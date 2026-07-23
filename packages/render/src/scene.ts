/**
 * scene.ts — the timeline-free scene boundary (Stabilize §2.1).
 *
 * `sceneIndex(stage)` is the id → live-handle index a program fragment resolves
 * against and the workspace `fold` surfaces as its `objects` map. It is KEEP
 * substrate — the reach-back boundary `M.byId` and the manifest share — but its
 * old implementation walked `world.timeline`, the very machinery Stabilize
 * quarantines. This module re-homes it so the scene is built from NATIVE
 * sources, with the timeline walk demoted to a clearly-marked compatibility
 * path that S3 removes.
 *
 * ## The three sources, and why the timeline one is temporary
 *
 * A scene object can reach the index three ways:
 *
 *   1. `stage.registered` — objects registered directly on the stage. This is
 *      the NATIVE seam: the S3 flat authoring surface auto-registers every
 *      object it constructs here (§5.1, "auto-register on construction, no
 *      show/place verb"). It is empty today because nothing populates it yet.
 *
 *   2. `stage.views` + the objects each view projects (`view.elements`) — every
 *      view a program constructed. Native and timeline-free.
 *
 *   3. TODO(S3): the timeline walk (`collect`). Today an exposed `param` with no
 *      view reaches the scene ONLY through its `expose` timeline step (risk 2):
 *      `M.parameter(...)` then `lesson.expose(...)` puts the parameter on the
 *      timeline, and nothing else retains it. The lesson-authored fold tests
 *      depend on this, so the walk stays as a compatibility source until the
 *      native surface auto-registers (source 1) and those tests are rewritten to
 *      it. At that point sources 1+2 are the whole scene and this file stops
 *      importing the timeline.
 *
 * So this module does NOT read the timeline as its only source — the native
 * `registered` seam and `stage.views` are first-class here; the timeline is the
 * demoted third.
 */

import { isHandle } from '@isomat/core';
import type { Handle, Id, TimelineNode } from '@isomat/core';
import type {
  EnableInteractionPayload,
  ExposePayload,
  FocusPayload,
  HidePayload,
  LinkPayload,
  ReplacePayload,
  RetirePayload,
  SayPayload,
  ShowPayload,
  VaryPayload,
} from '@isomat/lesson';
import type { Stage } from './stage.js';

// ───────────────── the timeline walk (compat, TODO(S3): remove) ─────────────────

/**
 * Every handle a step mentions, and whether the step makes it student-movable.
 *
 * `vary` counts as movable-adjacent but NOT draggable: the lesson moved it,
 * the student cannot. Only `expose` and `enableInteraction` hand over control,
 * and conflating them would tell a follow-up it may set something it cannot.
 *
 * Shared with the (quarantined) prose manifest, which reuses this walk.
 * TODO(S3): the native surface auto-registers objects on construction, which
 * replaces the reason this walk feeds `sceneIndex`.
 */
export function collect(
  node: TimelineNode,
  seen: Map<Id, Handle>,
  draggable: Set<Id>,
  narration: string[],
  retired: Set<Id>,
): void {
  if (node.type === 'cascade' || node.type === 'parallel' || node.type === 'loop') {
    const children = (node as { children?: readonly TimelineNode[] }).children ?? [];
    for (const c of children) collect(c, seen, draggable, narration, retired);
    const iterations = (node as { iterations?: readonly TimelineNode[] }).iterations ?? [];
    for (const c of iterations) collect(c, seen, draggable, narration, retired);
    return;
  }
  if (node.type !== 'action') return;

  const keep = (h: unknown): void => {
    if (isHandle(h) && !seen.has(h.id)) seen.set(h.id, h);
  };
  const p = node.payload as Record<string, unknown> | undefined;
  if (!p) return;

  switch (node.op) {
    case 'say': {
      const say = p as unknown as SayPayload;
      narration.push(say.strings.join('…').trim());
      for (const m of say.mentions) keep(m);
      return;
    }
    case 'show':
      keep((p as unknown as ShowPayload).subject);
      return;
    case 'hide':
      keep((p as unknown as HidePayload).subject);
      return;
    case 'retire': {
      // Retired, not merely hidden: the object is out of the explanation, so a
      // follow-up must not be offered it as something to reason about or move.
      // This is the whole reason `retire` had to exist separately from `hide`.
      retired.add((p as unknown as RetirePayload).subject.id);
      return;
    }
    case 'replace': {
      const r = p as unknown as ReplacePayload;
      retired.add(r.old.id);
      keep(r.next);
      return;
    }
    case 'focus':
      for (const s of (p as unknown as FocusPayload).subjects) keep(s);
      return;
    case 'vary':
      keep((p as unknown as VaryPayload).target);
      return;
    case 'expose': {
      const e = p as unknown as ExposePayload;
      keep(e.subject);
      draggable.add(e.subject.id);
      return;
    }
    case 'enableInteraction': {
      const i = (p as unknown as EnableInteractionPayload).interaction;
      keep(i.target);
      keep(i.along);
      draggable.add(i.target.id);
      return;
    }
    case 'link': {
      const l = p as unknown as LinkPayload;
      keep(l.a);
      for (const t of l.targets) keep(t);
      return;
    }
    default: {
      // Every other verb (morph, demonstrate, buildUp, compareExperiment,
      // transformFormula) carries handles under names this switch does not
      // know. Sweep them generically rather than enumerating payload shapes
      // that will drift — a manifest that silently misses new verbs is worse
      // than one that occasionally names a handle the student cannot see.
      for (const v of Object.values(p)) {
        if (Array.isArray(v)) v.forEach(keep);
        else keep(v);
      }
    }
  }
}

// ───────────────────────────── the scene index ─────────────────────────────

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
 *
 * Retired objects are absent here too, so a fragment cannot resurrect one by
 * id. That is `retire` doing its job rather than a special case.
 */
export function sceneIndex(stage: Stage): Map<Id, Handle> {
  const seen = new Map<Id, Handle>();
  const retired = new Set<Id>();

  // Source 1 (NATIVE): objects registered directly on the stage. The S3 flat
  // surface auto-registers here on construction; empty until then.
  for (const h of stage.registered) {
    if (!seen.has(h.id)) seen.set(h.id, h);
  }

  // Source 3 (COMPAT, TODO(S3): remove): the lesson timeline. An exposed `param`
  // with no view reaches the scene only through its `expose` step today, so the
  // lesson-authored fold tests need this walk until the native surface replaces
  // it (source 1). It also owns the retired set.
  for (const node of stage.world.timeline.root) {
    collect(node, seen, new Set(), [], retired);
  }

  // Source 2 (NATIVE): every mounted view and the objects it projects.
  for (const v of stage.views) {
    if (retired.has(v.id)) continue;
    seen.set(v.id, v as unknown as Handle);
    for (const e of v.elements) if (!retired.has(e.id)) seen.set(e.id, e);
  }

  for (const id of retired) seen.delete(id);
  return seen;
}
