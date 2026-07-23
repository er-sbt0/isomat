/**
 * checkpoint.sandbox.test.ts — compaction determinism, folded for real (M4 Stage D).
 *
 * The headline: a long log folds to the SAME workspace before and after a
 * checkpoint collapses its prefix into one synthesized `author` act — same object
 * ids, same live values, same layout, same retired set — while the log itself
 * shrinks from ~100 acts to a bounded handful. checkpoint.test.ts proves the pure
 * rewrite; this proves the cassette property survives the rewrite in QuickJS.
 */

import { describe, expect, it } from 'vitest';
import type { Handle, Id } from '@isomat/core';
import { fold, tryFold } from './node.js';
import { everyNActs } from './checkpoint.js';
import type { WorkspaceAct, WorkspaceLog } from './act.js';
import type { Workspace } from './fold.js';

const numAt = (objects: ReadonlyMap<Id, Handle>, id: Id): number =>
  (objects.get(id) as unknown as { value: number }).value;

/** Compare two folded workspaces on everything the cassette property covers. */
function expectSameWorkspace(a: Workspace, b: Workspace, numericIds: readonly Id[]): void {
  // same object ids
  expect([...a.objects.keys()].sort()).toEqual([...b.objects.keys()].sort());
  // same live values (re-invoking each derive's guest closure)
  for (const id of numericIds) expect(numAt(b.objects, id)).toBe(numAt(a.objects, id));
  // same layout
  expect([...b.layout.entries()].sort()).toEqual([...a.layout.entries()].sort());
  // same retired set
  expect([...b.retired].sort()).toEqual([...a.retired].sort());
}

/** Build a ~100-act log: two introduced params, two authored derivations, a move,
 *  a retire, a replace, and a long tail of drags — the churn compaction collapses. */
function longLog(): WorkspaceLog {
  const log: WorkspaceAct[] = [
    { kind: 'introduce', by: 'user', turn: 1, id: 'a@1', at: { x: 10, y: 20 },
      js: 'const a = param("a", 2, { range: [-9, 9], id: "a@1" });' },
    { kind: 'author', by: 'copilot', turn: 2,
      js: 'const a = byId("a@1");\nderive(() => a.value * a.value, { label: "y", id: "y@2" });\nplot((x) => a.value * x, { domain: [-5, 5], label: "f" });' },
    { kind: 'introduce', by: 'user', turn: 3, id: 'b@3', at: { x: 30, y: 40 },
      js: 'const b = param("b", 3, { range: [-9, 9], id: "b@3" });' },
    { kind: 'author', by: 'copilot', turn: 4,
      js: 'const a = byId("a@1");\nconst b = byId("b@3");\nderive(() => a.value + b.value, { label: "s", id: "s@4" });' },
    { kind: 'move', by: 'user', turn: 5, target: 'a@1', at: { x: 111, y: 222 } },
    { kind: 'retire', by: 'copilot', turn: 6, target: 'y@2' },
    // a replace mid-log — its churn must fold into a@1's single mint
    { kind: 'replace', by: 'copilot', turn: 7, target: 'a@1',
      js: 'const a = param("a", 5, { range: [-9, 9], id: "a@1" });' },
  ];
  // a long tail of interleaved drags on a@1 and b@3 (~90 acts)
  for (let i = 0; i < 45; i += 1) {
    log.push({ kind: 'set-input', by: 'user', turn: 8 + i, target: 'a@1', value: ((i * 3) % 17) - 8 });
    log.push({ kind: 'set-input', by: 'user', turn: 8 + i, target: 'b@3', value: ((i * 5) % 15) - 7 });
  }
  return log;
}

const NUMERIC: readonly Id[] = ['a@1', 'b@3', 'y@2', 's@4'];

