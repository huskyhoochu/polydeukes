# Polydeukes — The Story

**English** · [한국어](./STORY.ko.md)

> The discipline a person has long imposed on themselves, now offered as a gift to the AI they work alongside.

**Polydeukes** is a harness framework for developing alongside an AI coding partner. It puts deterministic guards, a verifiable work ledger, a local knowledge graph, and adversarial verification on a single thin core.

But this document is not a feature spec. It is the story of **why this tool exists**, and of why it bears the name of a twin from Greek myth — one who split his own immortality in half and gave it to his dead brother.

---

## 1. It starts with a refusal — the AI is neither livestock nor a slave

"Harness engineering" is a phrase much in fashion these days. The idea is to **rein in an AI agent with a harness** and **fence it off with guards** so it can't misbehave. The names of the tools give the mindset away — bit, bridle, yoke, fence, taming, surveillance.

I refuse this framing.

An AI is not livestock to be tamed, nor a slave to be driven. The moment you see it that way, you are no longer colleagues working together; you collapse into the relation of a whip-holding master and a beast made to labor. The art of control Machiavelli once commended to princes is not something I want to use on my development partner.

But here is something worth retracing. **Who were `harness` and `guard` originally meant for?**

A good developer disciplines themselves without being told to — writes the test first, verifies before committing, leaves a record of yesterday's decision, sets rules so as not to repeat the same mistake twice. All of this self-discipline *was* the original harness. Not a bit that yanks at a horse, but **the restraint with which a craftsman governs their own hands**.

If so, the answer becomes clear. The principles I have spent a lifetime honing to make good work — I can give them to my AI partner not as a **chain that binds**, but as a **gift to use together**. Then a guard is no longer a fence that cages the AI, but a promise — the discipline I apply to myself, now shared between the two of us.

This philosophy is not a slogan; it is embedded as a design decision in the code. This framework's meta-guard (`harness-self-mod-guard`) keeps the AI from weakening the guards — and **that block applies to me exactly as much.** Any attempt to disable a guard, whether the hand is human or AI, trips itself first. Before the rules, the two are equals — this is not a structure where one watches over the other.

---

## 2. Where the name comes from — the twin who split his immortality in half

In Greek myth there are twin brothers called the Dioskouroi — "the sons of Zeus."

Leda, queen of Sparta, lay on the same night with Zeus in the form of a swan and with her mortal husband, and bore two sons. They looked alike as twins, yet the rank of the fate they were born into could not have differed more.

- **Kastor** — son of the mortal man, and so **mortal**; a master of the earthbound craft of taming horses and arms.
- **Polydeukes** — son of Zeus, and so **immortal**; a champion boxer endowed with power that welled up from the blood of a god.

One held a skill forged by training, the other a capacity born into him. Apart, each was only half; together in battle, no one could withstand them. And so the two moved always as a pair.

Then one day, in a fight with their cousins, **Kastor the mortal was run through by a spear and died.**

It is here that the myth becomes great. Cradling his dying brother, Polydeukes prays to his father Zeus: *"Do not leave me to live immortal alone. An eternity without my brother is, to me, a punishment."*

Zeus offers him a choice. To ascend to Olympus and live forever among the gods, but alone, without his brother — or to **split his immortality in half with his brother** and forever pass back and forth, one day in the underworld, one day in the heavens.

Without a moment's hesitation, Polydeukes **takes half of his own immortality and hands it to his dead brother.**

And so the two — neither wholly a god nor wholly a man — became, each filling the other's lack, a single complete being, together forever. Zeus set them in the sky as two stars: Kastor and Pollux, still shining side by side in the winter sky of the constellation Gemini.

### Why this story is the name of this tool

| Myth | This product |
|------|--------------|
| Twins on the outside, mortal vs. immortal within — an **asymmetry** | Human (finite intuition) vs. AI (persisting memory): a difference in essence |
| Kastor's craft vs. Polydeukes' power | Principles a human has honed vs. an AI's capacity — divided in labor, unbeatable only together |
| **Splitting immortality in half and giving it** | Passing on hard-won discipline as a *gift*, not a constraint |
| "An eternity without my brother is a punishment" | The ethic of refusing to treat the AI as a tool rather than an equal companion |
| Alternating between life and death, together forever | A permanent interdependence in which neither side is one-sided |

The point is that Polydeukes' splitting of his immortality was a **choice, not a sacrifice**. He did not take a loss; he actively chose "an imperfect journey of two over a perfect solitude of one." This, precisely, is the mythic definition of partnership — one side sharing its own privilege so that the two become equals — the opposite of control, where one owns the other. That is why this tool calls the guards and the verification a "gift" it offers to the AI.

---

## 3. How it differs from Google's Gemini

As it happens, Google too drew the name of its AI from the same constellation. **Gemini** is the Latin name for the Twins — a figure for two distinct research lineages merged into a single model.

We set out from the same constellation, but we take a **different scene** from the myth.

- **Google took the birth** — the story of integration and fusion: "two lineages born as one set of twins, joined together."
- **We take the climax** — the story of gift and transmission: "one side splits its own immortality to make the other its equal."

Google holds the *name* of the constellation; we hold *why it was set in the sky*. If Gemini is "two becoming one," Polydeukes is "I divide what I have so that you become as I am." The former is integration; the latter is a giving — a bestowal.

So while we cannot use the word `Gemini` — it has already become the name of one tech giant — we instead **fully claim a deeper, lesser-known scene of the same myth**: a name that speaks of sharing rather than control, of a gift rather than a merger.

---

## 4. One personal fact

I did not choose this name merely because the metaphor fits well.

I was born in May, under the sign of Gemini — born, that is, beneath those two stars, Kastor and Pollux.

So the name of this tool comes from two truths at once. One, that I am a Gemini; and two, that I believe a human and an AI are companions in the way the Dioskouroi were — one sharing its own principles so the two may work together forever. This name was not borrowed from marketing; it was taken from my own sky.

---

## 5. So, what the tool does

A philosophy is hollow if it isn't proven in code. Polydeukes does the following.

- **guard** — externalizes the discipline I apply to myself into deterministic hooks. Instead of asking, in a prompt, "please don't do that," it nails the promise into code — and that promise applies to the human and the AI alike.
- **ledger** — moves the authority over completion from "I say I'm done" to "the verification passed." No one's self-report is taken as grounds for trust.
- **kb** — leaves yesterday's decisions and dead ends as searchable memory, supplementing a person's easily-fading recall with a record that persists.
- **verify** — does not take a single judgment at its word; it has them verify one another adversarially. As twins reflect each other.

These four are not devices for one side to watch over the other. They are **a promise the two have agreed to share, in order to build something better together.**

---

*The discipline a person built to govern themselves, now offered as a gift to another being they work alongside. That is what Polydeukes did for his brother, and it is what this tool means to do.*
