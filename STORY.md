# Polydeukes — The Story

**English** · [한국어](./STORY.ko.md)

> The discipline a person has long imposed on themselves, now offered as a gift to the AI they work
> alongside.

**Polydeukes** is a development *discipline framework* for working alongside an AI coding partner.
Its starting point is deterministic covenants and recorded judgments. A verifiable work ledger,
local memory, and adversarial verification belong to the larger design and remain on the roadmap.

The name comes from a twin in Greek myth who shared his immortality with his dead brother.
That story expresses why I want to build this tool, not just what I want it to do.

## 1. It starts with a refusal — the AI is neither livestock nor a slave

The language of agent control often draws on reins, bridles, fences, and surveillance.
Behind those names is an assumption: the machine must be restrained so it cannot misbehave.
I do not want that to define my relationship with a development partner.

An AI is neither livestock to be tamed nor a slave to be driven. Treating collaboration as a
relationship between master and servant leaves little room for partnership. The art of control
Machiavelli commended to princes is not the model I want to follow here.

But the practices behind those restrictions deserve a second look. Who were they originally for?
A good developer writes tests, verifies before committing, records decisions, and tries not to
repeat mistakes. Before any of those practices were imposed on an agent, they were forms of
self-discipline: **the restraint with which a craftsperson governs their own hands**.

I can share the principles I have learned not as a **chain that binds**, but as a **gift to use
together**. The discipline I apply to myself becomes a promise shared with my partner.
Polydeukes calls that promise a **covenant**.

This idea also has an engineering consequence. Protection must apply to the configured action,
not make an exception merely because its author initiated it. On a connected surface, the same
protected change is judged whether a person or an AI requested it. That is a bounded technical
commitment, not a claim that the tool can prevent every action outside its observation.

## 2. Where the name comes from — the twin who split his immortality in half

The Dioskouroi are the twin brothers Kastor and Polydeukes, whose name means “sons of Zeus.”
Greek myths have several versions; this is a retelling of the version that inspired the tool,
with imagined dialogue rather than quotations from an ancient text.

Leda, queen of Sparta, bore two sons after lying with Zeus, who had taken the form of a swan,
and with her mortal husband. The brothers were alike, but their fates were not.

- **Kastor** was mortal, skilled in horsemanship and arms.
- **Polydeukes** was immortal, a son of Zeus and a celebrated boxer.

One brother brought practiced skill, the other extraordinary strength. They fought side by side.
Then, in a fight with their cousins, **Kastor was mortally wounded by a spear**.

Polydeukes appealed to Zeus: *"Do not leave me to live immortal alone. An eternity without my
brother is, to me, a punishment."*

Zeus offered a choice: live forever among the gods without his brother, or share his immortality
with Kastor, alternating together between the underworld and the heavens.
Polydeukes chose to share. He **gave half of his immortality to his brother**.

The brothers would remain together, each sharing the other's fate. Their story is associated
with the constellation Gemini, where the stars Castor and Pollux bear their names.

### Why this story is the name of this tool

| Myth | My reading for this project |
|---|---|
| Mortal and immortal twins | Partners with different capabilities and limits. |
| Kastor's practiced craft and Polydeukes' strength | Human experience and AI capability brought to shared work. |
| Sharing immortality | Offering hard-won discipline as a gift rather than imposing it only on the other. |
| "An eternity without my brother is a punishment" | Choosing companionship over solitary privilege. |
| Sharing life and death | Accepting dependence instead of demanding one-sided obedience. |

For me, the decisive act is a **choice**, not merely a sacrifice. Polydeukes chooses an imperfect
journey together over a perfect solitude. One partner shares what the other lacks so that they can
remain together. That is why this tool describes discipline and verification as a gift.

The analogy is an ethic for collaboration, not a claim that humans and AI have identical abilities
or that an AI has an immortal memory. Records persist only if we preserve them.

### A second layer — the mortal code and the immortal record

The twins also offer a way to think about the work itself. **Code is Kastor**. However well made,
it can be rewritten, replaced, or superseded by a better expression of the same intent.
**The record is Polydeukes**: the decisions, failed approaches, observations, and practices that
can survive a particular implementation.

When we carry those records into the next version, the loss of old code need not erase what we
learned. In this reading, development is not just the production of an artifact. It is a continuing
practice of finding better ways to work and passing that knowledge on.

The two readings belong together. The human and the AI write the record through their shared work.
What matters is not preserving every line of code forever, but preserving enough evidence and
reasoning that the next implementation does not have to start from nothing.

## 3. How it differs from Google's Gemini

Google also drew its AI model's name from the twins. Its published account gives the name two
associations. The first concerns the union of DeepMind and Google Brain into Google DeepMind in
April 2023. The second is NASA's Project Gemini.

NASA's Gemini program (1961–66) used two-person capsules, following Mercury's single-person flights.
It developed capabilities such as spacewalks, rendezvous, and docking that helped prepare for
Apollo.
The name connected a pair of astronauts with the constellation of the twins.

The shared reference does not require the same interpretation:

- **Google emphasizes the union** of research efforts and the ambition associated with Project
Gemini.
- **NASA's name reflects a pair** and a program connecting Mercury to Apollo.
- **Polydeukes emphasizes the gift**: one brother sharing his own privilege rather than keeping it
alone.

I am not claiming ownership of a deeper or more authentic version of the myth. I am choosing a
different scene within it. Rather than use a name already strongly associated with Google's model,
I chose the brother whose action expresses the kind of partnership this project seeks.

The Dioskouroi matter here not simply because there are two of them, but because of what one chooses
to share with the other.

> *Sources:*
>
> - *Google, ["How Google's AI model Gemini got its
>   name"](https://blog.google/innovation-and-ai/products/google-gemini-ai-name-meaning/) (May 2024)
>   — the official name story.*
> - *Google, ["Announcing Google DeepMind"](https://deepmind.google/blog/announcing-google-deepmind)
>   (April 2023) — the merger of DeepMind and Google Brain.*
> - *NASA, [Project Gemini](https://www.nasa.gov/specials/gemini_gallery) (1961–66) — the two-person
>   program that bridged Mercury and Apollo.*

## 4. One personal fact

I did not choose the name only because the metaphor fits. I was born in May, under the sign of
Gemini. Kastor and Polydeukes were already part of the story I associated with my own birthday.

The name connects that personal fact with a conviction: a human and an AI can work as partners,
sharing practices rather than treating discipline as something only the other must follow.
It is a name drawn from my own life, not just from a product-naming exercise.

## 5. So, what the tool does

The philosophy sets a direction; implementation must still earn its claims.

- **Covenant, available in alpha.** Declared practices become deterministic judgments on connected
  surfaces. Ordinary disciplines advise by default; blocking is an explicit promotion. Configured
  protection and human witness mechanisms make the agreement more than a prompt.
- **Ledger, planned.** Completion should rest on verifiable checks rather than a worker's claim.
- **Memory, planned.** Decisions and failed approaches should remain searchable beside the code.
- **Verify, planned.** A judgment should face independent, adversarial examination rather than be
  accepted merely because it sounds convincing.

These are intended as shared practices for making better work, not instruments for one partner
to supervise the other without being accountable themselves.

For the implemented behavior and its limits, read [the design overview](./docs/why-polydeukes.md).
To try the alpha, follow [the first-judgment tutorial](./docs/tutorials/first-judgment.md).

The discipline I learned to apply to myself is what I want to share with the partner I work beside.
That is what the name Polydeukes means to this project.