describe('checkpoint compaction, folded through QuickJS', () => {
  it('folds to the SAME workspace before and after a checkpoint (determinism, ~100 acts)', async () => {
    const log = longLog();
    expect(log.length).toBeGreaterThan(90);

    const policy = everyNActs(50);
    expect(policy.shouldCompact(log)).toBe(true);
    const compacted = await policy.compact(log, tryFold);

    const before = await fold(log);
    const after = await fold(compacted);
    expect(before.ok ? 'ok' : before.failure.message).toBe('ok');
    expect(after.ok ? 'ok' : after.failure.message).toBe('ok');
    if (!before.ok || !after.ok) return;

    expectSameWorkspace(before.workspace, after.workspace, NUMERIC);
  });

  it('preserves ids: a prefix-introduced object still resolves post-checkpoint', async () => {
    const log = longLog();
    const compacted = await everyNActs(50).compact(log, tryFold);
    const after = await fold(compacted);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    // the explicit <base>@<n> ids survive the collapse — M.byId still resolves.
    for (const id of NUMERIC) expect(after.workspace.objects.has(id)).toBe(true);
    // and their live values are intact under those ids.
    expect(Number.isFinite(numAt(after.workspace.objects, 'a@1'))).toBe(true);
  });

  it('bounds replay: the ~100-act prefix collapses to 1 + |layout| + |retired| acts', async () => {
    const log = longLog();
    const compacted = await everyNActs(50).compact(log, tryFold);

    const before = await fold(log);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const expected = 1 + before.workspace.layout.size + before.workspace.retired.size;

    expect(compacted.length).toBe(expected);
    expect(compacted.length).toBeLessThan(log.length / 10); // ~100 → a handful
    expect(compacted[0]!.kind).toBe('author');
  });

  it('a drag in the collapsed prefix is reflected post-checkpoint (value preserved)', async () => {
    // author-minted param (explicit id) dragged to 5 in the prefix, then compacted
    // whole (keepRecent 0) — no introduce/move/retire, so the tail is empty and
    // the compacted log is exactly ONE act: 1 + |suffix(0)|.
    const log: WorkspaceLog = [
      { kind: 'author', by: 'user', turn: 1, js: 'param("a", 2, { range: [-9, 9], id: "a@1" });' },
      { kind: 'author', by: 'copilot', turn: 2, js: 'const a = byId("a@1"); derive(() => a.value * 10, { label: "b", id: "b@2" });' },
      { kind: 'set-input', by: 'user', turn: 3, target: 'a@1', value: 7 },
      { kind: 'set-input', by: 'user', turn: 4, target: 'a@1', value: 5 },
    ];
    const compacted = await everyNActs(4).compact(log, tryFold);
    expect(compacted).toHaveLength(1); // prefix → one act, no tail, no suffix

    const after = await fold(compacted);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    // the last prefix drag (5) survived the collapse, and the derive tracks it.
    expect(numAt(after.workspace.objects, 'a@1')).toBe(5);
    expect(numAt(after.workspace.objects, 'b@2')).toBe(50);
  });

  it('keepRecent keeps a live suffix: 1 + |suffix| acts, folds identically', async () => {
    const log: WorkspaceLog = [
      { kind: 'author', by: 'user', turn: 1, js: 'param("a", 2, { range: [-9, 9], id: "a@1" });' },
      { kind: 'author', by: 'copilot', turn: 2, js: 'const a = byId("a@1"); derive(() => a.value * a.value, { label: "y", id: "y@2" });' },
      { kind: 'set-input', by: 'user', turn: 3, target: 'a@1', value: 4 },
      { kind: 'set-input', by: 'user', turn: 4, target: 'a@1', value: -3 },
      { kind: 'set-input', by: 'user', turn: 5, target: 'a@1', value: 6 },
    ];
    const compacted = await everyNActs(5, { keepRecent: 2 }).compact(log, tryFold);
    expect(compacted).toHaveLength(1 + 2); // author + two preserved drags

    const before = await fold(log);
    const after = await fold(compacted);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expectSameWorkspace(before.workspace, after.workspace, ['a@1', 'y@2']);
    expect(numAt(after.workspace.objects, 'a@1')).toBe(6);
  });
});
