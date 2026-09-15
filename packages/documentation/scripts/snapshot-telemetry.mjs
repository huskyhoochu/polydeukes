/**
 * Summarizes this repository's telemetry log into a committed snapshot.
 *
 * `.polydeukes/roi.log` is local and gitignored, so a deployment build cannot read it.
 * This script is run by a maintainer whose working copy has the log; it writes the few
 * figures the landing page states into `src/data/telemetry.json`, which is committed and
 * is what the page reads. Rerun it to refresh the published figures.
 *
 *     node scripts/snapshot-telemetry.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, '../../../.polydeukes/roi.log');
const OUT = join(HERE, '../src/data/telemetry.json');

/** Verdicts that stopped or altered a call; a pass is the absence of an event. */
const INTERRUPTING = new Set(['blocked', 'advised', 'witnessed']);

const raw = await readFile(LOG, 'utf8').catch(() => {
  throw new Error(`No telemetry log at ${LOG}. Run this from a working copy that has one.`);
});

const counts = new Map();
const days = new Set();
const disciplines = new Set();
const recent = [];
let total = 0;

for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const [at, verdict, discipline, path] = line.split('\t');
  if (!verdict) continue;
  total += 1;
  counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  days.add(at.slice(0, 10));
  if (discipline) disciplines.add(discipline);
  if (INTERRUPTING.has(verdict)) {
    recent.push({ at, verdict, discipline, path: path && path !== '-' ? path : null });
  }
}

const blocked = counts.get('blocked') ?? 0;
const witnessed = counts.get('witnessed') ?? 0;
const advised = counts.get('advised') ?? 0;

const snapshot = {
  capturedAt: new Date().toISOString().slice(0, 10),
  total,
  days: days.size,
  disciplines: disciplines.size,
  // What a reader actually needs: how often the framework stops the work, and how often
  // a stop was opened again. The raw total answers no question a visitor is asking.
  stopped: blocked,
  stoppedShare: Number(((blocked / total) * 100).toFixed(2)),
  witnessed,
  witnessedShare: blocked ? Number(((witnessed / blocked) * 100).toFixed(1)) : 0,
  advised,
  recent: recent.slice(-6).reverse(),
  // A longer sample, for the hero's scrolling column of real verdicts.
  sample: recent
    .slice(-40)
    .reverse()
    .map(({ at, verdict, discipline, path }) => ({
      t: at.slice(11, 19),
      v: verdict,
      d: discipline,
      p: path,
    })),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(
  `wrote ${OUT}: ${total} judgments, ${blocked} stopped (${snapshot.stoppedShare}%), ` +
    `${witnessed} reopened by a witness`,
);
