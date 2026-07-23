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

import type { Handle } from '@isomat/core';
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
 * The scene as the model sees it: one line per object, id first, then kind, an
 * optional label, and a best-effort current value. Empty scene says so.
 */
export function sceneBrief(scene: SceneMap): string {
  const lines: string[] = [];
  for (const h of scene.values()) {
    const label = (h as Handle & { label?: unknown }).label;
    const labelPart = typeof label === 'string' ? ` "${label}"` : '';
    lines.push(`- ${h.id} (${h.kind})${labelPart}${summarize(h)}`);
  }
  if (lines.length === 0) return 'The workspace is empty.';
  return `Workspace objects (reach them by id):\n${lines.join('\n')}`;
}
