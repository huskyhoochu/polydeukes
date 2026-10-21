---
paths:
  - "polydeukes.config.yaml"
  - "polydeukes.config.yml"
  - "polydeukes.config.json"
  - ".claude/**"
---

# Polydeukes — query the installed docs

This project is judged by Polydeukes, and the matching documentation ships inside the
installed package. `pdks docs` answers offline, from the same version that does the
judging; a web search answers from whichever release it indexed.

Run `pdks docs` for the topic list, `pdks docs <topic>` for topic content,
`pdks docs search "locale key pairing"` to find a section, or
`pdks docs show write-disciplines` to retrieve the guide. Add `--lang ko` for Korean.

A local install puts the bin in `node_modules/.bin`, which a plain shell does not have on
PATH. If `pdks` is not found, run `./node_modules/.bin/pdks docs <topic>` — or your package
manager's exec form — from the project root.

| Before you | Run |
| --- | --- |
| install Polydeukes, or wire another surface into this project | `pdks docs install` |
| edit `polydeukes.config.*` — every key and what reads it | `pdks docs config` |
| add or change a `disciplines` entry | `pdks docs discipline` |
| explain a verdict, or why a surface failed closed | `pdks docs covenant` |
| open a blocked call in person | `pdks docs witness` |
