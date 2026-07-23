/**
 * tools.test.ts — the tool layer, with no sandbox in the way (roadmap M2a).
 *
 * The rules tier: dispatch, the boundary, typed errors, and the disposable-fold
 * probes, exercised over a scene built IN-PROCESS (a real world, stage and
 * native scope, driven by direct library calls instead of QuickJS). The sibling
 * `tools.workspace.test.ts` proves the same tools against a scene a real guest
 * program folds through `@isomat/workspace/node`; this proves the logic where it
 * is cheap.
 *
 * M2a retarget: the fold is `@isomat/workspace`'s own `foldLog` (not the
 * superseded `replayLog`), the log is a `WorkspaceLog` of `author` acts, and a
 * committed write lands a real `SetInputAct` / `AuthorAct`. The thunk registry
 * stands in for QuickJS execution — a source string keys the closure an `author`
 * act "runs" — exactly the seam the sandbox test backs with a real VM.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage, sceneIndex } from '@isomat/objects';
import { createNativeScope } from '@isomat/objects';
import type { NativeScope } from '@isomat/objects';
import { foldLog } from '@isomat/workspace';
import type { ExecutableAct, TryFold, WorkspaceLog } from '@isomat/workspace';
import {
  appendFragment,
  bisectFlip,
  counterfactual,
  evalAt,
  inspect,
  numericEquivalence,
  numericRoot,
  plot,
  runTool,
  setInput,
  tabulate,
  whyChanged,
} from '@isomat/copilot';
import type { CompileFragment } from '@isomat/copilot';

/**
 * One scene with something for every surviving dispatch arm: a draggable
 * parameter, a derived scalar, a two-sided claim, and a plotted fn — all
 * MENTIONED, because the boundary rule says a tool reaches what the manifest
 * offers and nothing else.
 */
function build(scope: NativeScope) {
  const spin = scope.param('spin', 1, { range: [-2, 2] });
  const doubled = scope.derive(() => 2 * spin.value, { label: 'doubled' });
  const under = scope.claim({ lhs: doubled, rhs: 3, relation: '<=', label: 'doubled stays under 3' });
  // a plot projects its rule as an id-reachable `fn` handle — evalAt's subject
  const plot = scope.plot((x) => spin.value / x, { domain: [1, 5], label: 'f' });
  const f = plot.elements[0] as unknown as { id: string; kind: string };

  return { spin, doubled, under, f };
}

function scene() {
  const world = createWorld();
  const stage = createStage(world);
  const scope: NativeScope = createNativeScope(world, stage);
  const refs = build(scope);

  // the hook contract: the scene map IS sceneIndex, built per probe so it
  // describes the workspace as it stands, not as it stood when the test began
  const index = () => sceneIndex(stage);

  // the live workspace is fold(log) too: one author act, standing for build()
  const log: WorkspaceLog = [{ kind: 'author', js: 'build', source: 'build', by: 'user', turn: 0 }];

  // An in-process fold: fresh world, replay the CANDIDATE through foldLog, hand
  // back the Workspace. Determinism means the folded ids line up with the live
  // scene's. `author` sources are interpreted through THUNKS — the stand-in for
  // QuickJS execution; the sibling .workspace.test.ts runs real guest code.
  const thunks: Record<string, (sc: NativeScope) => void> = {
    build,
    noteBeat: (sc) => {
      sc.note`a note`;
    },
  };
  const fold: TryFold = (candidate) => {
    const w = createWorld();
    const st = createStage(w);
    const sc = createNativeScope(w, st);
    return foldLog(candidate, {
      execute: (act: ExecutableAct) => {
        const run = thunks[act.source ?? ''];
        if (!run) throw new Error(`no thunk for source "${act.source}"`);
        run(sc);
      },
      scene: () => sceneIndex(st),
      graph: () => w.graph,
    });
  };

  return { stage, scope, index, log, fold, ...refs };
}

