/**
 * views.tsx — the native React view components (Phase 2 decision #7).
 *
 * These replace `View.render(doc)`, NOT the views themselves. The distinction is
 * the whole point and is load-bearing:
 *
 *   `sceneIndex(stage)` builds `Workspace.objects` — what every copilot tool
 *   resolves against and what `sceneBrief`/`scopedManifest` scope — out of
 *   `stage.registered` PLUS `stage.views` and each view's `.elements`. The view
 *   OBJECTS are therefore part of the LLM's addressable surface. Replace them
 *   with bare React components and the model silently loses handles it could
 *   previously name: nothing errors, the manifest just gets smaller.
 *
 * So the fold constructs views exactly as before; nothing ever calls `mount()`;
 * and these components read the same authored `spec` the SVG renderer read.
 * `packages/web/src/scene.test.tsx` pins that invariant.
 *
 * Values come through `useLive`, so a poked parameter repaints without a re-fold.
 */

import type {
  Claim as ClaimObject,
  Formula as FormulaObject,
  NoteView,
  PlotView,
  ReadoutView,
} from '@isomat/objects';
import type { Handle } from '@isomat/core';
import type { Verdict } from '@isomat/substrate';
import { sampleFn, useLive, useRevision } from './live.js';

const fmt = (n: number | undefined): string =>
  n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(3);

// ─────────────────────────────────── plot ───────────────────────────────────

const W = 260;
const H = 170;
const PAD = 22;

export function Plot({ view }: { view: PlotView }) {
  // Re-sample on every render. `PlotView` samples once at construction, which is
  // right for playback and wrong here: the rule closes over a parameter the user
  // can drag, so the curve must follow it.
  useRevision();
  const { subject, domain, label, showAxes = true, samples } = view.spec;
  const pts = sampleFn(subject as unknown as { at(x: number): number }, domain, samples ?? 121);

  if (pts.length === 0) return <figure className="obj plot">no samples</figure>;

  const [x0, x1] = domain;

  /**
   * A FIXED window, not auto-scaled to the data — and this is a correctness
   * choice, not a style one.
   *
   * Fitting the y-range to the samples renormalises the picture every render, so
   * `y = a·x` draws the identical diagonal at a = 1 and a = 5: the parameter's
   * entire effect vanishes precisely when the user drags it. A plot whose whole
   * job is to make a parameter visible must not rescale under it. So the window
   * is the x-domain, squared, and the curve clips — the graphing-calculator
   * convention, and the one that keeps slope meaningful.
   */
  const span = (x1 - x0) / 2;
  const y0 = -span;
  const y1 = span;

  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * PAD);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join('');

  const showX = showAxes && y0 <= 0 && y1 >= 0;
  const showY = showAxes && x0 <= 0 && x1 >= 0;
  const clipId = `clip-${view.id.replace(/[^\w-]/g, '_')}`;

  return (
    <figure className="obj plot">
      <figcaption>{label ?? 'plot'}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`plot of ${label ?? 'f'}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} />
          </clipPath>
        </defs>
        {showX && <line className="axis" x1={PAD} y1={sy(0)} x2={W - PAD} y2={sy(0)} />}
        {showY && <line className="axis" x1={sx(0)} y1={PAD} x2={sx(0)} y2={H - PAD} />}
        <path className="curve" d={d} fill="none" clipPath={`url(#${clipId})`} />
      </svg>
      <div className="domain">
        x ∈ [{fmt(x0)}, {fmt(x1)}] · y ∈ [{fmt(y0)}, {fmt(y1)}]
      </div>
    </figure>
  );
}

// ────────────────────────────────── readout ──────────────────────────────────

export function Readout({ view }: { view: ReadoutView }) {
  const { quantity, label, compareTo, compareLabel } = view.spec;
  const value = useLive<number>(quantity as unknown as Handle);
  const other = useLive<number>(compareTo as unknown as Handle);

  return (
    <figure className="obj readout">
      <figcaption>{label ?? 'readout'}</figcaption>
      <div className="value">{fmt(value)}</div>
      {compareTo && (
        <div className="compare">
          vs {compareLabel ?? 'target'} {fmt(other)}
          <span className="gap"> (Δ {fmt(value !== undefined && other !== undefined ? value - other : undefined)})</span>
        </div>
      )}
    </figure>
  );
}

// ─────────────────────────────────── claim ───────────────────────────────────

/**
 * Evidence is rendered as a TYPE, not decoration.
 *
 * The locked no-CAS decision says a model must not be able to narrate an opinion
 * as a proof. `holds: true` alone does exactly that. So the badge always carries
 * how the verdict was reached, and `authored-predicate` reads visibly weaker than
 * `exact-comparison`.
 */
