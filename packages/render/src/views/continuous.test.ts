/**
 * continuous.test.ts — the KEEP continuous views, model-level and headless (no
 * DOM): the coordinate frame, PlotView, and ReadoutView.
 *
 * Stabilize S3 split this file: the discipline-shaped halves (Region / Strip /
 * Riemann / Plane / Vectors / Field / Heatmap / Loop / Tiling) shed with their
 * views. What survives is the substrate the native `plot` / `readout` stand on
 * — a plot that samples ONCE at construction and rides a live point, and a
 * readout whose gap closes as two live quantities converge.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import type { World } from '@isomat/core';
import type { VarySettable } from '@isomat/substrate';
import { createStage } from '../stage.js';
import { createFrame, rangeOf } from './frame.js';
import { PlotView } from './plot.js';
import { ReadoutView } from './readout.js';

function setup() {
  const world = createWorld();
  return { world, stage: createStage(world) };
}

/** A minimal live scalar with the interaction hook, standing in for a Parameter. */
function cell(world: World, initial: number): VarySettable & {
  readonly kind: string;
  setValueLive(next: number): void;
} {
  const slot = world.slot(initial);
  const base = world.handle('scalar');
  return {
    id: base.id,
    kind: 'scalar',
    get value(): number {
      return slot.value;
    },
    setValue(next: number): void {
      slot.set(next);
    },
    setValueLive(next: number): void {
      slot.poke(next);
    },
  };
}

const F = (x: number): number => 0.5 * x + 1;

describe('coordinate frame', () => {
  it('maps domain to pixels and back', () => {
    const frame = createFrame([0, 6], [0, 4], { width: 320, height: 220, pad: 20 });
    expect(frame.x(0)).toBeCloseTo(20, 6);
    expect(frame.x(6)).toBeCloseTo(300, 6);
    expect(frame.y(0)).toBeCloseTo(200, 6); // y grows downward
    expect(frame.toDomain(frame.x(3.7))).toBeCloseTo(3.7, 6);
  });

  it('a computed range always includes zero and is padded', () => {
    const [lo, hi] = rangeOf([1, 2, 3]);
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThan(3);
  });
});

describe('PlotView', () => {
  it('samples the rule ONCE at construction, not per read', () => {
    const { world, stage } = setup();
    let calls = 0;
    const plot = new PlotView(stage, {
      subject: world.handle('fn'),
      sample: (x) => {
        calls += 1;
        return F(x);
      },
      domain: [0, 6],
      samples: 51,
    });
    expect(calls).toBe(51);
    const before = calls;
    plot.applyState();
    plot.applyState();
    // applyState moves markers (O(1) reads), it does not re-sample the curve
    expect(calls).toBe(before);
  });

  it('a moving point rides the curve and follows its live quantity', () => {
    const { world, stage } = setup();
    const x = cell(world, 2);
    const plot = new PlotView(stage, { subject: world.handle('fn'), sample: F, domain: [0, 6] });
    plot.pointAt(x);
    expect(plot.markerPositions()[0]).toMatchObject({ x: 2, y: F(2) });
    x.setValueLive(4.5);
    expect(plot.markerPositions()[0]).toMatchObject({ x: 4.5, y: F(4.5) });
  });

  it('projects its SUBJECT, so a fragment can reach a shown plot by id (4c)', () => {
    const { world, stage } = setup();
    const subject = world.handle('fn');
    const plot = new PlotView(stage, { subject, sample: F, domain: [0, 6] });
    expect(plot.elements).toEqual([subject]);
    expect(plot.projects(subject.id)).toBe(true);
  });
});

describe('ReadoutView', () => {
  it('reports the gap between two live quantities as it closes', () => {
    const { world, stage } = setup();
    const rate = cell(world, 2.4);
    const height = cell(world, 2.0);
    const view = new ReadoutView(stage, { quantity: rate, compareTo: height });
    expect(view.values().gap).toBeCloseTo(0.4, 9);
    rate.setValueLive(2.001);
    expect(Math.abs(view.values().gap!)).toBeLessThan(0.01);
    expect(view.elements).toHaveLength(2);
  });
});