describe('inspect — the full structured value of one object', () => {
  it('a parameter: value and range', () => {
    const s = scene();
    const r = inspect(s.index(), s.spin.id);
    expect(r).toEqual({
      ok: true,
      value: { id: s.spin.id, kind: 'parameter', label: 'spin', value: 1, range: [-2, 2] },
    });
  });

  it('a claim: verdict, evidence, and both sides with the gap', () => {
    const s = scene();
    const r = inspect(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        kind: 'claim',
        label: 'doubled stays under 3',
        holds: true, // 2·1 ≤ 3
        evidence: 'exact-comparison',
        relation: '<=',
        lhs: 2,
        rhs: 3,
        gap: -1,
      });
    }
  });

  it('the claim inspects LIVE: a drag that breaks it is visible', () => {
    const s = scene();
    s.spin.setValueLive(2); // 2·2 = 4 > 3
    const r = inspect(s.index(), s.under.id);
    expect(r.ok && (r.value as { holds: boolean }).holds).toBe(false);
  });

  it('a derived scalar falls through to {id, kind, label, value}', () => {
    const s = scene();
    const r = inspect(s.index(), s.doubled.id);
    expect(r).toEqual({
      ok: true,
      value: { id: s.doubled.id, kind: 'scalar', label: 'doubled', value: 2 },
    });
  });

  it('an unknown id is a typed error naming the boundary rule', () => {
    const s = scene();
    const r = inspect(s.index(), 'parameter#999');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('unknown-id');
      expect(r.error.message).toContain('parameter#999');
      expect(r.error.message).toContain('manifest');
    }
  });
});

describe('evalAt — sample a rule the object already carries', () => {
  it('a fn at x', () => {
    const s = scene();
    // rule is spin / x with spin = 1
    expect(evalAt(s.index(), s.f.id, [4])).toEqual({ ok: true, value: 0.25 });
  });

  it('reads the rule LIVE: a dragged parameter changes the sample', () => {
    const s = scene();
    s.spin.setValueLive(-2);
    expect(evalAt(s.index(), s.f.id, [2])).toEqual({ ok: true, value: -1 });
  });

  it('wrong arity is a typed error naming what was wanted', () => {
    const s = scene();
    const r = evalAt(s.index(), s.f.id, [1, 2]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('bad-args');
      expect(r.error.message).toContain('1 finite coordinate');
    }
  });

  it('a non-finite input is bad-args, not a crash', () => {
    const s = scene();
    const r = evalAt(s.index(), s.f.id, [Number.NaN]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });

  it('a pole is a domain error, not Infinity smuggled through JSON', () => {
    const s = scene();
    const r = evalAt(s.index(), s.f.id, [0]); // spin/x at 0
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('domain');
  });

  it('an object with no rule is not-evaluable', () => {
    const s = scene();
    const r = evalAt(s.index(), s.under.id, [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-evaluable');
      expect(r.error.message).toContain('claim');
    }
  });
});

describe('runTool — errors are data, never a throw', () => {
  it('dispatches a typed call', async () => {
    const s = scene();
    const out = await runTool({ tool: 'inspect', id: s.spin.id }, { scene: s.index });
    expect(out.result.ok).toBe(true);
  });

  it('an experiment call without a fold hook is a failed result, not a crash', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'bisectFlip', param: s.spin.id, claim: s.under.id, lo: -2, hi: 2 },
      { scene: s.index },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe('failed');
  });

  it('a scene that throws mid-read comes back as a failed result', async () => {
    const s = scene();
    const bomb = s.scope.claim({
      predicate: () => {
        throw new Error('the predicate exploded');
      },
      label: 'unstable',
    });
    const out = await runTool({ tool: 'inspect', id: bomb.id }, { scene: s.index });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe('failed');
      expect(out.result.error.message).toContain('the predicate exploded');
    }
  });
});

