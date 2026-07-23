/**
 * fold.test.ts — the log logic, proven with stub hooks (no QuickJS).
 *
 * The counterpart to fold.sandbox.test.ts: this proves the fold/commit/coalesce
 * RULES against a fake world — order, layout projection, the missing-target
 * failure, the one-transaction guarantee — with no sandbox and no browser, the
 * same split conversation.test.ts vs conversation.sandbox.test.ts draws.
 */

import { describe, expect, it, vi } from 'vitest';
import { CorrespondenceGraph } from '@isomat/core';
import type { Handle, Id } from '@isomat/core';
import { foldLog } from './fold.js';
import type { FoldHooks, Settable } from './fold.js';
import { coalesce, commit } from './commit.js';
import { isExecutable } from './act.js';
import type { WorkspaceAct, WorkspaceLog } from './act.js';
import { SessionIds } from './session.js';

type FakeHandle = Handle & Settable & { _v: number };

/** A fake world: `execute` mints the declared id for an introduce; set-input pokes `_v`. */
function stub(opts: { readonly mintOnIntroduce?: boolean } = {}) {
  const mint = opts.mintOnIntroduce ?? true;
  const objects = new Map<Id, FakeHandle>();
  const calls: WorkspaceAct[] = [];
  const graph = new CorrespondenceGraph();
  const hooks: FoldHooks = {
    execute: (act) => {
      calls.push(act);
      if (act.kind === 'introduce' && mint) {
        objects.set(act.id, {
          id: act.id,
          kind: 'parameter',
          _v: 0,
          setValueLive(next: number) {
            this._v = next;
          },
        } as FakeHandle);
      }
    },
    scene: () => objects,
    graph: () => graph,
  };
  return { hooks, objects, calls, graph };
}

const at = { x: 10, y: 20 };
const intro = (id: string): WorkspaceAct => ({ kind: 'introduce', by: 'user', turn: 1, id, at, js: '' });

describe('foldLog — the three verbs, against a stub world', () => {
  it('an introduce records layout[id] = at and offers the object', () => {
    const s = stub();
    const out = foldLog([intro('a@1')], s.hooks);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.workspace.objects.has('a@1')).toBe(true);
      expect(out.workspace.layout.get('a@1')).toEqual(at);
      expect(out.workspace.graph).toBe(s.graph);
    }
  });

  it('an introduce whose source mints no matching id is a FAILURE naming the act', () => {
    const s = stub({ mintOnIntroduce: false });
    const out = foldLog([intro('a@1')], s.hooks);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 0, kind: 'introduce' });
      expect(out.failure.message).toContain('a@1');
    }
  });

  it('a set-input pokes its target through the interaction-path setter', () => {
    const s = stub();
    const out = foldLog(
      [intro('a@1'), { kind: 'set-input', by: 'user', turn: 2, target: 'a@1', value: 5 }],
      s.hooks,
    );
    expect(out.ok).toBe(true);
    expect(s.objects.get('a@1')!._v).toBe(5);
  });

  it('a set-input naming an absent target is a FAILURE, not a skip', () => {
    const s = stub();
    const out = foldLog(
      [{ kind: 'set-input', by: 'user', turn: 1, target: 'ghost@9', value: 1 }],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 0, kind: 'set-input' });
      expect(out.failure.message).toContain('ghost@9');
      expect(out.failure.message).toContain('not in the workspace');
    }
  });

  it('acts fold IN ORDER, and a mid-log failure names its index', () => {
    const s = stub();
    const out = foldLog(
      [
        intro('a@1'),
        { kind: 'author', by: 'copilot', turn: 2, js: '' },
        { kind: 'set-input', by: 'user', turn: 3, target: 'gone@1', value: 0 },
      ],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.index).toBe(2);
    expect(s.calls).toHaveLength(2); // author + introduce ran; the bad set-input aborted
  });
});

