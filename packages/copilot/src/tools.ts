/**
 * tools.ts — the workspace as an instrument (roadmap M2a).
 *
 * A copilot turn becomes a tool loop: the model holds typed tools, each a thin
 * RPC over machinery that already exists — `sceneIndex` for reach, disposable
 * folds (`commit`'s one-transaction rule) for experiments, the reactive graph
 * for causality. Nothing here computes mathematics or grows a pipeline; every
 * tool resolves, reads, folds, or commits through the `@isomat/workspace` seam.
 *
 * ## What M2a changed
 *
 * This is `@isomat/sandbox`'s parked `tools.ts` retargeted from the superseded
 * `ConversationLog` (program/fragment/event, `commitEntry`, `ReplayFailure`) to
 * the workspace's own act log: `WorkspaceLog` (author/introduce/set-input),
 * `commit`, `FoldFailure`. The disposable-fold hook IS the workspace's `TryFold`,
 * so `commit` takes it directly — the old `asTryFold` shim is gone. A committed
 * write now lands a real `SetInputAct` / `AuthorAct`, authorship-tagged, through
 * the same `commit` a user's drag goes through (the symmetric-log payoff).
 *
 * ## Errors are data
 *
 * In the loop a tool error goes BACK TO THE MODEL as the tool result, where it
 * is the retry prompt (a rejection returned verbatim is repair become ordinary
 * tool-retry). So nothing here throws across the boundary: every tool returns
 * `ToolResult`, and `runTool` catches what the workspace itself throws (a derived
 * that errors mid-read) into one too.
 *
 * ## The boundary is the workspace's
 *
 * Every id resolves against the injected scene map, which callers MUST build
 * from `Workspace.objects` (i.e. `sceneIndex(stage)`) — exactly what the
 * manifest offered the model, nothing else. An object never shown is
 * unreachable; a retired one (M4) stays retired.
 */

import type { Handle, Id } from '@isomat/core';
import { commit } from '@isomat/workspace';
import type {
  Author,
  AuthorAct,
  FoldFailure,
  IntroduceAct,
  SetInputAct,
  TryFold,
  Workspace,
  WorkspaceLog,
} from '@isomat/workspace';
import { introduceExpr } from '@isomat/parse';

// ─────────────────────────── the call/result surface ───────────────────────────

export type Json =
  | null
  | number
  | string
  | boolean
  | readonly Json[]
  | { readonly [key: string]: Json };

export type ToolErrorCode =
  /** The id is not in the scene the manifest describes. */
  | 'unknown-id'
  /** Arguments malformed for this tool on this object (arity, non-finite). */
  | 'bad-args'
  /** The object exists but is not something this tool can act on. */
  | 'not-evaluable'
  /** whyChanged on something with no computation behind it (an input, a view). */
  | 'not-derived'
  /** A candidate log did not fold — the transaction's complaint, verbatim. */
  | 'rejected'
  /** The evaluation left the object's domain (a non-finite result). */
  | 'domain'
  /** The workspace itself threw while a tool was reading it. */
  | 'failed';

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
}

export type ToolResult =
  | { readonly ok: true; readonly value: Json }
  | { readonly ok: false; readonly error: ToolError };

export interface SetSpec {
  readonly id: Id;
  readonly value: number;
}

export type ToolCall =
  | { readonly tool: 'inspect'; readonly id: Id }
  | { readonly tool: 'evalAt'; readonly id: Id; readonly args: readonly number[] }
  | { readonly tool: 'whyChanged'; readonly id: Id }
  | { readonly tool: 'counterfactual'; readonly set: readonly SetSpec[]; readonly read: readonly Id[] }
  | {
      readonly tool: 'bisectFlip';
      readonly param: Id;
      readonly claim: Id;
      readonly lo: number;
      readonly hi: number;
      readonly maxProbes?: number;
    }
  | { readonly tool: 'setInput'; readonly id: Id; readonly value: number }
  | { readonly tool: 'appendFragment'; readonly source: string }
  | {
      readonly tool: 'plot';
      readonly text: string;
      readonly domain: { readonly from: number; readonly to: number };
      readonly id?: Id;
      readonly bindings?: Readonly<Record<string, Id>>;
    }
  | {
      readonly tool: 'tabulate';
      readonly id: Id;
      readonly from: number;
      readonly to: number;
      readonly count: number;
    }
  | {
      readonly tool: 'numericEquivalence';
      readonly idA: Id;
      readonly idB: Id;
      readonly from: number;
      readonly to: number;
      readonly count: number;
      readonly tolerance?: number;
    }
  | {
      readonly tool: 'numericRoot';
      readonly id: Id;
      readonly from: number;
      readonly to: number;
      readonly count?: number;
      readonly tolerance?: number;
    };

/** The scene as ids → live handles — `Workspace.objects`, i.e. `sceneIndex(stage)`. */
export type SceneMap = Workspace['objects'];