describe('whyChanged — causality read off the reactive graph', () => {
  it('walks a claim back to the parameter that moves it: claim → gap → derived → input', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    // ordered from the asked-about thing back to the root input
    expect(chain.map((e) => e['kind'])).toEqual(['claim', 'scalar', 'scalar', 'parameter']);
    expect(chain[0]).toMatchObject({ id: s.under.id, value: true });
    expect(chain[1]).toMatchObject({ label: 'gap', value: -1 });
    expect(chain[2]).toMatchObject({ id: s.doubled.id, label: 'doubled', value: 2 });
    expect(chain[3]).toMatchObject({ id: s.spin.id, label: 'spin', value: 1 });
  });

  it('answers about the CURRENT state: after the drag that broke the claim', () => {
    const s = scene();
    s.spin.setValueLive(2);
    const r = whyChanged(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    expect(chain[0]).toMatchObject({ value: false }); // the claim is broken…
    expect(chain[chain.length - 1]).toMatchObject({ id: s.spin.id, value: 2 }); // …because spin is 2
  });

  it('a derived scalar walks straight to its input', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.doubled.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    expect(chain.map((e) => e['id'])).toEqual([s.doubled.id, s.spin.id]);
  });

  it('a parameter is an INPUT — the typed error says where its history lives', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.spin.id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-derived');
      expect(r.error.message).toContain('INPUT');
      expect(r.error.message).toContain('set-input');
    }
  });

  it('unknown ids hit the same boundary as every other tool', () => {
    const s = scene();
    const r = whyChanged(s.index(), 'derived#404');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-id');
  });
});

describe('counterfactual — a disposable fold, not the live workspace', () => {
  it('answers "what if spin were 2" and leaves the screen untouched', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: 2 }],
      read: [s.doubled.id, s.under.id],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reads = (r.value as { reads: Array<Record<string, unknown>> }).reads;
      expect(reads[0]).toMatchObject({ id: s.doubled.id, value: 4 });
      expect(reads[1]).toMatchObject({ id: s.under.id, holds: false });
    }
    // the probe ran in a throwaway fold: the LIVE scene never moved
    expect(s.spin.value).toBe(1);
    expect(s.under.holds).toBe(true);
  });

  it("a set on an id the workspace does not offer is the fold's rejection, verbatim", async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: 'parameter#999', value: 2 }],
      read: [s.doubled.id],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('rejected');
      expect(r.error.message).toContain('parameter#999');
    }
  });

  it('a read of an unknown id fails whole — no partial answers to guess around', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: 2 }],
      read: ['scalar#404'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-id');
  });

  it('non-finite values are bad-args before any fold is spent', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: Number.POSITIVE_INFINITY }],
      read: [s.doubled.id],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });
});

describe('bisectFlip — the exact threshold, one disposable fold per probe', () => {
  it('finds where "2·spin ≤ 3" flips: the analytic threshold is 1.5', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as {
      flipped: boolean;
      lo: number;
      hi: number;
      holdsAtLo: boolean;
      holdsAtHi: boolean;
      probes: number;
    };
    expect(v.flipped).toBe(true);
    expect(v.holdsAtLo).toBe(true);
    expect(v.holdsAtHi).toBe(false);
    // The bracket pins the analytically known flip point — which, precisely, is
    // 1.5 + tol/2: the claim's `<=` carries its default 1e-9 float-hygiene
    // tolerance, and the bisection is exact enough to resolve THAT.
    expect(v.lo).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(v.hi).toBeGreaterThanOrEqual(1.5);
    expect((v.lo + v.hi) / 2).toBeCloseTo(1.5, 6);
    expect(v.probes).toBeLessThanOrEqual(40);
    // and the live scene never moved through ~40 folds
    expect(s.spin.value).toBe(1);
  });

  it('both ends agreeing is a typed no-flip result, not an error', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 1,
    });
    expect(r).toEqual({
      ok: true,
      value: { flipped: false, lo: -2, hi: 1, holdsAtLo: true, holdsAtHi: true, probes: 2 },
    });
  });

  it('the probe cap holds: a small budget still returns a (wider) bracket', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 2,
      maxProbes: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { probes: number; lo: number; hi: number };
      expect(v.probes).toBeLessThanOrEqual(6);
      expect(v.lo).toBeLessThanOrEqual(1.5);
      expect(v.hi).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('watching a non-claim is bad-args naming what bisect needs', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.doubled.id,
      lo: -2,
      hi: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('bad-args');
      expect(r.error.message).toContain('not a claim');
    }
  });

  it('inverted bounds are bad-args before any fold is spent', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, { param: s.spin.id, claim: s.under.id, lo: 2, hi: -2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });
});