const EVIDENCE_BLURB: Record<string, string> = {
  'exact-comparison': 'compared exactly',
  sampled: 'checked at sample points — not a proof',
  'authored-predicate': 'asserted by a predicate — not a proof',
};

export function Claim({ claim }: { claim: ClaimObject }) {
  const verdict = useLive<Verdict>(claim.verdict as unknown as Handle);
  const lhs = useLive<number>(claim.lhs as unknown as Handle);
  const rhs = useLive<number>(claim.rhs as unknown as Handle);

  const label = claim.label;
  const polarity = verdict?.polarity ?? 'neutral';
  const sides = claim.lhs !== undefined;
  const evidence = claim.evidence;

  return (
    <figure className={`obj claim polarity-${polarity}`}>
      <figcaption>{label ?? 'claim'}</figcaption>
      <div className="verdict">
        <span className={`badge badge-${polarity}`}>{verdict?.label ?? '…'}</span>
        {sides && (
          <span className="sides">
            {fmt(lhs)} <span className="rel">{claim.relation ?? '='}</span> {fmt(rhs)}
          </span>
        )}
      </div>
      <div className={`evidence ev-${evidence}`}>
        <code>{evidence}</code> — {EVIDENCE_BLURB[evidence] ?? evidence}
      </div>
    </figure>
  );
}

// ──────────────────────────────── note / formula ────────────────────────────────

/**
 * A mention inside a note, rendered LIVE.
 *
 * `NoteView.render` draws a mention as a label chip that lights up its object on
 * hover — a reference, which is what playback prose wants. In a co-edit
 * workspace the more useful chip also carries the current value, so prose stays
 * true as the workspace moves rather than describing a state that has passed.
 * Hence `label = value` when the mention is a live numeric, label alone when it
 * is not.
 */
function Mention({ handle }: { handle: Handle }) {
  const value = useLive<unknown>(handle);
  const label = (handle as { label?: string }).label ?? handle.id;
  const shown = typeof value === 'number' ? fmt(value) : undefined;
  return (
    <span className="mention" title={handle.id}>
      <span className="mlabel">{label}</span>
      {shown !== undefined && <span className="mvalue"> = {shown}</span>}
    </span>
  );
}

const isHandleLike = (m: unknown): m is Handle =>
  typeof m === 'object' && m !== null && typeof (m as { id?: unknown }).id === 'string';

export function Note({ view }: { view: NoteView }) {
  const { strings, mentions } = view.spec;
  return (
    <figure className="obj note">
      <p>
        {strings.map((s, i) => {
          const m = mentions[i];
          return (
            <span key={i}>
              {s}
              {m === undefined ? null : isHandleLike(m) ? (
                <Mention handle={m} />
              ) : (
                String(m)
              )}
            </span>
          );
        })}
      </p>
    </figure>
  );
}

export function Formula({ formula }: { formula: FormulaObject }) {
  // No KaTeX in the bundle yet — the TeX source is shown verbatim rather than
  // faking a render. W2 introduces expressions and can bring a real renderer.
  return (
    <figure className="obj formula">
      <code>{formula.tex}</code>
    </figure>
  );
}

// ─────────────────────────────────── dispatch ───────────────────────────────────

/**
 * Two families render, and the difference is the engine's, not a UI quirk.
 *
 * `plot` / `readout` / `note` build a VIEW at authoring time, so their spec is
 * the authored description and the component reads `view.spec`.
 *
 * `claim` / `formula` deliberately register the OBJECT ONLY — building a view
 * eagerly would evaluate a possibly-throwing predicate at construction, and a
 * verdict is read lazily so an error stays data (scope.ts). Those are the cases
 * the engine describes as the renderer materialising from the scene, so the
 * component reads the object directly. There is no `view:claim` to look for.
 */
const RENDERABLE = new Set(['view:plot', 'view:readout', 'view:note', 'claim', 'formula']);

export function ViewOf({ handle }: { handle: Handle }) {
  switch (handle.kind) {
    case 'view:plot':
      return <Plot view={handle as unknown as PlotView} />;
    case 'view:readout':
      return <Readout view={handle as unknown as ReadoutView} />;
    case 'view:note':
      return <Note view={handle as unknown as NoteView} />;
    case 'claim':
      return <Claim claim={handle as unknown as ClaimObject} />;
    case 'formula':
      return <Formula formula={handle as unknown as FormulaObject} />;
    default:
      return null;
  }
}

/** Is this handle something `ViewOf` can draw? */
export const isRenderableView = (h: Handle): boolean => RENDERABLE.has(h.kind);
