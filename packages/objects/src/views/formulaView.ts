/**
 * views/formulaView.ts — KaTeX rendering of a lesson `Formula`, one KaTeX
 * render PER FRAGMENT so every role-named span is an addressable DOM node.
 * All fragments of a role register under the role's single span handle —
 * lighting the handle lights every occurrence (π twice in πP=π).
 *
 * Fragments must therefore be self-contained TeX (the tag's interpolation
 * points are natural break points; a subscript can't straddle fragments).
 *
 * Element granularity: the role SPAN handles are the elements.
 *
 * This is the KEEP static span render (Stabilize §2.1): the formula-morph
 * animation (`transformTo`, which drove the `to` formula in place) was playback
 * and quarantined to `cell/` with the rest of the timeline machinery.
 */

import katex from 'katex';
import type { Id } from '@isomat/core';
import type { Formula } from '../formula.js';
import { View } from '../view.js';
import type { Stage } from '../stage.js';

export class FormulaView extends View {
  protected current: Formula;

  constructor(
    stage: Stage,
    readonly formula: Formula,
  ) {
    super(stage, 'view:formula');
    this.current = formula;
  }

  /** The formula this view is currently displaying (changes under a morph). */
  get displayed(): Formula {
    return this.current;
  }

  override get elements() {
    return this.current.roles.map((role) => this.current.span(role));
  }

  override projects(id: Id): boolean {
    return id === this.formula.id || id === this.current.id || super.projects(id);
  }

  /**
   * ONE KaTeX pass over the whole formula, with each role-named fragment
   * wrapped in `\htmlClass` so the rendered output still carries an
   * addressable node per role.
   *
   * Rendering fragment-by-fragment (the milestone-3 approach) required every
   * fragment to be self-contained TeX, and the FTC's ÷Δx formula is the case
   * that breaks it: `\frac{` · ΔA · `}{` · Δx · `}` has no standalone-valid
   * pieces at all. Wrapping instead of splitting keeps the addressable-span
   * contract — a role still resolves to every node it occupies — while the
   * math is laid out as one expression, which is the only way a fraction
   * typesets correctly.
   */
  protected buildInto(root: HTMLElement, doc: Document, formula: Formula): void {
    const roleIndex = new Map<string, number>();
    let tex = '';
    for (const fragment of formula.fragments) {
      if (fragment.role === undefined) {
        tex += fragment.tex;
        continue;
      }
      let index = roleIndex.get(fragment.role);
      if (index === undefined) {
        index = roleIndex.size;
        roleIndex.set(fragment.role, index);
      }
      tex += `\\htmlClass{mr-role-${index}}{${fragment.tex}}`;
    }
    const holder = doc.createElement('span');
    holder.innerHTML = katex.renderToString(tex, {
      throwOnError: false,
      // \htmlClass is the addressing mechanism, so it must be permitted
      trust: true,
      strict: 'ignore',
    });
    root.appendChild(holder);

    for (const [role, index] of roleIndex) {
      const nodes = holder.querySelectorAll<HTMLElement>(`.mr-role-${index}`);
      for (const el of Array.from(nodes)) {
        el.classList.add('mr-fspan');
        el.setAttribute('data-mr-role', role);
        this.stage.registry.register(el, formula.span(role).id);
      }
    }
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-formula');
    this.buildInto(root, doc, this.current);
    return root;
  }
}