describe('setInput — the event path as a tool', () => {
  it("commits via commit and hands back the advanced log; the screen is the caller's", async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: s.spin.id, value: -1 });
    expect(w.result.ok).toBe(true);
    expect(w.log).toHaveLength(2);
    expect(w.log[1]).toEqual({
      kind: 'set-input',
      target: s.spin.id,
      value: -1,
      by: 'copilot',
      turn: 0,
    });
    // the committed log FOLDS to the new value…
    const folded = await s.fold(w.log);
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const r = inspect(folded.workspace.objects, s.spin.id);
      expect(r.ok && (r.value as { value: number }).value).toBe(-1);
    }
    // …while the live stage stays whatever it was: reflecting an accepted log
    // (a re-fold, a poke) is the caller's act, as on the manipulate path
    expect(s.spin.value).toBe(1);
  });

  it('the write can be authorship-tagged for the loop that drives it', async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: s.spin.id, value: 0 }, { by: 'user', turn: 3 });
    expect(w.result.ok).toBe(true);
    expect(w.log[1]).toMatchObject({ by: 'user', turn: 3 });
  });

  it('an id the workspace does not offer is rejected, and the log is untouched', async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: 'parameter#999', value: 0 });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      expect(w.result.error.message).toContain('parameter#999');
    }
    expect(w.log).toBe(s.log);
  });

  it("a target that is not settable is the fold's complaint, verbatim", async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: s.under.id, value: 0 });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) expect(w.result.error.message).toContain('not settable');
  });
});

describe('appendFragment — the author path as a tool', () => {
  /** A gate that rejects on a marker: the unit-tier stand-in for lint. */
  const compile: CompileFragment = (source) =>
    source.includes('FORBIDDEN')
      ? { ok: false, errors: ['banned-global: FORBIDDEN is a sandbox-escape'] }
      : { ok: true, js: source };

  it('gates, commits, and the accepted log carries the author act', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'noteBeat' });
    expect(w.result.ok).toBe(true);
    expect(w.log).toHaveLength(2);
    expect(w.log[1]).toMatchObject({ kind: 'author', source: 'noteBeat', by: 'copilot', turn: 0 });
    expect((await s.fold(w.log)).ok).toBe(true);
  });

  it('a gate rejection returns VERBATIM as the tool error — retry is repair', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'FORBIDDEN' });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      expect(w.result.error.message).toBe('banned-global: FORBIDDEN is a sandbox-escape');
    }
    expect(w.log).toBe(s.log);
  });

  it('a fragment that gates but breaks the fold is rejected the same way', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'no-such-thunk' });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) expect(w.result.error.code).toBe('rejected');
    expect(w.log).toBe(s.log);
  });

  it('runTool routes writes and reports the advanced log', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'setInput', id: s.spin.id, value: 2 },
      { scene: s.index, log: s.log, fold: s.fold },
    );
    expect(out.result.ok).toBe(true);
    expect(out.log).toHaveLength(2);
  });

  it('appendFragment without a compile hook is a failed result, not a crash', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'appendFragment', source: 'noteBeat' },
      { scene: s.index, log: s.log, fold: s.fold },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe('failed');
  });
});

// ── M5a: the four probe tools — each returns typed `sampled` evidence ──

