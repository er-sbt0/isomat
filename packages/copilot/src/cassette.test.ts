/**
 * cassette.test.ts — M5d's free half, proven.
 *
 * Two claims, neither of which costs anything:
 *
 * 1. A CASSETTE REPLAYS. A recorded session drives the real `runTurn` against a
 *    real QuickJS-folded workspace and reaches the same evidence-grounded answer
 *    the recording did. This is the property the whole record-once discipline
 *    rests on — if replay didn't reproduce the turn, a billed recording would be
 *    worthless the moment it was captured.
 *
 * 2. DRIFT IS CAUGHT. A replay that no longer matches the questions being asked
 *    throws instead of handing back a move made in answer to something else. A
 *    cassette that silently replays the wrong move is worse than no cassette:
 *    the test still passes while the recorded evidence stops describing the code.
 *
 * The fixture below is hand-authored in the SHAPE a real recording takes — the
 * canonical "is d/dx of f equal to g?" flow from `equivalence.turn.test.ts`. No
 * billed call was made to produce it, and none is needed to run it.
 */

import { describe, expect, it } from 'vitest';
import { lint } from '@isomat/sandbox';
import { tryFold } from '@isomat/workspace/node';
import type { WorkspaceLog } from '@isomat/workspace';
import { CassetteClient, RecordingClient, fingerprint, runTurn } from './index.js';
import type {
  Cassette,
  CompileFragment,
  ModelClient,
  ModelRequest,
  ModelResponse,
  TurnDeps,
} from './index.js';

const PROGRAM = [
  'plot((x) => x * x, { domain: [0, 4], label: "f", id: "f" });',
  'plot((x) => 2 * x, { domain: [0, 4], label: "g", id: "g" });',
].join('\n');

const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

const deps: TurnDeps = { fold: tryFold, compile };
const START: WorkspaceLog = [{ kind: 'author', js: PROGRAM, source: PROGRAM, by: 'user', turn: 0 }];
const QUESTION = 'is d/dx of f equal to g?';

/** The engine mints the candidate's id off log position: first plot → `plot@1`. */
const CANDIDATE_ID = 'plot@1';

/**
 * A cassette in the shape a real recording takes.
 *
 * Depths are 1 / 3 / 5 because the thread grows by two messages per probe round
 * (the assistant's calls, then the tool results). That is exactly what
 * `fingerprint` pins, and getting it wrong is what drift detection is for.
 */
const CASSETTE: Cassette = {
  name: 'derivative-equivalence',
  note: 'Shape of the canonical M5b flow. Hand-authored; no billed call was made.',
  entries: [
    {
      ask: { depth: 1, question: QUESTION, lastResults: [] },
      move: {
        kind: 'tool-calls',
        calls: [{ tool: 'plot', text: '2*x', domain: { from: 0, to: 4 } }],
      },
    },
    {
      ask: { depth: 3, question: QUESTION, lastResults: ['plot'] },
      move: {
        kind: 'tool-calls',
        calls: [
          {
            tool: 'numericEquivalence',
            idA: CANDIDATE_ID,
            idB: 'g',
            from: 0,
            to: 4,
            count: 25,
          },
        ],
      },
    },
    {
      ask: { depth: 5, question: QUESTION, lastResults: ['numericEquivalence'] },
      move: {
        kind: 'answer',
        text:
          'Sampled at 25 points on [0, 4], your candidate 2*x agrees with g to within tolerance. ' +
          'That is sampled agreement, not a proof — two functions can agree at every sample and ' +
          'differ between them.',
        evidence: 'sampled',
      },
    },
  ],
};

