# Rulesets

Drafts of the two rulesets described in [`docs/repo-settings.md`](../../docs/repo-settings.md),
kept here so the configuration is reviewable rather than living only in a web UI.

They are **not applied automatically** — nothing reads this directory. Import one with:

```bash
gh api repos/gabmichels/lindo-md/rulesets --method POST --input .github/rulesets/main.json
```

and export the live version back, to see what has drifted:

```bash
gh api repos/gabmichels/lindo-md/rulesets --jq '.[] | {id, name}'
gh api repos/gabmichels/lindo-md/rulesets/<id> > /tmp/live.json
```

Two things to read before applying `main.json`:

- **`bypass_actors` is empty**, including for you. That is deliberate — a standing bypass is a rule
  that only applies when you are paying attention, which is the opposite of the point.
- **The required checks are only the ones that always run.** `CI` is the aggregating gate in
  `ci.yml`; the jobs it depends on are legitimately skipped on prose-only changes, and requiring a
  skippable check makes a PR unmergeable forever. Nothing from `supply-chain.yml` is required for
  the same reason.
