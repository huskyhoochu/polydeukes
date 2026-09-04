/**
 * @polydeukes/adapter-claude-code — up-translates Claude Code PreToolUse hook
 * payloads into the agent-neutral covenant input IR.
 *
 * Pre-alpha. Translation plus this surface's supply bodies — the readers a composition root
 * injects, which open files and spawn nothing. Agent and tool literals live here by design:
 * this package is the boundary where Claude Code's vocabulary is translated away before it
 * reaches the core.
 */

export { type EvaluatePrecedentSpec, evaluatePrecedent } from './precedent.js';
export {
  type AdapterPathOutcome,
  type DispatchAdapterView,
  type RunAdapterPathSpec,
  runAdapterPath,
} from './run-adapter-path.js';
export {
  type SessionChannelReaderSpec,
  sessionChannelReader,
} from './session-channel-reader.js';
export { type SessionSourceReaderSpec, sessionSourceReader } from './session-source-reader.js';
export {
  COMMAND_ARGS,
  MUTATING_TOOLS,
  SHELL_TOOLS,
  type TranscriptPathFromPayloadSpec,
  transcriptPathFromPayload,
} from './session-vocabulary.js';
export { type TranscriptFromJsonlFileSpec, transcriptFromJsonlFile } from './transcript.js';
