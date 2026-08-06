# AI code review

Comparing what is actually free for a public, MIT-licensed, single-maintainer repo, because
that combination is what decides it — most of these are free "for open source" with conditions
that matter.

## The options, as of August 2026

| | Free for this repo? | Friction | Catch |
|---|---|---|---|
| **Greptile** | Yes — free Starter tier (50 reviews/month, unlimited repos), *and* free for qualified non-commercial MIT/Apache projects | Install the app | Moved to per-review pricing in March 2026; the free allowance is the thing that could change |
| **Qodo** | Yes, but **by application** to their open-source programme | Apply, wait, hope this repo qualifies | Unknown whether a ~130-file solo project qualifies |
| **CodeRabbit** | Technically | Install the app | Free tier was cut to **summary only, 1 PR/hour** — not a review |
| **CodeQL + Copilot Autofix** | Yes, unconditionally on public repos | Already wired up in `codeql.yml` | Finds known-shaped defects, not design problems |

## The recommendation: Greptile

Not because it is the best reviewer — that is not knowable from a comparison table — but because
it is the only one whose free tier is **usable without asking permission** and is a real review
rather than a summary. Qodo may well be better and is worth applying for in parallel; the
application is the reason it is not the first choice.

Fifty reviews a month is a lot for this repo. It is not a lot for a busy week, and the March 2026
move to per-review pricing is a reminder that the allowance is somebody else's decision. Treat it
as convenience rather than infrastructure: nothing in CI should depend on it.

## What it is and is not for

It is a second opinion on a pull request. This repo already has the checks that do not need
judgement — types, lint, format, clippy with panics denied, a sanitizer property test, a
dependency floor, CodeQL. An AI reviewer is for the layer above that: *this looks like it
contradicts the comment three lines up*, *this is the third copy of this shape*.

Worth knowing what it would and would not have caught here. The adversarial audit of this repo
found five real defects. Two of them — the forged `data-sourcepos` and the Mermaid egress — were
found by reasoning across three files at once and then **confirmed by running the app and watching
the network**. A reviewer reading a diff would have had no way to see either. What it plausibly
would have caught is the class that was already visible in the text: a comment claiming something
the code no longer did, which is how three of the five survived.

So: useful, and not a substitute for the tests. If it starts producing noise, remove it — a
reviewer nobody reads is worse than none, for the same reason a skipped test is.

## Enabling it

1. Install the [Greptile GitHub App](https://github.com/apps/greptile) on this repository.
2. If it does not pick up the free open-source tier automatically, apply — the licence is MIT,
   which is what qualifies.
3. Configure it in `greptile.json` at the repository root if the defaults are too chatty. The
   format is theirs and changes; read their docs rather than trusting a snippet here.

Nothing in this repository depends on it being installed, and nothing here should start to.
