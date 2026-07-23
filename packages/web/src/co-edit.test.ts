/**
 * co-edit.test.ts — the engine contracts the W2 UI leans on.
 *
 * `session.ts` is a thin React wrapper over `commit` / `coalesce` / `foldLog`.
 * What is worth pinning is not the wrapper but the guarantees it advertises to
 * the user through the interface: that a drag becomes ONE act, that a rejected
 * act changes nothing, that undo is truncation, and that retiring hides an
 * object WITHOUT deleting it. Each of those is a promise the UI makes visually,
 * so each gets a test.
 *
 * Folds through `@isomat/workspace/node` — a test runs in Node, and the fence
 * exempts `*.test.ts` for exactly this. The APP may only reach `./browser`.
 */

import { describe, expect, it } from 'vitest';
import type { Id } from '@isomat/core';
import { coalesce, commit } from '@isomat/workspace';
import type { WorkspaceAct, WorkspaceLog } from '@isomat/workspace';
import { fold, tryFold } from '@isomat/workspace/node';
import { introduceExpr } from '@isomat/parse';
import { DEMO_LOG } from './demo-log.js';

const numAt = (ws: { objects: ReadonlyMap<Id, unknown> }, id: string): number =>
  (ws.objects.get(id as Id) as { value: number }).value;

const setA = (value: number, turn: number): WorkspaceAct => ({
  kind: 'set-input',
  by: 'user',
  turn,
  target: 'a@1',
  value,
});

describe('a drag becomes one act', () => {
  // Explicit logs, not DEMO_LOG — the demo already ENDS with a set-input on
  // a@1, which correctly merges into a following sweep and would make the
  // arithmetic here read like an off-by-one rather than the rule it is.
  const intro: WorkspaceAct = DEMO_LOG[0]!;

  it('consecutive set-inputs on the same target coalesce to the last', () => {
    // What a slider sweep emits if every frame committed.
    const swept: WorkspaceLog = [intro, setA(3.1, 2), setA(3.6, 3), setA(4, 4)];
    const collapsed = coalesce(swept);

    expect(collapsed).toHaveLength(2); // the introduce + ONE set-input
    const last = collapsed[collapsed.length - 1]!;
    expect(last.kind).toBe('set-input');
    expect((last as { value: number }).value).toBe(4);
  });

  it('does NOT merge across an executable act — that act was authored against the earlier value', () => {
    const author: WorkspaceAct = { kind: 'author', by: 'copilot', turn: 3, js: '' };
    const log: WorkspaceLog = [intro, setA(1, 2), author, setA(2, 4)];
    // Merging across `author` would silently rewrite the world it was written for.
    expect(coalesce(log)).toHaveLength(log.length);
  });
});

describe('the one-transaction rule, as the UI relies on it', () => {
  it('a rejected act leaves the PRIOR log untouched, referentially', async () => {
    const log: WorkspaceLog = [...DEMO_LOG];
    // `set-input` naming an object that is not in the scene is a failure.
    const bad: WorkspaceAct = { kind: 'set-input', by: 'user', turn: 9, target: 'nope@1', value: 1 };

    const result = await commit(log, bad, tryFold);

    expect(result.ok).toBe(false);
    expect(result.log).toBe(log); // same reference — nothing half-applied
    if (!result.ok) expect(result.errors[0]).toContain('position');
  });

  it('an accepted act advances the log by exactly one', async () => {
    const log: WorkspaceLog = [...DEMO_LOG];
    const result = await commit(log, setA(4, 4), tryFold);
    expect(result.ok).toBe(true);
    expect(result.log).toHaveLength(log.length + 1);
  });
});

describe('undo is truncation — the workspace IS fold(log)', () => {
  it('dropping the last act restores the previous value with no inverse operation', async () => {
    const log: WorkspaceLog = [...DEMO_LOG];
    const before = await fold(log);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(numAt(before.workspace, 'a@1')).toBe(3);

    const advanced = [...log, setA(4, 4)];
    const after = await fold(advanced);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(numAt(after.workspace, 'a@1')).toBe(4);

    // Undo: no undo stack, no inverse act — just a shorter log.
    const undone = await fold(advanced.slice(0, -1));
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(numAt(undone.workspace, 'a@1')).toBe(3);
  });
});

describe('retire hides without deleting', () => {
  it('the object stays in `objects` and only joins the `retired` projection', async () => {
    const log: WorkspaceLog = [...DEMO_LOG];
    const base = await fold(log);
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const target = [...base.workspace.objects.values()].find((h) => h.kind === 'view:readout')!;
    const withRetire: WorkspaceLog = [
      ...log,
      { kind: 'retire', by: 'user', turn: 4, target: target.id },
    ];

    const out = await fold(withRetire);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // Still addressable — `byId` must resolve it and dependents keep recomputing.
    expect(out.workspace.objects.has(target.id)).toBe(true);
    // ...but the UI is required to filter it out.
    expect(out.workspace.retired.has(target.id)).toBe(true);
  });
});

describe('a typed expression binds to a live parameter', () => {
  it('introduceExpr("a*x + 1") tracks `a` — the curve follows a later set-input', async () => {
    const act = introduceExpr({
      text: 'a*x + 1',
      at: { x: 40, y: 40 },
      id: 'e1@4',
      domain: [-5, 5],
      indepVar: 'x',
      bindings: { a: 'a@1' },
      by: 'user',
      turn: 4,
    });

    const log: WorkspaceLog = [...DEMO_LOG, act];
    const out = await fold(log);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const fn = out.workspace.objects.get('e1@4' as Id) as unknown as { at(x: number): number };
    // a = 3 from the demo log's set-input, so f(2) = 3*2 + 1 = 7.
    expect(fn.at(2)).toBeCloseTo(7);

    // Move `a` and re-fold: the SAME expression samples differently, which is
    // what "binds to the live parameter" has to mean.
    const moved = await fold([...log, setA(5, 5)]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const fn2 = moved.workspace.objects.get('e1@4' as Id) as unknown as { at(x: number): number };
    expect(fn2.at(2)).toBeCloseTo(11); // 5*2 + 1
  });

  it('an unbound free variable throws BEFORE any act exists', () => {
    expect(() =>
      introduceExpr({
        text: 'q*x',
        at: { x: 0, y: 0 },
        id: 'e2@4',
        domain: [-5, 5],
        indepVar: 'x',
        bindings: {},
      }),
    ).toThrow(/free variable/i);
  });
});