/**
 * Who a committed write is tagged as, and on which turn. The tool executor is
 * the COPILOT's instrument, so writes default to `{ by: 'copilot', turn: 0 }`;
 * the loop (M2b) overrides `turn` per conversational turn. `fold` never reads
 * either field (M1: both authors fold identically), so a probe's throwaway acts
 * carry a fixed attribution and it is immaterial.
 */
export interface Attribution {
  readonly by: Author;
  readonly turn: number;
}

const COPILOT: Attribution = { by: 'copilot', turn: 0 };

export interface ToolHooks {
  /**
   * The live workspace's object index, read PER DISPATCH — a tool between two
   * user drags must see the workspace as it stands, not as it stood at loop
   * start. Read probes resolve against it and never mutate it.
   */
  readonly scene: () => SceneMap;
  /** The act log so far — what experiments fold and writes extend. */
  readonly log?: WorkspaceLog;
  /** The disposable fold. Required by the experiment probes and the writes. */
  readonly fold?: TryFold;
  /** Compile + gate. Required by appendFragment only. */
  readonly compile?: CompileFragment;
  /** How a committed write is authorship-tagged. Defaults to the copilot. */
  readonly attribution?: Attribution;
}

/**
 * Compile + gate a fragment's source into runnable JS. Callers wire it with the
 * sandbox lint gate (M2a's test does exactly this); a rejection's errors come
 * back to the model as the tool error, verbatim.
 */
export type CompileFragment = (
  source: string,
) =>
  | Promise<{ ok: true; js: string } | { ok: false; errors: readonly string[] }>
  | { ok: true; js: string }
  | { ok: false; errors: readonly string[] };

const ok = (value: Json): ToolResult => ({ ok: true, value });
const err = (code: ToolErrorCode, message: string): ToolResult => ({
  ok: false,
  error: { code, message },
});

/**
 * The one resolution path every tool shares. The message states the boundary
 * rule rather than just the miss, because in the loop this text IS what the
 * model reads next.
 */
function reach(scene: SceneMap, id: Id): Handle | ToolResult {
  const found = scene.get(id);
  if (found) return found;
  return err(
    'unknown-id',
    `"${id}" is not in the workspace. A tool may reach exactly what the scene manifest offers — ` +
      `never an object the user was not shown, and never a retired one.`,
  );
}

function isToolResult(x: Handle | ToolResult): x is ToolResult {
  return typeof (x as { ok?: unknown }).ok === 'boolean';
}

// ─────────────────────────── structural probes ───────────────────────────
// Everything in the engine is a frozen object literal, so these are duck-typed
// rather than instanceof — the same choice the scene index makes, and for the
// same reason: the library's shapes are contracts, not classes.

interface ClaimLike {
  readonly holds: boolean;
  readonly evidence?: string;
  readonly label?: string;
  readonly relation?: string;
  readonly tolerance?: number;
  readonly lhs?: { readonly value: number };
  readonly rhs?: { readonly value: number };
  readonly gap?: { readonly value: number };
}

function asClaim(h: Handle): ClaimLike | undefined {
  return h.kind === 'claim' && typeof (h as unknown as ClaimLike).holds === 'boolean'
    ? (h as unknown as ClaimLike)
    : undefined;
}

function labelOf(h: Handle): string | undefined {
  const l = (h as { label?: unknown }).label;
  return typeof l === 'string' ? l : undefined;
}

/**
 * Render a scene value as JSON, or nothing. A `Verdict` becomes its label —
 * `holds`/`broken` is what a model can narrate; `polarity` is view plumbing.
 */
function jsonValue(v: unknown): Json | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const items = v.map(jsonValue);
    return items.every((x): x is Json => x !== undefined) ? items : undefined;
  }
  if (v !== null && typeof v === 'object') {
    const verdict = v as { label?: unknown; polarity?: unknown };
    if (typeof verdict.label === 'string' && typeof verdict.polarity === 'string') {
      return verdict.label;
    }
  }
  return undefined;
}

// ─────────────────────────────── inspect ───────────────────────────────

/**
 * The full structured value of ONE object — what the manifest deliberately
 * keeps terse, on demand. Dispatch is by kind; anything without a richer shape
 * falls through to `{id, kind, label?, value?}`, which is never an error: an
 * object the manifest offered is always at least inspectable as itself.
 */
export function inspect(scene: SceneMap, id: Id): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const base: Record<string, Json> = { id: h.id, kind: h.kind };
  const label = labelOf(h);
  if (label !== undefined) base['label'] = label;

  const claim = asClaim(h);
  if (claim) {
    return ok({
      ...base,
      holds: claim.holds,
      // absent only on a claim predating the field; under-claim, as the manifest does
      evidence: claim.evidence ?? 'authored-predicate',
      ...(claim.relation !== undefined ? { relation: claim.relation } : {}),
      ...(claim.tolerance !== undefined ? { tolerance: claim.tolerance } : {}),
      ...(claim.lhs ? { lhs: claim.lhs.value } : {}),
      ...(claim.rhs ? { rhs: claim.rhs.value } : {}),
      ...(claim.gap ? { gap: claim.gap.value } : {}),
    });
  }

  if (h.kind === 'parameter') {
    const p = h as unknown as { value: number; range: readonly [number, number] };
    return ok({ ...base, value: p.value, range: [p.range[0], p.range[1]] });
  }

  const value = jsonValue((h as { value?: unknown }).value);
  return ok(value !== undefined ? { ...base, value } : base);
}

