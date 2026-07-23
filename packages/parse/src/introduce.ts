/**
 * introduce.ts — expression → `IntroduceAct` (roadmap M3).
 *
 * The LaTeX → source front door `act.ts` promised: a user types "x^2 + a*x", and
 * this turns it into an `introduce` act whose emitted source mints a live,
 * plotted object at a canvas position with a stable id. The fold then runs that
 * source in the sandbox exactly like any hand-authored `introduce` — no new fold
 * path, no host-side evaluator. The parser sits BESIDE the fold, at authoring
 * time; the numeric sampler runs where all authored math runs, in QuickJS.
 *
 * Free variables other than the plotted one bind to scene objects by id and are
 * reached with `byId`, so a plot of "a*x" tracks the live parameter `a`: a
 * `set-input` on `a` plus a re-fold re-samples the curve (the plot samples once
 * per fold — `state = fold(log)` — so "drag updates" IS re-fold).
 */

import type { Id } from '@isomat/core';
import type { Author, ExprMeta, IntroduceAct, Position } from '@isomat/workspace';
import { parseExpr } from './expr.js';

export interface IntroduceExprOpts {
  /** The expression text, e.g. "x^2 + a*x". */
  readonly text: string;
  /** Where the object sits on the canvas. */
  readonly at: Position;
  /** The stable id the minted plotted object carries (survives re-fold). */
  readonly id: Id;
  /** The plot's domain. */
  readonly domain: readonly [number, number];
  /** The plotted (independent) variable. Default `"x"`. */
  readonly indepVar?: string;
  /** Free variable → the scene object id it reads live (via `byId`). */
  readonly bindings?: Readonly<Record<string, Id>>;
  /** Display label. Default: the expression text. */
  readonly label?: string;
  /** Authorship tag. Default `by: "user"`, `turn: 0`. */
  readonly by?: Author;
  readonly turn?: number;
}

/**
 * Build the `introduce` act for a typed expression. Throws (before any act
 * exists) on empty text, a non-finite domain, or a free variable left unbound —
 * the caller's mistakes, named where they are made, not deferred to a fold.
 */
export function introduceExpr(opts: IntroduceExprOpts): IntroduceAct {
  const indepVar = opts.indepVar ?? 'x';
  const [lo, hi] = opts.domain;
  if (![lo, hi].every((n) => typeof n === 'number' && Number.isFinite(n)) || !(lo < hi)) {
    throw new Error(`introduceExpr: domain must be finite with lo < hi; got [${lo}, ${hi}].`);
  }

  const parsed = parseExpr(opts.text);
  const bindings = opts.bindings ?? {};

  // one `const vN = byId("<sceneId>")` per bound free variable, in first-
  // appearance order — deterministic, so the emitted source is stable per input
  const decls: string[] = [];
  const localRefs = new Map<string, string>();
  let n = 0;
  for (const v of parsed.freeVars) {
    if (v === indepVar) continue;
    const sceneId = bindings[v];
    if (sceneId === undefined) {
      throw new Error(
        `introduceExpr: "${opts.text}" uses free variable "${v}", but no binding was given. ` +
          `Pass bindings: { "${v}": <sceneId> }, or set indepVar: "${v}".`,
      );
    }
    const local = `v${n}`;
    n += 1;
    localRefs.set(v, `${local}.value`);
    decls.push(`const ${local} = byId(${JSON.stringify(sceneId)});`);
  }

  const body = parsed.sampleBody(indepVar, localRefs);
  const label = opts.label ?? opts.text;
  const plotLine =
    `plot((${indepVar}) => ${body}, ` +
    `{ domain: [${lo}, ${hi}], label: ${JSON.stringify(label)}, id: ${JSON.stringify(opts.id)} });`;
  const js = [...decls, plotLine].join('\n');

  // The parse context M4's `edit-span` re-parses and re-emits from. Carrying it
  // on the act (plain data — `workspace` is upstream of `parse`) is what lets a
  // later span edit reproduce THIS object under the same id from edited source.
  const expr: ExprMeta = {
    text: opts.text,
    at: opts.at,
    id: opts.id,
    domain: [lo, hi],
    indepVar,
    bindings,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  };

  return {
    kind: 'introduce',
    js,
    // the human-facing source is the expression the user typed, not the emitted
    // JS — that is what reads well in a log and what M4's edit-span re-parses
    source: opts.text,
    at: opts.at,
    id: opts.id,
    expr,
    by: opts.by ?? 'user',
    turn: opts.turn ?? 0,
  };
}
