/** Generated from core JSON Schema. Run scripts/generate-types.mjs to regenerate. */

/**
 * One file's mutation evidence around the judged call, discriminated by `kind`. `delete.pre` is the text baseline when one exists, absent for a binary blob.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "FileChange".
 */
export type FileChange =
  | {
      kind: 'create';
      path: string;
      post: string;
    }
  | {
      kind: 'modify';
      path: string;
      pre: string;
      post: string;
    }
  | {
      kind: 'delete';
      path: string;
      pre?: string;
    };

/**
 * The input a host sends to `pdks covenant check` on stdin. Any document this schema accepts, the command reads without refusing; `world` is absent because the command fills that axis itself.
 */
export interface CovenantInput {
  /**
   * The judged tool calls, each carrying its own file-change evidence when the adapter has it.
   */
  toolCalls: ToolCall[];
  /**
   * The subagents the observed turn spawned.
   */
  subagentSpawns: SubagentSpawn[];
  /**
   * The user messages the observed turn carries.
   */
  userMessages: UserMessage[];
  actor?: Actor;
  tools?: Tools;
  session?: Session;
}
/**
 * One tool call; an absent `fileChange` means the call is unproven, and no sibling call's evidence stands in for it.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "ToolCall".
 */
export interface ToolCall {
  /**
   * The tool name the host reports.
   */
  name: string;
  /**
   * The call's arguments as the host passed them.
   */
  args?: {
    [k: string]: unknown;
  };
  fileChange?: FileChange;
  /**
   * Project-relative shell working directory; absence means the project root.
   */
  cwd?: string;
}
/**
 * One subagent spawn; `kind` is the subagent name the adapter fills in.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "SubagentSpawn".
 */
export interface SubagentSpawn {
  kind: string;
}
/**
 * One user message's text.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "UserMessage".
 */
export interface UserMessage {
  text: string;
}
/**
 * Who made the observation. `agentType` is the subagent kind when the call comes from one; the empty object is the main session.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "Actor".
 */
export interface Actor {
  agentType?: string;
}
/**
 * The host's tool roster: `mutating` names the tools whose calls change a file, `shell` the ones carrying a command line, and `commandArgs` the argument keys that command line travels in. A non-empty `shell` needs a non-empty `commandArgs`, since a shell call's command line is read from those keys.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "Tools".
 */
export interface Tools {
  mutating: string[];
  shell: string[];
  commandArgs: string[];
}
/**
 * The evidence a live agent session carries that the repository's disk does not. A session whose lists are empty is a host that named its evidence and could not deliver it.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "Session".
 */
export interface Session {
  /**
   * Where the session evidence was read from.
   */
  evidencePath?: string;
  userMessages: SessionUserMessage[];
  toolCalls: SessionToolCall[];
  channels?: Channels;
}
/**
 * One session user message, with the time it was sent when the session proves it.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "SessionUserMessage".
 */
export interface SessionUserMessage {
  text: string;
  /**
   * Milliseconds since the Unix epoch.
   */
  timestampMs?: number;
}
/**
 * One session tool call, with its outcome when the session proves it.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "SessionToolCall".
 */
export interface SessionToolCall {
  name: string;
  args?: {
    [k: string]: unknown;
  };
  succeeded?: boolean;
}
/**
 * Evidence channel texts by kind. `sidecar` is the spawn-record list as JSON text: `'[]'` says the channel observed no spawn, an absent key says there is no channel.
 *
 * This interface was referenced by `CovenantInput`'s JSON-Schema
 * via the `definition` "Channels".
 */
export interface Channels {
  sidecar?: string;
}
