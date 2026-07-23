/**
 * editspan.ts — the `edit-span` re-emit (roadmap M4 Stage B, parse side).
 *
 * `edit-span` edits ONE addressable span of a parsed expression and re-mints the
 * object under its EXISTING id. The workspace fold cannot do this itself — it
 * sits upstream of `@isomat/parse` — so it takes a `SpanResolver` hook, and this
 * is the parse-layer implementation of that hook.
 *
 * A span is a top-level additive term, role-named `term0`/`term1`/… exactly as
 * `toFragments` splits the display TeX. But `parseExpr` consumes SOURCE, not
 * TeX, so the edit is addressed and applied in source terms: `editSpanSource`
 * reads the addressed term's source (`additiveTermSources`), splices the
 * replacement in, and rejoins — a plain structural rewrite, never a symbolic
 * one, so the no-CAS fence holds (route only through `parseToAst` + our own
 * walkers). `resolveSpan` then re-runs `introduceExpr` over the edited source,
 * reproducing the object under the same `id`/`at`/`bindings`.
 */

import type { ExprMeta, ResolvedExpr, SpanResolver } from '@isomat/workspace';
import { parseToAst } from './mathjs.js';
import { additiveTermSources } from './ast.js';
import { introduceExpr } from './introduce.js';

/** `term0` → 0. Rejects a malformed or out-of-range role, naming what exists. */
function roleIndex(role: string, count: number): number {
  const m = /^term(\d+)$/.exec(role);
  if (!m) {
    throw new Error(
      `edit-span role "${role}" is not addressable — a span role is "term0", "term1", … naming a ` +
        `top-level additive term.`,
    );
  }
  const i = Number(m[1]);
  if (i < 0 || i >= count) {
    throw new Error(
      `edit-span role "${role}" is out of range — the expression has ${count} top-level term(s) ` +
        `(term0..term${count - 1}).`,
    );
  }
  return i;
}

/** Rejoin signed source terms into a source string (leading `-` kept, glue spaced). */
function reassemble(terms: ReadonlyArray<{ sign: '+' | '-'; src: string }>): string {
  return terms
    .map((t, i) => (i === 0 ? (t.sign === '-' ? `-${t.src}` : t.src) : ` ${t.sign} ${t.src}`))
    .join('');
}

/**
 * Splice `termText` (mathjs SOURCE) into the addressed `role` of `text`,
 * returning the reassembled expression source. Throws on a bad role or on
 * `termText` that does not itself parse — the caller's mistake, named here,
 * before any act exists.
 */
export function editSpanSource(text: string, role: string, termText: string): string {
  const terms = additiveTermSources(parseToAst(text));
  const idx = roleIndex(role, terms.length);
  // The replacement must be a valid expression in the same grammar — reject
  // garbage now (and keep the whole path routed through parseToAst).
  parseToAst(termText);
  const edited = terms.map((t, i) => (i === idx ? { sign: t.sign, src: termText } : t));
  return reassemble(edited);
}

/**
 * The `SpanResolver` the parse-enabled fold injects: splice the edit into the
 * target's current source, then re-emit through `introduceExpr` under the same
 * id/at/bindings. The returned `meta` carries the edited source, so successive
 * edit-spans on one object compose.
 */
export const resolveSpan: SpanResolver = (meta: ExprMeta, role: string, text: string): ResolvedExpr => {
  const newSource = editSpanSource(meta.text, role, text);
  const act = introduceExpr({
    text: newSource,
    at: meta.at,
    id: meta.id,
    domain: meta.domain,
    indepVar: meta.indepVar,
    bindings: meta.bindings,
    ...(meta.label !== undefined ? { label: meta.label } : {}),
  });
  return { js: act.js, source: newSource, meta: act.expr ?? { ...meta, text: newSource } };
};
