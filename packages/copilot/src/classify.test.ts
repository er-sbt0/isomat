/**
 * classify.test.ts — the intent fast-path, in isolation (roadmap M2b).
 *
 * The classifier is pure over a scene map, so it needs no fold and no model: a
 * real world + native scope builds the parameters, and `classify` recognizes the
 * manipulation commands and nothing else. What it must NOT match is as important
 * as what it must — a compound question or an unknown name has to fall through
 * to the model, not get silently manipulated on the way past.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage, createNativeScope, sceneIndex } from '@isomat/objects';
import { classify } from './classify.js';

function sceneWith(...params: ReadonlyArray<[string, number]>) {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createNativeScope(world, stage);
  for (const [name, value] of params) scope.param(name, value, { range: [-10, 10] });
  return sceneIndex(stage);
}

describe('classify — recognizes a pure manipulation command', () => {
  it('"set spin to 2"', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('set spin to 2', scene)).toMatchObject({ label: 'spin', value: 2 });
  });

  it('the several command forms all resolve to the same set', () => {
    const scene = sceneWith(['spin', 1]);
    for (const [q, v] of [
      ['set spin to 2', 2],
      ['make spin 3', 3],
      ['change spin = 0', 0],
      ['spin = -1.5', -1.5],
      ['spin to 4', 4],
      ['SET SPIN TO 2', 2], // case-insensitive
      ['set spin to -1.', -1],
    ] as const) {
      expect(classify(q, scene), q).toMatchObject({ label: 'spin', value: v });
    }
  });

  it('resolves the named parameter among several', () => {
    const scene = sceneWith(['spin', 1], ['gain', 0]);
    expect(classify('set gain to 7', scene)).toMatchObject({ label: 'gain', value: 7 });
  });

  it('carries the resolved id, not just the label', () => {
    const scene = sceneWith(['spin', 1]);
    const spinId = [...scene.values()].find((h) => h.kind === 'parameter')!.id;
    expect(classify('spin = 9', scene)?.id).toBe(spinId);
  });
});

describe('classify — falls through (null) on anything not a pure command', () => {
  it('a question is not a command', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('why did spin break the claim?', scene)).toBeNull();
  });

  it('a COMPOUND request does not silently manipulate', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('set spin to 2 and tell me why it breaks', scene)).toBeNull();
  });

  it('an unknown parameter name is not classified', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('set gravity to 5', scene)).toBeNull();
  });

  it('an empty question is null', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('   ', scene)).toBeNull();
  });

  it('a non-numeric value is not a set', () => {
    const scene = sceneWith(['spin', 1]);
    expect(classify('set spin to high', scene)).toBeNull();
  });
});
