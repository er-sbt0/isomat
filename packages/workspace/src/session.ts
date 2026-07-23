/**
 * session.ts — the stable-id allocator (roadmap M1 stable-id policy).
 *
 * An introduced / user-authored object must get an EXPLICIT stable id, not a
 * positional `<kind>#<n>` one. The reason is a future `replace` (M4): inserting
 * or dropping acts mid-log shifts every positional id, which would break every
 * `M.byId` reference authored against the old ids. An explicit id, minted once
 * and embedded in the act's source, is immune to that.
 *
 * This allocator is the "who hands out the next id" half. A UI (Phase 2) calls
 * `next()` when the user drops a new object on the canvas and bakes the result
 * into the `introduce` source. Ids take the form `<base>@<n>` — the `@`
 * deliberately keeps them out of core's reserved generated form `<kind>#<n>`
 * (identity.ts rejects an explicit id matching `/#\d+$/`), so a session id can
 * never collide with a positional one.
 *
 * It is monotonic and deterministic given the same call sequence, which is what
 * keeps a re-recorded session reproducible.
 */

import type { Id } from '@isomat/core';

const SANITIZE = /[^A-Za-z0-9_]/g;

export class SessionIds {
  private n = 0;

  constructor(private readonly base: string = 'obj') {}

  /**
   * The next stable id, e.g. `x@3`. Pass a `hint` (a label, a variable name)
   * to make the id legible in a log; it is sanitized to `[A-Za-z0-9_]` so the
   * result is always a valid, `#`-free identifier.
   */
  next(hint?: string): Id {
    this.n += 1;
    const stem = hint ? hint.replace(SANITIZE, '') || this.base : this.base;
    return `${stem}@${this.n}`;
  }

  /** How many ids have been handed out — the session counter itself. */
  get count(): number {
    return this.n;
  }
}
