import { describe, expect, it } from 'vitest';
import { normalizeQuery } from '../src/normalize-query.ts';

// The analyzer is the real one; a Korean row below pins what its tags produce under the
// normalization rules, so the analyzer's own splitting (`워크트리` → `워크` + `트리`) is part of
// what each row defends against.

describe('normalizeQuery', () => {
  // Each row is a rule a lookalike implementation breaks: a particle left on (`cognee를`), an
  // interrogative kept (`어떻`, `얼마`), an adverb kept (`왜`, `다시`), a bound noun kept (`것`),
  // a numeral joined to the run (`복구하나요` is `복구` · `하나` · `요`), a stem run cut short
  // (`디스패치`), a suffix left out of the run (`판정기는` is `판정` · `기` · `는`), a one-character
  // run kept (`된다` is `되` · `ㄴ다`), a punctuation mark left on the identifier.
  it.each([
    ['왜 cognee를 제거했나', ['cognee', '제거']],
    ['세션이 잠기면 어떻게 복구하나요', ['세션', '잠기', '복구']],
    ['COVENANT-14가 도입한 것은?', ['COVENANT-14', '도입']],
    ['통합 디스패치는 왜 필요했나', ['통합', '디스패치', '필요']],
    ['얼마 다시', []],
    ['판정기는', ['판정기']],
    ['된다', []],
    ['잠김을', ['잠김']],
    ['설정됨을', ['설정됨']],
    ['훅을 어떻게 고치나', ['훅', '고치']],
    ['`--delete`를', ['--delete']],
    ['디스패치(W1)의', ['디스패치', 'W1']],
    ['field·filter로', ['field', 'filter']],
    ['`세션이` (잠기면)', ['세션', '잠기']],
  ])('%s → %j', async (query, expected) => {
    await expect(normalizeQuery(query)).resolves.toEqual(expected);
  });

  // The analyzer splits every one of these into two morphemes; a normalization that hands
  // the analyzer's output back for a particle-free word answers the halves, which the
  // index matches on far more sections than the compound.
  it.each([
    ['워크트리', ['워크트리']],
    ['알림', ['알림']],
    ['판정기', ['판정기']],
  ])('keeps a particle-free Hangul word verbatim: %s', async (query, expected) => {
    await expect(normalizeQuery(query)).resolves.toEqual(expected);
  });

  // `why`, `did`, `the` are function words whatever their case; a single letter is one too.
  // A kept word keeps its case and its ending: the index ignores case, and a changed case or
  // a cut ending would move an unchanged query off the literal path.
  it.each([
    ["Why did the adapter's typecheck stay green", ['adapter', 'typecheck', 'stay', 'green']],
    ['Drift', ['Drift']],
    ['drifted', ['drifted']],
    ['PRD MRR', ['PRD', 'MRR']],
    ["agents'", ['agents']],
    ['green? (cognee) `pdks` drift,', ['green', 'cognee', 'pdks', 'drift']],
  ])('%s → %j', async (query, expected) => {
    await expect(normalizeQuery(query)).resolves.toEqual(expected);
  });

  // An identifier query must come back unchanged to stay on the literal path; a
  // normalization that lowercases (`issue-63b`) or cuts an ending (`search-memory.t`) moves it.
  it.each([
    ['ISSUE-63b', ['ISSUE-63b']],
    ['search-memory.ts', ['search-memory.ts']],
    ['T260901', ['T260901']],
    ['.polydeukes', ['.polydeukes']],
    ['packages/memory의 구조', ['packages/memory', '구조']],
    ['foo_bar의', ['foo_bar']],
    ['.claude/rules를', ['.claude/rules']],
    ['searchMemory', ['searchMemory']],
  ])('keeps an identifier verbatim: %s', async (query, expected) => {
    await expect(normalizeQuery(query)).resolves.toEqual(expected);
  });

  // Two words that normalize to one count once, in first-seen order; a Set built before
  // normalizing keeps both spellings, and one built from a sorted list reorders them.
  it('drops a duplicate after normalization and keeps first-seen order', async () => {
    await expect(normalizeQuery("snapshot adapter's adapter snapshot")).resolves.toEqual([
      'snapshot',
      'adapter',
    ]);
  });

  // The literal path is chosen by comparing this list with the whitespace split, so a
  // normalization that trims, reorders, or re-cases a query it does not change would send
  // every identifier query down the union path.
  it('returns the whitespace split unchanged for a query normalization does not touch', async () => {
    const query = 'T-260901 MQ-568 판정기';
    await expect(normalizeQuery(query)).resolves.toEqual(query.split(' '));
  });
});
