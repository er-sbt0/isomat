/**
 * views/note.ts — `note`, narration reborn as a first-class text OBJECT.
 *
 * The lesson layer's `say` emitted a timeline step and rendered through the
 * player-driven narration panel. The native surface (Stabilize §5) drops the
 * timeline: a `note` is an ordinary View that the author act constructs, so it
 * auto-registers into the scene like every other object and needs no `show`
 * verb and no player. It keeps the one thing `say` was worth — interpolated
 * handles become live, linked mention chips, each registered under the
 * mentioned object's id, so focusing/animating that object lights its mentions
 * and hovering a mention lights the object everywhere.
 */

import { isHandle } from '@isomat/core';
import type { Handle } from '@isomat/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { displayLabel } from '../util.js';
import { renderTex } from '../tex.js';

/** A mention is a live handle, or a plain interpolated primitive. */
export type NoteMention = Handle | string | number;

export interface NoteSpec {
  readonly strings: readonly string[];
  readonly mentions: readonly NoteMention[];
}

export class NoteView extends View {
  constructor(
    stage: Stage,
    private readonly spec: NoteSpec,
  ) {
    super(stage, 'view:note');
  }

  /** The handle mentions this note refers to — the correspondence granularity. */
  override get elements(): readonly Handle[] {
    return this.spec.mentions.filter((m): m is Handle => isHandle(m));
  }

  /** The prose as a flat string — headless tests and the scene read this. */
  get text(): string {
    let out = '';
    this.spec.strings.forEach((s, i) => {
      out += s;
      const m = this.spec.mentions[i];
      if (m === undefined) return;
      out += isHandle(m) ? displayLabel(m) : String(m);
    });
    return out.trim();
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('p');
    root.classList.add('mr-note');
    this.spec.strings.forEach((s, i) => {
      if (s) root.appendChild(doc.createTextNode(s));
      const mention = this.spec.mentions[i];
      if (mention === undefined) return;
      if (isHandle(mention)) {
        const chip = doc.createElement('span');
        chip.className = 'mr-mention';
        // labels are authored as TeX (`\Delta x`) — typeset them
        renderTex(chip, displayLabel(mention));
        this.stage.registry.register(chip, mention.id);
        chip.addEventListener('mouseenter', () => this.stage.lightUp(mention));
        root.appendChild(chip);
      } else {
        root.appendChild(doc.createTextNode(String(mention)));
      }
    });
    return root;
  }
}
