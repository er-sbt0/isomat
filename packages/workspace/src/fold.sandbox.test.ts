/**
 * fold.sandbox.test.ts — a hand-built co-edit log, folded for real.
 *
 * fold.test.ts proves the log rules with stubs. This proves what stubs cannot:
 * that an `introduce` act's source actually mints a stably-id'd parameter in
 * QuickJS, an `author` act reaches it back BY ID and derives over it, a
 * `set-input` drag propagates through the reactive graph, and the whole log
 * folds to the same ids every time — the cassette property.
 *
 * Covers roadmap M1 exit criteria 2–4:
 *   2. fold(author/introduce + set-input) → object present, value propagated
 *   3. a throwing author act leaves the prior log untouched (one transaction)
 *   4. re-fold yields identical ids; an introduced id survives an earlier insert
 */

import { describe, expect, it } from 'vitest';
import { CorrespondenceGraph } from '@isomat/core';
import type { Handle, Id } from '@isomat/core';
import { commit } from './commit.js';
import { fold, tryFold } from './node.js';
import type { WorkspaceAct, WorkspaceLog } from './act.js';

const at = { x: 120, y: 240 };

/** introduce: mint the draggable parameter `a` with the EXPLICIT stable id `a@1`.
 *  No `expose`/`show` — the native surface auto-registers on construction (§5.1). */
const INTRODUCE_A: WorkspaceAct = {
  kind: 'introduce',
  by: 'user',
  turn: 1,
  id: 'a@1',
  at,
  source: 'introduce a = 2',
  js: 'const a = param("a", 2, { range: [-5, 5], id: "a@1" });',
};

/** author: reach `a` back by id, derive y = a² (stable id `y@2`), and plot f(x) = a·x. */
const AUTHOR_Y: WorkspaceAct = {
  kind: 'author',
  by: 'copilot',
  turn: 2,
  js: [
    'const a = byId("a@1");',
    'const y = derive(() => a.value * a.value, { label: "y = a^2", id: "y@2" });',
    'plot((x) => a.value * x, { domain: [-5, 5], label: "f" });',
    'readout(y, { label: "y" });',
  ].join('\n'),
};

const setA = (value: number, turn = 3): WorkspaceAct => ({
  kind: 'set-input',
  by: 'user',
  turn,
  target: 'a@1',
  value,
});

function idByLabel(objects: ReadonlyMap<Id, Handle>, label: string): Id {
  for (const h of objects.values()) {
    if ((h as { label?: unknown }).label === label) return h.id;
  }
  throw new Error(`no object labeled "${label}"; have: ${[...objects.keys()].join(', ')}`);
}

const numAt = (objects: ReadonlyMap<Id, Handle>, id: Id): number =>
  (objects.get(id) as unknown as { value: number }).value;