// ─────────────────────────────── evalAt ───────────────────────────────

/**
 * kind → how many coordinates its rule takes. Only `fn` (a plotted numeric
 * rule) survives the discipline shed; the field/accumulation kinds went with
 * their libraries and are not reintroduced here as a dead surface. M3's parser
 * front door and M5's probe toolset extend this as the lean substrate grows to
 * express them.
 */
const EVAL_ARITY: Record<string, number> = {
  fn: 1,
};

/**
 * Sample a function handle at a point. The rule is an authored closure the
 * object already carries (`at` reads it), so this is the engine doing
 * arithmetic the model must never do itself — grounded in the actual workspace
 * object, not a formula the model remembers writing.
 */
export function evalAt(scene: SceneMap, id: Id, args: readonly number[]): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const arity = EVAL_ARITY[h.kind];
  if (arity === undefined) {
    return err(
      'not-evaluable',
      `"${id}" is a ${h.kind}, which has no rule to sample. evalAt samples a plotted fn at a ` +
        `single coordinate x.`,
    );
  }
  if (args.length !== arity || !args.every((a) => typeof a === 'number' && Number.isFinite(a))) {
    return err(
      'bad-args',
      `evalAt("${id}") wants exactly ${arity} finite coordinate${arity === 1 ? '' : 's'}; ` +
        `got [${args.map(String).join(', ')}].`,
    );
  }

  const at = (h as unknown as { at: (...xs: number[]) => number | readonly number[] }).at;
  const result = at.call(h, ...args);
  const value = jsonValue(result);
  if (value === undefined) {
    return err(
      'domain',
      `"${id}" is not finite at (${args.join(', ')}) — the point is outside the rule's domain.`,
    );
  }
  return ok(value);
}

// ─────────────────────────── numeric probes (M5a) ───────────────────────────
// Four probes that SAMPLE live `fn` rules — the engine doing arithmetic the model
// must never do itself. Every result is `sampled` evidence: agreement across a
// finite point set, never a proof. `numericEquivalence` is the one that catches a
// wrong LLM derivative; none of these differentiate or simplify (the no-CAS line).

/** How many points `plot` samples the new curve at, for its `sampled` witness. */
const PLOT_SAMPLE_COUNT = 5;
/** A generous cap on a single read's sample count — a rail, not a real limit. */
const SAMPLE_MAX = 10_000;
/** Default agreement tolerance for `numericEquivalence` — float hygiene, not proof. */
const DEFAULT_EQUIV_TOL = 1e-9;
/** Default scan resolution + root precision for `numericRoot`. */
const DEFAULT_ROOT_COUNT = 100;
const DEFAULT_ROOT_TOL = 1e-9;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** `count` evenly spaced points across [from, to] (descending if from > to). */
function samplePoints(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  const xs: number[] = [];
  for (let i = 0; i < n; i += 1) xs.push(from + ((to - from) * i) / (n - 1));
  return xs;
}

/**
 * Resolve a live `fn` to its authored `at` sampler — the same seam `evalAt`
 * reads, shared by every M5a probe. A non-`fn` is `not-evaluable`; an unknown id
 * is the boundary rule. The returned closure yields the fn's value at x, or `NaN`
 * for a shape that is not a single number (the caller turns that into `domain`).
 */
function resolveFn(scene: SceneMap, id: Id): ((x: number) => number) | ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;
  if (EVAL_ARITY[h.kind] === undefined) {
    return err(
      'not-evaluable',
      `"${id}" is a ${h.kind}, which has no rule to sample. This probe samples a plotted fn at a ` +
        `coordinate x.`,
    );
  }
  const at = (h as unknown as { at: (x: number) => number | readonly number[] }).at;
  return (x: number) => {
    const r = at.call(h, x);
    return typeof r === 'number' ? r : Number.NaN;
  };
}

const outsideDomain = (id: Id, x: number): ToolResult =>
  err('domain', `"${id}" is not finite at x = ${x} — the point is outside the rule's domain.`);

/**
 * `plot(text, domain, id?)` — the WRITE probe, the parse-gated "model supplies
 * text, engine compiles" boundary (`appendFragment` is its raw-js sibling). The
 * model's expression TEXT routes through `introduceExpr` → a stable-id `introduce`
 * act → `commit`; the new live curve is sampled at a handful of points for the
 * `sampled` witness. `introduceExpr` throws on empty text / a bad domain / an
 * unbound free variable — the model's mistake, returned as `bad-args` data so the
 * loop retries, never a crash across the boundary. Numeric eval stays in the
 * sandbox: the samples read the folded object's own `at`, not a host evaluator.
 */
