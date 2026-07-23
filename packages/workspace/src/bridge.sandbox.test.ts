/**
 * bridge.sandbox.test.ts — the marshalling seam, played against a real guest
 * program written on the flat native surface (Stabilize §5).
 *
 * Rewritten in S3 from the automata/lesson vocabulary the shed removed. It still
 * exercises every cross-boundary shape the bridge must carry: methods returning
 * handles (`param`, `derive`, `claim`, `expr`), guest closures re-invoked LIVE
 * by the host (a derive's rule, a claim predicate, a plot sampler), a
 * tagged-template formula that must preserve `strings.raw` (so `\cdot` survives),
 * and reactive propagation across a `setValueLive` drag.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage } from '@isomat/objects';
import { createNativeScope } from '@isomat/objects';
import { QuickJSHost } from '@isomat/sandbox';
import { newNodeContext } from '@isomat/sandbox/node';

async function hostWithScope() {
  const world = createWorld();
  const stage = createStage(world); // headless
  const scope = createNativeScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, stage, host };
}

// A plain double-quoted string so its backtick tagged templates and TeX
// backslashes embed cleanly.
const PROGRAM = [
  'const a = param("a", 2, { range: [-5, 5] });',
  'const y = derive(() => a.value * a.value, { label: "y" });',
  'const equalsFour = claim({ lhs: y, rhs: 4, relation: "=" });',
  'const even = claim({ predicate: () => a.value % 2 === 0, label: "a even" });',
  'const f = expr`f(a) = ${span("coef", "a")} \\cdot x`;',
  'plot((x) => a.value * x, { domain: [-5, 5], label: "f" });',
  'note`watch ${a} and ${y}`;',
  'a.setValueLive(3);', // reactive: y -> 9, both claims break; the drag path (no timeline step)
  'globalThis.__probe = {',
  '  yAfter: y.value,',
  '  claimHolds: equalsFour.holds,',
  '  evenHolds: even.holds,',
  '  evidence: equalsFour.evidence,',
  '  roles: f.roles.length,',
  '  hasBackslashInTex: f.tex.indexOf("\\\\cdot") >= 0,',
  '};',
].join('\n');

describe('bridge marshalling', () => {
  it('runs a native program unmodified through the sandbox and reads the live scene back', async () => {
    const { stage, host } = await hostWithScope();
    host.run(PROGRAM);

    // Host-side truth: the guest calls actually built the scene.
    expect(stage.registered.length).toBeGreaterThan(0);

    const probe = host.evalJSON<Record<string, unknown>>('__probe');
    expect(probe).toMatchObject({
      // the derive's guest closure was re-invoked after the drag: 3² = 9
      yAfter: 9,
      // the relation claim re-derived live and broke (9 ≠ 4)
      claimHolds: false,
      // the predicate — a guest closure — was re-invoked live and broke (3 is odd)
      evenHolds: false,
      // evidence is carried verbatim from the claim
      evidence: 'exact-comparison',
      // the tagged-template formula addressed one role and kept its raw TeX
      roles: 1,
      hasBackslashInTex: true,
    });
    host.dispose();
  });
});
