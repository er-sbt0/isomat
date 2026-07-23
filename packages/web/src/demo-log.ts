/**
 * demo-log.ts — a hand-built co-edit log, the app's W0 fixture.
 *
 * Lifted from `workspace/src/fold.sandbox.test.ts` deliberately: it is a log
 * already PROVEN to fold under Node, so when the browser folds it to the same
 * ids we have isolated the one variable W0 is testing — the runtime — rather
 * than debugging a new fixture and a new environment at once.
 *
 * It exercises the symmetric log both authors write to: the user introduces a
 * draggable parameter, the copilot reaches it back BY ID and builds on it, and
 * the user drags. Three acts, two authors, one workspace.
 */

import type { WorkspaceAct, WorkspaceLog } from '@isomat/workspace';

/**
 * introduce: mint the draggable parameter `a` with the EXPLICIT stable id `a@1`.
 * No `expose`/`show` — the native surface auto-registers on construction.
 */
const INTRODUCE_A: WorkspaceAct = {
  kind: 'introduce',
  by: 'user',
  turn: 1,
  id: 'a@1',
  at: { x: 120, y: 240 },
  source: 'introduce a = 2',
  js: 'const a = param("a", 2, { range: [-5, 5], id: "a@1" });',
};

/** author: reach `a` back by id, derive y = a² (stable id `y@2`), plot f(x) = a·x. */
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

/** set-input: the user drags `a` to 3. `y` must follow to 9 through the graph. */
const SET_A_TO_3: WorkspaceAct = {
  kind: 'set-input',
  by: 'user',
  turn: 3,
  target: 'a@1',
  value: 3,
};

export const DEMO_LOG: WorkspaceLog = [INTRODUCE_A, AUTHOR_Y, SET_A_TO_3];