/** Register a plotted fn in the scene and hand back its id — the probe subject. */
function plotFn(
  scope: NativeScope,
  rule: (x: number) => number,
  label: string,
  domain: readonly [number, number] = [-3, 3],
): string {
  return (scope.plot(rule, { domain: [domain[0], domain[1]], label }).elements[0] as unknown as { id: string })
    .id;
}

describe('tabulate — sample a live fn at evenly spaced points (sampled)', () => {
  it('returns count rows of [x, y] read off the object rule', () => {
    const s = scene();
    // s.f is spin/x with spin = 1: at x = 1..5 the values are 1, .5, .333…, .25, .2
    const r = tabulate(s.index(), { id: s.f.id, from: 1, to: 5, count: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = (r.value as { rows: Array<[number, number]> }).rows;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual([1, 1]);
    expect(rows[4]).toEqual([5, 0.2]);
  });

  it('a point outside the domain is a domain error (spin/x at 0)', () => {
    const s = scene();
    const r = tabulate(s.index(), { id: s.f.id, from: 0, to: 4, count: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('domain');
  });

  it('a non-fn is not-evaluable; an unknown id is the boundary; bad count is bad-args', () => {
    const s = scene();
    expect((tabulate(s.index(), { id: s.under.id, from: 1, to: 5, count: 3 }) as { error: { code: string } }).error?.code).toBe('not-evaluable');
    expect((tabulate(s.index(), { id: 'fn#999', from: 1, to: 5, count: 3 }) as { error: { code: string } }).error?.code).toBe('unknown-id');
    expect((tabulate(s.index(), { id: s.f.id, from: 1, to: 5, count: 0 }) as { error: { code: string } }).error?.code).toBe('bad-args');
    expect((tabulate(s.index(), { id: s.f.id, from: Number.NaN, to: 5, count: 3 }) as { error: { code: string } }).error?.code).toBe('bad-args');
  });
});

describe('numericEquivalence — sampled agreement, NEVER a proof', () => {
  it('two ids for the same function agree: equivalent true, maxAbsDiff 0', () => {
    const s = scene();
    const a = plotFn(s.scope, (x) => x * x, 'sq-a');
    const b = plotFn(s.scope, (x) => x * x, 'sq-b');
    const r = numericEquivalence(s.index(), { idA: a, idB: b, from: -3, to: 3, count: 11 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ equivalent: true, maxAbsDiff: 0, points: 11 });
      expect((r.value as { tolerance: number }).tolerance).toBe(1e-9);
    }
  });

  it('a mismatched pair reports equivalent false with a REAL maxAbsDiff', () => {
    const s = scene();
    const a = plotFn(s.scope, (x) => x * x, 'sq');
    const b = plotFn(s.scope, (x) => x * x + 1, 'sq-plus-one');
    const r = numericEquivalence(s.index(), { idA: a, idB: b, from: -3, to: 3, count: 11 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ equivalent: false, maxAbsDiff: 1 });
  });

  it('a generous tolerance can call a small gap equivalent — still sampled, not proven', () => {
    const s = scene();
    const a = plotFn(s.scope, (x) => x * x, 'sq');
    const b = plotFn(s.scope, (x) => x * x + 0.5, 'sq-plus-half');
    const r = numericEquivalence(s.index(), { idA: a, idB: b, from: -3, to: 3, count: 11, tolerance: 1 });
    expect(r.ok && (r.value as { equivalent: boolean }).equivalent).toBe(true);
  });

  it('validates: unknown id, bad count, negative tolerance', () => {
    const s = scene();
    const a = plotFn(s.scope, (x) => x, 'lin');
    expect((numericEquivalence(s.index(), { idA: a, idB: 'fn#404', from: -1, to: 1, count: 3 }) as { error: { code: string } }).error?.code).toBe('unknown-id');
    expect((numericEquivalence(s.index(), { idA: a, idB: a, from: -1, to: 1, count: 0 }) as { error: { code: string } }).error?.code).toBe('bad-args');
    expect((numericEquivalence(s.index(), { idA: a, idB: a, from: -1, to: 1, count: 3, tolerance: -1 }) as { error: { code: string } }).error?.code).toBe('bad-args');
  });
});

describe('numericRoot — scan for a sign change, then bisect (sampled)', () => {
  it('finds the root of x^2 - 4 near 2', () => {
    const s = scene();
    const rooter = plotFn(s.scope, (x) => x * x - 4, 'rooter', [0, 5]);
    const r = numericRoot(s.index(), { id: rooter, from: 0, to: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { root: number | null; bracket: [number, number] };
      expect(v.root).not.toBeNull();
      expect(v.root as number).toBeCloseTo(2, 6);
      expect(v.bracket[0]).toBeLessThanOrEqual(v.root as number);
      expect(v.bracket[1]).toBeGreaterThanOrEqual(v.root as number);
    }
  });

  it('no sign change on the interval is a typed { root: null }, not an error', () => {
    const s = scene();
    const nope = plotFn(s.scope, (x) => x * x + 1, 'always-positive', [0, 5]);
    const r = numericRoot(s.index(), { id: nope, from: 0, to: 5 });
    expect(r).toEqual({ ok: true, value: { root: null } });
  });

  it('validates: unknown id, inverted bounds', () => {
    const s = scene();
    expect((numericRoot(s.index(), { id: 'fn#404', from: 0, to: 5 }) as { error: { code: string } }).error?.code).toBe('unknown-id');
    const f = plotFn(s.scope, (x) => x, 'lin', [-2, 2]);
    expect((numericRoot(s.index(), { id: f, from: 5, to: 0 }) as { error: { code: string } }).error?.code).toBe('bad-args');
  });
});

describe('plot — the WRITE probe: model text → parse gate → sampled', () => {
  it('empty text and a bad domain are bad-args before any fold', async () => {
    const s = scene();
    const bad1 = await plot(s.log, s.fold, { text: '  ', domain: { from: -3, to: 3 } });
    expect(bad1.result.ok).toBe(false);
    if (!bad1.result.ok) expect(bad1.result.error.code).toBe('bad-args');
    const bad2 = await plot(s.log, s.fold, { text: 'x^2', domain: { from: 3, to: 3 } });
    expect(bad2.result.ok).toBe(false);
    if (!bad2.result.ok) expect(bad2.result.error.code).toBe('bad-args');
    // the log is untouched on rejection
    expect(bad1.log).toBe(s.log);
    expect(bad2.log).toBe(s.log);
  });

  it("an unbound free variable is the parser's complaint returned as bad-args", async () => {
    const s = scene();
    // "a*x": x is the plotted var, but a is free and no binding was given
    const w = await plot(s.log, s.fold, { text: 'a*x', domain: { from: -3, to: 3 } });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('bad-args');
      expect(w.result.error.message).toContain('free variable');
    }
    expect(w.log).toBe(s.log);
  });

  it('without a fold hook, runTool returns a failed result, not a crash', async () => {
    const s = scene();
    const out = await runTool({ tool: 'plot', text: 'x^2', domain: { from: -3, to: 3 } }, { scene: s.index });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe('failed');
  });
});

describe('runTool — the M5a probes dispatch and ground `sampled`', () => {
  it('routes tabulate, numericEquivalence, and numericRoot as reads', async () => {
    const s = scene();
    const a = plotFn(s.scope, (x) => x * x, 'sq-a');
    const b = plotFn(s.scope, (x) => x * x, 'sq-b');
    expect((await runTool({ tool: 'tabulate', id: s.f.id, from: 1, to: 5, count: 3 }, { scene: s.index })).result.ok).toBe(true);
    expect((await runTool({ tool: 'numericEquivalence', idA: a, idB: b, from: -3, to: 3, count: 5 }, { scene: s.index })).result.ok).toBe(true);
    const root = await runTool({ tool: 'numericRoot', id: plotFn(s.scope, (x) => x * x - 4, 'r', [0, 5]), from: 0, to: 5 }, { scene: s.index });
    expect(root.result.ok).toBe(true);
  });
});
