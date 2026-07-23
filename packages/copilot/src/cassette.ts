/**
 * cassette.ts — record once, replay free forever (roadmap M5d).
 *
 * The testing discipline this repo runs on: a billed path is paid ONCE, its
 * moves are captured, and every run afterwards replays them for nothing. A
 * cassette is that capture — the sequence of `ModelResponse` moves a real model
 * made, plus enough of each request to prove the replay is answering the same
 * questions in the same order.
 *
 * ## No SDK here, on purpose
 *
 * `anthropic.ts` imports the Anthropic SDK and therefore lives off the barrel.
 * This module imports NOTHING but the seam's own types, so replay is free,
 * runs in a browser, and works with no key — which is what makes a recorded
 * flagship session usable as an ordinary test fixture and, later, as a demo the
 * web app can play without a billed path.
 *
 * ## What the drift check is for
 *
 * A cassette that silently replays the wrong move is worse than no cassette: the
 * test still passes and the recorded evidence no longer describes the code. So a
 * replay verifies each incoming request against the recorded one and throws on
 * divergence rather than handing back a move that was made in answer to a
 * different question. `strict: false` downgrades that to a warning for the case
 * where a prompt was reworded deliberately and re-recording is not worth it.
 */

import type { ModelClient, ModelRequest, ModelResponse } from './client.js';

/** One recorded exchange: the question asked, and the move made in reply. */
export interface CassetteEntry {
  /** A fingerprint of the request — see `fingerprint`. Not the whole prompt. */
  readonly ask: RequestFingerprint;
  readonly move: ModelResponse;
}

/**
 * The parts of a request a replay checks. Deliberately NOT the full prompt: the
 * scene brief carries generated ids and formatting that churn without changing
 * what was asked, and pinning those would make every cassette brittle. What must
 * match is the conversation's shape — how far in we are, and what came back from
 * the last probe.
 */
export interface RequestFingerprint {
  /** How many messages the thread carried when the move was made. */
  readonly depth: number;
  /** The user's question — the first user message. */
  readonly question: string;
  /** Names of the tools whose results were most recently fed back, in order. */
  readonly lastResults: readonly string[];
}

export interface Cassette {
  readonly name: string;
  /** Free-form provenance: model, date, why it was recorded. */
  readonly note?: string;
  readonly entries: readonly CassetteEntry[];
}

export function fingerprint(req: ModelRequest): RequestFingerprint {
  const first = req.messages.find((m) => m.role === 'user');
  const last = req.messages[req.messages.length - 1];
  return {
    depth: req.messages.length,
    question: first && first.role === 'user' ? first.content : '',
    lastResults: last && last.role === 'tool' ? last.results.map((r) => r.tool) : [],
  };
}

const describe = (f: RequestFingerprint): string =>
  `depth=${f.depth} question=${JSON.stringify(f.question)} lastResults=[${f.lastResults.join(', ')}]`;

function drifted(a: RequestFingerprint, b: RequestFingerprint): boolean {
  return (
    a.depth !== b.depth ||
    a.question !== b.question ||
    a.lastResults.length !== b.lastResults.length ||
    a.lastResults.some((t, i) => t !== b.lastResults[i])
  );
}

export interface ReplayOpts {
  /** Throw on drift (default). `false` warns and replays anyway. */
  readonly strict?: boolean;
  readonly onWarn?: (message: string) => void;
}

/**
 * Replay a recorded session. Drop-in for `ScriptedClient`, and indistinguishable
 * from a live client to `runTurn` — which is the property that lets one billed
 * recording stand in for the real thing in every later test.
 */
export class CassetteClient implements ModelClient {
  private cursor = 0;

  constructor(
    private readonly cassette: Cassette,
    private readonly opts: ReplayOpts = {},
  ) {}

  respond(req: ModelRequest): ModelResponse {
    const entry = this.cassette.entries[this.cursor];
    if (!entry) {
      throw new Error(
        `cassette "${this.cassette.name}" exhausted: the loop asked for move #${this.cursor + 1}, ` +
          `but the recording has ${this.cassette.entries.length}. The loop is probing further than ` +
          `the recorded session did — re-record, or check what changed in the tools.`,
      );
    }

    const actual = fingerprint(req);
    if (drifted(actual, entry.ask)) {
      const message =
        `cassette "${this.cassette.name}" drifted at move #${this.cursor + 1}:\n` +
        `  recorded: ${describe(entry.ask)}\n` +
        `  actual:   ${describe(actual)}\n` +
        `The replay would answer a question the model was never asked.`;
      if (this.opts.strict === false) this.opts.onWarn?.(message);
      else throw new Error(message);
    }

    this.cursor += 1;
    return entry.move;
  }

  /** How many moves have been replayed. */
  get calls(): number {
    return this.cursor;
  }

  /** True once every recorded move has been used — a turn that stopped early left some. */
  get exhausted(): boolean {
    return this.cursor >= this.cassette.entries.length;
  }
}

/**
 * Wrap a live client and capture what it does.
 *
 * This is the ONLY billed path, and it is the one place a real session becomes a
 * reusable fixture. Wrap an `AnthropicClient`, run the turn once, then write
 * `recorder.cassette()` to a JSON file — every later run replays it for free.
 *
 * Failures are recorded too. A turn where the model probed wrongly and answered
 * badly is a defect pinned for free forever, which is worth more than a cassette
 * that only ever shows the happy path.
 */
export class RecordingClient implements ModelClient {
  private readonly entries: CassetteEntry[] = [];

  constructor(
    private readonly inner: ModelClient,
    private readonly name: string,
    private readonly note?: string,
  ) {}

  async respond(req: ModelRequest): Promise<ModelResponse> {
    const ask = fingerprint(req);
    const move = await this.inner.respond(req);
    this.entries.push({ ask, move });
    return move;
  }

  cassette(): Cassette {
    return {
      name: this.name,
      ...(this.note ? { note: this.note } : {}),
      entries: [...this.entries],
    };
  }
}
