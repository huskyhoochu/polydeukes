/** The host exit status and optional judgment diagnostic. */
export type RenderHookResponseSpec = { exitCode: 0 | 2; reason?: string };
/** The status and streams delivered to the host. */
export type RenderHookResponseOutcome = { exitCode: 0 | 2; stdout: string; stderr: string };
/** Render the host's response to a completed hook invocation. */
export function renderHookResponse(spec: RenderHookResponseSpec): RenderHookResponseOutcome {
  return {
    exitCode: spec.exitCode,
    stdout: '',
    stderr: spec.reason ? `${spec.reason}\n` : '',
  };
}
