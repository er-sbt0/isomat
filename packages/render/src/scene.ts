/**
 * scene.ts — the timeline-free scene boundary (Stabilize §2.1, §5.1).
 *
 * `sceneIndex(stage)` is the id → live-handle index a program fragment resolves
 * against and the workspace `fold` surfaces as its `objects` map. It is KEEP
 * substrate — the reach-back boundary `byId` and the manifest share. Its old
 * implementation walked `world.timeline`, the very machinery Stabilize
 * quarantines; S3 removed that. The scene is now built from two NATIVE sources
 * only, and this module imports nothing from `lesson` or `timeline`.
 *
 * ## The two native sources
 *
 *   1. `stage.registered` — objects registered directly on the stage. The flat
 *      authoring surface auto-registers every object it constructs here on
 *      construction (§5.1, "auto-register on construction, no show/place verb").
 *      A bare `param` with no `expose` reaches the scene THROUGH THIS, which is
 *      the load-bearing risk-2 decoupling: the timeline is no longer consulted.
 *
 *   2. `stage.views` + the objects each view projects (`view.elements`) — every
 *      view a program constructed (a `plot`, a `readout`, a `note`). A view
 *      auto-adds itself to `stage.views` in the `View` base constructor.
 */

import type { Handle, Id } from '@isomat/core';
import type { Stage } from './stage.js';

/**
 * The id → handle index a program FRAGMENT resolves against (roadmap 4b).
 *
 * A turn-2 fragment compiles in its own scope, so it cannot see turn-1's
 * `const`s; it reaches back by id. There is no registry of minted handles to
 * look them up in, so the index is built from the stage's own retained
 * references — which gives the reference the right boundary for free: a fragment
 * can name anything the scene offered it and nothing else. Naming an object the
 * student was never shown would be authoring against a scene that does not, as
 * far as anyone can tell, exist.
 */
export function sceneIndex(stage: Stage): Map<Id, Handle> {
  const seen = new Map<Id, Handle>();

  // Source 1 (NATIVE): objects registered directly on the stage. The flat
  // surface auto-registers here on construction — a bare `param` surfaces with
  // no `expose`/`show` verb (§5.1).
  for (const h of stage.registered) {
    if (!seen.has(h.id)) seen.set(h.id, h);
  }

  // Source 2 (NATIVE): every mounted view and the objects it projects.
  for (const v of stage.views) {
    if (!seen.has(v.id)) seen.set(v.id, v as unknown as Handle);
    for (const e of v.elements) if (!seen.has(e.id)) seen.set(e.id, e);
  }

  return seen;
}
