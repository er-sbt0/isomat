/**
 * @isomat/cell — the QUARANTINE (Stabilize §4). Playback-in-a-cell.
 *
 * Everything demoted out of the main path lives here, OFF the workspace DAG:
 * nothing in `core` / `sandbox` / `objects` / `workspace` imports this package,
 * and the Stabilize fence (`workspace/src/import-boundary.test.ts`) asserts it.
 * The package keeps building and its tests keep running — it is preserved, not
 * deleted — but it is never in the product's dependency closure.
 *
 * What it holds:
 *   - the lesson authoring verbs (`lesson.ts`) and morph legality (`morph.ts`),
 *     with the playback payload/verb/morph-route types (`types.ts`);
 *   - the timeline player and its machinery (`player`, `segments`, `events`,
 *     `animate`, `pacing`, `supersede`);
 *   - the prose scene manifest (`manifest.ts` — `sceneManifest`/`transitionFeed`,
 *     the timeline-free `sceneIndex` stayed in `objects/scene.ts`);
 *   - the playback-only views (`narration` renders `lesson.say`; `experiment`
 *     renders a compare; `formulaMorph` animates a formula transition).
 *
 * This barrel exists so the package has a coherent entry point; it exports
 * nothing the main path is allowed to reach.
 */

// authoring + morph
export { Lesson, createLesson } from './lesson.js';
export { checkMorph, elementsOf, routeFor, illegalMorphError } from './morph.js';
export type { MorphCheck } from './morph.js';

// the timeline player + machinery
export { Player, createPlayer } from './player.js';
export type { PlayerOpts, PlayerStatus, SegmentEvent } from './player.js';
export { splitIntoSegments, segmentTitles, isBeatMarker } from './segments.js';
export type { Segment } from './segments.js';
export { interpretEvent } from './events.js';
export type { AnimationCue, HandleRef } from './events.js';
export { stepSupersedesLoop } from './supersede.js';
export { cascadeDurations, paceMs, parseOver, PACE_MS } from './pacing.js';

// the prose scene manifest
export { sceneManifest, transitionFeed } from './manifest.js';
export type {
  SceneManifest,
  ManifestBeat,
  ManifestObject,
  ManifestClaim,
  ManifestView,
  ManifestEvidence,
  ManifestMove,
  ClaimFlip,
  TransitionFeed,
} from './manifest.js';

// playback-only views
export { appendNarration } from './views/narration.js';
export { ExperimentView } from './views/experiment.js';
export { MorphFormulaView } from './views/formulaMorph.js';
