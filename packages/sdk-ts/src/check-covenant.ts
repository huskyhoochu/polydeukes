import type { CovenantInput } from './ir.ts';
import { failureReason, type ProcessSpec, runProcess } from './process.ts';

/** Judge a caller-built input with a separately installed pdks executable. */
export type CheckCovenantSpec = ProcessSpec & {
  repoRoot: string;
  input: CovenantInput;
  enforce?: 'advise' | 'block';
  configLayer?: string;
  telemetryPath?: string;
};
/** A judgment or an explicit failure to obtain one. */
export type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };

/** Execute the covenant command shared by IR and diff judgments. */
export async function runCheck(
  spec: ProcessSpec & {
    repoRoot: string;
    diffMode: boolean;
    enforce?: 'advise' | 'block';
    configLayer?: string;
    telemetryPath?: string;
    stdin: () => string;
  },
): Promise<CheckCovenantVerdict> {
  try {
    const { status, stderr } = await runProcess({
      ...spec,
      root: spec.repoRoot,
      args: [
        'covenant',
        'check',
        ...(spec.diffMode ? ['--diff'] : []),
        '--enforce',
        spec.enforce ?? 'block',
        ...(spec.configLayer === undefined ? [] : ['--config-layer', spec.configLayer]),
        ...(spec.telemetryPath === undefined ? [] : ['--telemetry-path', spec.telemetryPath]),
      ],
      stdin: () => new TextEncoder().encode(spec.stdin()),
    });
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(stderr);
    if (status === 0) return { verdict: 'upheld', advisories: text };
    if (status === 2) return { verdict: 'blocked', reason: text };
    return {
      verdict: 'unjudged',
      reason:
        status === null
          ? 'the judge was killed by a signal'
          : text || `the judge exited with status ${status} instead of a verdict`,
    };
  } catch (error) {
    return { verdict: 'unjudged', reason: failureReason(error) };
  }
}

/** Send input unchanged as UTF-8 JSON and return the CLI verdict. */
export async function checkCovenant(spec: CheckCovenantSpec): Promise<CheckCovenantVerdict> {
  return runCheck({
    ...spec,
    diffMode: false,
    stdin: () =>
      JSON.stringify(spec.input, (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value))
          throw new Error('input contains a non-finite JSON number');
        return value;
      }),
  });
}
