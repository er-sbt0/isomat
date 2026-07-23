/**
 * tools.workspace.test.ts — the whole instrument, played against real guest code
 * folded into a real Workspace (roadmap M2a exit criterion, the free half).
 *
 * This is the seam M2 exists to pay: the tool executor, driven end-to-end
 * against a scene a QuickJS `author` act actually folded through
 * `@isomat/workspace/node`. Every probe is a throwaway `tryFold`; every write
 * `commit`s a real authorship-tagged act; the live workspace never moves under
 * an experiment. The billed half — a real model choosing these calls — is M2b.
 *
 * The guest program is the flat native surface (`param`/`derive`/`claim`/`plot`/
 * `readout`), auto-registering, resolved through the native `sceneIndex` the
 * workspace `fold` surfaces as `Workspace.objects`.
 */

import { describe, expect, it } from 'vitest';
import { lint } from '@isomat/sandbox';
import { fold, tryFold } from '@isomat/workspace/node';
import type { WorkspaceLog } from '@isomat/workspace';
import {
  appendFragment,
  bisectFlip,
  counterfactual,
  evalAt,
  inspect,
  setInput,
  whyChanged,
} from '@isomat/copilot';
import type { CompileFragment, SceneMap } from '@isomat/copilot';

/** Turn 1: a parameter, a derived, a claim over it, and a fn to sample. */
const PROGRAM = [
  'const spin = param("spin", 1, { range: [-2, 2] });',
  'const doubled = derive(() => 2 * spin.value, { label: "doubled" });',
  'const under = claim({ lhs: doubled, rhs: 3, relation: "<=", label: "under three" });',
  'plot((x) => spin.value / x, { domain: [1, 5], label: "f" });',
  'readout(doubled, { label: "doubled" });',
].join('\n');

/** The real lint gate, no esbuild: these fragments are already plain JS. */
const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

function idByLabel(scene: SceneMap, label: string, kind?: string): string {
  for (const h of scene.values()) {
    const l = (h as { label?: unknown }).label;
    if (l === label && (kind === undefined || h.kind === kind)) return h.id;
  }
  const seen = [...scene.values()].map((h) => `${h.id}:${String((h as { label?: unknown }).label)}`);
  throw new Error(`the workspace offers nothing labeled "${label}" — it has: ${seen.join(', ')}`);
}

const numFromInspect = (scene: SceneMap, id: string): number => {
  const r = inspect(scene, id);
  if (!r.ok) throw new Error(`inspect(${id}) failed: ${r.error.message}`);
  return (r.value as { value: number }).value;
};

const holdsFromInspect = (scene: SceneMap, id: string): boolean => {
  const r = inspect(scene, id);
  if (!r.ok) throw new Error(`inspect(${id}) failed: ${r.error.message}`);
  return (r.value as { holds: boolean }).holds;
};

