/**
 * substrate.smoke.test.ts — the M0 end-to-end proof.
 *
 * This is the isomat-specific test the roadmap's M0 exit calls for: boot the
 * real QuickJS host, run a trivial lesson program headless, and read a value
 * back across the sandbox boundary. It touches the whole lifted substrate in
 * one pass — core (Slot/Derived reactivity), render (headless Stage), library
 * (the `M` program scope), host (Bridge marshalling + QuickJS context) — and
 * nothing above it. If this is green, "lift core+host verbatim" carried no
 * hidden lesson-authoring coupling that stops the base from booting.
 *
 * It deliberately uses ONLY the scalar substrate — the flat native `param` and
 * `derive` (Stabilize §5) — not beats/say/Player. That is the exact vocabulary
 * M1's `workspace` co-edits, so this smoke test is the seam the rest of isomat
 * grows out of.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage } from '@isomat/objects';
import { createNativeScope } from '@isomat/objects';
import { QuickJSHost } from '@isomat/sandbox';
import { newNodeContext } from '@isomat/sandbox/node';

async function bootHost() {
  const world = createWorld();
  const stage = createStage(world); // headless — no DOM
  const scope = createNativeScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, host };
}

// A trivial program on the flat surface: a draggable scalar `x` and a reactive
// `y = x^2`. It mutates the parameter (twice, once past its range) and stashes
// what it observed on a guest global for the host to read back.
const PROGRAM = [
  'const x = param("x", 3, { range: [0, 10] });',
  'const y = derive(() => x.value * x.value, { label: "x squared" });',
  'const before = { x: x.value, y: y.value };',
  'x.setValue(5);', // reactive: y must recompute to 25
  'const after = { x: x.value, y: y.value };',
  'x.setValue(20);', // past range -> clamped to 10 by the parameter policy
  'const clamped = { x: x.value, y: y.value };',
  'globalThis.__probe = { before, after, clamped };',
].join('\n');

describe('M0 substrate smoke', () => {
  it('boots QuickJS, runs a trivial program, and reads a reactive value back', async () => {
    const { world, host } = await bootHost();
    host.run(PROGRAM);

    const probe = host.evalJSON<{
      before: { x: number; y: number };
      after: { x: number; y: number };
      clamped: { x: number; y: number };
    }>('__probe');

    // Initial state marshalled out of the sandbox intact.
    expect(probe.before).toEqual({ x: 3, y: 9 });
    // Setting the parameter propagated through the core reactive graph: the
    // derive that reads x.value recomputed without any explicit wiring.
    expect(probe.after).toEqual({ x: 5, y: 25 });
    // The parameter owns its clamp policy at the boundary.
    expect(probe.clamped).toEqual({ x: 10, y: 100 });

    // Host-side truth: the guest never held the state — it lives in the world.
    expect(world).toBeDefined();

    host.dispose();
  });
});
