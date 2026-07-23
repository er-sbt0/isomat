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
 * M4 adds `edit-span` (in-place term edit) here, consolidated with the
 * workspace's `replace` since both are the same id-stability-under-mutation
 * problem: `resolveSpan` is the parse-layer hook the fold injects to re-parse
 * and re-emit an edited span. The no-CAS fence still holds — it routes only
 * through `parseToAst` and the AST walkers, never a symbolic op.
 */

export { parseExpr } from './expr.js';
export type { ParsedExpr } from './expr.js';
export { introduceExpr } from './introduce.js';
export type { IntroduceExprOpts } from './introduce.js';
export { resolveSpan, editSpanSource } from './editspan.js';
