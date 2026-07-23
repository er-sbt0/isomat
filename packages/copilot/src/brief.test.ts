/**
 * brief.test.ts — the scoped manifest (roadmap M4 Stage C).
 *
 * `scopedManifest` is the byte-budgeted, focus-relative counterpart to
 * `sceneBrief`: a nearest-first BFS over the correspondence graph that fills a
 * byte budget outward from one object. These tests drive it against a synthetic
 * workspace — a 30-object ternary tree plus a disconnected cluster — built
 * straight from `CorrespondenceGraph` + a handle map (no QuickJS fold needed,
 * since the manifest only reads `objects` for line text and `graph` for BFS).
 */

import { describe, expect, it } from 'vitest';
import { CorrespondenceGraph } from '@isomat/core';
import type { Handle, Id } from '@isomat/core';
import type { Workspace } from '@isomat/workspace';
import { scopedManifest } from './brief.js';

const byteLen = (s: string): number => new TextEncoder().encode(s).length;
const EMPTY = 'The workspace is empty.';

const id = (n: number): Id => `obj-${String(n).padStart(2, '0')}`;

/** A bare live handle — id + kind + label, the shape a folded scene offers. */
function handle(objId: Id, label: string, kind = 'scalar'): Handle {
  return { id: objId, kind, label } as Handle & { label: string };
}

/** Assemble a `Workspace` from a handle list and an undirected edge list. */
function makeWorkspace(handles: readonly Handle[], edges: readonly [Id, Id][]): Workspace {
  const objects = new Map<Id, Handle>(handles.map((h) => [h.id, h]));
  const graph = new CorrespondenceGraph();
  for (const [a, b] of edges) {
    graph.link(objects.get(a)!, objects.get(b)!, 'represents', 'authored');
  }
  return { objects, layout: new Map(), graph, retired: new Set() };
}

/**
 * A 30-node ternary tree rooted at `obj-00` (each node i>0 hangs off parent
 * floor((i-1)/3), so hops are: node 0 → 0; nodes 1..3 → 1; nodes 4..12 → 2;
 * nodes 13..29 → 3), PLUS a two-node cluster (`far-a`/`far-b`) disconnected from
 * the tree — the reachability control.
 */
function makeTreeWorkspace(): Workspace {
  const handles: Handle[] = [];
  const edges: [Id, Id][] = [];
  for (let i = 0; i < 30; i += 1) handles.push(handle(id(i), `n${i}`));
  for (let i = 1; i < 30; i += 1) edges.push([id(Math.floor((i - 1) / 3)), id(i)]);
  handles.push(handle('far-a', 'fa'), handle('far-b', 'fb'));
  edges.push(['far-a', 'far-b']);
  return makeWorkspace(handles, edges);
}

const lineCount = (manifest: string): number => manifest.split('\n').length - 1; // minus the header

describe('scopedManifest — bounded nearest-first BFS', () => {
  it('with an ample budget covers the whole reachable component and excludes the disconnected cluster', () => {
    const ws = makeTreeWorkspace();
    const out = scopedManifest(ws, id(0), 100_000);

    // every one of the 30 connected objects is present…
    for (let i = 0; i < 30; i += 1) expect(out).toContain(id(i));
    expect(lineCount(out)).toBe(30);
    // …and the unreachable cluster is absent (excluded by BFS, not by budget)
    expect(out).not.toContain('far-a');
    expect(out).not.toContain('far-b');
    // shape matches sceneBrief: header, then focus first
    expect(out.startsWith('Workspace objects (reach them by id):\n- obj-00 ')).toBe(true);
    expect(byteLen(out)).toBeLessThanOrEqual(100_000);
  });

  it('honors the byte budget: near objects included, far ones dropped, total within budget', () => {
    const ws = makeTreeWorkspace();
    const budget = 120;
    const out = scopedManifest(ws, id(0), budget);

    expect(byteLen(out)).toBeLessThanOrEqual(budget);
    // the focus and its nearest layer survive; the farthest tree nodes do not
    expect(out).toContain(id(0));
    expect(out).toContain(id(1));
    expect(out).not.toContain(id(29));
    // strictly fewer than the full component — the budget really cut it
    expect(lineCount(out)).toBeLessThan(30);
  });

  it('fills nearest-first: a mid budget keeps a contiguous near prefix by hop distance', () => {
    const ws = makeTreeWorkspace();
    const out = scopedManifest(ws, id(0), 100);
    // whatever fits, the focus (hop 0) and at least one hop-1 neighbor come before
    // any hop-3 node — and a hop-3 node never appears without the focus present
    expect(out).toContain(id(0));
    if (out.includes(id(13))) expect(out).toContain(id(1)); // hop-3 implies hop-1 present
  });

  it('is deterministic: identical input yields a byte-identical string', () => {
    const a = scopedManifest(makeTreeWorkspace(), id(0), 250);
    const b = scopedManifest(makeTreeWorkspace(), id(0), 250);
    expect(a).toBe(b);
    // repeated calls on the same workspace also stable
    const ws = makeTreeWorkspace();
    expect(scopedManifest(ws, id(0), 250)).toBe(scopedManifest(ws, id(0), 250));
  });

  it('orders within a BFS layer by sorted id', () => {
    // focus with three neighbors introduced out of id order; the manifest must
    // list them a < b < c regardless of edge-record order
    const f = handle('root', 'root');
    const hs = [f, handle('n-c', 'c'), handle('n-a', 'a'), handle('n-b', 'b')];
    const ws = makeWorkspace(hs, [
      ['root', 'n-c'],
      ['root', 'n-a'],
      ['root', 'n-b'],
    ]);
    const out = scopedManifest(ws, 'root', 100_000);
    expect(out.indexOf('n-a')).toBeLessThan(out.indexOf('n-b'));
    expect(out.indexOf('n-b')).toBeLessThan(out.indexOf('n-c'));
  });

  it('edge case — a focus absent from the workspace reports empty', () => {
    const ws = makeTreeWorkspace();
    expect(scopedManifest(ws, 'no-such-id', 100_000)).toBe(EMPTY);
  });

  it('edge case — an isolated focus yields just its own line when it fits', () => {
    const only = handle('solo', 'solo');
    const ws = makeWorkspace([only], []);
    const out = scopedManifest(ws, 'solo', 100_000);
    expect(out).toBe('Workspace objects (reach them by id):\n- solo (scalar) "solo"');
    expect(lineCount(out)).toBe(1);
  });

  it('edge case — an isolated focus whose own line overflows the budget reports empty', () => {
    const only = handle('solo', 'solo');
    const ws = makeWorkspace([only], []);
    // a budget smaller than even the header cannot fit the one line
    expect(scopedManifest(ws, 'solo', 5)).toBe(EMPTY);
  });

  it('edge case — an empty workspace reports empty', () => {
    const ws = makeWorkspace([], []);
    expect(scopedManifest(ws, 'anything', 100_000)).toBe(EMPTY);
  });
});