export async function plot(
  log: WorkspaceLog,
  fold: TryFold,
  args: {
    readonly text: string;
    readonly domain: { readonly from: number; readonly to: number };
    readonly id?: Id;
    readonly bindings?: Readonly<Record<string, Id>>;
  },
  attribution: Attribution = COPILOT,
): Promise<WriteOutcome> {
  if (typeof args.text !== 'string' || args.text.trim() === '') {
    return { result: err('bad-args', 'plot wants non-empty expression text.'), log };
  }
  const from = args.domain?.from;
  const to = args.domain?.to;
  if (!finite(from) || !finite(to) || !(from < to)) {
    return {
      result: err(
        'bad-args',
        `plot wants a finite domain { from, to } with from < to; got { from: ${from}, to: ${to} }.`,
      ),
      log,
    };
  }
  // an explicit id when the model gives one; otherwise a stable session id minted
  // off the log position — `@`-form so it never collides with a positional `#n`
  // (session.ts) and, baked into the act, reproducible under re-fold
  const id = args.id ?? `plot@${log.length}`;

  let act: IntroduceAct;
  try {
    act = introduceExpr({
      text: args.text,
      at: { x: 0, y: 0 },
      id,
      domain: [from, to],
      ...(args.bindings ? { bindings: args.bindings } : {}),
      by: attribution.by,
      turn: attribution.turn,
    });
  } catch (e) {
    return { result: err('bad-args', e instanceof Error ? e.message : String(e)), log };
  }

  const candidate = [...log, act];
  const outcome = await fold(candidate);
  if (!outcome.ok) return { result: foldRejected(outcome.failure), log };

  const h = outcome.workspace.objects.get(id);
  const sampled: Array<[number, number]> = [];
  if (h && EVAL_ARITY[h.kind] !== undefined) {
    const at = (h as unknown as { at: (x: number) => number | readonly number[] }).at;
    for (const x of samplePoints(from, to, PLOT_SAMPLE_COUNT)) {
      const y = at.call(h, x);
      if (typeof y === 'number' && Number.isFinite(y)) sampled.push([x, y]);
    }
  }
  return { result: ok({ id, sampled: sampled as unknown as Json }), log: candidate };
}

/**
 * `tabulate(id, from, to, count)` — a READ probe: sample one live `fn` at `count`
 * evenly spaced points across [from, to]. Pure — the live scene never moves. A
 * point outside the rule's domain is a `domain` error (as `evalAt`), not a crash.
 */
export function tabulate(
  scene: SceneMap,
  args: { readonly id: Id; readonly from: number; readonly to: number; readonly count: number },
): ToolResult {
  const { id, from, to, count } = args;
  if (!finite(from) || !finite(to)) {
    return err('bad-args', `tabulate("${id}") wants finite from/to; got [${from}, ${to}].`);
  }
  if (!Number.isInteger(count) || count < 1 || count > SAMPLE_MAX) {
    return err('bad-args', `tabulate("${id}") wants an integer count in [1, ${SAMPLE_MAX}]; got ${count}.`);
  }
  const f = resolveFn(scene, id);
  if (typeof f !== 'function') return f;

  const rows: Array<[number, number]> = [];
  for (const x of samplePoints(from, to, count)) {
    const y = f(x);
    if (!Number.isFinite(y)) return outsideDomain(id, x);
    rows.push([x, y]);
  }
  return ok({ rows: rows as unknown as Json });
}

/**
 * `numericEquivalence(idA, idB, from, to, count, tolerance?)` — a READ probe:
 * sample two live `fn`s at `count` points and report `max|a−b|`. `equivalent` is
 * `maxAbsDiff ≤ tolerance` (default `1e-9`). This is SAMPLED AGREEMENT, NEVER a
 * proof — two functions can agree at every sample and differ between them; it is
 * exactly the probe that catches a wrong LLM derivative (a real `maxAbsDiff`).
 * Pure — the live scene never moves. No differentiation, no simplification.
 */
