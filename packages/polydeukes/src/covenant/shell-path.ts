import type { SimpleCommand } from './bash-line.ts';
import { pathCandidates, pathMatchesProtected } from './mention.ts';
import { commandBasename } from './mutation-rules.ts';

/** Resolve a shell path against its project-relative working directory without reading disk. */
export function shellPath(path: string, cwd: string | undefined): string {
  return path.startsWith('/') || cwd === undefined || cwd === '.' ? path : `${cwd}/${path}`;
}

/** The command head and literal output arguments do not name cwd-relative files. */
export function shellWordCwd(
  command: SimpleCommand,
  index: number,
  cwd: string | undefined,
): string | undefined {
  const head = command.words[0];
  return index === 0 || (head !== undefined && ['echo', 'printf'].includes(commandBasename(head)))
    ? undefined
    : cwd;
}

/** Compare a shell token's path candidates in the supplied directory. */
export function mentionsShellPath(value: string, path: string, cwd: string | undefined): boolean {
  return pathCandidates(value).some((candidate) =>
    pathMatchesProtected(shellPath(candidate, cwd), path),
  );
}
