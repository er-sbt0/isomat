/**
 * turn.test.ts — the co-edit turn, end to end (roadmap M2b exit criteria).
 *
 * The whole loop against a real QuickJS-folded Workspace, driven by a
 * ScriptedClient — free, deterministic, a canned move sequence standing in for a
 * recorded cassette. This is the M2b exit:
 *
 *  - the classifier fast-path manipulates a param with ZERO model calls;
 *  - an agentic turn probes (counterfactual) then answers with evidence-typing,
 *    and the evidence is cross-checked against the probe that ran;
 *  - a model-authored write commits through `commit` and the live scene re-folds
 *    to reflect it;
 *  - the executor's tool results are provably fed back to the model.
 */

import { describe, expect, it } from 'vitest';
import { lint } from '@isomat/sandbox';
import { fold, tryFold } from '@isomat/workspace/node';
import type { WorkspaceLog } from '@isomat/workspace';
import { runTurn, ScriptedClient } from './index.js';
import type { CompileFragment, ModelClient, ModelResponse, SceneMap, TurnDeps } from './index.js';

const PROGRAM = [
  'const spin = param("spin", 1, { range: [-2, 2] });',
  'const doubled = derive(() => 2 * spin.value, { label: "doubled" });',
  'const under = claim({ lhs: doubled, rhs: 3, relation: "<=", label: "under three" });',
  'plot((x) => spin.value / x, { domain: [1, 5], label: "f" });',
].join('\n');

const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

const deps: TurnDeps = { fold: tryFold, compile };

const START: WorkspaceLog = [{ kind: 'author', js: PROGRAM, source: PROGRAM, by: 'user', turn: 0 }];

function idByLabel(scene: SceneMap, label: string, kind?: string): string {
  for (const h of scene.values()) {
    if ((h as { label?: unknown }).label === label && (kind === undefined || h.kind === kind)) return h.id;
  }
  throw new Error(`no object labeled "${label}"`);
}

async function ids() {
  const w = await fold(START);
  if (!w.ok) throw new Error('the start log did not fold');
  const scene = w.workspace.objects;
  return {
    spin: idByLabel(scene, 'spin', 'parameter'),
    under: idByLabel(scene, 'under three', 'claim'),
    scene,
  };
}

const numAt = async (log: WorkspaceLog, id: string): Promise<number> => {
  const w = await fold(log);
  if (!w.ok) throw new Error('log did not fold');
  return (w.workspace.objects.get(id) as unknown as { value: number }).value;
};

describe('runTurn — the classifier fast-path (zero model calls)', () => {
  it('"set spin to 2" manipulates with no model call and advances the log', async () => {
    const { spin } = await ids();
    // an empty script: if the loop calls the model at all, ScriptedClient throws
    const client = new ScriptedClient([]);
    const out = await runTurn(START, 'set spin to 2', client, deps);

    expect(out.kind).toBe('manipulated');
    expect(out.modelCalls).toBe(0);
    expect(client.calls).toBe(0);
    expect(out.log).toHaveLength(2);
    expect(out.log[1]).toMatchObject({ kind: 'set-input', target: spin, value: 2, by: 'copilot' });
    expect(out.answer).toContain('spin');
    // the advanced log folds to the new value
    expect(await numAt(out.log, spin)).toBe(2);
  });
});