export function numericEquivalence(
  scene: SceneMap,
  args: {
    readonly idA: Id;
    readonly idB: Id;
    readonly from: number;
    readonly to: number;
    readonly count: number;
    readonly tolerance?: number;
  },
): ToolResult {
  const { idA, idB, from, to, count } = args;
  if (!finite(from) || !finite(to)) {
    return err('bad-args', `numericEquivalence wants finite from/to; got [${from}, ${to}].`);
  }
  if (!Number.isInteger(count) || count < 1 || count > SAMPLE_MAX) {
    return err('bad-args', `numericEquivalence wants an integer count in [1, ${SAMPLE_MAX}]; got ${count}.`);
  }
  if (args.tolerance !== undefined && (!finite(args.tolerance) || args.tolerance < 0)) {
    return err('bad-args', `numericEquivalence tolerance must be a finite number ≥ 0; got ${args.tolerance}.`);
  }
  const fa = resolveFn(scene, idA);
  if (typeof fa !== 'function') return fa;
  const fb = resolveFn(scene, idB);
  if (typeof fb !== 'function') return fb;

  const tolerance = args.tolerance ?? DEFAULT_EQUIV_TOL;
  let maxAbsDiff = 0;
  for (const x of samplePoints(from, to, count)) {
    const ya = fa(x);
    if (!Number.isFinite(ya)) return outsideDomain(idA, x);
    const yb = fb(x);
    if (!Number.isFinite(yb)) return outsideDomain(idB, x);
    const d = Math.abs(ya - yb);
    if (d > maxAbsDiff) maxAbsDiff = d;
  }
  return ok({ equivalent: maxAbsDiff <= tolerance, maxAbsDiff, points: count, tolerance });
}

/**
 * `numericRoot(id, from, to, count?, tolerance?)` — a READ probe: scan [from, to]
 * in `count` sub-intervals (default 100) for a SIGN CHANGE in the live `fn`, then
 * bisect to a root within `tolerance` (default `1e-9`). Result `{ root, bracket }`
 * or `{ root: null }` when no sign change is found. Mirrors `bisectFlip`'s bracket
 * search, but on a numeric value crossing zero rather than a claim verdict flip.
 * SAMPLED evidence — a root the sampling found, not a symbolic solve. Pure read.
 */
export function numericRoot(
  scene: SceneMap,
  args: {
    readonly id: Id;
    readonly from: number;
    readonly to: number;
    readonly count?: number;
    readonly tolerance?: number;
  },
): ToolResult {
  const { id, from, to } = args;
  if (!finite(from) || !finite(to) || !(from < to)) {
    return err('bad-args', `numericRoot("${id}") wants finite from/to with from < to; got [${from}, ${to}].`);
  }
  const count = args.count ?? DEFAULT_ROOT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > SAMPLE_MAX) {
    return err('bad-args', `numericRoot("${id}") wants an integer count in [1, ${SAMPLE_MAX}]; got ${count}.`);
  }
  if (args.tolerance !== undefined && (!finite(args.tolerance) || args.tolerance <= 0)) {
    return err('bad-args', `numericRoot tolerance must be a finite number > 0; got ${args.tolerance}.`);
  }
  const f = resolveFn(scene, id);
  if (typeof f !== 'function') return f;
  const tolerance = args.tolerance ?? DEFAULT_ROOT_TOL;

  const at = (x: number): number | ToolResult => {
    const y = f(x);
    return Number.isFinite(y) ? y : outsideDomain(id, x);
  };

  let prevX = from;
  let prevY = at(from);
  if (typeof prevY !== 'number') return prevY;
  if (prevY === 0) return ok({ root: from, bracket: [from, from] });

  for (let i = 1; i <= count; i += 1) {
    const x = from + ((to - from) * i) / count;
    const y = at(x);
    if (typeof y !== 'number') return y;

    if (y === 0) return ok({ root: x, bracket: [x, x] });

    if (Math.sign(prevY) !== Math.sign(y)) {
      // bracketed: bisect [prevX, x] to precision, tightening on the sign
      let lo = prevX;
      let hi = x;
      let flo = prevY;
      while (hi - lo > tolerance) {
        const mid = lo + (hi - lo) / 2;
        if (mid === lo || mid === hi) break; // the doubles are adjacent: exact
        const fmid = at(mid);
        if (typeof fmid !== 'number') return fmid;
        if (fmid === 0) {
          lo = mid;
          hi = mid;
          break;
        }
        if (Math.sign(fmid) === Math.sign(flo)) {
          lo = mid;
          flo = fmid;
        } else {
          hi = mid;
        }
      }
      return ok({ root: lo + (hi - lo) / 2, bracket: [lo, hi] });
    }
    prevX = x;
    prevY = y;
  }
  return ok({ root: null });
}

// ─────────────────────────────── whyChanged ───────────────────────────────

/** What the walk needs of a reactive cell. `dependsOn` is core's retention. */
interface CellLike extends Handle {
  dependsOn?(): readonly Handle[];
  peek?(): unknown;
}

/** A handle that knows its backing cell (Live carries it; Parameter its id). */
interface Celled {
  readonly cell?: CellLike;
  readonly cellId?: string;
}

/** One link of the causal chain — exactly what a model needs to narrate it. */
export interface WhyChangedEntry {
  readonly id: Id;
  readonly kind: string;
  readonly label?: string;
  readonly value?: Json;
}

const CLAIM_PARTS = ['verdict', 'gap', 'lhs', 'rhs'] as const;

