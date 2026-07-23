/**
 * views.ts — the lean native view factory (Stabilize §5).
 *
 * `createViews(stage)` builds the KEEP primitive views the flat authoring
 * surface stands on — `plot`, `readout`, `claim`, `formula` — bound to one
 * render `Stage`. The discipline-shaped `View.*` methods (tokens / partition /
 * stateGraph / graph / table / matrix / bars / history / region / strip /
 * riemann / plane / vectors / field / heatmap / loop / tiling) shed with their
 * views; the `Fn | Accumulation` plot subject and the `integrate`-based sampler
 * shed with calculus.
 *
 * The one real behaviour change (Stabilize §8 risk 3): `plot` takes a plain
 * sampler `(x) => number` and drops the accumulation/antiderivative branch — the
 * FTC showpiece curve is a capability regression, acceptable with no calculus.
 */

import type { Handle } from '@isomat/core';
import type { Formula } from '@isomat/lesson';
import type { NumericHandle } from '@isomat/substrate';
import {
  ClaimView,
  FormulaView,
  PlotView,
  ReadoutView,
} from '@isomat/render';
import type { ClaimSubject, Stage } from '@isomat/render';

/** What `plot` can render: a plain sampler, or (M3) a symbolic expr. */
export type PlotSubject = Formula | ((x: number) => number);

export interface PlotOpts {
  readonly domain: readonly [number, number];
  readonly showAxes?: boolean;
  readonly label?: string;
}

export interface NativeViewLib {
  /** A continuous plot y = f(x) over a domain. */
  plot(subject: PlotSubject, opts: PlotOpts): PlotView;
  /** A live numeric readout, optionally watched against a second quantity. */
  readout(
    quantity: NumericHandle,
    opts?: { readonly label?: string; readonly compareTo?: NumericHandle },
  ): ReadoutView;
  /** A live proposition with a status badge that flips when it stops holding. */
  claim(claim: ClaimSubject, opts?: { readonly label?: string; readonly showValues?: boolean }): ClaimView;
  /** A KaTeX render of an addressable-span formula. */
  formula(f: Formula): FormulaView;
}

function labelOfNumeric(q: NumericHandle): string | undefined {
  return (q as NumericHandle & { label?: string }).label;
}

/**
 * A readout tracks a LIVE quantity. Handed a plain number it used to build fine
 * and die later reading `.value` off it — `undefined.toFixed(...)`, with nothing
 * naming the cause. A generated program hit exactly that.
 */
function assertLiveNumeric(q: NumericHandle, where: string): void {
  if (typeof q === 'number') {
    throw new Error(
      `${where} needs a LIVE numeric handle, not a plain number — you passed ${q}. ` +
        `Pass a param(...), or a derive(...) — something whose .value re-reads.`,
    );
  }
  if (q == null || typeof (q as { value?: unknown }).value !== 'number') {
    throw new Error(`${where} needs a live numeric handle with a numeric .value — got ${String(q)}.`);
  }
}

function isFormula(x: PlotSubject): x is Formula {
  return typeof x !== 'function' && Array.isArray((x as Formula).fragments);
}

/**
 * A minimal handle carrying a plotted rule. `plot` needs its subject to be a
 * Handle (so the curve registers and a fragment can reach it by id); a bare
 * closure is not one. `kind: 'fn'` + `at(x)` also makes it `evalAt`-able (4c).
 */
export interface PlottedFn extends Handle<'fn'> {
  readonly label?: string;
  at(x: number): number;
}

function plottedFn(stage: Stage, rule: (x: number) => number, label?: string): PlottedFn {
  const base = stage.world.handle('fn');
  return Object.freeze({
    id: base.id,
    kind: 'fn' as const,
    ...(label !== undefined ? { label } : {}),
    at: (x: number): number => rule(x),
  });
}

export function createViews(stage: Stage): { View: NativeViewLib } {
  const View: NativeViewLib = {
    plot(subject, opts) {
      if (isFormula(subject)) {
        // The symbolic expr → sampler path needs the mathjs parser (M3). Until
        // then a plot takes a numeric rule; a formula has no numeric closure to
        // sample without evaluating it, which the engine deliberately cannot do.
        throw new Error(
          'plot(expr) is not available yet — a symbolic expression cannot be sampled without the ' +
            'M3 parser. Pass a numeric rule: plot((x) => a.value * x, { domain }).',
        );
      }
      const fn = plottedFn(stage, subject, opts.label);
      return new PlotView(stage, {
        subject: fn,
        sample: (x) => subject(x),
        domain: opts.domain,
        showAxes: opts.showAxes,
        label: opts.label ?? fn.label,
      });
    },

    readout(quantity, opts) {
      assertLiveNumeric(quantity, 'readout(quantity)');
      if (opts?.compareTo !== undefined) {
        assertLiveNumeric(opts.compareTo, 'readout(_, { compareTo })');
      }
      return new ReadoutView(stage, {
        quantity,
        label: opts?.label ?? labelOfNumeric(quantity),
        compareTo: opts?.compareTo,
        compareLabel: opts?.compareTo ? labelOfNumeric(opts.compareTo) : undefined,
      });
    },

    claim(claim, opts) {
      if (claim == null || typeof (claim as { holds?: unknown }).holds !== 'boolean') {
        throw new Error(
          `claim rendering needs a claim handle — build one with claim({ lhs, rhs, relation }). ` +
            `Got ${String(claim)}.`,
        );
      }
      return new ClaimView(stage, {
        claim,
        label: opts?.label ?? claim.label,
        showValues: opts?.showValues,
      });
    },

    formula(f) {
      return new FormulaView(stage, f);
    },
  };

  return { View };
}
