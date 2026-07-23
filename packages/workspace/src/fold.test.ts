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
      workspace: { objects: new Map(), layout: new Map(), graph: new CorrespondenceGraph() },
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
  it('is true for author/introduce, false for set-input', () => {
    expect(isExecutable(intro('a@1'))).toBe(true);
    expect(isExecutable({ kind: 'author', by: 'user', turn: 1, js: '' })).toBe(true);
    expect(isExecutable({ kind: 'set-input', by: 'user', turn: 1, target: 'a@1', value: 0 })).toBe(false);
  });
});
