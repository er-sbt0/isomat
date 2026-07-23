/**
 * copilot.ts — wiring the turn loop into the app (W3, free half).
 *
 * `runTurn` needs two things and a client. The two things are here; the client
 * is the part that is gated.
 *
 * ## What works with no model at all
 *
 * `runTurn`'s FIRST path is the deterministic classifier: a question that is
 * really a manipulation ("set a to 5", "a = -1") resolves to a `set-input`
 * committed by the copilot, with `modelCalls: 0`. That is not a stub or a
 * shortcut around the model — it is the engine refusing to spend a model call on
 * something provably decidable. It is the honest, useful, free half of W3 and it
 * works in this app today.
 *
 * ## What does not
 *
 * Anything the classifier does not recognise falls to the agentic loop, which
 * needs a real `ModelClient`. None exists in this repo: no SDK, no key, no
 * billed path (roadmap M5d, gated on explicit approval). `NoModelClient` below
 * makes that boundary visible in the UI instead of faking an answer — the one
 * thing this project's locked decisions rule out is letting a narrated opinion
 * pass as a result.
 *
 * ## A known cost
 *
 * `deps.fold` is the plain `tryFold`, which does not dispose its QuickJS
 * context. `session.ts` is careful about exactly this, so the asymmetry is
 * deliberate and worth naming: a probe fold's `Workspace` is READ after the fold
 * returns (a derived's `.value` re-invokes a retained guest closure), so the env
 * cannot be disposed eagerly the way a throwaway candidate fold's can. A turn
 * therefore costs a few wasm contexts. Fine for a demo, and the thing to fix
 * before this is a real session — probably by having the fold seam hand back a
 * disposer the loop closes at end-of-turn.
 */

import { lint } from '@isomat/sandbox';
import { tryFold } from '@isomat/workspace/browser';
import type { CompileFragment, ModelClient, ModelResponse, TurnDeps } from '@isomat/copilot';

/**
 * Compile + gate an authored fragment. The fragments the loop writes are already
 * plain JS, so this is the real lint gate and no bundler — a rejection's findings
 * go back to the model verbatim as the tool error.
 */
export const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

export const turnDeps: TurnDeps = { fold: tryFold, compile };

/** Why the agentic path is unavailable, said once, in the UI's voice. */
export const NO_MODEL_ANSWER =
  'No model is configured, so I can only handle direct manipulations right now — ' +
  'try "set a to 5", which runs deterministically with zero model calls. ' +
  'Answering an open question needs a real ModelClient (roadmap M5d), which is a ' +
  'billed path and is not built in this repo.';

/**
 * The stand-in for an unconfigured model.
 *
 * It answers immediately rather than probing, and says plainly that it cannot
 * answer. It deliberately declares NO evidence: an answer with no probes behind
 * it must not carry an evidence type, or the UI would show a verdict that looks
 * earned. That is precisely the failure mode evidence-typing exists to prevent.
 */
export class NoModelClient implements ModelClient {
  respond(): ModelResponse {
    return { kind: 'answer', text: NO_MODEL_ANSWER };
  }
}
