/**
 * @isomat/library — the object primitives and the flat native authoring surface
 * (Stabilize §5), over core + the kept render views.
 *
 * The discipline libraries (automata / probability / calculus / linalg / graph /
 * field) and the `nerode` acceptance fixture were shed in Stabilize S3; what
 * remains is the reactive cell (`live`), the numeric/parameter/claim primitives,
 * and the flat scope that binds `expr / span / param / derive / plot / readout /
 * claim / link / note / byId` to one world + stage.
 */

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
