/**
 * mathjs.ts — the no-CAS boundary (roadmap M3, decision #3).
 *
 * This is the ONLY module in the repo permitted to import `mathjs`, and it
 * imports ONLY `parse` — the text → AST front door. mathjs is a full CAS;
 * everything that makes it one (`simplify`, `derivative`, `rationalize`,
 * `resolve`, `evaluate`-as-symbolic-manipulation, the matrix/unit algebra) stays
 * unreachable behind this wall. isomat's standing line holds: the engine parses
 * and evaluates numerically; it does not manipulate symbols. A model reasons;
 * the engine probes.
 *
 * `fence.test.ts` enforces the wall — it fails the build if any other `parse`
 * source imports `mathjs`, or if this file imports anything from it beyond
 * `parse` (and the AST node types, which carry no runtime).
 *
 * Numeric evaluation is deliberately NOT taken from here. A parsed expression's
 * live sampler is EMITTED as sandbox JS (`emit.ts`) and runs in QuickJS like any
 * authored fragment — keeping a single evaluation site (the sandbox, lint-gated
 * and deterministic) rather than splitting arithmetic across a host-side CAS.
 */

import { parse } from 'mathjs';
import type {
  MathNode,
  OperatorNode,
  ConstantNode,
  SymbolNode,
  ParenthesisNode,
  FunctionNode,
} from 'mathjs';

/** Text → AST. The one capability of mathjs isomat uses. */
export function parseToAst(text: string): MathNode {
  return parse(text);
}

export type { MathNode, OperatorNode, ConstantNode, SymbolNode, ParenthesisNode, FunctionNode };
