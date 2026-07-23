/**
 * App.tsx — W2: interactive co-edit, the human half.
 *
 * Every mutation here becomes an ACT in the log, committed under the
 * one-transaction rule. That is the difference from W1, where the slider poked
 * the world in place and left no trace. A poke is not co-edit: it is not
 * attributable, not undoable, and invisible to the copilot.
 *
 * The slider does BOTH, and the split is the engine's own design rather than a
 * UI compromise:
 *   • while dragging → `setValueLive` + `bumpLive`, so the curve tracks the
 *     thumb at interaction speed with no fold and no act;
 *   • on release      → one `SetInputAct` through `commit`, which re-folds.
 * `Slot.poke` exists precisely so a drag frame is not a beat of the record.
 *
 * Undo is `log.slice(0, -1)` and a re-fold. There is no undo stack, no inverse
 * operation, and nothing to keep in sync — the workspace IS `fold(log)`, so
 * truncating the log is already the previous state.
 */

import { useCallback, useMemo, useState } from 'react';
import type { Handle, Id } from '@isomat/core';
import type { Workspace, WorkspaceAct } from '@isomat/workspace';
import { SessionIds } from '@isomat/workspace';
import { introduceExpr, parseExpr } from '@isomat/parse';
import { DEMO_LOG } from './demo-log.js';
import { bumpLive, useLive } from './live.js';
import { useSession } from './session.js';
import type { Session } from './session.js';
import { ViewOf, isRenderableView } from './views.js';

interface ParamLike extends Handle {
  readonly label: string;
  readonly range: readonly [number, number];
  readonly value: number;
  setValueLive(next: number): void;
}

const isParam = (h: Handle): h is ParamLike => h.kind === 'parameter';

// ──────────────────────────────── inputs ────────────────────────────────

function ParamSlider({ param, session }: { param: ParamLike; session: Session }) {
  const value = useLive<number>(param) ?? param.value;
  const [lo, hi] = param.range;

  // Interaction path: clamp-and-poke. No act, no fold — this fires per frame.
  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      param.setValueLive(Number(e.target.value));
      bumpLive();
    },
    [param],
  );

  // Release: ONE act for the whole sweep. `coalesce` collapses any that slip
  // through consecutively, so a drag never bloats the log.
  const onCommit = useCallback(() => {
    void session.apply({
      kind: 'set-input',
      by: 'user',
      turn: session.nextTurn(),
      target: param.id,
      value: param.value,
    });
  }, [param, session]);

  return (
    <label className="param">
      <span className="pname">{param.label}</span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={0.1}
        value={value}
        onChange={onInput}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        disabled={session.busy}
      />
      <output>{Number.isInteger(value) ? value : value.toFixed(1)}</output>
    </label>
  );
}

// ───────────────────────────── expression entry ─────────────────────────────

/**
 * Bind each free variable to a scene object of the same label.
 *
 * `introduceExpr` refuses to guess: an unbound free variable throws before any
 * act exists. Matching on the authored label is the obvious binding for a typed
 * expression ("a*x" means the `a` already on the canvas), and anything it cannot
 * resolve is reported as a typing error rather than silently dropped.
 */
function bindFreeVars(
  text: string,
  indepVar: string,
  workspace: Workspace,
): { bindings: Record<string, Id> } | { error: string } {
  let free: readonly string[];
  try {
    free = parseExpr(text).freeVars;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const byLabel = new Map<string, Id>();
  for (const [id, h] of workspace.objects) {
    const label = (h as { label?: unknown }).label;
    if (typeof label === 'string' && !byLabel.has(label)) byLabel.set(label, id);
  }

  const bindings: Record<string, Id> = {};
  for (const v of free) {
    if (v === indepVar) continue;
    const target = byLabel.get(v) ?? (workspace.objects.has(v as Id) ? (v as Id) : undefined);
    if (!target) {
      return { error: `"${v}" is not on the canvas — introduce it first, or use it as the variable.` };
    }
    bindings[v] = target;
  }
  return { bindings };
}

function ExprEntry({ session, workspace, ids }: { session: Session; workspace: Workspace; ids: SessionIds }) {
  const [text, setText] = useState('a*x + 1');
  const [local, setLocal] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;
      setLocal(null);

      const bound = bindFreeVars(trimmed, 'x', workspace);
      if ('error' in bound) {
        setLocal(bound.error);
        return;
      }

      let act: WorkspaceAct;
      try {
        // Throws BEFORE any act exists on bad text/domain/binding — the caller's
        // mistake, named where it is made rather than deferred to a fold.
        act = introduceExpr({
          text: trimmed,
          at: { x: 40, y: 40 },
          id: ids.next(trimmed),
          domain: [-5, 5],
          indepVar: 'x',
          bindings: bound.bindings,
          by: 'user',
          turn: session.nextTurn(),
        });
      } catch (err) {
        setLocal(err instanceof Error ? err.message : String(err));
        return;
      }

      if (await session.apply(act)) setText('');
    },
    [text, workspace, ids, session],
  );

  return (
    <form className="expr" onSubmit={submit}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // A typing error describes the text that produced it; the moment that
          // text changes the message is stale and must not linger.
          if (local) setLocal(null);
        }}
        placeholder="an expression in x, e.g. a*x + 1"
        aria-label="expression"
        disabled={session.busy}
      />
      <button type="submit" disabled={session.busy || !text.trim()}>
        introduce
      </button>
      {local && <p className="failed inline">{local}</p>}
    </form>
  );
}

