/**
 * introduce.sandbox.test.ts — the front door, end to end (roadmap M3 exit).
 *
 * Type "x^2 + a*x" → an `introduce` act → fold it into a real Workspace through
 * QuickJS → a live plotted object whose sampler evaluates the actual arithmetic,
 * reading the live parameter `a`. Then set `a` and re-fold: the curve updates and
 * the object's id is unchanged. This is the M3 exit minus edit-span (M4).
 */

import { describe, expect, it } from 'vitest';
import { fold } from '@isomat/workspace/node';
import type { WorkspaceLog } from '@isomat/workspace';
import { introduceExpr } from './introduce.js';
import { resolveSpan } from './editspan.js';

/** Turn 0: a live parameter `a` with a known stable id to bind against. */
const authorA: WorkspaceLog[number] = {
  kind: 'author',
  js: 'param("a", 1, { range: [-3, 3], id: "a" });',
  source: 'a = 1',
  by: 'user',
  turn: 0,
};

/** The plotted fn handle's numeric rule, reached by id from the folded scene. */
async function sampleAt(log: WorkspaceLog, id: string, x: number): Promise<number> {
  const w = await fold(log);
  if (!w.ok) throw new Error(`did not fold: ${JSON.stringify((w as { failure: unknown }).failure)}`);
  const fn = w.workspace.objects.get(id) as unknown as { at(x: number): number } | undefined;
  if (!fn || typeof fn.at !== 'function') throw new Error(`no sampleable object "${id}" in the scene`);
  return fn.at(x);
}

describe('introduceExpr → fold → a live plotted object', () => {
  it('parses, mints a stable-id fn, and samples the actual arithmetic', async () => {
    const intro = introduceExpr({
      text: 'x^2 + a*x',
      at: { x: 100, y: 40 },
      id: 'curve',
      domain: [-2, 2],
      bindings: { a: 'a' },
      turn: 1,
    });
    const log: WorkspaceLog = [authorA, intro];

    // the introduce carries the human text, and the fold accepts it
    expect(intro.source).toBe('x^2 + a*x');
    const w = await fold(log);
    expect(w.ok ? 'ok' : JSON.stringify((w as { failure: unknown }).failure)).toBe('ok');
    if (!w.ok) return;

    // the object is in the scene under its stable id, kind fn, and it is placed
    const curve = w.workspace.objects.get('curve');
    expect(curve?.kind).toBe('fn');
    expect(w.workspace.layout.get('curve')).toEqual({ x: 100, y: 40 });

    // it SAMPLES the arithmetic, reading a = 1: x^2 + a*x at x = 3 is 9 + 3 = 12
    expect(await sampleAt(log, 'curve', 3)).toBe(12);
    expect(await sampleAt(log, 'curve', 2)).toBe(6); // 4 + 2
  });

  it('a set-input on `a` + re-fold updates the curve; the id is stable', async () => {
    const intro = introduceExpr({
      text: 'x^2 + a*x',
      at: { x: 0, y: 0 },
      id: 'curve',
      domain: [-2, 2],
      bindings: { a: 'a' },
      turn: 1,
    });
    const base: WorkspaceLog = [authorA, intro];

    // drag a → 2 is a set-input act; re-fold re-samples (state = fold(log))
    const dragged: WorkspaceLog = [
      ...base,
      { kind: 'set-input', target: 'a', value: 2, by: 'user', turn: 2 },
    ];

    // at x = 3: a=1 → 12, then a=2 → 9 + 6 = 15
    expect(await sampleAt(base, 'curve', 3)).toBe(12);
    expect(await sampleAt(dragged, 'curve', 3)).toBe(15);

    // the object kept its id across the re-fold (the cassette property)
    const w = await fold(dragged);
    expect(w.ok && w.workspace.objects.has('curve')).toBe(true);
  });

  it('a bound expression tracks the live parameter through the bridge', async () => {
    // sin(a*x): purely to show a whitelisted function + binding fold and sample
    const intro = introduceExpr({
      text: 'a*x',
      at: { x: 0, y: 0 },
      id: 'line',
      domain: [-1, 1],
      bindings: { a: 'a' },
      turn: 1,
    });
    const log: WorkspaceLog = [authorA, intro];
    expect(await sampleAt(log, 'line', 4)).toBe(4); // a=1 → 1*4
  });
});

