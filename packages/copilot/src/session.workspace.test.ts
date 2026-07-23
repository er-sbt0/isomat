/**
 * session.workspace.test.ts — the symmetric-log hammer (roadmap M5, Stage M5c).
 *
 * The M5 exit at scale: ONE foldable log carrying 100+ interleaved acts from BOTH
 * authors — a user typing parsed expressions, dragging parameters, and editing
 * spans, and a copilot probing, plotting candidates, and authoring derivations
 * through `runTurn` — driven end-to-end against a real QuickJS-folded Workspace.
 * Everything is free and deterministic: a `ScriptedClient` stands in for the model
 * and the classifier fast-path handles the drags with zero model calls.
 *
 * It proves the four M5 exit criteria on the accumulated session log:
 *   1. determinism — re-fold yields identical ids AND values (the cassette property);
 *   2. no half-apply — a rejected turn/act leaves the prior log reference intact;
 *   3. `byId` robust — every live object resolves; a retired one is flagged but
 *      still resolves;
 *   4. checkpoint determinism — an M4 `everyNActs` compaction over the long log
 *      folds to the SAME workspace (ids, values, layout, retired).
 */

import { describe, expect, it } from 'vitest';
import { lint } from '@isomat/sandbox';
import { fold, tryFoldWith } from '@isomat/workspace/node';
import { commit, everyNActs } from '@isomat/workspace';
import type { WorkspaceAct, WorkspaceLog } from '@isomat/workspace';
import type { Handle, Id } from '@isomat/core';
import type { Workspace } from '@isomat/workspace';
import { introduceExpr, resolveSpan } from '@isomat/parse';
import { runTurn, ScriptedClient } from './index.js';
import type { CompileFragment, ModelResponse, TurnDeps } from './index.js';

// ── the fold environment: a span-aware tryFold, since the session edit-spans ──
const tryFoldSpan = tryFoldWith(resolveSpan);

const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

const deps: TurnDeps = { fold: tryFoldSpan, compile };

/** Turn 0 (user): four draggable params, a derived sum, and a claim over it. */
const SEED_JS = [
  'const a = param("alpha", 1, { range: [-10, 10], id: "a" });',
  'const b = param("beta", 2, { range: [-10, 10], id: "b" });',
  'const c = param("gamma", 3, { range: [-10, 10], id: "c" });',
  'const d = param("delta", 4, { range: [-10, 10], id: "d" });',
  'const sum = derive(() => a.value + b.value + c.value + d.value, { label: "sum", id: "sum" });',
  'claim({ lhs: sum, rhs: 100, relation: "<=", label: "under 100" });',
].join('\n');

const SEED: WorkspaceLog = [{ kind: 'author', js: SEED_JS, source: SEED_JS, by: 'user', turn: 0 }];

const numAt = (objects: ReadonlyMap<Id, Handle>, id: Id): number =>
  (objects.get(id) as unknown as { value: number }).value;

/** Compare two folded workspaces on everything the cassette property covers. */
function expectSameWorkspace(a: Workspace, b: Workspace, numericIds: readonly Id[]): void {
  expect([...b.objects.keys()].sort()).toEqual([...a.objects.keys()].sort());
  for (const id of numericIds) expect(numAt(b.objects, id)).toBe(numAt(a.objects, id));
  expect([...b.layout.entries()].sort()).toEqual([...a.layout.entries()].sort());
  expect([...b.retired].sort()).toEqual([...a.retired].sort());
}

/** The explicit ids the session mints, all live at the end (retired ones included). */
const LIVE_IDS: readonly Id[] = [
  'a', 'b', 'c', 'd', 'sum', // seed
  'curve0', 'curve1', 'curve2', 'p', // user-introduced
  'g0', 'g1', 'g2', // copilot-plotted candidates
  'e0', 'e1', // copilot-authored derivations
];
const RETIRED_IDS: readonly Id[] = ['g1', 'e1'];
/** Objects that carry a live `.value` (params + deriveds) — the value-equality set. */
const NUMERIC_IDS: readonly Id[] = ['a', 'b', 'c', 'd', 'sum', 'p', 'e0', 'e1'];

