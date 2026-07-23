/**
 * views.test.ts — guards on the lean native view constructors (Stabilize §5).
 *
 * `plot` takes a plain sampler (the calculus `Fn | Accumulation` branch shed);
 * `readout` still refuses a dead number, the trap that once broke a generated
 * program by dying much later on `undefined.toFixed`.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage } from '@isomat/render';
import { createViews } from './views.js';
import { createParameter } from './parameter.js';
import { derivedNumber } from './numeric.js';

function setup() {
  const world = createWorld();
  const { View } = createViews(createStage(world));
  return { world, View };
}

describe('plot', () => {
  it('samples a numeric rule over its domain', () => {
    const { world, View } = setup();
    const a = createParameter(world, 'a', 2, [-5, 5]);
    const plot = View.plot((x) => a.value * x, { domain: [-5, 5], label: 'f' });
    expect(plot.projects(plot.elements[0]!.id)).toBe(true);
  });

  it('refuses a symbolic expr until the M3 parser', () => {
    const { View } = setup();
    const fakeExpr = { id: 'formula#1', kind: 'formula', fragments: [] } as never;
    expect(() => View.plot(fakeExpr, { domain: [0, 1] })).toThrow(/M3 parser/);
  });
});

describe('readout', () => {
  it('accepts a live numeric handle', () => {
    const { world, View } = setup();
    const x = createParameter(world, 'x', 2, [0, 6]);
    expect(() => View.readout(x)).not.toThrow();
  });

  it('rejects a plain number', () => {
    const { View } = setup();
    // a snapshot reads as live but never moves — the shape that broke a program
    expect(() => View.readout(3 as never)).toThrow(/LIVE numeric handle/);
  });

  it('rejects a dead compareTo as well as a dead quantity', () => {
    const { world, View } = setup();
    const x = createParameter(world, 'x', 2, [0, 6]);
    const live = derivedNumber(world, () => x.value, 'live');
    expect(() => View.readout(live, { compareTo: 7 as never })).toThrow(/compareTo/);
  });
});
