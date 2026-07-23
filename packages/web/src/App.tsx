/**
 * App.tsx — W0: prove the Phase-1 substrate folds inside a browser.
 *
 * This is deliberately not a UI. It boots QuickJS in the page, folds the demo
 * log, and prints what came back as text. Its entire job is to answer one
 * question — does the engine run client-side with zero edits — before W1 spends
 * any effort on components. If this fails, the Phase 2 plan is wrong and it is
 * much cheaper to find out here.
 *
 * The values below are read live off the folded handles, which means the guest
 * closures in the VM are being re-invoked from React. `y = 9` (not 4) is the
 * load-bearing number on screen: it proves the `set-input` act propagated
 * through the reactive graph inside the sandbox, not just that objects exist.
 */

import { useEffect, useState } from 'react';
import type { Handle, Id } from '@isomat/core';
import type { Position, Workspace } from '@isomat/workspace';
import { fold } from '@isomat/workspace/browser';
import { DEMO_LOG } from './demo-log.js';

type Status =
  | { phase: 'folding' }
  | { phase: 'ok'; workspace: Workspace; ms: number }
  | { phase: 'failed'; message: string };

/** Best-effort description of a folded handle — these are heterogeneous by design. */
function describe(h: Handle): { label?: string; value?: string; kind?: string } {
  const anyH = h as unknown as { label?: unknown; value?: unknown; kind?: unknown };
  const out: { label?: string; value?: string; kind?: string } = {};
  if (typeof anyH.label === 'string') out.label = anyH.label;
  if (typeof anyH.kind === 'string') out.kind = anyH.kind;
  try {
    const v = anyH.value;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      out.value = String(v);
    }
  } catch {
    // A lazily-materialising view can throw on read (errors-as-data). Not fatal
    // here — W0 only claims the object EXISTS.
    out.value = '(unreadable)';
  }
  return out;
}

const fmtPos = (p: Position | undefined) => (p ? `(${p.x}, ${p.y})` : '—');

export function App() {
  const [status, setStatus] = useState<Status>({ phase: 'folding' });

  useEffect(() => {
    let live = true;
    const started = performance.now();
    fold(DEMO_LOG)
      .then((out) => {
        if (!live) return;
        const ms = Math.round(performance.now() - started);
        setStatus(
          out.ok
            ? { phase: 'ok', workspace: out.workspace, ms }
            : { phase: 'failed', message: `act ${out.failure.index} (${out.failure.kind}): ${out.failure.message}` },
        );
      })
      .catch((e: unknown) => {
        if (live) setStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <main>
      <header>
        <h1>isomat</h1>
        <p className="sub">
          W0 — <code>fold(log) &rarr; Workspace</code>, running entirely in this page.
        </p>
      </header>

      <section>
        <h2>The log ({DEMO_LOG.length} acts)</h2>
        <ol className="log">
          {DEMO_LOG.map((act, i) => (
            <li key={i}>
              <span className={`by by-${act.by}`}>{act.by}</span>
              <span className="kind">{act.kind}</span>
              <code>
                {act.kind === 'introduce' || act.kind === 'author'
                  ? act.js.split('\n')[0] + (act.js.includes('\n') ? ' …' : '')
                  : act.kind === 'set-input'
                    ? `${act.target} = ${act.value}`
                    : ''}
              </code>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>The fold</h2>
        {status.phase === 'folding' && <p className="pending">booting QuickJS and folding…</p>}
        {status.phase === 'failed' && <p className="failed">FAILED — {status.message}</p>}
        {status.phase === 'ok' && (
          <>
            <p className="ok">
              folded {DEMO_LOG.length} acts &rarr; {status.workspace.objects.size} objects in {status.ms}ms
            </p>
            <table>
              <thead>
                <tr>
                  <th>id</th>
                  <th>label</th>
                  <th>value</th>
                  <th>position</th>
                </tr>
              </thead>
              <tbody>
                {[...status.workspace.objects.entries()].map(([id, h]: [Id, Handle]) => {
                  const d = describe(h);
                  return (
                    <tr key={id}>
                      <td>
                        <code>{id}</code>
                      </td>
                      <td>{d.label ?? d.kind ?? '—'}</td>
                      <td>{d.value ?? '—'}</td>
                      <td className="dim">{fmtPos(status.workspace.layout.get(id))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">
              <code>a@1 = 3</code> because the user&rsquo;s <code>set-input</code> act applied;{' '}
              <code>y@2 = 9</code> because that change propagated through the reactive graph
              <em> inside the sandbox</em>. That second number is the one that proves the engine
              really ran.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
