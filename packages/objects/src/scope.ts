/**
 * scope.ts — the flat native authoring surface (Stabilize §5, §5.1).
 *
 * `createNativeScope(world, stage)` yields the ~10 bare functions the guest is
 * handed — `expr, span, param, derive, plot, readout, claim, link, note, byId`
 * — bound to ONE world and ONE stage. This replaces the 13-member
 * `createProgramScope` (`M / Prob / Calc / LinAlg / Graph / Field / View /
 * Layout / Interaction / F / lesson`): the discipline namespaces and the lesson
 * verbs are gone, and there is no `M.` / `View.` / `lesson.` ceremony. The whole
 * object is injected FLAT into the guest global by `host.defineScope(...)`, so a
 * fragment calls `param(...)`, `plot(...)`, `expr\`...\`` directly.
 *
 * ## Auto-register on construction (§5.1, RESOLVED)
 *
 * There is NO `show` / `place` / `expose` verb. Every object an act builds
 * registers into `stage.registered` (or, for the view primitives, adds itself to
 * `stage.views` in the `View` base) the moment it is constructed, so it appears
 * in `sceneIndex` with no further ceremony — a bare `param` surfaces in the
 * scene with no timeline. Params are drag-interactive by default (`createParameter`
 * carries `setValueLive`); interactivity is cheap and not the point.
 */

import type { Handle, Relation, World } from '@isomat/core';
import { createF } from './formula.js';
import type { Formula, FormulaSpan, SpanSpec } from './formula.js';
import { NoteView } from './views/note.js';
import type { NoteMention } from './views/note.js';
import { sceneIndex } from './scene.js';
import type { Stage } from './stage.js';
import { createParameter } from './parameter.js';
import type { Parameter } from './parameter.js';
import { derivedNumber } from './numeric.js';
import type { LabeledNumber } from './numeric.js';
import { createClaim } from './claim.js';
import type { Claim, ClaimOpts } from './claim.js';
import { createViews } from './views.js';
import type { NativeViewLib, PlotOpts, PlotSubject } from './views.js';
import type { PlotView } from './views/plot.js';
import type { ReadoutView } from './views/readout.js';

/**
 * The flat native authoring surface. Every member is a bare function; there is
 * no namespace object. `host.defineScope(scope)` spreads these into the guest.
 */
export interface NativeScope {
  readonly world: World;
  readonly stage: Stage;

  /** An addressable live math expression (the tagged-template span builder). */
  expr(strings: TemplateStringsArray, ...parts: ReadonlyArray<string | SpanSpec>): Formula;
  /** A role-named TeX fragment, interpolated into an `expr`. */
  span(role: string, tex: string): SpanSpec;
  /** A live, draggable scalar with a range. `opts.id` stamps a stable handle id. */
  param(name: string, value: number, opts: { range: readonly [number, number]; id?: string }): Parameter;
  /** A live scalar computed from other reactive cells; re-run on read, tracks its inputs. */
  derive(fn: () => number, opts?: { label?: string; id?: string }): LabeledNumber;
  /** Render a numeric rule y = f(x) over a domain. */
  plot(subject: PlotSubject, opts: PlotOpts): PlotView;
  /** A live numeric display, optionally watched against a second quantity. */
  readout(quantity: LabeledNumber | Parameter, opts?: { label?: string; compareTo?: LabeledNumber | Parameter }): ReadoutView;
  /** An evidence-typed proposition: two quantities and a relation, or a predicate. */
  claim(opts: ClaimOpts): Claim;
  /** A correspondence edge between objects (no timeline step). */
  link(a: Handle, b: Handle | readonly Handle[], rel: Relation): void;
  /** Narration as an editable, auto-registered text object. */
  note(strings: TemplateStringsArray, ...mentions: readonly NoteMention[]): NoteView;
  /** Reach an object an earlier act authored, by its handle id. Throws if absent. */
  byId<T = Handle>(id: string): T;
}

export function createNativeScope(world: World, stage: Stage): NativeScope {
  if (stage.world !== world) {
    throw new Error('createNativeScope: the stage must belong to the same world');
  }
  const F = createF(world);
  const { View } = createViews(stage);

  /** Auto-register on construction (§5.1): the object surfaces in the scene. */
  const register = <T extends Handle>(h: T): T => {
    stage.registered.push(h);
    return h;
  };

  const scope: NativeScope = {
    world,
    stage,

    expr(strings, ...parts) {
      // Register the object (it surfaces in the scene); its render is a
      // FormulaView the renderer materializes from the scene, not built eagerly
      // here — a formula carries no eager evaluation, but a claim does (below),
      // and the two object-constructors keep the same discipline.
      return register(F.tex(strings as unknown as TemplateStringsArray, ...parts));
    },

    span(role, tex) {
      return F.span(role, tex);
    },

    param(name, value, opts) {
      return register(createParameter(world, name, value, opts.range, opts.id));
    },

    derive(fn, opts) {
      return register(derivedNumber(world, fn, opts?.label, opts?.id));
    },

    plot(subject, opts) {
      return View.plot(subject, opts);
    },

    readout(quantity, opts) {
      return View.readout(quantity, opts);
    },

    claim(opts) {
      // Register the object only. Building a ClaimView here would read `holds`
      // to validate the subject, evaluating the (possibly-throwing) predicate at
      // CONSTRUCTION — but a claim's verdict is deliberately read lazily, so a
      // predicate that throws is data at read time, not a build-time crash.
      return register(createClaim(world, opts));
    },

    link(a, b, rel) {
      world.link(a, b, rel);
    },

    note(strings, ...mentions) {
      return new NoteView(stage, {
        strings: [...(strings as unknown as readonly string[])],
        mentions,
      });
    },

    byId<T = Handle>(id: string): T {
      // Built per call, not cached: a fragment may reference an object an
      // earlier STATEMENT of the same fragment constructed, and a cached index
      // taken at scope construction would predate the whole conversation.
      const index = sceneIndex(stage);
      const found = index.get(id);
      if (!found) {
        const available = [...index.keys()].slice(0, 20).join(', ');
        throw new Error(
          `byId("${id}") — no object with that id is in the scene. A fragment may only ` +
            `reference ids the scene offered it, and never a retired one. ` +
            `Available: ${available}${index.size > 20 ? ', …' : ''}`,
        );
      }
      return found as T;
    },
  };

  return scope;
}

export type { FormulaSpan, NativeViewLib, PlotOpts, PlotSubject };
