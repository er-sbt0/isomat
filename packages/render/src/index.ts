/**
 * @isomat/render — milestone 3: the DOM/SVG renderer over `@isomat/core` +
 * `@isomat/lesson`. Framework-free; theme-aware via CSS custom properties.
 *
 * Shape: a `Stage` (registry + canvas + narration + resonance) hosts `View`s
 * that project semantic objects and implement the lesson's structural
 * protocols (`elements` for morph, `buildUpGroups`); a `Player` walks the
 * timeline and executes step payloads as animation. Views subscribe to
 * slots/collections at authoring time and queue delta animations keyed by the
 * mutation's timeline step — playback runs them when it reaches that step.
 */

export { Stage, createStage } from './stage.js';
export type { StageOpts } from './stage.js';
export { NodeRegistry } from './registry.js';
export type { NodeKey } from './registry.js';
export { View } from './view.js';
export type { PendingAnimation, BackendCapabilities } from './view.js';
export { Player, createPlayer } from './player.js';
export type { PlayerOpts, PlayerStatus, SegmentEvent } from './player.js';
export { splitIntoSegments, segmentTitles, isBeatMarker } from './segments.js';
export type { Segment } from './segments.js';
export { sceneManifest, transitionFeed } from './manifest.js';
export { sceneIndex } from './scene.js';
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

// ── the KEEP primitive views (Stabilize §2.1); discipline-shaped views shed ──
export { FormulaView } from './views/formulaView.js';
export { FramedView, createFrame, rangeOf, polyline, svgLayer, SVG_NS } from './views/frame.js';
export type { CoordFrame, FrameOpts } from './views/frame.js';
export { PlotView } from './views/plot.js';
export type { PlotSpec } from './views/plot.js';
export { ReadoutView } from './views/readout.js';
export type { ReadoutSpec } from './views/readout.js';
export { ClaimView, relationGlyph } from './views/claim.js';
export type { ClaimSpec, ClaimSubject } from './views/claim.js';
export { NoteView } from './views/note.js';
export type { NoteSpec, NoteMention } from './views/note.js';
export { ExperimentView } from './views/experiment.js';
export { LayoutContainerView } from './views/layout.js';
export type { LayoutKindName } from './views/layout.js';
export { appendNarration } from './views/narration.js';

export { interpretEvent } from './events.js';
export type { AnimationCue, HandleRef } from './events.js';
export { stepSupersedesLoop } from './supersede.js';
export { cascadeDurations, paceMs, parseOver, PACE_MS } from './pacing.js';
export { labelOf, displayLabel, fmt } from './util.js';
export { renderTex, plainTex, isTexish } from './tex.js';
export { THEME_CSS, ensureTheme } from './theme.js';