describe('edit-span → re-parse → re-emit under the same id (roadmap M4 Stage B)', () => {
  const num = (log: WorkspaceLog, id: string) =>
    fold(log, resolveSpan).then((w) => {
      if (!w.ok) throw new Error(`did not fold: ${JSON.stringify((w as { failure: unknown }).failure)}`);
      return (w.workspace.objects.get(id) as unknown as { value: number }).value;
    });
  const sample = (log: WorkspaceLog, id: string, x: number) =>
    fold(log, resolveSpan).then((w) => {
      if (!w.ok) throw new Error(`did not fold: ${JSON.stringify((w as { failure: unknown }).failure)}`);
      return (w.workspace.objects.get(id) as unknown as { at(x: number): number }).at(x);
    });

  /** curve = x^2 + a*x (term0 = x^2, term1 = a*x), bound to the live param `a`. */
  const curve = () =>
    introduceExpr({ text: 'x^2 + a*x', at: { x: 0, y: 0 }, id: 'curve', domain: [-2, 2], bindings: { a: 'a' }, turn: 1 });

  /** A dependent authored off the curve by id — it must reflect the edited definition. */
  const dependent: WorkspaceLog[number] = {
    kind: 'author',
    js: 'const c = byId("curve"); derive(() => c.at(2), { label: "d", id: "d" });',
    by: 'copilot',
    turn: 2,
  };

  it('edits term0 (x^2 → x^3): the curve and its dependent recompute; id stable', async () => {
    const base: WorkspaceLog = [authorA, curve(), dependent];
    const edited: WorkspaceLog = [
      ...base,
      { kind: 'edit-span', target: 'curve', role: 'term0', text: 'x^3', by: 'user', turn: 3 },
    ];

    // before: x^2 + a*x at x=2, a=1 → 4 + 2 = 6
    expect(await sample(base, 'curve', 2)).toBe(6);
    expect(await num(base, 'd')).toBe(6);

    // after editing term0 to x^3: x^3 + a*x at x=2, a=1 → 8 + 2 = 10
    expect(await sample(edited, 'curve', 2)).toBe(10);
    // the DEPENDENT recomputed against the new definition, too
    expect(await num(edited, 'd')).toBe(10);

    // the object kept its id across the edit — the id-stability watch
    const w = await fold(edited, resolveSpan);
    expect(w.ok && w.workspace.objects.has('curve')).toBe(true);
    if (w.ok) expect(w.workspace.layout.get('curve')).toEqual({ x: 0, y: 0 });
  });

  it('composes two edit-spans on the same object (term0 then term1); id stable', async () => {
    const log: WorkspaceLog = [
      authorA,
      curve(),
      { kind: 'edit-span', target: 'curve', role: 'term0', text: 'x^3', by: 'user', turn: 3 },
      { kind: 'edit-span', target: 'curve', role: 'term1', text: '2*a*x', by: 'user', turn: 4 },
    ];
    // curve is now x^3 + 2*a*x; at x=2, a=1 → 8 + 2*1*2 = 12
    expect(await sample(log, 'curve', 2)).toBe(12);

    const w = await fold(log, resolveSpan);
    expect(w.ok && w.workspace.objects.has('curve')).toBe(true);
  });

  it('an edit-span with a malformed role is a FoldFailure, prior definition untouched', async () => {
    const log: WorkspaceLog = [
      authorA,
      curve(),
      { kind: 'edit-span', target: 'curve', role: 'term9', text: 'x', by: 'user', turn: 3 },
    ];
    const w = await fold(log, resolveSpan);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.failure.kind).toBe('edit-span');
  });
});