describe('foldLog — the spatial verbs move / retire (M4 Stage A)', () => {
  it('a move relocates layout[target] to the new position', () => {
    const s = stub();
    const to = { x: 99, y: 88 };
    const out = foldLog(
      [intro('a@1'), { kind: 'move', by: 'user', turn: 2, target: 'a@1', at: to }],
      s.hooks,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.workspace.layout.get('a@1')).toEqual(to);
      // the object itself is untouched — a move is pure projection
      expect(out.workspace.objects.has('a@1')).toBe(true);
    }
  });

  it('a move naming an absent target is a FAILURE, not a skip', () => {
    const s = stub();
    const out = foldLog(
      [{ kind: 'move', by: 'user', turn: 1, target: 'ghost@9', at: { x: 1, y: 2 } }],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 0, kind: 'move' });
      expect(out.failure.message).toContain('ghost@9');
      expect(out.failure.message).toContain('not in the workspace');
    }
  });

  it('a retire adds the id to workspace.retired and leaves objects/graph intact', () => {
    const s = stub();
    const out = foldLog(
      [intro('a@1'), { kind: 'retire', by: 'copilot', turn: 2, target: 'a@1' }],
      s.hooks,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.workspace.retired.has('a@1')).toBe(true);
      // retire is a filter-projection: the object stays live in objects and graph
      expect(out.workspace.objects.has('a@1')).toBe(true);
      expect(out.workspace.graph).toBe(s.graph);
    }
  });

  it('a retire naming an absent target is a FAILURE, not a skip', () => {
    const s = stub();
    const out = foldLog(
      [{ kind: 'retire', by: 'user', turn: 1, target: 'ghost@9' }],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 0, kind: 'retire' });
      expect(out.failure.message).toContain('ghost@9');
    }
  });

  it('retired starts empty when no retire act is folded', () => {
    const s = stub();
    const out = foldLog([intro('a@1')], s.hooks);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.workspace.retired.size).toBe(0);
  });
});

describe('foldLog — replace / edit-span resolve in place (M4 Stage B)', () => {
  const introMeta = {
    kind: 'introduce' as const,
    by: 'user' as const,
    turn: 1,
    id: 'c@1',
    at,
    js: 'ORIG',
    expr: {
      text: 'x^2',
      at,
      id: 'c@1',
      domain: [-2, 2] as const,
      indepVar: 'x',
      bindings: {},
    },
  };

  it('a replace supersedes the target: its js runs at the introduce position, once', () => {
    const s = stub();
    const out = foldLog(
      [intro('a@1'), { kind: 'replace', by: 'copilot', turn: 2, target: 'a@1', js: 'REPLACED' }],
      s.hooks,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.workspace.objects.has('a@1')).toBe(true); // id unchanged
    // the introduce executed the FINAL resolved js, not intro()'s empty js…
    const introCall = s.calls.find((c) => c.kind === 'introduce') as { js: string } | undefined;
    expect(introCall?.js).toBe('REPLACED');
    // …and the replace act itself never reached execute (no second mint)
    expect(s.calls.some((c) => c.kind === 'replace')).toBe(false);
    expect(s.calls.filter((c) => c.kind === 'introduce')).toHaveLength(1);
  });

  it('the last replace wins when a target is replaced twice (determinism)', () => {
    const s = stub();
    const out = foldLog(
      [
        intro('a@1'),
        { kind: 'replace', by: 'user', turn: 2, target: 'a@1', js: 'FIRST' },
        { kind: 'replace', by: 'user', turn: 3, target: 'a@1', js: 'SECOND' },
      ],
      s.hooks,
    );
    expect(out.ok).toBe(true);
    const introCall = s.calls.find((c) => c.kind === 'introduce') as { js: string } | undefined;
    expect(introCall?.js).toBe('SECOND');
  });

  it('a replace on an id no earlier introduce defined is a FAILURE naming the act', () => {
    const s = stub();
    const out = foldLog(
      [intro('a@1'), { kind: 'replace', by: 'user', turn: 2, target: 'ghost@9', js: 'X' }],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 1, kind: 'replace' });
      expect(out.failure.message).toContain('ghost@9');
    }
  });

  it('an edit-span calls the injected resolver and folds its emitted js in at the defining position', () => {
    const s = stub();
    const resolveSpan = vi.fn(() => ({ js: 'EMITTED', source: 'x^3', meta: { ...introMeta.expr, text: 'x^3' } }));
    const out = foldLog(
      [introMeta, { kind: 'edit-span', by: 'copilot', turn: 2, target: 'c@1', role: 'term0', text: 'x^3' }],
      { ...s.hooks, resolveSpan },
    );
    expect(out.ok ? 'ok' : out.failure.message).toBe('ok');
    expect(resolveSpan).toHaveBeenCalledWith(introMeta.expr, 'term0', 'x^3');
    const introCall = s.calls.find((c) => c.kind === 'introduce') as { js: string } | undefined;
    expect(introCall?.js).toBe('EMITTED');
  });

  it('an edit-span with no resolver in the hooks is a FAILURE (parse-enabled fold required)', () => {
    const s = stub();
    const out = foldLog(
      [introMeta, { kind: 'edit-span', by: 'user', turn: 2, target: 'c@1', role: 'term0', text: 'x^3' }],
      s.hooks,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toMatchObject({ index: 1, kind: 'edit-span' });
      expect(out.failure.message).toContain('resolver');
    }
  });

  it('an edit-span on an object with no parse metadata is a FAILURE', () => {
    const s = stub();
    const resolveSpan = vi.fn(() => ({ js: 'EMITTED', source: 'x', meta: introMeta.expr }));
    const out = foldLog(
      // intro('a@1') carries no `expr` metadata (hand-authored)
      [intro('a@1'), { kind: 'edit-span', by: 'user', turn: 2, target: 'a@1', role: 'term0', text: 'x' }],
      { ...s.hooks, resolveSpan },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure).toMatchObject({ index: 1, kind: 'edit-span' });
    expect(resolveSpan).not.toHaveBeenCalled();
  });
});

