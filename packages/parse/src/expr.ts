/**
 * expr.ts — `parseExpr(text)` (roadmap M3, the parser front door).
 *
 * The public parse: math text ("x^2 + a*x") → a `ParsedExpr` carrying the four
 * things the rest of isomat needs — the display TeX, the addressable span tree
 * (formula shape), the free variables, and a numeric sampler emitter. None of it
 * is symbolic; the AST is walked, never simplified or differentiated.
 *
 * INPUT is expression text (mathjs syntax), NOT LaTeX — mathjs parses the
 * former; the span tree carries GENERATED TeX for display. The roadmap's
 * "LaTeX/text → span tree" resolves to: text in, addressable TeX out.
 */

import type { FormulaFragment } from '@isomat/objects';
import { parseToAst } from './mathjs.js';
import { freeVars, toFragments, toJs, toTex } from './ast.js';

export interface ParsedExpr {
  /** The input text, verbatim. */
  readonly text: string;
  /** Generated display TeX. */
  readonly tex: string;
  /** The addressable span tree — `{ tex, role? }`, top-level terms role-named. */
  readonly fragments: readonly FormulaFragment[];
  /** Every variable in the expression, in first-appearance order. */
  readonly freeVars: readonly string[];
  /**
   * Emit the numeric sampler body as sandbox JS: `indepVar` is the plotted
   * variable (a bare local); every other variable must appear in `bindings`
   * (name → a JS reference to a live value, e.g. `"v0.value"`). Throws on an
   * unbound free variable or a term outside the arithmetic grammar.
   */
  sampleBody(indepVar: string, bindings: ReadonlyMap<string, string>): string;
}

export function parseExpr(text: string): ParsedExpr {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('parseExpr wants non-empty expression text.');
  }
  const ast = parseToAst(text);
  const vars = freeVars(ast);

  return {
    text,
    tex: toTex(ast),
    fragments: toFragments(ast),
    freeVars: [...vars],
    sampleBody: (indepVar, bindings) => toJs(ast, indepVar, bindings),
  };
}
