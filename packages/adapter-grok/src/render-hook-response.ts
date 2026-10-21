/** The host exit status and optional refusal diagnostic. */
export type RenderHookResponseSpec = { exitCode: 0 | 2; reason?: string };
/** The status and streams delivered to the host. */
export type RenderHookResponseOutcome = { exitCode: 0 | 2; stdout: string; stderr: string };
/** Render the host's response to a completed hook invocation. */
export function renderHookResponse(spec: RenderHookResponseSpec): RenderHookResponseOutcome {
  return {
    exitCode: spec.exitCode,
    stdout: `${JSON.stringify({ decision: spec.exitCode === 0 ? 'allow' : 'deny', ...(spec.reason === undefined ? {} : { reason: spec.reason }) })}\n`,
    stderr: '',
  };
}
