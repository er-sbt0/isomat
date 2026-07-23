/**
 * @isomat/objects — the math object primitives, the flat native authoring
 * surface (Stabilize §5), and the KEEP render substrate they draw through.
 *
 * The discipline libraries (automata / probability / calculus / linalg / graph /
 * field) and the `nerode` acceptance fixture were shed in Stabilize S3; the
 * playback machinery (player / timeline manifest / lesson verbs / morph) was
 * quarantined to `@isomat/cell` in S4. What remains here is the reactive cell
 * (`live`), the numeric/parameter/claim primitives, the `expr` formula model,
 * the flat scope that binds `expr / span / param / derive / plot / readout /
 * claim / link / note / byId` to one world + stage, and — folded in from the
 * former `@isomat/render` (Stabilize §4.2) — the stage/view substrate and the
 * KEEP primitive views (`plot / readout / claim / formula / note`), so a math
 * object and its rendering live in one package.
 */

// ── the flat native authoring surface + object primitives ──
export { createNativeScope } from './scope.js';
export type { NativeScope, PlotOpts, PlotSubject } from './scope.js';

export { createViews } from './views.js';
export type { NativeViewLib, PlottedFn } from './views.js';

export { createParameter } from './parameter.js';
export type { Parameter } from './parameter.js';

export { createClaim } from './claim.js';
export type { Claim, ClaimOpts, ClaimSides, ClaimPredicate, ClaimRelation, ClaimEvidence } from './claim.js';

export { derivedNumber, constNumber, numOf } from './numeric.js';
export type { LabeledNumber } from './numeric.js';

export { live, constLive, isLive, valueOf, vec2Equals, listEquals, vec2ListEquals } from './live.js';
export type { Live, LiveValue, LiveOpts } from './live.js';

// ── the `expr` formula model (KEEP; salvaged from the former lesson package) ──
export { createF } from './formula.js';
export type { SpanSpec, FormulaSpan, FormulaFragment, Formula, FormulaBuilder } from './formula.js';

// ── the KEEP render substrate (folded in from the former @isomat/render) ──
export { Stage, createStage } from './stage.js';
export type { StageOpts } from './stage.js';
export { NodeRegistry } from './registry.js';
export type { NodeKey } from './registry.js';
export { View } from './view.js';
export type { PendingAnimation, BackendCapabilities } from './view.js';
export { sceneIndex } from './scene.js';

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
export { LayoutContainerView } from './views/layout.js';
export type { LayoutKindName } from './views/layout.js';

export { labelOf, displayLabel, fmt } from './util.js';
export { renderTex, plainTex, isTexish } from './tex.js';
export { THEME_CSS, ensureTheme } from './theme.js';