describe('a hand-scripted tool sequence against a QuickJS-folded Workspace', () => {
  it('inspect → evalAt → whyChanged → counterfactual → bisectFlip → setInput → appendFragment', async () => {
    const log: WorkspaceLog = [{ kind: 'author', js: PROGRAM, source: PROGRAM, by: 'user', turn: 0 }];

    // the live workspace: fold the log once; its objects read live (the VM stays
    // alive), and no experiment below moves it
    const live = await fold(log);
    expect(live.ok ? 'ok' : (live as { failure: { message: string } }).failure.message).toBe('ok');
    if (!live.ok) return;
    const scene = live.workspace.objects;

    const spin = idByLabel(scene, 'spin', 'parameter');
    const doubled = idByLabel(scene, 'doubled', 'scalar');
    const under = idByLabel(scene, 'under three', 'claim');
    const f = idByLabel(scene, 'f', 'fn');

    // ── inspect: the full value of one object, live ──
    expect(inspect(scene, spin)).toEqual({
      ok: true,
      value: { id: spin, kind: 'parameter', label: 'spin', value: 1, range: [-2, 2] },
    });
    const c = inspect(scene, under);
    expect(c.ok && (c.value as { holds: boolean }).holds).toBe(true);

    // ── evalAt: sample the guest-authored rule at a point (spin / x at x = 4) ──
    expect(evalAt(scene, f, [4])).toEqual({ ok: true, value: 0.25 });

    // ── whyChanged: causality off the reactive graph, across the bridge ──
    const why = whyChanged(scene, under);
    expect(why.ok).toBe(true);
    if (why.ok) {
      const chain = (why.value as { chain: Array<Record<string, unknown>> }).chain;
      expect(chain.map((e) => e['kind'])).toEqual(['claim', 'scalar', 'scalar', 'parameter']);
      expect(chain[chain.length - 1]).toMatchObject({ id: spin, label: 'spin', value: 1 });
    }

    // ── counterfactual: a disposable fold answers "what if spin were 2" ──
    const what = await counterfactual(log, tryFold, {
      set: [{ id: spin, value: 2 }],
      read: [doubled, under],
    });
    expect(what.ok).toBe(true);
    if (what.ok) {
      const reads = (what.value as { reads: Array<Record<string, unknown>> }).reads;
      expect(reads[0]).toMatchObject({ id: doubled, value: 4 });
      expect(reads[1]).toMatchObject({ id: under, holds: false });
    }

    // ── bisectFlip: the exact threshold of "2·spin ≤ 3", one VM per probe ──
    const flip = await bisectFlip(log, tryFold, { param: spin, claim: under, lo: -2, hi: 2, maxProbes: 12 });
    expect(flip.ok).toBe(true);
    if (flip.ok) {
      const v = flip.value as { flipped: boolean; lo: number; hi: number; holdsAtLo: boolean; holdsAtHi: boolean };
      expect(v.flipped).toBe(true);
      expect(v.holdsAtLo).toBe(true);
      expect(v.holdsAtHi).toBe(false);
      // the analytic flip point, to the resolution 12 probes buy
      expect((v.lo + v.hi) / 2).toBeCloseTo(1.5, 2);
    }

    // ── every probe so far was a throwaway fold: the LIVE workspace never moved ──
    expect(numFromInspect(scene, spin)).toBe(1);
    expect(holdsFromInspect(scene, under)).toBe(true);

    // ── setInput: the event path, committed through the disposable fold ──
    const set = await setInput(log, tryFold, { id: spin, value: -1 });
    expect(set.result.ok).toBe(true);
    expect(set.log).toHaveLength(2);
    expect(set.log[1]).toMatchObject({ kind: 'set-input', target: spin, value: -1, by: 'copilot' });

    // ── appendFragment: gate → commit; the fragment reaches back BY ID ──
    const FRAGMENT = [
      `const spin = byId("${spin}");`,
      'readout(derive(() => spin.value, { label: "spin now" }), { label: "spin now" });',
    ].join('\n');
    const appended = await appendFragment(set.log, tryFold, compile, { source: FRAGMENT });
    expect(appended.result.ok ? 'ok' : JSON.stringify(appended.result.error)).toBe('ok');
    expect(appended.log).toHaveLength(3);
    expect(appended.log[2]).toMatchObject({ kind: 'author', by: 'copilot' });

    // the whole session still folds from scratch, and the folded workspace
    // carries the write acts: spin at -1
    const refolded = await fold(appended.log);
    expect(refolded.ok ? 'ok' : (refolded as { failure: { message: string } }).failure.message).toBe('ok');
    if (refolded.ok) expect(numFromInspect(refolded.workspace.objects, spin)).toBe(-1);

    // and the live workspace STILL has not moved — writes advance the log; the
    // screen is the caller's to refresh, exactly as on the manipulate path
    expect(numFromInspect(scene, spin)).toBe(1);
  }, 30_000);

  it('the gate rejection comes back verbatim as the tool error', async () => {
    const log: WorkspaceLog = [{ kind: 'author', js: PROGRAM, source: PROGRAM, by: 'user', turn: 0 }];
    const BAD = 'const x = eval("1");';
    const w = await appendFragment(log, tryFold, compile, { source: BAD });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      // the lint complaint itself, word for word — retry IS repair
      expect(w.result.error.message).toContain('banned-global');
      expect(w.result.error.message).toContain('eval()');
    }
    expect(w.log).toBe(log);
  });
});