/**
 * cell id → the scene handle that owns it. The reactive graph speaks in raw
 * cells (`slot#3`, `derived#7`); the scene speaks in handles a user was shown.
 * This map is the translation, built from the SAME index every tool resolves
 * through — so a retired object's cells stay unattributed, exactly as its handle
 * stays unreachable. A claim's sub-handles (verdict, gap, the two sides) are
 * reachable through the claim, so they are owners too.
 */
function cellOwners(scene: SceneMap): Map<string, Handle> {
  const owners = new Map<string, Handle>();
  const claim = (h: Handle, part: string): Handle | undefined => {
    const sub = (h as unknown as Record<string, unknown>)[part];
    return sub !== null && typeof sub === 'object' && typeof (sub as Handle).id === 'string'
      ? (sub as Handle)
      : undefined;
  };
  const register = (h: Handle): void => {
    const { cell, cellId } = h as unknown as Celled;
    if (cell && typeof cell.id === 'string' && !owners.has(cell.id)) owners.set(cell.id, h);
    if (typeof cellId === 'string' && !owners.has(cellId)) owners.set(cellId, h);
  };
  for (const h of scene.values()) {
    register(h);
    if (h.kind === 'claim') {
      for (const part of CLAIM_PARTS) {
        const sub = claim(h, part);
        if (sub) register(sub);
      }
    }
  }
  return owners;
}

function chainEntry(h: Handle): WhyChangedEntry {
  const label = labelOf(h);
  const claim = asClaim(h);
  const value =
    claim !== undefined
      ? claim.holds
      : (jsonValue((h as { value?: unknown }).value) ??
        (typeof (h as CellLike).peek === 'function'
          ? jsonValue((h as CellLike).peek!())
          : undefined));
  return {
    id: h.id,
    kind: h.kind,
    ...(label !== undefined ? { label } : {}),
    ...(value !== undefined ? { value } : {}),
  };
}

/** The cell a handle's liveness comes from: a claim's verdict, a Live's own. */
function cellBehind(h: Handle): CellLike | undefined {
  const claimVerdict = (h as { verdict?: Celled }).verdict?.cell;
  if (claimVerdict) return claimVerdict;
  return (h as unknown as Celled).cell;
}

/**
 * The dependency path from a derived value or claim verdict back to the root
 * inputs, read off the reactive graph — causality, not narration. The chain is
 * ordered from the asked-about thing to the roots; each raw cell is attributed
 * to the scene handle that owns it when one does (a slot to its parameter, a
 * derived to its Live), and shown as itself when none does.
 *
 * The edges are the CURRENT value's (dependsOn pulls first), which is the
 * question "why is this what it is now" — the only question a live workspace can
 * answer exactly.
 */
export function whyChanged(scene: SceneMap, id: Id): ToolResult {
  const h = reach(scene, id);
  if (isToolResult(h)) return h;

  const start = cellBehind(h);
  if (!start) {
    const isInput = typeof (h as unknown as Celled).cellId === 'string';
    return err(
      'not-derived',
      isInput
        ? `"${id}" is an INPUT — nothing upstream moves it. It changes when a user or the ` +
          `copilot sets it; its history is the set-input acts in the workspace log.`
        : `"${id}" has no reactive cell behind it, so there is no dependency path to walk. ` +
          `whyChanged works on derived values and claims.`,
    );
  }

  const owners = cellOwners(scene);
  const chain: WhyChangedEntry[] = [chainEntry(h)];
  const visited = new Set<string>([start.id]);
  const named = new Set<Id>([h.id]);

  const walk = (cell: CellLike): void => {
    for (const dep of cell.dependsOn?.() ?? []) {
      if (visited.has(dep.id)) continue;
      visited.add(dep.id);
      const owner = owners.get(dep.id) ?? dep;
      if (!named.has(owner.id)) {
        named.add(owner.id);
        chain.push(chainEntry(owner));
      }
      walk(dep as CellLike);
    }
  };
  walk(start);

  return ok({ chain: chain as unknown as Json });
}

// ───────────────────────────── experiment probes ─────────────────────────────
// Where determinism pays out: state = fold(log), so an experiment is a candidate
// log folded somewhere disposable, read, and thrown away. The live workspace
// cannot be touched by construction — the probe never holds it.

/** A throwaway set-input act. Attribution is immaterial: it is never committed. */
const setAct = (s: SetSpec): SetInputAct => ({
  kind: 'set-input',
  target: s.id,
  value: s.value,
  by: COPILOT.by,
  turn: COPILOT.turn,
});

const foldRejected = (failure: FoldFailure): ToolResult =>
  err(
    'rejected',
    `the candidate did not fold: the ${failure.kind} at position ${failure.index} broke the ` +
      `workspace: ${failure.message}`,
  );

/**
 * "Would claim#2 still hold at k = 5?" — append the set-input acts to a
 * CANDIDATE log, fold it headlessly, read the requested objects there, discard.
 * Nothing is committed and nothing on screen moves; the answer is grounded in
 * the actual workspace objects because the fold ran the actual program.
 */
