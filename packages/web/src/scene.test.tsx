/**
 * scene.test.tsx — the decision-#7 guard, plus the reactive bridge.
 *
 * Phase 2 rebuilds the views as React components. The trap that choice creates
 * is silent, so it gets a test rather than a comment:
 *
 *   `sceneIndex(stage)` builds `Workspace.objects` from `stage.registered` PLUS
 *   `stage.views` and each view's `.elements`. `Workspace.objects` is what every
 *   copilot tool resolves against and what `sceneBrief`/`scopedManifest` scope.
 *   If someone "simplifies" the app by rendering React components INSTEAD of
 *   constructing views, the view handles stop existing, the LLM's addressable
 *   surface silently shrinks, and nothing anywhere throws.
 *
 * So the first test asserts the view handles are in the folded workspace at all.
 * It fails the moment the fold stops constructing views — which is exactly the
 * refactor that would look harmless in review.
 *
 * Folds through `@isomat/workspace/node`: this file is a test, it runs in Node,
 * and the import-boundary fence exempts `*.test.tsx` for precisely this reason.
 * The APP may only reach `@isomat/workspace/browser`.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Handle, Id } from '@isomat/core';
import type { Workspace } from '@isomat/workspace';
import { fold } from '@isomat/workspace/node';
import { DEMO_LOG } from './demo-log.js';
import { bumpLive } from './live.js';
import { ViewOf, isRenderableView } from './views.js';

afterEach(cleanup);

async function foldDemo(): Promise<Workspace> {
  const out = await fold(DEMO_LOG);
  if (!out.ok) throw new Error(`demo log failed to fold: ${out.failure.message}`);
  return out.workspace;
}

const kinds = (ws: Workspace): string[] => [...ws.objects.values()].map((h) => h.kind).sort();

describe('the decision-#7 guard — view models stay in the addressable scene', () => {
  it('the folded workspace contains the VIEW handles, not just the math objects', async () => {
    const ws = await foldDemo();
    const present = new Set(kinds(ws));

    // If this fails, the app has stopped constructing views and the copilot's
    // addressable surface has silently shrunk. Do not "fix" it by deleting the
    // assertion — see the header.
    expect(present.has('view:plot')).toBe(true);
    expect(present.has('view:readout')).toBe(true);
    expect(present.has('view:note')).toBe(true);
  });

  it('a claim registers as an OBJECT with no view — the renderer materialises it', async () => {
    const ws = await foldDemo();
    const present = new Set(kinds(ws));

    // Not an oversight and not a gap to fill: building a ClaimView at authoring
    // time would read `holds` and evaluate the predicate eagerly, and a verdict
    // is deliberately lazy so a throwing predicate is data rather than a crash
    // (scope.ts). React renders the claim object directly. Asserted so nobody
    // later "fixes" the missing view into existence.
    expect(present.has('claim')).toBe(true);
    expect(present.has('view:claim')).toBe(false);
  });

  it('each view also contributes its projected elements to the scene', async () => {
    const ws = await foldDemo();
    // `a@1` (a param) and `y@2` (a derived) are projected BY views as well as
    // registered directly; both must be addressable by their stable ids.
    expect(ws.objects.has('a@1')).toBe(true);
    expect(ws.objects.has('y@2')).toBe(true);
  });

  it('RENDERING does not mutate the workspace — React only reads', async () => {
    const ws = await foldDemo();
    const before = [...ws.objects.keys()].sort();

    const views = [...ws.objects.values()].filter(isRenderableView);
    render(
      <>
        {views.map((v: Handle) => (
          <ViewOf key={v.id} handle={v} />
        ))}
      </>,
    );

    const after = [...ws.objects.keys()].sort();
    expect(after).toEqual(before);
  });
});

describe('the reactive bridge — a live poke reaches the DOM', () => {
  it('setValueLive on a parameter re-renders the dependent readout', async () => {
    const ws = await foldDemo();

    const param = ws.objects.get('a@1' as Id) as unknown as {
      value: number;
      setValueLive(n: number): void;
    };
    const views = [...ws.objects.values()].filter(isRenderableView);
    render(
      <>
        {views.map((v: Handle) => (
          <ViewOf key={v.id} handle={v} />
        ))}
      </>,
    );

    // The log's set-input left a = 3, so the derived y = a² is 9.
    expect(param.value).toBe(3);
    expect(screen.getByText('9')).toBeTruthy();

    // Poke in place — no act, no re-fold. This is the path a drag takes.
    act(() => {
      param.setValueLive(4);
      bumpLive();
    });

    // y must follow through the engine's own graph, into React's output.
    expect(param.value).toBe(4);
    expect(screen.getByText('16')).toBeTruthy();
  });

  it('the claim verdict flips when the poke breaks it', async () => {
    const ws = await foldDemo();
    const param = ws.objects.get('a@1' as Id) as unknown as {
      setValueLive(n: number): void;
    };
    const views = [...ws.objects.values()].filter(isRenderableView);
    render(
      <>
        {views.map((v: Handle) => (
          <ViewOf key={v.id} handle={v} />
        ))}
      </>,
    );

    // The claim is `y = 9`, and a = 3 makes it hold.
    const badge = () => document.querySelector('.claim .badge');
    expect(badge()?.className).toContain('badge-accept');

    act(() => {
      param.setValueLive(1); // y = 1, so the claim breaks
      bumpLive();
    });

    expect(badge()?.className).toContain('badge-reject');
  });

  it('the plot window is FIXED, so changing a parameter visibly changes the curve', async () => {
    const ws = await foldDemo();
    const param = ws.objects.get('a@1' as Id) as unknown as { setValueLive(n: number): void };
    const views = [...ws.objects.values()].filter(isRenderableView);
    render(
      <>
        {views.map((v: Handle) => (
          <ViewOf key={v.id} handle={v} />
        ))}
      </>,
    );

    const path = () => document.querySelector('.plot .curve')?.getAttribute('d') ?? '';
    const atOne = (act(() => (param.setValueLive(1), bumpLive())), path());
    const atFive = (act(() => (param.setValueLive(5), bumpLive())), path());

    // Fitting the y-range to the samples would draw the SAME diagonal for every
    // slope — the parameter's whole effect would vanish exactly when dragged.
    // These must differ. See the window comment in views.tsx.
    expect(atOne).not.toEqual('');
    expect(atFive).not.toEqual(atOne);
  });

  it('evidence type is rendered, so a verdict can never read as a bare proof', async () => {
    const ws = await foldDemo();
    const views = [...ws.objects.values()].filter(isRenderableView);
    render(
      <>
        {views.map((v: Handle) => (
          <ViewOf key={v.id} handle={v} />
        ))}
      </>,
    );

    // Two live numerics compared → exact-comparison, and it must be on screen.
    const evidence = document.querySelector('.claim .evidence');
    expect(evidence?.textContent).toContain('exact-comparison');
  });
});