// ──────────────────────────────── the app ────────────────────────────────

export function App() {
  const session = useSession(DEMO_LOG);
  const { state } = session;

  // One allocator per mounted session, so ids stay legible and unique.
  const ids = useMemo(() => new SessionIds('e'), []);

  const retire = useCallback(
    (target: Id) => {
      void session.apply({ kind: 'retire', by: 'user', turn: session.nextTurn(), target });
    },
    [session],
  );

  if (!state) {
    return (
      <main>
        <Header />
        {session.error ? <p className="failed">{session.error}</p> : <p className="pending">booting QuickJS and folding…</p>}
      </main>
    );
  }

  const { workspace, log, ms } = state;
  const all = [...workspace.objects.values()];
  const params = all.filter(isParam).filter((p) => !workspace.retired.has(p.id));
  // `retire` does NOT remove the object — it stays live in `objects` and `graph`
  // so `byId` still resolves it and dependents keep recomputing. It only joins
  // the `retired` filter-projection, which the UI is required to honour.
  const views = all.filter(isRenderableView).filter((v) => !workspace.retired.has(v.id));

  return (
    <main>
      <Header />

      <section>
        <h2>Inputs</h2>
        {params.length === 0 && <p className="dim">no inputs on the canvas</p>}
        {params.map((p) => (
          <ParamSlider key={p.id} param={p} session={session} />
        ))}
        <p className="caveat">
          Dragging pokes the value live; releasing commits one <code>SetInputAct</code>.
        </p>
      </section>

      <section>
        <h2>Introduce an expression</h2>
        <ExprEntry session={session} workspace={workspace} ids={ids} />
      </section>

      <section>
        <h2>Workspace</h2>
        {session.error && <p className="failed">rejected — {session.error}</p>}
        <div className="canvas">
          {views.map((v) => (
            <div className="cell" key={v.id}>
              <button className="retire" onClick={() => retire(v.id)} title={`retire ${v.id}`} disabled={session.busy}>
                ×
              </button>
              <ViewOf handle={v} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>
          The log ({log.length} acts){' '}
          <button className="undo" onClick={() => void session.undo()} disabled={session.busy || log.length === 0}>
            undo
          </button>
        </h2>
        <ol className="log">
          {log.map((act, i) => (
            <li key={i}>
              <span className={`by by-${act.by}`}>{act.by}</span>
              <span className="kind">{act.kind}</span>
              <code>{describeAct(act)}</code>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        {log.length} acts &rarr; {workspace.objects.size} objects in {ms}ms
        <span className="dim">
          {' '}
          · {views.length} shown · {workspace.retired.size} retired
        </span>
      </footer>
    </main>
  );
}

function describeAct(act: WorkspaceAct): string {
  switch (act.kind) {
    case 'set-input':
      return `${act.target} = ${act.value}`;
    case 'retire':
      return act.target;
    case 'move':
      return `${act.target} → (${act.at.x}, ${act.at.y})`;
    case 'introduce':
      return act.expr?.text ?? act.source ?? act.id;
    case 'author':
      return act.js.split('\n')[0] + (act.js.includes('\n') ? ' …' : '');
    default:
      return '';
  }
}

function Header() {
  return (
    <header>
      <h1>isomat</h1>
      <p className="sub">
        W2 — every change is an act; the workspace is <code>fold(log)</code>, and undo is truncation.
      </p>
    </header>
  );
}
