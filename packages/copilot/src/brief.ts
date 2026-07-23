/**
 * brief.ts — the scene brief (roadmap M2b).
 *
 * What the manifest offers the model this turn: a terse, id-addressable list of
 * the workspace's objects. This is the boundary the whole tool layer resolves
 * through — a tool may reach exactly what the brief names — so building it from
 * `Workspace.objects` (the `sceneIndex` boundary) is what makes "reach only what
 * the user was shown" true by construction.
 *
 * M2b's brief is the WHOLE scene, unbounded. M4's `scopedManifest` replaces this
 * with a byte-budgeted BFS from a focus object; the shape a model reads — one
 * line per object, id first — is deliberately the same, so that swap does not
 * change the loop.
 *
 * (Named `brief`, not `manifest`: the Stabilize fence forbids a workspace-facing
 * package from importing a module named `manifest` — a playback name. The
 * function is the manifest; the file is not.)
 */

import type { Handle, Id } from '@isomat/core';
import type { Workspace } from '@isomat/workspace';
import type { SceneMap } from './tools.js';

/** Best-effort scalar/verdict summary for the one-liner — never throws. */
function summarize(h: Handle): string {
  try {
    if (h.kind === 'claim') {
      const holds = (h as Handle & { holds?: unknown }).holds;
      const evidence = (h as Handle & { evidence?: unknown }).evidence;
      if (typeof holds === 'boolean') {
        return ` — ${holds ? 'holds' : 'broken'}${typeof evidence === 'string' ? ` (${evidence})` : ''}`;
      }
    }
    const value = (h as Handle & { value?: unknown }).value;
    if (typeof value === 'number' && Number.isFinite(value)) return ` = ${value}`;
  } catch {
    // a derived/predicate that throws at read is data at probe time, not here —
    // the brief just omits its value (errors-as-data, honored)
  }
  return '';
}

/**
 * The one shared per-object line: id first, then kind, an optional label, and a
 * best-effort current value. Both `sceneBrief` and `scopedManifest` render
 * through this, so a model reads exactly the same shape whether it was handed the
 * whole scene or a byte-budgeted neighborhood.
 */
function objectLine(h: Handle): string {
  const label = (h as Handle & { label?: unknown }).label;
  const labelPart = typeof label === 'string' ? ` "${label}"` : '';
  return `- ${h.id} (${h.kind})${labelPart}${summarize(h)}`;
}

const HEADER = 'Workspace objects (reach them by id):';
const EMPTY = 'The workspace is empty.';

/**
 * The scene as the model sees it: one line per object, id first, then kind, an
 * optional label, and a best-effort current value. Empty scene says so.
 */
export function sceneBrief(scene: SceneMap): string {
  const lines: string[] = [];
  for (const h of scene.values()) lines.push(objectLine(h));
  if (lines.length === 0) return EMPTY;
  return `${HEADER}\n${lines.join('\n')}`;
}

const ENCODER = new TextEncoder();
const byteLen = (s: string): number => ENCODER.encode(s).length;

/**
 * `scopedManifest` — the byte-budgeted counterpart to `sceneBrief` (roadmap M4).
 *
 * Where `sceneBrief` dumps the WHOLE scene, this hands the model only the
 * neighborhood around one `focus` object: a nearest-first BFS over the
 * correspondence graph, filling the budget outward from the focus. The output
 * shape is identical to `sceneBrief` (same header, same `objectLine`), so swapping
 * one for the other never changes how the loop reads the manifest.
 *
 * Determinism (the cassette property): within each BFS layer objects are visited
 * in id-sorted order, so the same workspace + focus + budget always yields the
 * byte-identical string. The focus is layer 0, hence always first.
 *
 * The budget bounds the ENTIRE returned string (header included). Lines are added
 * in BFS order while the running byte total stays within `byteBudget`; the first
 * line that would overflow stops the fill (nearest-first means everything past it
 * is farther, so a hard stop is also the right exclusion). Objects never reached —
 * or reached but past the budget — are excluded. A `focus` absent from the
 * workspace, an isolated focus whose own line overflows, and an empty workspace
 * all reduce to zero emitted lines, reported the same way `sceneBrief` reports an
 * empty scene.
 */
export function scopedManifest(workspace: Workspace, focus: Id, byteBudget: number): string {
  const objects = workspace.objects;
  const focusH = objects.get(focus);
  if (!focusH) return EMPTY;

  // ── Nearest-first BFS: build the full visit order, layer by layer, id-sorted
  //    within each layer (the frontier is sorted before it is emitted/expanded). ──
  const order: Handle[] = [];
  const visited = new Set<Id>([focus]);
  let frontier: Handle[] = [focusH];
  while (frontier.length > 0) {
    for (const h of frontier) order.push(h);
    const next = new Map<Id, Handle>();
    for (const h of frontier) {
      for (const nb of workspace.graph.neighbors(h)) {
        if (visited.has(nb.id) || next.has(nb.id)) continue;
        // A neighbor is only manifestable if it is a live workspace object;
        // render from the `objects` handle (it carries label/value), not the
        // possibly-barer handle the edge stored.
        const oh = objects.get(nb.id);
        if (oh) next.set(nb.id, oh);
      }
    }
    for (const id of next.keys()) visited.add(id);
    frontier = [...next.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // ── Fill the budget in BFS order; stop at the first line that would overflow. ──
  const lines: string[] = [];
  let total = byteLen(HEADER);
  for (const h of order) {
    const line = objectLine(h);
    const cost = 1 + byteLen(line); // the '\n' joining it in, plus the line itself
    if (total + cost > byteBudget) break;
    total += cost;
    lines.push(line);
  }

  if (lines.length === 0) return EMPTY;
  return `${HEADER}\n${lines.join('\n')}`;
}
