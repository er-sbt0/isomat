/**
 * checkpoint.test.ts — the N-acts compaction policy, at the log-rewriting tier
 * (M4 Stage D). No QuickJS: a fake `tryFold` stands in for the sandbox so the
 * PURE rewrite — boundary, prefix collapse, replace/edit-span fold-in, set-input
 * transcription, the layout/retired tail, suffix preservation — is provable
 * headless. The real-sandbox determinism proof lives in checkpoint.sandbox.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { CorrespondenceGraph, Id } from '@isomat/core';
import { everyNActs, noCheckpoint } from './checkpoint.js';
import type { Position, WorkspaceAct, WorkspaceLog } from './act.js';
import type { FoldOutcome, Workspace } from './fold.js';
import type { TryFold } from './commit.js';

const at = (x: number, y: number): Position => ({ x, y });

/** A fake `tryFold` that folds nothing — it only reports the layout/retired the
 *  checkpoint tail restores. The pure rewrite never runs guest code. */
function fakeTryFold(layout: ReadonlyMap<Id, Position>, retired: ReadonlySet<Id>): TryFold {
  const workspace: Workspace = {
    objects: new Map(),
    layout,
    retired,
    graph: {} as unknown as CorrespondenceGraph,
  };
  return (): FoldOutcome => ({ ok: true, workspace });
}

const introduceA: WorkspaceAct = {
  kind: 'introduce',
  by: 'user',
  turn: 1,
  id: 'a@1',
  at: at(10, 20),
  js: 'const a = param("a", 2, { range: [-5, 5], id: "a@1" });',
};
const authorY: WorkspaceAct = {
  kind: 'author',
  by: 'copilot',
  turn: 2,
  js: 'const a = byId("a@1"); derive(() => a.value * a.value, { label: "y", id: "y@2" });',
};
const setA = (value: number, turn = 3): WorkspaceAct => ({
  kind: 'set-input',
  by: 'user',
  turn,
  target: 'a@1',
  value,
});
const replaceA: WorkspaceAct = {
  kind: 'replace',
  by: 'copilot',
  turn: 4,
  target: 'a@1',
  js: 'const a = param("a", 4, { range: [-5, 5], id: "a@1" });',
};

describe('everyNActs — the trigger', () => {
  it('shouldCompact fires at the threshold, not before', () => {
    const policy = everyNActs(3);
    expect(policy.shouldCompact([])).toBe(false);
    expect(policy.shouldCompact([introduceA, authorY])).toBe(false);
    expect(policy.shouldCompact([introduceA, authorY, setA(1)])).toBe(true);
    expect(policy.shouldCompact([introduceA, authorY, setA(1), setA(2)])).toBe(true);
  });

  it('rejects a non-positive or non-integer threshold', () => {
    expect(() => everyNActs(0)).toThrow(/positive integer/);
    expect(() => everyNActs(-1)).toThrow(/positive integer/);
    expect(() => everyNActs(2.5)).toThrow(/positive integer/);
  });
});

describe('noCheckpoint — the opt-out', () => {
  it('never fires and returns the log by reference', async () => {
    const log: WorkspaceLog = [introduceA, authorY, setA(1)];
    expect(noCheckpoint.shouldCompact(log)).toBe(false);
    expect(await noCheckpoint.compact(log, fakeTryFold(new Map(), new Set()))).toBe(log);
  });
});

describe('everyNActs — the compaction rewrite', () => {
  it('collapses the prefix to ONE author act carrying every object under its id', async () => {
    const log: WorkspaceLog = [introduceA, authorY, setA(3), replaceA];
    const layout = new Map<Id, Position>([['a@1', at(10, 20)]]);
    const compacted = await everyNActs(4).compact(log, fakeTryFold(layout, new Set()));

    // prefix (all 4 acts) → one author act; one move restoring a@1's layout.
    expect(compacted).toHaveLength(2);
    const [synth, move] = compacted;
    expect(synth!.kind).toBe('author');
    expect(move).toMatchObject({ kind: 'move', target: 'a@1', at: at(10, 20) });

    const js = (synth as { js: string }).js;
    // the introduce is minted under its OWN id…
    expect(js).toContain('id: "a@1"');
    // …with the REPLACE's definition folded in (value 4), not the introduce's (2).
    expect(js).toContain('param("a", 4');
    expect(js).not.toContain('param("a", 2');
    // the author-derived object is carried verbatim, under its id.
    expect(js).toContain('id: "y@2"');
    // the set-input is transcribed as an in-order live setter.
    expect(js).toContain('byId("a@1").setValueLive(3)');
  });

  it('restores layout and retired as a bounded projection tail', async () => {
    const log: WorkspaceLog = [introduceA, authorY, setA(1)];
    const layout = new Map<Id, Position>([['a@1', at(1, 2)]]);
    const retired = new Set<Id>(['y@2']);
    const compacted = await everyNActs(3).compact(log, fakeTryFold(layout, retired));

    // [synthesized, move a@1, retire y@2] — 1 + |layout| + |retired|.
    expect(compacted).toHaveLength(3);
    expect(compacted.map((a) => a.kind)).toEqual(['author', 'move', 'retire']);
    expect(compacted[1]).toMatchObject({ kind: 'move', target: 'a@1', at: at(1, 2) });
    expect(compacted[2]).toMatchObject({ kind: 'retire', target: 'y@2' });
  });

  it('keepRecent leaves the most-recent acts as an un-compacted suffix', async () => {
    const log: WorkspaceLog = [introduceA, authorY, setA(1), setA(2), setA(3)];
    // no layout/retired here → the tail is empty, so length is exactly 1 + |suffix|.
    const compacted = await everyNActs(5, { keepRecent: 2 }).compact(log, fakeTryFold(new Map(), new Set()));

    expect(compacted).toHaveLength(1 + 2);
    expect(compacted[0]!.kind).toBe('author');
    // the last two acts are preserved verbatim, by reference.
    expect(compacted[1]).toBe(log[3]);
    expect(compacted[2]).toBe(log[4]);
  });

  it('leaves a prefix it cannot resolve untouched (one-transaction discipline)', async () => {
    // a replace with no earlier introduce for its target → resolvePass fails.
    const badReplace: WorkspaceAct = {
      kind: 'replace',
      by: 'user',
      turn: 2,
      target: 'ghost@9',
      js: 'param("g", 1, { range: [-1, 1], id: "ghost@9" });',
    };
    const log: WorkspaceLog = [introduceA, badReplace];
    const compacted = await everyNActs(2).compact(log, fakeTryFold(new Map(), new Set()));
    expect(compacted).toBe(log);
  });
});
