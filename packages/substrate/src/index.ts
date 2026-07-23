/**
 * @isomat/substrate — the lean shared substrate types.
 *
 * These six types are the structural contracts the KEPT object primitives and
 * their KEPT views stand on: a reactive cell of any type (`Live`), the numeric
 * specializations the plot/readout/claim views read (`NumericHandle`,
 * `VarySettable`), the evidence polarity a `claim` reports (`Verdict`,
 * `Polarity`), and the morph endpoint the view base structurally implements
 * (`MorphSubject`).
 *
 * They were extracted out of `lesson/src/types.ts`, where they sat in the same
 * file as every playback payload/verb/morph-route type. Keeping them behind that
 * file coupled the substrate — `render`'s kept views and `library`'s kept
 * primitives — to the whole lesson playback vocabulary. This module is core-only
 * (it imports nothing but `Handle`), so the substrate no longer depends on
 * lesson playback. `lesson/src/types.ts` re-exports them, so the playback layer
 * is unaffected.
 *
 * Target end-state (Stabilize §4): this home is absorbed by/kept beside
 * `objects` once the kept render views fold in. For now it is the small
 * dedicated `(types)` node under `core`.
 */

import type { Handle } from '@isomat/core';

// ────────────────────────────── verdicts ──────────────────────────────

export type Polarity = 'accept' | 'reject' | 'neutral';

/** Polarity, not the label string, drives color/emphasis semantics. */
export interface Verdict {
  readonly label: string;
  readonly polarity: Polarity;
}

// ─────────────────────────── the reactive cell ───────────────────────────

/**
 * A LIVE value of any type: a handle whose `.value` is re-read, not stored.
 *
 * This is the reactive cell as a protocol. It was scalar-only for a long time
 * and three independent ledgers said the same thing about that (roadmap step
 * 3): a claim's boolean had to be special-cased, a field's geometry had to be
 * faked as plain closures with no memoization or dependency tracking, and an
 * eigen-decomposition had to be faked the same way. All three are `Live<T>`
 * for a non-numeric `T`.
 *
 * `world.derived<T>` in core was ALREADY generic — the scalar-only constraint
 * lived entirely in this protocol type and the library's single wrapper. So
 * this is a widening, not a new mechanism.
 */
export interface Live<T> extends Handle {
  readonly value: T;
}

/** Anything with a numeric value the timeline or the user can vary. */
export type NumericHandle = Live<number>;

/**
 * A numeric handle `vary` can advance at authoring time. `setValue` is the
 * raw, non-timeline mutation hook — the `vary` step itself is the timeline
 * record of the transition (one verb, one step). Library objects (matrix
 * cells, sliders) implement it, applying their interaction policy
 * (renormalize-row etc.) inside. Targets without it still get a declarative
 * `vary` step, flagged `applied: false` in the payload.
 */
export interface VarySettable extends NumericHandle {
  setValue(next: number): void;
  /**
   * Apply a value on the INTERACTION path: same policy (clamp, renormalize),
   * but no timeline step. A drag frame and a `vary` replay frame are not beats
   * of the explanation — recording them would grow the timeline the player is
   * walking. Implementors back this with `Slot.poke`. Optional: a target
   * without it is only advanced at authoring time.
   */
  setValueLive?(next: number): void;
}

// ─────────────────────────── morph endpoint ───────────────────────────

/**
 * A morph endpoint. `elements` are the object handles the subject projects or
 * aggregates — the granularity at which morph legality is checked and routes
 * are produced. A subject without `elements` is its own single element.
 * Milestone-3 views expose the objects they project here.
 */
export interface MorphSubject extends Handle {
  readonly elements?: readonly Handle[];
}