describe('commit — the one-transaction rule', () => {
  it('a rejected candidate returns the PRIOR log, untouched (referentially)', async () => {
    const log: WorkspaceLog = [intro('a@1')];
    const tryFold = vi.fn(async () => ({ ok: false as const, failure: { index: 1, kind: 'author' as const, message: 'boom' } }));
    const res = await commit(log, { kind: 'author', by: 'copilot', turn: 2, js: '' }, tryFold);
    expect(res.ok).toBe(false);
    expect(res.log).toBe(log); // same reference — nothing half-applied
    if (!res.ok) expect(res.errors[0]).toContain('position 1');
  });

  it('an accepted candidate advances the log by exactly the appended act', async () => {
    const log: WorkspaceLog = [intro('a@1')];
    const tryFold = vi.fn(async (c: WorkspaceLog) => ({
      ok: true as const,
      workspace: { objects: new Map(), layout: new Map(), graph: new CorrespondenceGraph(), retired: new Set<Id>() },
    }));
    const act: WorkspaceAct = { kind: 'set-input', by: 'user', turn: 2, target: 'a@1', value: 3 };
    const res = await commit(log, act, tryFold);
    expect(res.ok).toBe(true);
    expect(res.log).toHaveLength(2);
    expect(res.log[1]).toBe(act);
    expect(tryFold).toHaveBeenCalledWith([...log, act]);
  });
});

describe('coalesce — a drag sweep to its checkpoint', () => {
  it('collapses consecutive set-inputs on one target, keeping the last', () => {
    const sweep: WorkspaceLog = [
      intro('a@1'),
      ...[0.1, 0.4, 0.9, 1.6].map(
        (value): WorkspaceAct => ({ kind: 'set-input', by: 'user', turn: 2, target: 'a@1', value }),
      ),
    ];
    const tight = coalesce(sweep);
    expect(tight).toHaveLength(2);
    expect((tight[1] as { value: number }).value).toBe(1.6);
  });

  it('does NOT merge across an executable act, nor across a different target', () => {
    const log: WorkspaceLog = [
      { kind: 'set-input', by: 'user', turn: 1, target: 'a@1', value: 1 },
      { kind: 'author', by: 'copilot', turn: 2, js: '' },
      { kind: 'set-input', by: 'user', turn: 3, target: 'a@1', value: 2 },
      { kind: 'set-input', by: 'user', turn: 3, target: 'b@1', value: 9 },
    ];
    expect(coalesce(log)).toHaveLength(4);
  });
});

describe('SessionIds — the stable-id allocator', () => {
  it('issues monotonic, #-free ids that never collide with the generated form', () => {
    const ids = new SessionIds();
    expect(ids.next('x')).toBe('x@1');
    expect(ids.next('y = a^2')).toBe('ya2@2'); // sanitized, still #-free
    expect(ids.next()).toBe('obj@3');
    expect(ids.count).toBe(3);
    // the reserved generated form is `<kind>#<n>` — a session id must not match it
    expect('x@1').not.toMatch(/#\d+$/);
  });
});

describe('isExecutable', () => {
  it('is true for author/introduce/replace (they carry runnable js), false otherwise', () => {
    expect(isExecutable(intro('a@1'))).toBe(true);
    expect(isExecutable({ kind: 'author', by: 'user', turn: 1, js: '' })).toBe(true);
    expect(isExecutable({ kind: 'replace', by: 'user', turn: 1, target: 'a@1', js: '' })).toBe(true);
    expect(isExecutable({ kind: 'set-input', by: 'user', turn: 1, target: 'a@1', value: 0 })).toBe(false);
    // edit-span has no js — it is re-emitted through @isomat/parse, not executed as-is
    expect(isExecutable({ kind: 'edit-span', by: 'user', turn: 1, target: 'a@1', role: 'term0', text: 'x' })).toBe(false);
  });
});