export async function counterfactual(
  log: WorkspaceLog,
  fold: TryFold,
  args: { readonly set: readonly SetSpec[]; readonly read: readonly Id[] },
): Promise<ToolResult> {
  if (args.set.length === 0 || args.read.length === 0) {
    return err('bad-args', 'counterfactual wants at least one {id, value} to set and one id to read.');
  }
  for (const s of args.set) {
    if (typeof s.value !== 'number' || !Number.isFinite(s.value)) {
      return err('bad-args', `counterfactual: the value for "${s.id}" must be a finite number.`);
    }
  }
  const outcome = await fold([...log, ...args.set.map(setAct)]);
  if (!outcome.ok) return foldRejected(outcome.failure);

  const reads: Json[] = [];
  for (const id of args.read) {
    const r = inspect(outcome.workspace.objects, id);
    // an unreadable id fails the whole probe — it names the boundary, and a
    // partial answer would invite the model to fill the gap by guessing
    if (!r.ok) return r;
    reads.push(r.value);
  }
  return ok({ reads });
}

/** How the folded workspace answers "does this claim hold?", shared by bisect. */
function holdsIn(scene: SceneMap, claimId: Id): boolean | ToolResult {
  const h = reach(scene, claimId);
  if (isToolResult(h)) return h;
  const claim = asClaim(h);
  if (!claim) {
    return err('bad-args', `"${claimId}" is a ${h.kind}, not a claim — bisectFlip needs a claim to watch.`);
  }
  return claim.holds;
}

/** Iteration cap: past ~40 halvings a double's mantissa is exhausted anyway. */
const BISECT_DEFAULT_PROBES = 40;
const BISECT_MAX_PROBES = 60;

/**
 * Binary-search the parameter value where a claim's verdict flips, each probe
 * one disposable fold. Returns the bracketing interval with the verdict at both
 * ends — the exact threshold no snapshot could contain — or a typed no-flip
 * result when both ends agree (which is itself an answer: within [lo, hi], the
 * claim never changes its mind).
 *
 * Determinism makes this exact rather than statistical: the same fold at the
 * same value answers the same way every time, so the bracket is a fact about the
 * workspace, not about a run.
 */
export async function bisectFlip(
  log: WorkspaceLog,
  fold: TryFold,
  args: {
    readonly param: Id;
    readonly claim: Id;
    readonly lo: number;
    readonly hi: number;
    readonly maxProbes?: number;
  },
): Promise<ToolResult> {
  const { param, claim } = args;
  if (![args.lo, args.hi].every(Number.isFinite) || !(args.lo < args.hi)) {
    return err('bad-args', `bisectFlip wants finite bounds with lo < hi; got [${args.lo}, ${args.hi}].`);
  }
  const cap = Math.min(BISECT_MAX_PROBES, Math.max(2, args.maxProbes ?? BISECT_DEFAULT_PROBES));

  let probes = 0;
  const probe = async (value: number): Promise<boolean | ToolResult> => {
    probes += 1;
    const outcome = await fold([...log, setAct({ id: param, value })]);
    if (!outcome.ok) return foldRejected(outcome.failure);
    return holdsIn(outcome.workspace.objects, claim);
  };

  let lo = args.lo;
  let hi = args.hi;
  const holdsAtLo = await probe(lo);
  if (typeof holdsAtLo !== 'boolean') return holdsAtLo;
  const holdsAtHi = await probe(hi);
  if (typeof holdsAtHi !== 'boolean') return holdsAtHi;

  if (holdsAtLo === holdsAtHi) {
    return ok({ flipped: false, lo, hi, holdsAtLo, holdsAtHi, probes });
  }

  while (probes < cap) {
    const mid = lo + (hi - lo) / 2;
    if (mid === lo || mid === hi) break; // the doubles are adjacent: exact
    const holdsAtMid = await probe(mid);
    if (typeof holdsAtMid !== 'boolean') return holdsAtMid;
    if (holdsAtMid === holdsAtLo) lo = mid;
    else hi = mid;
  }

  return ok({ flipped: true, lo, hi, holdsAtLo, holdsAtHi, probes });
}

// ─────────────────────────────── write acts ───────────────────────────────
// Thin wrappers over `commit`: the candidate folds somewhere disposable FIRST,
// and only an accepted act advances the log. The tools return the advanced log
// rather than touching the live workspace — the log is the artifact, and
// reflecting it on screen (a re-fold, a poke) stays the caller's act.

/** A write's answer: the tool result, plus the log as it stands after it. */
export interface WriteOutcome {
  readonly result: ToolResult;
  /** Advanced by a committed write; the input log, untouched, on rejection. */
  readonly log: WorkspaceLog;
}

/**
 * The event path as a tool: one `set-input` act, committed via `commit`. A
 * target the workspace does not offer, or one that is not settable, is the
 * fold's rejection — the same complaint a replayed cassette would raise,
 * verbatim.
 */
