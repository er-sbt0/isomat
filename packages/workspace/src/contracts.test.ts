/**
 * contracts.test.ts — the S3 Stabilize contract tests (plan §6.3).
 *
 * These pin the two properties the whole vocabulary redesign turns on, at the
 * workspace level where the native scene boundary actually lives. They run the
 * flat native scope IN-PROCESS (no QuickJS) — the sandbox round trip is proven
 * separately by `fold.sandbox.test.ts`; here the subject is the scene boundary
 * and the evidence typing, cheap to exercise directly.
 *
 *   - Scene boundary (risk 2): an introduced object surfaces in `sceneIndex`
 *     with NO timeline — the §2.1/§5.1 decoupling. Before S3 a bare parameter
 *     reached the scene ONLY through its `expose` timeline step; now it reaches
 *     it by auto-registration, and the timeline is never consulted.
 *   - Evidence typing (risk 7): a claim reports HOW it was judged
 *     (exact-comparison / sampled / authored-predicate), and that word is
 *     carried verbatim into the native scene — re-derived from the claim itself,
 *     not from the quarantined manifest mirror.
 *
 * This is the workspace-level rewrite of the old `library/manifest.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage, sceneIndex } from '@isomat/render';
import { createNativeScope } from '@isomat/library';
import type { ClaimEvidence } from '@isomat/library';

function setup() {
  const world = createWorld();
  const stage = createStage(world);
  return { world, stage, scope: createNativeScope(world, stage) };
}

describe('scene boundary — introduced objects surface with no timeline (risk 2)', () => {
  it('a bare param reaches the scene by auto-registration, not through the timeline', () => {
    const { world, stage, scope } = setup();
    const a = scope.param('a', 2, { range: [-5, 5], id: 'a@1' });

    // the object IS in the scene…
    expect(sceneIndex(stage).get('a@1')).toBe(a);
    // …and the timeline was NEVER touched to put it there. This is the whole
    // §2.1 decoupling: before S3 the scene walked `world.timeline`, and a param
    // with no `expose` step would have been invisible.
    expect(world.timeline.root.length).toBe(0);
  });

  it('a derived and a claim built in the same scope both surface, still no timeline', () => {
    const { world, stage, scope } = setup();
    const a = scope.param('a', 2, { range: [-5, 5], id: 'a@1' });
    const y = scope.derive(() => a.value * a.value, { label: 'y', id: 'y@2' });
    const c = scope.claim({ lhs: y, rhs: 4, relation: '=' });

    const scene = sceneIndex(stage);
    expect(scene.has('a@1')).toBe(true);
    expect(scene.has('y@2')).toBe(true);
    expect(scene.get(c.id)).toBe(c);
    expect(world.timeline.root.length).toBe(0);
  });
});

describe('evidence typing — carried verbatim into the native scene (risk 7)', () => {
  const evidenceInScene = (id: string, stage: ReturnType<typeof setup>['stage']): ClaimEvidence => {
    const h = sceneIndex(stage).get(id) as unknown as { evidence: ClaimEvidence };
    return h.evidence;
  };

  it('an exact = comparison is exact-comparison', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 2, { range: [0, 10] });
    const c = scope.claim({ lhs: x, rhs: 2, relation: '=' });
    expect(c.evidence).toBe('exact-comparison');
    expect(evidenceInScene(c.id, stage)).toBe('exact-comparison');
  });

  it('≈ demotes to sampled — numerical agreement, not exactness', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 1, { range: [0, 10] });
    const c = scope.claim({ lhs: x, rhs: 1, relation: '≈' });
    expect(c.evidence).toBe('sampled');
    expect(evidenceInScene(c.id, stage)).toBe('sampled');
  });

  it('an explicit tolerance on = is also sampled', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 1, { range: [0, 10] });
    const c = scope.claim({ lhs: x, rhs: 1, relation: '=', tolerance: 0.01 });
    expect(c.evidence).toBe('sampled');
    expect(evidenceInScene(c.id, stage)).toBe('sampled');
  });

  it('a predicate is authored-predicate — a closure the engine ran but did not check', () => {
    const { stage, scope } = setup();
    const n = scope.param('n', 4, { range: [1, 10] });
    const c = scope.claim({ predicate: () => n.value % 2 === 0, label: 'n even' });
    expect(c.evidence).toBe('authored-predicate');
    expect(evidenceInScene(c.id, stage)).toBe('authored-predicate');
  });

  it('the scene reads the LIVE verdict, so a drag that flips the claim is visible', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 2, { range: [0, 10] });
    const c = scope.claim({ lhs: x, rhs: 2, relation: '=' });
    const inScene = () => sceneIndex(stage).get(c.id) as unknown as { holds: boolean };
    expect(inScene().holds).toBe(true);
    x.setValueLive(5);
    expect(inScene().holds).toBe(false);
  });
});
