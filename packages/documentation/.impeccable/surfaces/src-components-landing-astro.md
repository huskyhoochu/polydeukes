---
version: 1
slug: "src-components-landing-astro"
primary_target: "src/components/Landing.astro"
related_targets: ["src/pages/index.astro", "src/pages/ko/index.astro"]
---

# Landing page (`/` and `/ko/`)

Scope: the two landing routes rendered by `src/components/Landing.astro`. Mode: Persuade.

Audience and job: a developer working with an AI coding agent who wants to know in one look what
this tool is. Success is understanding the category first, then copying the install command or
opening a recipe.

Proof on the page: two real judged calls read from the conformance fixtures at build time (one
advised, one blocked), three recipes, the install commands from the install guide.

Constraints: English and Korean have the same structure; light and dark themes; the twin-profile
logo appears in the header only; no animated illustration; nothing that reads as a security product
or a stock SaaS page; low-chroma palette (the owner found the first saturated palette tiring).

Unresolved: the owner has not yet confirmed the softened palette; hero copy is a draft the owner
will revise on the real page; the Korean display face.

## Direction contract

THESIS: The page is one star atlas plate. The Gemini figure is drawn at its real coordinates:
Castor's chain is what the agent called, Pollux's chain is the ruling on each call. It refuses the
split hero with a code box beside the headline.

OWN-WORLD: Ink-navy sky `#121b2b`, warm off-white ink `#e6e1d3`, slate grid lines `#26344d`, ochre
`#d6a85a` for advised, clay `#d9806b` for blocked; the light theme is the exact inverse, navy ink on
paper. Curved coordinate lines with right-ascension and declination ticks, stars sized by magnitude,
italic Greek designations, a faint star field. Serif display, grotesque text, mono for commands and
output. Index tables ruled in hairlines stand where cards would.

STORY: The visitor reads the headline, sees two stars marked advised and blocked, reads the two
index entries with the real output, then copies the install command or opens a recipe.

FIRST VIEWPORT: The sky fills the viewport edge to edge. Headline, lede and the install command sit
top left in a column about 600px wide, kept clear of grid lines and ticks. The constellation spans
the right two thirds. A two-cell index along the bottom edge carries the two calls and their output.
The primary action is the install command under the lede.

FORM: Star atlas, open sky variant; position 6 of the third list, developed with the owner over two
further rounds. seed:0bed1d34bed2fefb. Signature interaction: focusing or hovering an index entry
lights its star and its chain. Ambient motion, chosen by the owner (2026-11-13): faint stars
brighten now and then in groups, and the chart's three layers (stars, grid, figure) shift by
different amounts with the pointer and with scrolling; both stop under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance
