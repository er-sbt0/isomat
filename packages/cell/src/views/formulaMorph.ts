/**
 * views/formulaMorph.ts — the QUARANTINED formula-morph animation.
 *
 * The KEEP `FormulaView` (in `@isomat/objects`) renders a static addressable
 * span model. The `transformTo` animation — re-rendering as the `to` formula in
 * place so a shared role is one DOM lineage that FLIPs to its new position — was
 * playback (Stabilize §2.1, §8 risk 5) and moved here with the rest of the
 * timeline machinery. It subclasses the static view and adds the animated
 * transition, using the quarantined `animate` and the `TransformFormulaPayload`
 * that only the player emits.
 *
 * Nothing on the main path builds a `MorphFormulaView`; the native authoring
 * surface has no representation-change verb. It exists so the quarantined
 * `player` still typechecks and the morph reasoning is preserved.
 */

import { FormulaView } from '@isomat/objects';
import { animate } from '../animate.js';
import type { TransformFormulaPayload } from '../types.js';

export class MorphFormulaView extends FormulaView {
  /**
   * Become the `to` formula. Preserved roles keep span identity: their nodes
   * are re-registered under the target span handle and travel to their new
   * position; leaving roles fade out, entering roles fade in.
   */
  async transformTo(payload: TransformFormulaPayload, ms: number): Promise<void> {
    this.current = payload.to;
    const doc = this.stage.doc;
    if (!this.el || !doc) return;

    const preservedRoles = new Set(payload.preserved.map((p) => p.role));
    const before = new Map<string, DOMRect>();
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
      const role = el.getAttribute('data-mr-role');
      if (role !== null && preservedRoles.has(role)) before.set(role, el.getBoundingClientRect());
    }
    // leaving spans fade before the rebuild
    const leaving = Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]')).filter(
      (el) => !preservedRoles.has(el.getAttribute('data-mr-role') ?? ''),
    );
    await Promise.all(leaving.map((el) => animate(el, [{ opacity: 1 }, { opacity: 0 }], ms / 2)));

    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this.buildInto(this.el, doc, payload.to);

    // preserved spans also answer to their `from` handle: a link authored on
    // the old formula's span must keep resolving to a live node
    for (const pair of payload.preserved) {
      for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
        if (el.getAttribute('data-mr-role') === pair.role) {
          this.stage.registry.register(el, pair.from.id);
        }
      }
    }

    const moves: Array<Promise<void>> = [];
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
      const role = el.getAttribute('data-mr-role') ?? '';
      const from = before.get(role);
      if (from) {
        // FLIP: start at the old position, settle into the new one
        const to = el.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        el.classList.add('mr-preserved');
        moves.push(
          animate(
            el,
            [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` }, { transform: 'none' }],
            ms,
            'cubic-bezier(0.4, 0, 0.2, 1)',
          ).then(() => {
            setTimeout(() => el.classList.remove('mr-preserved'), ms);
          }),
        );
      } else {
        moves.push(animate(el, [{ opacity: 0 }, { opacity: 1 }], ms));
      }
    }
    await Promise.all(moves);
  }
}
