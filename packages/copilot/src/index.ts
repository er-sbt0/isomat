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
 * M2b (next) adds the loop driver + intent classifier + a `ModelClient` seam
 * around this executor. The tools themselves throw nothing across the boundary,
 * so the loop reads every outcome — success or typed error — as data.
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
