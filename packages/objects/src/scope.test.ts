/**
 * scope.test.ts — the flat native authoring surface (Stabilize §5), bound to one
 * world + stage, and auto-registering every object it constructs into the scene.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage } from './stage.js';
import { sceneIndex } from './scene.js';
import { createNativeScope } from './scope.js';

function setup() {
  const world = createWorld();
  const stage = createStage(world);
  return { world, stage, scope: createNativeScope(world, stage) };
}

describe('createNativeScope', () => {
  it('yields the flat surface bound to one world + stage', () => {
    const { world, stage, scope } = setup();
    expect(scope.world).toBe(world);
    expect(scope.stage).toBe(stage);
    for (const key of ['expr', 'span', 'param', 'derive', 'plot', 'readout', 'claim', 'link', 'note', 'byId'] as const) {
      expect(typeof scope[key], key).toBe('function');
    }
  });

  it('rejects a stage from another world', () => {
    const world = createWorld();
    const other = createWorld();
    const stage = createStage(other);
    expect(() => createNativeScope(world, stage)).toThrow(/same world/);
  });

  it('auto-registers a bare param into the scene — no expose, no timeline (risk 2)', () => {
    const { stage, scope } = setup();
    const a = scope.param('a', 2, { range: [-5, 5], id: 'a@1' });
    // it is in the scene purely by construction, and the timeline is untouched
    expect(sceneIndex(stage).get('a@1')).toBe(a);
    expect(stage.world.timeline.root.length).toBe(0);
  });

  it('derive tracks the params it reads, and auto-registers', () => {
    const { stage, scope } = setup();
    const theta = scope.param('θ', 0, { range: [0, Math.PI] });
    const dot = scope.derive(() => 6 * Math.cos(theta.value), { label: 'dot' });

    expect(dot.value).toBeCloseTo(6);
    theta.setValueLive(Math.PI);
    // no re-read, no rebuild — it follows
    expect(dot.value).toBeCloseTo(-6);
    expect(dot.label).toBe('dot');
    expect(sceneIndex(stage).has(dot.id)).toBe(true);
  });

  it('byId reaches an earlier object, and refuses one the scene never offered', () => {
    const { scope } = setup();
    scope.param('a', 2, { range: [-5, 5], id: 'a@1' });
    expect(scope.byId('a@1')).toBeDefined();
    expect(() => scope.byId('nope@9')).toThrow(/no object with that id/);
  });

  it('readout rejects a dead number (the snapshot trap)', () => {
    const { scope } = setup();
    const theta = scope.param('θ', 1, { range: [0, 2] });
    expect(() => scope.readout(scope.derive(() => theta.value * 2))).not.toThrow();
    expect(() => scope.readout(theta.value * 2 as never)).toThrow();
  });

  it('expr builds an addressable-span formula and auto-registers it', () => {
    const { stage, scope } = setup();
    const f = scope.expr`x \sim_L y \iff ${scope.span('suffix', 'z')} \in \Sigma`;
    expect(f.roles).toEqual(['suffix']);
    expect(f.tex.indexOf('\\sim')).toBeGreaterThanOrEqual(0);
    expect(sceneIndex(stage).has(f.id)).toBe(true);
  });

  it('claim carries evidence and appears in the scene', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 2, { range: [0, 10] });
    const c = scope.claim({ lhs: x, rhs: 2, relation: '=' });
    expect(c.evidence).toBe('exact-comparison');
    expect(sceneIndex(stage).get(c.id)).toBe(c);
  });

  it('note is a first-class text object that surfaces in the scene', () => {
    const { stage, scope } = setup();
    const x = scope.param('x', 2, { range: [0, 10] });
    const n = scope.note`watch ${x} move`;
    expect(n.text).toContain('watch');
    expect(n.elements.map((e) => e.id)).toEqual([x.id]);
    expect(sceneIndex(stage).has(n.id)).toBe(true);
  });
});
