"""Build en-ko.tsv, the English-to-Korean word list pdks-memory search embeds.

usage: python3 en-ko.py <kaikki.org-dictionary-Korean.jsonl> > en-ko.tsv

The input is kaikki.org's extract of the English Wiktionary's Korean entries. Each Korean headword
whose English gloss is one word becomes a translation of that word: a verb or
adjective is cut to the stem the documents also carry (구매하다 -> 구매), translations shorter than
two syllables are dropped because a one-syllable word matches inside almost every Korean text, and
each English word keeps its first three translations in entry order. Search splits a query at
whitespace, so a key holding a space would never be looked up.
"""

import json
import re
import sys

HANGUL = re.compile(r"^[가-힣]+$")
ENGLISH = re.compile(r"[a-z][a-z \-']*")
POS = {"noun", "verb", "adj", "adv", "name"}
KEEP = 3


def stem(word, pos):
    if pos not in ("verb", "adj"):
        return word
    if not word.endswith("다"):
        return None
    word = word[:-1]
    if word.endswith("하") and len(word) >= 3:
        word = word[:-1]
    return word


def main():
    table = {}
    with open(sys.argv[1], encoding="utf-8") as source:
        for line in source:
            entry = json.loads(line)
            pos = entry.get("pos")
            word = entry.get("word", "")
            if pos not in POS or not HANGUL.match(word):
                continue
            korean = stem(word, pos)
            if korean is None or len(korean) < 2:
                continue
            for sense in entry.get("senses", []):
                for gloss in sense.get("glosses", []):
                    for part in re.split(r"[;,]", re.sub(r"\([^)]*\)", "", gloss)):
                        english = re.sub(r"^(to|a|an|the) ", "", part.strip().lower())
                        if not ENGLISH.fullmatch(english) or " " in english:
                            continue
                        found = table.setdefault(english, [])
                        if korean not in found and len(found) < KEEP:
                            found.append(korean)
    for english in sorted(table):
        sys.stdout.write("\t".join([english, *table[english]]) + "\n")


main()