describe('the symmetric-log hammer — a full both-authors co-edit session at scale', () => {
  it('accumulates 100+ interleaved acts, both authors, folding deterministically', async () => {
    let log: WorkspaceLog = SEED;
    let turn = 1;

    // helper: append a validated user/copilot act directly (no model call)
    const append = (act: WorkspaceAct): void => {
      log = [...log, act];
    };

    // ── Phase 1 — the USER introduces parsed expressions + a hand introduce ──
    // three parsed curves (edit-span targets) bound to the live params, and one
    // hand-authored introduce param (a `replace` target — replace needs an
    // introduce-defined id).
    append(
      introduceExpr({ text: 'x^2 + a*x', at: { x: 10, y: 10 }, id: 'curve0', domain: [-3, 3], bindings: { a: 'a' }, by: 'user', turn: turn++ }),
    );
    append(
      introduceExpr({ text: 'b*x + c', at: { x: 20, y: 20 }, id: 'curve1', domain: [-3, 3], bindings: { b: 'b', c: 'c' }, by: 'user', turn: turn++ }),
    );
    append(
      introduceExpr({ text: 'x^3 - d*x', at: { x: 30, y: 30 }, id: 'curve2', domain: [-3, 3], bindings: { d: 'd' }, by: 'user', turn: turn++ }),
    );
    append({
      kind: 'introduce', by: 'user', turn: turn++, id: 'p', at: { x: 40, y: 40 },
      js: 'param("phi", 1, { range: [-10, 10], id: "p" });',
    });

    // ── Phase 2 — the COPILOT probes, then plots a candidate (probe → write) ──
    // each turn threads its out.log forward, accumulating the plotted introduce.
    const plotTurn = async (id: Id, text: string, bindings: Record<string, Id>, extra: ModelResponse[] = []): Promise<void> => {
      const script: ModelResponse[] = [
        { kind: 'tool-calls', calls: [{ tool: 'tabulate', id: 'curve0', from: -3, to: 3, count: 5 }] },
        { kind: 'tool-calls', calls: [{ tool: 'plot', text, domain: { from: -3, to: 3 }, id, bindings }] },
        ...extra,
        { kind: 'answer', text: `plotted ${id} and sampled it`, evidence: 'sampled' },
      ];
      const out = await runTurn(log, `plot a candidate ${id}`, new ScriptedClient(script), deps);
      expect(out.kind).toBe('agentic');
      if (out.kind !== 'agentic') return;
      expect(out.evidence).toBe('sampled');
      expect(out.evidenceGrounded).toBe(true); // the tabulate/plot sampled numerically
      // the plot committed an introduce tagged copilot; the log advanced
      expect(out.log.length).toBe(log.length + 1);
      expect(out.log[out.log.length - 1]).toMatchObject({ kind: 'introduce', id, by: 'copilot' });
      log = out.log;
    };

    await plotTurn('g0', '2*x + a', { a: 'a' });
    await plotTurn('g1', '2*x', {});
    // a turn that ALSO runs a numericEquivalence probe between two live candidates
    await plotTurn('g2', 'c*x', { c: 'c' }, [
      { kind: 'tool-calls', calls: [{ tool: 'numericEquivalence', idA: 'g0', idB: 'g1', from: -3, to: 3, count: 7 }] },
    ]);

    // ── Phase 3 — the COPILOT authors derivations off the curves (byId reach) ──
    const authorTurn = async (id: Id, sourceId: Id): Promise<void> => {
      const src = `const s = byId("${sourceId}"); derive(() => s.at(2), { label: "${id}at2", id: "${id}" });`;
      const script: ModelResponse[] = [
        { kind: 'tool-calls', calls: [{ tool: 'inspect', id: sourceId }] },
        { kind: 'tool-calls', calls: [{ tool: 'appendFragment', source: src }] },
        { kind: 'answer', text: `authored ${id}` },
      ];
      const out = await runTurn(log, `record ${id}`, new ScriptedClient(script), deps);
      expect(out.kind).toBe('agentic');
      if (out.kind !== 'agentic') return;
      expect(out.log.length).toBe(log.length + 1);
      expect(out.log[out.log.length - 1]).toMatchObject({ kind: 'author', by: 'copilot' });
      log = out.log;
    };

    await authorTurn('e0', 'curve0');
    await authorTurn('e1', 'curve1');

    // ── Phase 4a — the USER drags via the classifier fast-path (ZERO model calls) ──
    // ScriptedClient([]) throws if the loop ever calls the model, so the assertion
    // that these manipulate for free is structural.
    const dragCommands: Array<[string, number]> = [
      ['set alpha to 3', 3], ['set beta to -2', -2], ['set gamma to 5', 5],
      ['delta to 1', 1], ['make phi 6', 6], ['alpha = -4', -4],
    ];
    for (const [command] of dragCommands) {
      const before = log;
      const out = await runTurn(before, command, new ScriptedClient([]), deps);
      expect(out.kind).toBe('manipulated');
      expect(out.modelCalls).toBe(0);
      expect(out.log.length).toBe(before.length + 1);
      expect(out.log[out.log.length - 1]).toMatchObject({ kind: 'set-input', by: 'copilot' });
      log = out.log;
    }

    // ── Phase 4b — a rejected turn mid-session: nothing half-applies ──
    // the model tries to set a non-existent id; the tool errors, the log does not
    // advance, and the prior log REFERENCE is returned unchanged.
    {
      const before = log;
      const rejecting = new ScriptedClient([
        { kind: 'tool-calls', calls: [{ tool: 'setInput', id: 'ghost@404', value: 1 }] },
        { kind: 'answer', text: 'that object is not in the scene' },
      ]);
      const out = await runTurn(before, 'set the ghost to 1', rejecting, deps);
      expect(out.kind).toBe('agentic');
      if (out.kind === 'agentic') {
        expect(out.log).toBe(before); // same reference — nothing half-applied
        const failed = out.steps.find((s) => s.call.tool === 'setInput');
        expect(failed?.result.ok).toBe(false);
      }
      log = before; // carry the unchanged reference forward
    }

    // ── Phase 4c — the long drag tail: interleaved user AND copilot set-inputs ──
    // direct appends (no fold cost each) alternating author + target, pumping the
    // log past 100 acts. Both authors land set-inputs.
    for (let i = 0; i < 90; i += 1) {
      const target = (['a', 'b', 'c', 'd'] as const)[i % 4]!;
      const value = ((i * 7) % 19) - 9; // deterministic, inside [-10, 10]
      append({ kind: 'set-input', by: i % 2 === 0 ? 'user' : 'copilot', turn: turn++, target, value });
    }

    // ── Phase 5 — M4 spatial + parser verbs (both authors): move / retire /
    // edit-span / replace. The id-stability-under-mutation watch. ──
    append({ kind: 'move', by: 'user', turn: turn++, target: 'curve0', at: { x: 100, y: 200 } });
    append({ kind: 'move', by: 'copilot', turn: turn++, target: 'g0', at: { x: 300, y: 400 } });
    append({ kind: 'retire', by: 'user', turn: turn++, target: 'g1' });
    append({ kind: 'retire', by: 'copilot', turn: turn++, target: 'e1' });
    // edit a parsed span: curve0's term0 (x^2 → x^3); id stays 'curve0'
    append({ kind: 'edit-span', by: 'user', turn: turn++, target: 'curve0', role: 'term0', text: 'x^3' });
    // edit curve1's term1 (c → 2*c); id stays 'curve1'
    append({ kind: 'edit-span', by: 'user', turn: turn++, target: 'curve1', role: 'term1', text: '2*c' });
    // re-mint the introduced param p under its own id — the replace id-stability core
    append({
      kind: 'replace', by: 'user', turn: turn++, target: 'p',
      js: 'param("phi", 7, { range: [-10, 10], id: "p" });',
    });

    const finalLog = log;

    // ── criterion 5: the log reached scale and spans BOTH authors ──
    expect(finalLog.length).toBeGreaterThanOrEqual(100);
    const authors = new Set(finalLog.map((act) => act.by));
    expect(authors.has('user')).toBe(true);
    expect(authors.has('copilot')).toBe(true);

    // the whole accumulated session folds cleanly
    const first = await fold(finalLog, resolveSpan);
    expect(first.ok ? 'ok' : (first as { failure: { message: string } }).failure.message).toBe('ok');
    if (!first.ok) return;
    const wsA = first.workspace;

    // ── criterion 1: determinism — re-fold yields identical ids AND values ──
    const second = await fold(finalLog, resolveSpan);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expectSameWorkspace(wsA, second.workspace, NUMERIC_IDS);

    // ── criterion 3: byId robust — every live object resolves; retired ones are
    // flagged in `retired` yet STILL resolve (retire is a filter-projection) ──
    for (const id of LIVE_IDS) {
      expect(wsA.objects.has(id)).toBe(true);
    }
    // the positional claim resolves too (found by kind)
    const claim = [...wsA.objects.values()].find((h) => h.kind === 'claim');
    expect(claim && wsA.objects.has(claim.id)).toBe(true);
    for (const id of RETIRED_IDS) {
      expect(wsA.retired.has(id)).toBe(true); // flagged retired
      expect(wsA.objects.has(id)).toBe(true); // yet still live/resolvable
    }
    // the id-stability watch: the mutated objects kept their ids under
    // edit-span (curve0, curve1) and replace (p)
    for (const id of ['curve0', 'curve1', 'p'] as const) expect(wsA.objects.has(id)).toBe(true);

    // ── criterion 2: no half-apply — a rejected act leaves the log reference
    // untouched (the transaction never partially lands) ──
    const badAct: WorkspaceAct = { kind: 'set-input', by: 'copilot', turn: 999, target: 'ghost@999', value: 1 };
    const rejected = await commit(finalLog, badAct, tryFoldSpan);
    expect(rejected.ok).toBe(false);
    expect(rejected.log).toBe(finalLog); // same reference — nothing half-applied
    if (!rejected.ok) expect(rejected.errors[0]).toContain('ghost@999');

    // ── criterion 4: checkpoint determinism (M4 everyNActs at M5 scale) — the
    // compacted long log folds to the SAME workspace: ids, values, layout, retired ──
    const policy = everyNActs(50, { resolveSpan });
    expect(policy.shouldCompact(finalLog)).toBe(true);
    const compacted = await policy.compact(finalLog, tryFoldSpan);
    expect(compacted.length).toBeLessThan(finalLog.length); // the churn collapsed

    const afterCompact = await fold(compacted, resolveSpan);
    expect(afterCompact.ok ? 'ok' : (afterCompact as { failure: { message: string } }).failure.message).toBe('ok');
    if (!afterCompact.ok) return;
    expectSameWorkspace(wsA, afterCompact.workspace, NUMERIC_IDS);
  }, 120_000);
});
