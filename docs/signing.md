# Code signing

lindo-md ships unsigned. This is what that costs, what fixing it costs, and why it has not been
fixed yet — written down so the decision is a decision rather than a thing nobody got round to.

## What it costs today

**Windows.** SmartScreen shows "Windows protected your PC" with the publisher as *Unknown*, and
the user has to click **More info → Run anyway**. That dialog is the same one malware gets. On a
Markdown viewer someone found on GitHub, a meaningful share of people close it — and the ones who
do not are being taught to click through exactly the warning that protects them.

**macOS.** Gatekeeper refuses outright. The user needs right-click → Open, or `xattr -d
com.apple.quarantine`. The README already says macOS builds are "not yet".

**Linux.** No equivalent problem. `.deb` and `.AppImage` are fine unsigned.

Reputation makes Windows worse before it gets better: SmartScreen scores a *certificate*, so a new
certificate starts cold and warns anyway until enough installs accumulate. Buying one does not
switch the warning off on day one.

## What fixing it costs

| | Windows | macOS |
|---|---|---|
| Cheapest route | Azure Trusted Signing, ~$120/yr | Apple Developer Program, $99/yr |
| Requires | An identity-verified organisation — 3+ years of history, or slower individual validation | An Apple ID, and a Mac (or a macOS runner) to notarize from |
| Alternative | An OV certificate, ~$200–400/yr, usually on a hardware token | none |
| CI work | Store the cert, sign in `release.yml` | Notarize + staple in `release.yml`; needs an app-specific password as a secret |

Both mean putting a signing credential in GitHub Actions secrets. That is a real addition to what
this repo is worth attacking, and it is why the workflows are pinned to SHAs and scanned for
secrets before anyone does it — see [SECURITY.md](../SECURITY.md).

Tauri supports both natively; the bundler already has the hooks. The work is credentials and
paperwork, not code.

## Why not yet

The Azure route needs an organisation with three years of history, which this project does not
have. Individual validation exists but is slower and is being tightened.

The macOS half is currently moot: there is no macOS build to notarize.

## What is done instead

Not signing does not mean giving up on "is this the file the author built". Every release carries:

- **SHA256 checksums**, so a download can be checked against the release page
- **SLSA build provenance** via `actions/attest-build-provenance`, so a file can be tied to this
  repository, this commit and this workflow run:

  ```bash
  gh attestation verify lindo-md_1.0.0_x64-setup.exe --repo gabmichels/lindo-md
  ```

Provenance is stronger than a signature in one respect — it says *where the binary came from*,
not merely that someone with a certificate produced it — and weaker in the one that matters to a
non-technical user: the OS does not read it, so the scary dialog stays.

## If this gets revisited

Windows first: it is where the users are, it is the cheaper certificate, and it is the platform
where the warning actually stops people. macOS only becomes worth doing when there is a macOS
build worth shipping.