describe('a hand-built co-edit log, folded through QuickJS', () => {
  it('introduce + author + set-input → object present, dragged value propagated (criterion 2)', async () => {
    const log: WorkspaceLog = [INTRODUCE_A, AUTHOR_Y, setA(3)];
    const out = await fold(log);
    expect(out.ok ? 'ok' : out.failure.message).toBe('ok');
    if (!out.ok) return;
    const { objects, layout } = out.workspace;

    // the introduced object is present, at its stable id, with the drag applied
    expect(objects.has('a@1')).toBe(true);
    expect(numAt(objects, 'a@1')).toBe(3);

    // the introduce recorded a layout position; the authored derived did not
    expect(layout.get('a@1')).toEqual(at);
    expect(layout.has('y@2')).toBe(false);

    // y = a² propagated through the reactive graph: 3² = 9 (was 2² = 4 at author time)
    expect(numAt(objects, 'y@2')).toBe(9);

    // the workspace carries the world's correspondence graph as its projection
    expect(out.workspace.graph).toBeInstanceOf(CorrespondenceGraph);
  });

  it('re-dragging folds to the newest value (order is load-bearing)', async () => {
    const out = await fold([INTRODUCE_A, AUTHOR_Y, setA(3), setA(-4)]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(numAt(out.workspace.objects, 'a@1')).toBe(-4);
      expect(numAt(out.workspace.objects, 'y@2')).toBe(16);
    }
  });

  it('a throwing author act leaves the prior log untouched (criterion 3)', async () => {
    const log: WorkspaceLog = [INTRODUCE_A, AUTHOR_Y];
    const BAD: WorkspaceAct = {
      kind: 'author',
      by: 'copilot',
      turn: 3,
      js: 'const missing = byId("nope@9");',
    };

    const committed = await commit(log, BAD, tryFold);
    expect(committed.ok).toBe(false);
    // nothing half-applied: the previous log comes back, same reference
    expect(committed.log).toBe(log);
    if (!committed.ok) {
      expect(committed.errors[0]).toContain('position 2');
      expect(committed.errors[0]).toContain('nope@9');
    }

    // and the prior log still folds cleanly — the rejected act touched nothing
    const still = await fold(committed.log);
    expect(still.ok).toBe(true);
  });

  it('a good act commits, and the accepted log is the one that folded', async () => {
    const log: WorkspaceLog = [INTRODUCE_A, AUTHOR_Y];
    const committed = await commit(log, setA(1), tryFold);
    expect(committed.ok).toBe(true);
    expect(committed.log).toHaveLength(3);
    const check = await fold(committed.log);
    expect(check.ok).toBe(true);
    if (check.ok) expect(numAt(check.workspace.objects, 'a@1')).toBe(1);
  });

  it('re-folding the same log yields identical ids (the cassette property, criterion 4)', async () => {
    const log: WorkspaceLog = [INTRODUCE_A, AUTHOR_Y, setA(2)];
    const a = await fold(log);
    const b = await fold(log);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect([...a.workspace.objects.keys()].sort()).toEqual([...b.workspace.objects.keys()].sort());
    }
  });

  it("an introduced object's stable id survives an unrelated earlier act (criterion 4)", async () => {
    // an unrelated author act that ALSO mints a parameter, inserted FIRST
    const unrelated: WorkspaceAct = {
      kind: 'author',
      by: 'user',
      turn: 0,
      js: 'const p = param("p", 0, { range: [-1, 1] });',
    };

    const alone = await fold([INTRODUCE_A]);
    const shifted = await fold([unrelated, INTRODUCE_A]);
    expect(alone.ok && shifted.ok).toBe(true);
    if (!alone.ok || !shifted.ok) return;

    // the explicit stable id is a@1 in BOTH — the earlier insert did not shift it
    expect(alone.workspace.objects.has('a@1')).toBe(true);
    expect(shifted.workspace.objects.has('a@1')).toBe(true);
    expect(shifted.workspace.layout.get('a@1')).toEqual(at);

    // ── the counter-example that proves WHY the policy exists ──
    // an object minted WITHOUT an explicit id gets a positional `<kind>#<n>` id,
    // which DOES shift when an earlier act is inserted.
    const POSITIONAL = 'const a = param("a", 2, { range: [-5, 5] });'; // no id → positional
    const posAlone = await fold([{ kind: 'author', by: 'user', turn: 1, js: POSITIONAL }]);
    const posAfter = await fold([unrelated, { kind: 'author', by: 'user', turn: 1, js: POSITIONAL }]);
    expect(posAlone.ok && posAfter.ok).toBe(true);
    if (posAlone.ok && posAfter.ok) {
      const before = idByLabel(posAlone.workspace.objects, 'a');
      const after = idByLabel(posAfter.workspace.objects, 'a');
      // same object 'a', different id — positional ids are NOT insert-stable.
      // this is exactly the breakage an introduce's explicit id (a@1 above) avoids.
      expect(before).not.toBe(after);
    }
  });
});
