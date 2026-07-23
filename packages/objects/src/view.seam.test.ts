/**
 * view.seam.test.ts — the renderer backend seam (docs/renderer-backends.md,
 * step 1), checked by retrodiction: the existing SVG views satisfy
 * applyState/dispose/capabilities as they are, headless, in the cheap tier.
 *
 * Stabilize S3 trimmed the framed-view trio to the KEEP `PlotView`; the Region
 * / Strip vehicles shed with their views. The seam it proves — capabilities,
 * headless applyState, dispose reaching every view — is a property of the View
 * base, so one framed view exercises it.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import type { World } from '@isomat/core';
import { createStage } from './stage.js';
import type { Stage } from './stage.js';
import { View } from './view.js';
import { PlotView } from './views/plot.js';

function setup() {
  const world = createWorld();
  return { world, stage: createStage(world) };
}

const F = (x: number): number => 0.5 * x + 1;

/** A headless stage carrying the KEEP framed view. */
function framed(stage: Stage, world: World): readonly View[] {
  const plot = new PlotView(stage, { subject: world.handle('fn'), sample: F, domain: [0, 6] });
  const second = new PlotView(stage, { subject: world.handle('fn'), sample: (x) => -F(x), domain: [0, 6] });
  return [plot, second];
}

describe('the backend seam, on the views that already exist', () => {
  it('the SVG family declares full capabilities — headless construction and per-element nodes', () => {
    const { world, stage } = setup();
    for (const v of framed(stage, world)) {
      expect(v.capabilities).toEqual({ headlessConstruct: true, elementNodes: true });
    }
  });

  it('applyState is callable headless, synchronously, before any mount', () => {
    const { world, stage } = setup();
    framed(stage, world);
    expect(() => stage.applyStateAll()).not.toThrow();
  });

  it('dispose is callable headless and idempotent — backward seek runs it constantly', () => {
    const { world, stage } = setup();
    framed(stage, world);
    expect(() => stage.dispose()).not.toThrow();
    expect(() => stage.dispose()).not.toThrow();
  });

  it('Stage.dispose reaches every view, so a foreign backend cannot be skipped', () => {
    const { world, stage } = setup();
    const disposed: string[] = [];
    class Probe extends View {
      constructor(stage: Stage, tag: string) {
        super(stage, `probe:${tag}`);
      }
      protected render(): HTMLElement {
        throw new Error('headless');
      }
      override dispose(): void {
        disposed.push(this.kind);
      }
    }
    new Probe(stage, 'a');
    framed(stage, world);
    new Probe(stage, 'b');
    stage.dispose();
    expect(disposed).toEqual(['probe:a', 'probe:b']);
  });
});
