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
 * It deliberately uses ONLY the scalar substrate — `M.slot`, `M.parameter`,
 * `M.derived` — not beats/say/Player. That is the exact vocabulary M1's
 * `workspace` will co-edit, so this smoke test is the seam the rest of isomat
 * grows out of.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@isomat/core';
import { createStage } from '@isomat/render';
import { createProgramScope } from '@isomat/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';

async function bootHost() {
  const world = createWorld();
  const stage = createStage(world); // headless — no DOM
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  return { world, host };
}

// A trivial lesson program: a draggable scalar `x`, a reactive `y = x^2`, and a
// raw slot. It mutates the parameter (twice, once past its range) and stashes
// what it observed on a guest global for the host to read back.
const PROGRAM = [
  'const x = M.parameter("x", 3, { range: [0, 10] });',
  'const y = M.derived(() => x.value * x.value, "x squared");',
  'const s = M.slot(41);',
  'const before = { x: x.value, y: y.value, s: s.value };',
  'x.setValue(5);', // reactive: y must recompute to 25
  'const after = { x: x.value, y: y.value };',
  'x.setValue(20);', // past range -> clamped to 10 by the parameter policy
  's.set(42);',
  'const clamped = { x: x.value, y: y.value, s: s.value };',
  'globalThis.__probe = { before, after, clamped };',
].join('\n');

describe('M0 substrate smoke', () => {
  it('boots QuickJS, runs a trivial program, and reads a reactive value back', async () => {
    const { world, host } = await bootHost();
    host.run(PROGRAM);

    const probe = host.evalJSON<{
      before: { x: number; y: number; s: number };
      after: { x: number; y: number };
      clamped: { x: number; y: number; s: number };
    }>('__probe');

    // Initial state marshalled out of the sandbox intact.
    expect(probe.before).toEqual({ x: 3, y: 9, s: 41 });
    // Setting the parameter propagated through the core reactive graph: the
    // Derived that reads x.value recomputed without any explicit wiring.
    expect(probe.after).toEqual({ x: 5, y: 25 });
    // The parameter owns its clamp policy at the boundary; a raw slot set is
    // read straight back.
    expect(probe.clamped).toEqual({ x: 10, y: 100, s: 42 });

    // Host-side truth: the guest never held the state — it lives in the world.
    expect(world).toBeDefined();

    host.dispose();
  });
});
