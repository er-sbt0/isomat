/**
 * live.test.ts — the reactive cell, generalized (roadmap step 3).
 *
 * The regression these guard is not "does .value work" — derivedNumber already
 * proved that. It is the three things a non-numeric live value costs when it is
 * FAKED as a getter over a bare closure: memoization, equality, and a handle to
 * point at.
 *
 * Stabilize S3 trimmed the segment/region cases: they exercised `createFieldLib`
 * and the discipline-shaped views, both shed. The surviving non-numeric ledger
 * entry — a claim's `Live<Verdict>` — carries the same three properties.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { constLive, isLive, live, valueOf, vec2Equals, vec2ListEquals } from './live.js';
import { createParameter } from './parameter.js';
import { createClaim } from './claim.js';

describe('live — the reactive cell for any T', () => {
  it('carries a non-numeric value and tracks its inputs', () => {
    const world = createWorld();
    const k = createParameter(world, 'k', 1, [0, 5]);
    const pair = live<{ a: number; b: string }>(world, () => ({ a: k.value, b: 'x'.repeat(k.value) }));
    expect(pair.value).toEqual({ a: 1, b: 'x' });
    k.setValueLive(3);
    expect(pair.value).toEqual({ a: 3, b: 'xxx' });
  });

  it('mints a handle, so a correspondence or a view can point at it', () => {
    const world = createWorld();
    const l = live<boolean>(world, () => true, { kind: 'verdict' });
    expect(typeof l.id).toBe('string');
    expect(l.kind).toBe('verdict');
    expect(isLive(l)).toBe(true);
    expect(isLive(3)).toBe(false);
  });

  it('equality short-circuits a structural derived that recomputes to the same value', () => {
    const world = createWorld();
    const k = createParameter(world, 'k', 1, [0, 5]);
    const p = live<readonly [number, number]>(world, () => [k.value, 0], { equals: vec2Equals });
    let recomputes = 0;
    const downstream = live<number>(world, () => {
      recomputes += 1;
      return p.value[0];
    });
    expect(downstream.value).toBe(1);
    expect(downstream.value).toBe(1);
    expect(recomputes).toBe(1);
    k.setValueLive(1); // clamped to the same number — the value does NOT move
    expect(downstream.value).toBe(1);
    expect(recomputes).toBe(1);
    k.setValueLive(2);
    expect(downstream.value).toBe(2);
    expect(recomputes).toBe(2);
  });

  it('constLive and valueOf read raw and live values uniformly', () => {
    const world = createWorld();
    const c = constLive(world, 'fixed');
    expect(c.value).toBe('fixed');
    expect(valueOf(c)).toBe('fixed');
    expect(valueOf('raw')).toBe('raw');
  });

  it('vec2ListEquals compares elementwise', () => {
    expect(vec2ListEquals([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
    expect(vec2ListEquals([[1, 2]], [[1, 2], [3, 4]])).toBe(false);
    expect(vec2ListEquals([[1, 2]], [[1, 3]])).toBe(false);
  });
});

describe('the ledger entry no longer faked', () => {
  it("a claim's verdict is a Live<Verdict> — a handle, and it only changes when it FLIPS", () => {
    const world = createWorld();
    const k = createParameter(world, 'k', 1, [-5, 5]);
    const claim = createClaim(world, { predicate: () => k.value > 0, label: 'k > 0' });
    expect(typeof claim.verdict.id).toBe('string');
    const holding = claim.verdict.value;
    k.setValueLive(4);
    // still holding, and IDENTICALLY so — that identity is what lets a
    // dependent short-circuit instead of repainting on every drag frame.
    expect(claim.verdict.value).toBe(holding);
    k.setValueLive(-1);
    expect(claim.verdict.value).not.toBe(holding);
    expect(claim.holds).toBe(false);
    expect(claim.status.polarity).toBe('reject');
  });
});

describe('the backing cell (roadmap 4c)', () => {
  it('live() carries its derived, so a graph walk can start at a handle', () => {
    const world = createWorld();
    const a = world.slot(1);
    const l = live(world, () => a.value + 1);
    expect(l.cell).toBeDefined();
    expect(l.cell!.value).toBe(2);
    expect(l.cell!.dependsOn().map((h) => h.id)).toEqual([a.id]);
  });

  it('constLive has none — a constant has no computation to explain', () => {
    const world = createWorld();
    expect(constLive(world, 7).cell).toBeUndefined();
  });
});
