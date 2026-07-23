/**
 * @isomat/parse — the parser front door (roadmap M3).
 *
 * Math text → live workspace object. `parseExpr(text)` yields the display TeX, an
 * addressable span tree (formula shape), the free variables, and a numeric
 * sampler emitter; `introduceExpr(...)` packages all that as an `introduce` act
 * the workspace folds like any other. mathjs parses the text into an AST; the
 * walk (`ast.ts`) is the only thing that touches it, and it never simplifies or
 * differentiates — the no-CAS line, enforced by `fence.test.ts`.
 *
 * NOT in scope (deliberately): `edit-span` (in-place term edit) is consolidated
 * with M4's `replace`, since both are the same id-stability-under-mutation
 * problem — solved once, there. M3 is the front door and its fence.
 */

export { parseExpr } from './expr.js';
export type { ParsedExpr } from './expr.js';
export { introduceExpr } from './introduce.js';
export type { IntroduceExprOpts } from './introduce.js';
