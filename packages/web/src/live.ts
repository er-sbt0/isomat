/**
 * live.ts — the reactive bridge: isomat's graph → React's render loop.
 *
 * The engine's reactivity predates React and does not know about it. This file
 * is the whole adapter, and it exists because of one asymmetry worth stating
 * plainly, since it dictates the design:
 *
 *   • A `LiveValue` (anything from `derive`) carries `.cell`, a core `Derived`,
 *     which HAS `subscribe(fn) => Unsubscribe`. Both mutation paths reach it:
 *     `Slot.set` and `Slot.poke` each call `markStale()` + `runFlush()`, so a
 *     derived subscriber fires on a committed act AND on a live drag.
 *
 *   • A `Parameter` — the one object a user actually drags — carries NO
 *     subscribable handle at all. It exposes `.value`, `peek()`, `setValue`,
 *     `setValueLive` and `cellId`, but deliberately not the `Slot`:
 *     "handing out the Slot itself would hand out an unclamped `set` around the
 *     clamp policy this object exists to own" (parameter.ts). That is a good
 *     rule and this file does not try to defeat it.
 *
 * So the bridge is two-channel. Where a `Derived` exists we subscribe to it
 * precisely. Where none does, we fall back to a REVISION BUS: a tiny external
 * store that anything mutating the world in place bumps, re-reading every
 * unsubscribable handle. Both channels feed `useSyncExternalStore`, so React
 * stays the sole scheduler and there is no `setState`-in-a-callback tearing.
 *
 * The bus is coarse by choice. A workspace holds tens of objects, not
 * thousands; a re-read is a property access on a memoised cell. Precision here
 * would buy nothing and cost the correctness of the drag path, which W2 needs.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { Handle } from '@isomat/core';

// ───────────────────────────── the revision bus ─────────────────────────────

let revision = 0;
const listeners = new Set<() => void>();

/**
 * Announce that the world changed in place — a `setValueLive` drag frame, or
 * anything else that pokes a slot without producing a new `Workspace`.
 *
 * A committed act does NOT need this: it re-folds and yields a new workspace
 * object, which React re-renders through props like any other value.
 */
export function bumpLive(): void {
  revision++;
  for (const fn of [...listeners]) fn();
}

function subscribeBus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getRevision = () => revision;

/** Re-render whenever anything pokes the world. The fallback channel, alone. */
export function useRevision(): number {
  return useSyncExternalStore(subscribeBus, getRevision, getRevision);
}

// ─────────────────────────────── reading values ───────────────────────────────

/** The `Derived` behind a handle, when it has one. `LiveValue.cell` is optional. */
interface HasCell {
  readonly cell?: { subscribe(fn: () => void): () => void; peek(): unknown };
}

function cellOf(h: unknown): HasCell['cell'] | undefined {
  const c = (h as HasCell | null | undefined)?.cell;
  return c && typeof c.subscribe === 'function' && typeof c.peek === 'function' ? c : undefined;
}

/**
 * Read a live handle's `.value`, re-rendering when it changes.
 *
 * Subscribes to the handle's own `Derived` when it has one, and to the revision
 * bus otherwise. Both are wired unconditionally rather than either/or: a derived
 * whose inputs were poked notifies through its own cell, but a `Parameter` read
 * in the same component would go stale without the bus.
 *
 * `peek()` — not `.value` — is the snapshot on the cell path. `.value` is a
 * TRACKED read: called inside someone else's computation it would register a
 * spurious dependency edge. React is not a reactive computation and must not
 * appear in the graph.
 */
export function useLive<T>(handle: Handle | null | undefined): T | undefined {
  const cell = cellOf(handle);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const offBus = subscribeBus(onChange);
      const offCell = cell?.subscribe(onChange);
      return () => {
        offBus();
        offCell?.();
      };
    },
    [cell],
  );

  const snapshot = useCallback((): T | undefined => {
    if (!handle) return undefined;
    if (cell) return cell.peek() as T;
    try {
      return (handle as unknown as { value?: T }).value;
    } catch {
      // Lazily-materialising objects report errors as data rather than throwing
      // across the boundary; a read that fails is a value we do not have yet.
      return undefined;
    }
  }, [handle, cell]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Sample a function handle across a domain, live.
 *
 * `PlotView` samples once at construction — correct for playback, where the
 * curve is a fixed frame of a recorded explanation, and wrong for a co-edit
 * workspace where the rule reads a parameter the user is dragging. `PlottedFn`
 * exposes `at(x)`, so re-sampling per render is both possible and cheap, and
 * this is the clearest case where rebuilding the view in React (decision #7)
 * buys a capability rather than just a different idiom.
 */
export function sampleFn(
  fn: { at(x: number): number } | undefined,
  domain: readonly [number, number],
  samples = 121,
): Array<readonly [number, number]> {
  if (!fn) return [];
  const [lo, hi] = domain;
  const out: Array<readonly [number, number]> = [];
  const step = (hi - lo) / (samples - 1);
  for (let i = 0; i < samples; i++) {
    const x = lo + i * step;
    const y = fn.at(x);
    if (Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}