describe('a cassette replays a recorded session for free', () => {
  it('drives the real loop to the same sampled-evidence answer', async () => {
    const client = new CassetteClient(CASSETTE);
    const outcome = await runTurn(START, QUESTION, client, deps);

    expect(outcome.kind).toBe('agentic');
    if (outcome.kind !== 'agentic') return;

    expect(outcome.modelCalls).toBe(3);
    expect(client.exhausted).toBe(true);

    // The load-bearing assertion: the answer rests on SAMPLED evidence, and the
    // loop confirms a probe actually sampled rather than taking the word for it.
    expect(outcome.evidence).toBe('sampled');
    expect(outcome.evidenceGrounded).toBe(true);
    expect(outcome.answer).toContain('not a proof');

    // The probes really ran against the live workspace.
    const tools = outcome.steps.map((s) => s.call.tool);
    expect(tools).toContain('plot');
    expect(tools).toContain('numericEquivalence');

    const equiv = outcome.steps.find((s) => s.call.tool === 'numericEquivalence');
    expect(equiv?.result.ok).toBe(true);
    if (equiv?.result.ok) {
      expect((equiv.result.value as { equivalent: boolean }).equivalent).toBe(true);
    }
  });

  it('is indistinguishable from a live client to the loop', async () => {
    // Same cassette, same log, same question → same answer. The replay carries no
    // state the loop can observe beyond the moves themselves.
    const a = await runTurn(START, QUESTION, new CassetteClient(CASSETTE), deps);
    const b = await runTurn(START, QUESTION, new CassetteClient(CASSETTE), deps);
    expect(a.answer).toBe(b.answer);
    expect(a.log.length).toBe(b.log.length);
  });
});

describe('drift is caught, not silently replayed', () => {
  const req = (question: string): ModelRequest => ({
    system: '',
    brief: '',
    messages: [{ role: 'user', content: question }],
    tools: [],
  });

  it('throws when the question no longer matches the recording', () => {
    const client = new CassetteClient(CASSETTE);
    expect(() => client.respond(req('something else entirely'))).toThrow(/drifted/i);
  });

  it('names both sides so the failure is diagnosable', () => {
    const client = new CassetteClient(CASSETTE);
    try {
      client.respond(req('a different question'));
      expect.unreachable('should have thrown');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      expect(message).toContain('recorded:');
      expect(message).toContain('actual:');
      expect(message).toContain(QUESTION);
    }
  });

  it('non-strict mode warns and replays anyway', () => {
    const warnings: string[] = [];
    const client = new CassetteClient(CASSETTE, {
      strict: false,
      onWarn: (m) => warnings.push(m),
    });
    const move = client.respond(req('reworded on purpose'));
    expect(warnings).toHaveLength(1);
    expect(move.kind).toBe('tool-calls');
  });

  it('a loop that probes past the recording says so plainly', () => {
    const client = new CassetteClient({ name: 'tiny', entries: [] });
    expect(() => client.respond(req(QUESTION))).toThrow(/exhausted/i);
  });
});

describe('the recorder captures what a live client did', () => {
  it('wraps any ModelClient and yields a replayable cassette', async () => {
    // A fake "live" client stands in for the billed one — the recorder does not
    // care which client it wraps, which is precisely why the billed path is one
    // swap away and everything else stays free.
    const moves: ModelResponse[] = [
      { kind: 'tool-calls', calls: [{ tool: 'plot', text: '2*x', domain: { from: 0, to: 4 } }] },
      { kind: 'answer', text: 'done', evidence: 'sampled' },
    ];
    let i = 0;
    const live: ModelClient = { respond: () => moves[i++]! };

    const recorder = new RecordingClient(live, 'demo', 'a fake session');
    const first: ModelRequest = {
      system: '',
      brief: '',
      messages: [{ role: 'user', content: QUESTION }],
      tools: [],
    };
    await recorder.respond(first);

    const cassette = recorder.cassette();
    expect(cassette.name).toBe('demo');
    expect(cassette.note).toBe('a fake session');
    expect(cassette.entries).toHaveLength(1);
    expect(cassette.entries[0]!.ask).toEqual(fingerprint(first));
    expect(cassette.entries[0]!.move).toEqual(moves[0]);

    // And what it captured replays.
    const replayed = new CassetteClient(cassette).respond(first);
    expect(replayed).toEqual(moves[0]);
  });
});
