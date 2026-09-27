import type { AnalyzeResult, Garu } from 'garu-ko';

// A leading `.` stays: it starts a path such as `.claude/rules` or `.gitignore`.
const PUNCTUATION = /^[`'"()[\]{}<>?,!:;]+|[`'"()[\]{}<>?,.!:;]+$/gu;
const HANGUL = /\p{Script=Hangul}/u;
const ENDING = new Set(['EP', 'EF', 'EC', 'ETM']);
// `NR` stays out: the analyzer splits `복구하나요` into `복구` · `하나`/NR · `요`, and a numeral
// joined to the run would turn it into `복구하나`, which no document holds.
const CONTENT = new Set(['NNG', 'NNP', 'SL', 'SH', 'SN', 'XR', 'XSN', 'XPN', 'VV', 'VA']);
const INTERROGATIVES = new Set(['어떻', '얼마', '어디', '언제', '무엇', '누구', '뭔']);
const STOPWORDS = new Set(
  (
    'a an the and or of to in on at by for from with without about into is are was were be been ' +
    'being do does did done have has had i you we they it this that these those what which who ' +
    'whom whose when where why how should would could can will shall may might must not no my ' +
    'our your their its there than then so if as while still let lets'
  ).split(' '),
);

let analyzer: Promise<Garu> | undefined;

function loadAnalyzer(): Promise<Garu> {
  analyzer ??= (async () => {
    const { Garu } = await import('garu-ko');
    // The Node loader calls its WASM init in a deprecated form and warns on every load. Other
    // code can run across the load's awaits, so only that one message is dropped.
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (!String(args[0]).startsWith('using deprecated parameters')) warn(...args);
    };
    try {
      return await Garu.load();
    } finally {
      console.warn = warn;
    }
  })();
  return analyzer;
}

function wordTerms(garu: Garu | undefined, raw: string): string[] {
  const word = raw.replace(PUNCTUATION, '');
  if (!garu || !HANGUL.test(word)) {
    // `·` joins a list inside one word (`field·filter`), so each part is a word of its own.
    return word.split('·').flatMap((part) => {
      const bare = part.replace(/'s?$/u, '');
      return [...bare].length > 1 && !STOPWORDS.has(bare.toLowerCase()) ? [bare] : [];
    });
  }
  const { tokens } = garu.analyze(word) as AnalyzeResult;
  // A particle is spelled as the analyzer returns it, so it comes off the end of the word as
  // written and the rest is read again. Rebuilding the word from tokens would split
  // `packages/memory의` at `/` and turn `잠김을` into `잠기`, which no document holds.
  const last = tokens.at(-1);
  if (last?.pos.startsWith('J') && word.length > last.text.length && word.endsWith(last.text)) {
    return wordTerms(garu, word.slice(0, -last.text.length));
  }
  const hasContent = tokens.some((token) => CONTENT.has(token.pos));
  // A word with no particle, ending, or symbol stays whole: the analyzer splits compounds such
  // as `워크트리` into halves the index matches in far more sections than the compound. A
  // symbol (`디스패치(W1)`) still splits the word at that symbol.
  const whole = !tokens.some(
    (token) =>
      token.pos.startsWith('J') ||
      ENDING.has(token.pos) ||
      (token.pos.startsWith('S') && !CONTENT.has(token.pos)),
  );
  if (whole) {
    return hasContent && !INTERROGATIVES.has(word) ? [word] : [];
  }
  const runs: string[] = [];
  let run = '';
  for (const token of [...tokens, undefined]) {
    if (token && CONTENT.has(token.pos)) {
      run += token.text;
      continue;
    }
    if ([...run].length >= 2 && !INTERROGATIVES.has(run)) runs.push(run);
    run = '';
  }
  return runs;
}

/**
 * Splits a query on whitespace and reduces each word to the text a document would hold:
 * Korean words lose their particles and endings, English words their possessive, and
 * function words drop out. English words keep their case and ending so an identifier query
 * comes back unchanged.
 */
export async function normalizeQuery(query: string): Promise<string[]> {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  const garu = words.some((word) => HANGUL.test(word)) ? await loadAnalyzer() : undefined;
  const terms: string[] = [];
  for (const raw of words) terms.push(...wordTerms(garu, raw));
  return [...new Set(terms)];
}