export async function setInput(
  log: WorkspaceLog,
  fold: TryFold,
  args: { readonly id: Id; readonly value: number },
  attribution: Attribution = COPILOT,
): Promise<WriteOutcome> {
  if (typeof args.value !== 'number' || !Number.isFinite(args.value)) {
    return { result: err('bad-args', `setInput("${args.id}") wants a finite number.`), log };
  }
  const act: SetInputAct = {
    kind: 'set-input',
    target: args.id,
    value: args.value,
    by: attribution.by,
    turn: attribution.turn,
  };
  const committed = await commit(log, act, fold);
  if (!committed.ok) {
    return { result: err('rejected', committed.errors.join('\n')), log };
  }
  return { result: ok({ set: args.id, to: args.value }), log: committed.log };
}

/**
 * The author path as a tool. The gate runs on the argument, and a rejection
 * returns as the tool error VERBATIM — in the loop that is the repair brief
 * become ordinary tool-retry, with no separate machinery. A fragment that gates
 * but breaks the fold (a bad id, a guest throw) is rejected the same way, and
 * the previous log comes back untouched.
 */
export async function appendFragment(
  log: WorkspaceLog,
  fold: TryFold,
  compile: CompileFragment,
  args: { readonly source: string },
  attribution: Attribution = COPILOT,
): Promise<WriteOutcome> {
  if (typeof args.source !== 'string' || args.source.trim() === '') {
    return { result: err('bad-args', 'appendFragment wants non-empty program source.'), log };
  }
  const compiled = await compile(args.source);
  if (!compiled.ok) {
    return { result: err('rejected', compiled.errors.join('\n')), log };
  }
  const act: AuthorAct = {
    kind: 'author',
    js: compiled.js,
    source: args.source,
    by: attribution.by,
    turn: attribution.turn,
  };
  const committed = await commit(log, act, fold);
  if (!committed.ok) {
    return { result: err('rejected', committed.errors.join('\n')), log };
  }
  return { result: ok({ appended: true, acts: committed.log.length }), log: committed.log };
}

// ─────────────────────────────── dispatch ───────────────────────────────

export interface ToolOutcome {
  /** JSON-serializable either way — in the loop this is what the model reads. */
  readonly result: ToolResult;
  /**
   * The log after this call: advanced by a committed write, passed through
   * unchanged by everything else. Absent only when the loop was wired without a
   * log at all.
   */
  readonly log?: WorkspaceLog;
}

/**
 * One entry point for the loop: a typed call in, data out, no throw. The catch
 * is the last line of the errors-are-data rule — a derived that throws mid-read
 * is the workspace's failure, and the model should be told, not the process
 * killed.
 */
export async function runTool(call: ToolCall, hooks: ToolHooks): Promise<ToolOutcome> {
  const passthrough = hooks.log !== undefined ? { log: hooks.log } : {};
  const attribution = hooks.attribution ?? COPILOT;
  const unwired = (what: string): ToolOutcome => ({
    result: err('failed', `this loop was wired without ${what}, so "${call.tool}" cannot run`),
    ...passthrough,
  });
  try {
    switch (call.tool) {
      case 'inspect':
        return { result: inspect(hooks.scene(), call.id), ...passthrough };
      case 'evalAt':
        return { result: evalAt(hooks.scene(), call.id, call.args), ...passthrough };
      case 'whyChanged':
        return { result: whyChanged(hooks.scene(), call.id), ...passthrough };
      case 'tabulate':
        return { result: tabulate(hooks.scene(), call), ...passthrough };
      case 'numericEquivalence':
        return { result: numericEquivalence(hooks.scene(), call), ...passthrough };
      case 'numericRoot':
        return { result: numericRoot(hooks.scene(), call), ...passthrough };
      case 'plot': {
        const { log, fold } = hooks;
        if (!log || !fold) return unwired('a log and a fold hook');
        return await plot(log, fold, call, attribution);
      }
      case 'counterfactual':
      case 'bisectFlip': {
        const { log, fold } = hooks;
        if (!log || !fold) return unwired('a log and a fold hook');
        if (call.tool === 'counterfactual') {
          return { result: await counterfactual(log, fold, call), log };
        }
        return { result: await bisectFlip(log, fold, call), log };
      }
      case 'setInput': {
        const { log, fold } = hooks;
        if (!log || !fold) return unwired('a log and a fold hook');
        return await setInput(log, fold, call, attribution);
      }
      case 'appendFragment': {
        const { log, fold, compile } = hooks;
        if (!log || !fold || !compile) return unwired('a log, a fold and a compile hook');
        return await appendFragment(log, fold, compile, call, attribution);
      }
      default:
        // A malformed call is loop input, not caller code — answer it as data.
        return {
          result: err('bad-args', `unknown tool "${(call as { tool: string }).tool}"`),
          ...passthrough,
        };
    }
  } catch (e) {
    return {
      result: err('failed', e instanceof Error ? e.message : String(e)),
      ...passthrough,
    };
  }
}
