# Repository settings

The parts of this project's security that do not live in the repository. Written down because
settings applied through a web UI are invisible in review, drift silently, and are the first thing
lost if the repo is ever recreated or transferred.

Shaped for what this actually is: **one maintainer, a public repo, shipping signed-by-nobody
binaries that people download and run.** Rules that assume a review team are called out as such
rather than recommended and quietly ignored.

## Before anything else: the CI trap

**Do not require a status check from a workflow that can be skipped.** A skipped workflow reports
*nothing*, not success — so a required check waits forever for a report that never arrives, and the
PR can never merge.

`ci.yml` used to use `paths-ignore`, which does exactly that. It no longer does: the filter moved
into a `changes` job, and a single always-running `ci` job aggregates the rest. **`CI` is the check
to require.** The individual jobs (`Typecheck & unit tests`, `Rust tests (…)`, `Build bundle (…)`)
must *not* be required — they are legitimately skipped on a prose-only change.

The same applies to `supply-chain.yml`, which is path-filtered: require nothing from it.

## Rulesets on `main`

Settings → Rules → Rulesets → New branch ruleset. Target `main`.

| Rule | Setting | Why |
|---|---|---|
| Restrict deletions | ✅ | |
| Block force pushes | ✅ | Rewriting `main` breaks every clone and every tag's ancestry |
| Require linear history | ✅ | Merges here are squashes; this makes that the only option |
| Require a pull request | ✅, **0 approvals** | See below |
| — Dismiss stale approvals | ✅ | |
| — Require conversation resolution | ✅ | |
| Require status checks | ✅ — `CI`, `CodeQL`, `gitleaks` | Nothing path-filtered |
| — Require branches up to date | ❌ | Costs a re-run per merge for one maintainer; the `CI` gate already ran against the merge result |
| Require signed commits | optional | Real benefit, real friction — see below |
| Require deployments | ❌ | No environments |

**Zero required approvals is deliberate.** GitHub will not let you approve your own PR, so any
non-zero number makes `main` unmergeable for a solo maintainer, and the workaround is bypassing the
ruleset — which trains you to bypass it. Zero still forces every change through a PR, which is what
buys the status checks, the diff, and a place for the review to happen. Raise this the day a second
maintainer arrives.

**Bypass list: empty.** Not even yourself. The whole value is that it applies when you are tired.
If you genuinely need to push directly, edit the ruleset, do it, and put it back — that friction is
the feature, and it leaves an audit trail that a standing bypass does not.

**Signed commits** are worth it if you already have signing set up. If you do not, the failure mode
is committing from a second machine and being unable to push; decide once rather than enabling it
and discovering that later.

## A ruleset for tags

Settings → Rules → Rulesets → New **tag** ruleset. Target `v*`.

- Restrict deletions ✅
- Block force pushes ✅
- Restrict creation to maintainers ✅

This matters more here than the branch rules. **A tag is what triggers a release** — `release.yml`
runs on `v*` — and a tag is public and immutable once anyone has pulled it. Blocking force pushes
stops `v1.0.0` being repointed at different code after people have downloaded it, which is the
difference between a version number and a promise.

## Code security

Settings → Code security.

| Setting | Value | Why |
|---|---|---|
| Private vulnerability reporting | ✅ **required** | `SECURITY.md` links straight at it; without this the link 404s and reporters open a public issue instead |
| Secret scanning | ✅ | |
| Push protection | ✅ | The half `secrets.yml` cannot do — it blocks the push instead of reporting afterwards |
| Dependabot alerts | ✅ | Renovate opens the PRs, but the alerts are the feed its `vulnerabilityAlerts` rule reacts to |
| Dependabot security updates | ❌ | Renovate already does this; two bots would open duplicate PRs |
| CodeQL default setup | ❌ | `codeql.yml` is the advanced setup — enabling both analyses everything twice |

## Actions

Settings → Actions → General.

| Setting | Value | Why |
|---|---|---|
| Actions permissions | Allow *selected* actions | Every `uses:` here is already SHA-pinned; this makes adding an unvetted one a settings change rather than a quiet commit |
| Fork PR approval | Require for **all outside collaborators** | A fork PR can edit the workflow it runs under |
| Workflow permissions | **Read repository contents** | This is the default `ci.yml` had been silently inheriting when it had no `permissions:` block. Set it read-only and the blast radius of a bad action shrinks everywhere at once |
| Allow GitHub Actions to create and approve PRs | ❌ | Renovate uses its own app token |

If "selected actions" is too strict to live with, the fallback is *"Allow actions created by GitHub
and verified creators"* — weaker, since `tauri-action` and `osv-scanner` are neither.

## General

- **Squash merging only.** Merge commits and rebase merging off. The version is derived from commit
  subjects, and a squash is what makes one PR one subject.
- **Default commit message: pull request title.** The PR title is written to be a Conventional
  Commit; the default ("commit messages") concatenates the branch's commits instead.
- **Automatically delete head branches** ✅.
- **Allow auto-merge** ✅ — this is what makes Renovate's `automerge` for devDependency patches
  actually land without a human.

## Applying it

Most of this is UI-only. The two rulesets are API-addressable, and drafts are in
[`.github/rulesets/`](../.github/rulesets/) — import them with:

```bash
gh api repos/gabmichels/lindo-md/rulesets --method POST --input .github/rulesets/main.json
gh api repos/gabmichels/lindo-md/rulesets --method POST --input .github/rulesets/tags.json
```

Read them before running that. They are a starting point, not a thing to apply unread — the
`bypass_actors` list in particular is empty on purpose, and that is a decision about how you want
to work.

## What this does not cover

Branch protection stops accidents and casual tampering. It does not stop someone who has your
credentials, and it is not a substitute for the things that make a compromise recoverable: 2FA on
the account, a passkey or hardware key rather than TOTP, and the SLSA provenance on every release
that lets anyone check a binary came from this repository's workflow rather than from a laptop.