describe('runTurn — the agentic path probes then answers with evidence', () => {
  it('counterfactual → evidence-typed answer, the probe result fed back, evidence grounded', async () => {
    const { spin, under } = await ids();

    const seenBriefs: string[] = [];
    let toolResultReachedModel = false;
    const script: ModelResponse[] = [
      { kind: 'tool-calls', calls: [{ tool: 'counterfactual', set: [{ id: spin, value: 2 }], read: [under] }] },
      { kind: 'answer', text: 'No — at spin = 2 the claim breaks.', evidence: 'sampled' },
    ];
    const client = new ScriptedClient(script, {
      onRequest: (req, i) => {
        seenBriefs.push(req.brief);
        if (i === 1) {
          // the second request must carry the counterfactual's result back
          const toolMsg = req.messages.find((m) => m.role === 'tool');
          toolResultReachedModel = !!toolMsg;
        }
      },
    });

    const out = await runTurn(START, 'would the claim still hold if spin were 2?', client, deps);

    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.modelCalls).toBe(2);
    expect(out.answer).toContain('breaks');
    expect(out.evidence).toBe('sampled');
    expect(out.evidenceGrounded).toBe(true); // a counterfactual actually ran
    expect(out.log).toBe(START); // a read-only turn does not advance the log

    // the probe ran against the real engine: the claim broke at spin = 2
    const probe = out.steps[0]!;
    expect(probe.call.tool).toBe('counterfactual');
    expect(probe.result.ok).toBe(true);
    if (probe.result.ok) {
      const reads = (probe.result.value as { reads: Array<{ holds: boolean }> }).reads;
      expect(reads[0]!.holds).toBe(false);
    }

    // the executor's result was fed back to the model, and the brief named the scene
    expect(toolResultReachedModel).toBe(true);
    expect(seenBriefs[0]).toContain(under);
  });

  it('a model-authored write commits and the live scene re-folds to reflect it', async () => {
    const { spin } = await ids();
    const script: ModelResponse[] = [
      { kind: 'tool-calls', calls: [{ tool: 'setInput', id: spin, value: -1 }] },
      // the next batch must see spin at -1 in the re-folded live scene
      { kind: 'tool-calls', calls: [{ tool: 'inspect', id: spin }] },
      { kind: 'answer', text: 'spin is now -1.' },
    ];
    const client = new ScriptedClient(script);
    const out = await runTurn(START, 'lower spin to its floor', client, deps);

    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.modelCalls).toBe(3);
    expect(out.log).toHaveLength(2); // the setInput advanced the log
    expect(out.log[1]).toMatchObject({ kind: 'set-input', target: spin, value: -1, by: 'copilot' });

    // the inspect in the SECOND batch saw the re-folded value, not the stale one
    const inspectStep = out.steps.find((s) => s.call.tool === 'inspect')!;
    expect(inspectStep.result.ok).toBe(true);
    if (inspectStep.result.ok) {
      expect((inspectStep.result.value as { value: number }).value).toBe(-1);
    }
  });
});

describe('runTurn — the evidence discipline holds through the loop', () => {
  it('an answer that claims evidence no probe earned is flagged not-grounded', async () => {
    const client = new ScriptedClient([
      { kind: 'answer', text: 'It holds.', evidence: 'exact-comparison' },
    ]);
    const out = await runTurn(START, 'does the claim hold?', client, deps);
    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.evidence).toBe('exact-comparison');
    expect(out.evidenceGrounded).toBe(false); // no inspect/probe backed the claim
  });

  it('an inspect of the claim grounds an exact-comparison answer', async () => {
    const { under } = await ids();
    const client = new ScriptedClient([
      { kind: 'tool-calls', calls: [{ tool: 'inspect', id: under }] },
      { kind: 'answer', text: 'It holds by exact comparison.', evidence: 'exact-comparison' },
    ]);
    const out = await runTurn(START, 'does the claim hold, and how do you know?', client, deps);
    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.evidenceGrounded).toBe(true);
  });
});

describe('runTurn — the step budget is a rail', () => {
  it('a model that never answers is cut off as truncated', async () => {
    const { spin } = await ids();
    // a client that always probes, never answers
    const looper: ModelClient = {
      respond: () => ({ kind: 'tool-calls', calls: [{ tool: 'inspect', id: spin }] }),
    };
    const out = await runTurn(START, 'loop forever', looper, deps);
    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.truncated).toBe(true);
    expect(out.answer).toContain('did not reach an answer');
  }, 30_000);
});
