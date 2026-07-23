/**
 * classify.ts — the intent fast-path (roadmap M2b).
 *
 * Some turns are not questions at all: "set spin to 2", "a = -1". Routing those
 * through the model is waste — the answer is a `set-input`, deterministic and
 * free. `classify` recognizes exactly that shape and nothing more: an explicit
 * set of a named, settable parameter to a literal value. It is deliberately
 * NARROW — no "increase by", no NLU — because the fast-path's whole value is
 * being provably free and unambiguous. Anything it does not recognize returns
 * `null`, and the turn falls to the agentic path.
 *
 * The name must resolve against the LIVE scene: a command naming a parameter the
 * workspace does not offer is not classified (the model, with the brief, is the
 * right place for "did you mean…"). Zero model calls either way.
 */

import type { Handle, Id } from '@isomat/core';
import type { SceneMap } from './tools.js';

/** A recognized manipulation: which settable to set, to what, and its label. */
export interface Manipulation {
  readonly id: Id;
  readonly label: string;
  readonly value: number;
}

/** A signed integer or decimal. */
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The settable parameters the scene offers, by their display label. */
function settableParams(scene: SceneMap): ReadonlyArray<{ id: Id; label: string }> {
  const out: { id: Id; label: string }[] = [];
  for (const h of scene.values()) {
    if (h.kind !== 'parameter') continue;
    const label = (h as Handle & { label?: unknown }).label;
    if (typeof label === 'string') out.push({ id: h.id, label });
  }
  return out;
}

/**
 * Recognize a pure manipulation command, or return `null`.
 *
 * Anchored start-to-end so a COMPOUND question ("set spin to 2 and tell me why
 * it broke") does NOT match — that genuinely needs the model, and quietly
 * manipulating on the way past would drop the rest of the request. A bare
 * `label = value` counts; so do `set/make/change label to value` forms.
 */
export function classify(question: string, scene: SceneMap): Manipulation | null {
  const q = question.trim();
  if (q === '') return null;

  for (const p of settableParams(scene)) {
    const name = escapeRegExp(p.label);
    const patterns = [
      // "set spin to 2", "make spin 2", "change spin = 2", "set spin: -1.5"
      new RegExp(`^(?:set|make|change)\\s+${name}\\s+(?:to\\s+|=\\s*|:\\s*)?${NUM}\\s*[.!]?$`, 'i'),
      // bare: "spin = 2", "spin to -1"
      new RegExp(`^${name}\\s*(?:=|to)\\s*${NUM}\\s*[.!]?$`, 'i'),
    ];
    for (const re of patterns) {
      const m = re.exec(q);
      if (m) {
        const value = Number(m[1]);
        if (Number.isFinite(value)) return { id: p.id, label: p.label, value };
      }
    }
  }
  return null;
}
