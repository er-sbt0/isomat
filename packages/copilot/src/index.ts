/**
 * @isomat/copilot — the workspace as an instrument (roadmap M2).
 *
 * The 4c tool loop, retargeted onto the co-edit workspace. M2a lifts the tool
 * executor out of `@isomat/sandbox` (where it was parked against the superseded
 * `ConversationLog`) and re-points it at `@isomat/workspace`: a typed tool call
 * resolves against `Workspace.objects`, experiments through the disposable
 * `commit` transaction, and a committed write lands a real authorship-tagged
 * `SetInputAct` / `AuthorAct`. This is where "4c dark → live" is paid — the
 * executor ↔ workspace seam.
 *
 * M2b adds the loop around this executor: `runTurn` (the headless co-edit turn),
 * an intent-classifier fast-path, a scene brief, and the `ModelClient` seam with
 * a free `ScriptedClient` fake. The tools themselves throw nothing across the
 * boundary, so the loop reads every outcome — success or typed error — as data.
 */

export {
  inspect,
  evalAt,
  whyChanged,
  counterfactual,
  bisectFlip,
  setInput,
  appendFragment,
  runTool,
} from './tools.js';
export type {
  Json,
  ToolCall,
  ToolResult,
  ToolError,
  ToolErrorCode,
  ToolHooks,
  ToolOutcome,
  SceneMap,
  SetSpec,
  Attribution,
  CompileFragment,
  WhyChangedEntry,
  WriteOutcome,
} from './tools.js';

// ── M2b: the loop ──
export { runTurn } from './turn.js';
export type { TurnOutcome, ManipulatedOutcome, AgenticOutcome, TurnStep, TurnDeps } from './turn.js';
export { classify } from './classify.js';
export type { Manipulation } from './classify.js';
export { sceneBrief, scopedManifest } from './brief.js';
export { ScriptedClient, SYSTEM_PROMPT, TOOL_SPECS } from './client.js';
export type {
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelMessage,
  ToolSpec,
  ToolResultMsg,
  Evidence,
} from './client.js';
