/**
 * App.tsx — W1: a folded workspace, rendered as native React components.
 *
 * W0 printed ids to prove the engine ran. This renders the workspace through the
 * components in `views.tsx` and proves the REACTIVE BRIDGE: the slider does not
 * append an act and does not re-fold. It pokes the parameter's slot in place via
 * `setValueLive` and announces it with `bumpLive`, and everything downstream —
 * the derived readout, the curve, the claim's verdict — follows through the
 * engine's own graph.
 *
 * That is deliberately the WEAKER half of co-edit. A live poke is not a co-edit
 * act: it leaves no trace in the log, so it is not attributable, not undoable and
 * not something the copilot can see. W2 promotes these into real `SetInputAct`s
 * through `commit`, with `coalesce` collapsing a drag into one act. Until then
 * the slider is labelled for what it is.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Handle, Id } from '@isomat/core';
import type { Workspace } from '@isomat/workspace';
import { fold } from '@isomat/workspace/browser';
import { DEMO_LOG } from './demo-log.js';
import { bumpLive, useLive } from './live.js';
import { ViewOf, isRenderableView } from './views.js';

type Status =
  | { phase: 'folding' }
  | { phase: 'ok'; workspace: Workspace; ms: number }
  | { phase: 'failed'; message: string };

/** A parameter is the interaction-mutable scalar — the thing a user can drag. */
interface ParamLike extends Handle {
  readonly label: string;
  readonly range: readonly [number, number];
  readonly value: number;
  setValueLive(next: number): void;
}

const isParam = (h: Handle): h is ParamLike => h.kind === 'parameter';

function ParamSlider({ param }: { param: ParamLike }) {
  const value = useLive<number>(param) ?? param.value;
  const [lo, hi] = param.range;

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // The interaction path: clamp-and-poke, no timeline step, no act.
      param.setValueLive(Number(e.target.value));
      // A Parameter exposes no subscribable Slot by design, so the bridge's
      // fallback channel is what tells React anything happened. See live.ts.
      bumpLive();
    },
    [param],
  );

  return (
    <label className="param">
      <span className="pname">{param.label}</span>
      <input type="range" min={lo} max={hi} step={0.1} value={value} onChange={onChange} />
      <output>{Number.isInteger(value) ? value : value.toFixed(1)}</output>
    </label>
  );
}

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
            : {
                phase: 'failed',
                message: `act ${out.failure.index} (${out.failure.kind}): ${out.failure.message}`,
              },
        );
      })
      .catch((e: unknown) => {
        if (live) setStatus({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, []);

  if (status.phase === 'folding') {
    return (
      <main>
        <Header />
        <p className="pending">booting QuickJS and folding…</p>
      </main>
    );
  }

  if (status.phase === 'failed') {
    return (
      <main>
        <Header />
        <p className="failed">FAILED — {status.message}</p>
      </main>
    );
  }

  const objects = [...status.workspace.objects.entries()] as Array<[Id, Handle]>;
  const params = objects.map(([, h]) => h).filter(isParam);
  const views = objects.map(([, h]) => h).filter(isRenderableView);

  return (
    <main>
      <Header />

      <section>
        <h2>Inputs</h2>
        {params.map((p) => (
          <ParamSlider key={p.id} param={p} />
        ))}
        <p className="caveat">
          Live poke — <code>setValueLive</code>, no act appended and no re-fold. W2 promotes this
          into a <code>SetInputAct</code> through <code>commit</code>.
        </p>
      </section>

      <section>
        <h2>Workspace</h2>
        <div className="canvas">
          {views.map((v) => (
            <ViewOf key={v.id} handle={v} />
          ))}
        </div>
      </section>

      <footer>
        folded {DEMO_LOG.length} acts &rarr; {status.workspace.objects.size} objects in {status.ms}ms
        <span className="dim">
          {' '}
          · {views.length} views · {params.length} input{params.length === 1 ? '' : 's'}
        </span>
      </footer>
    </main>
  );
}

function Header() {
  return (
    <header>
      <h1>isomat</h1>
      <p className="sub">
        W1 — <code>fold(log)</code> rendered as React components; drag an input and the reactive
        graph carries it.
      </p>
    </header>
  );
}
