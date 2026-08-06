# Security

lindo-md opens files written by other people. That is the whole product, and it is also the
threat model: a `.md` file is untrusted input, and so is a theme someone shares with you.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/gabmichels/lindo-md/security/advisories/new).
It goes to the maintainer and nobody else, and it keeps the discussion attached to the repository.

Please do not open a public issue for anything you think is exploitable.

There is no bounty. This is one person's app; what you get is credit in the advisory and the fix
shipping quickly.

## What counts

The claims below are what the app is *for*. A way to break any of them is a vulnerability, and
"you have to open a malicious file" is not a mitigation — opening files is the feature.

- **A document cannot run code.** comrak renders with `unsafe_` enabled so GitHub's raw HTML
  survives, which makes the `ammonia` pass after it load-bearing rather than optional. Anything
  that reaches the webview as executable — script, an event handler, a `javascript:` URL — is a
  bug in that pass.
- **A document cannot reach the network.** No telemetry, no update check, no remote fonts. Remote
  images are blocked by default because a tracking pixel is an image. Any request leaving the
  process because of something in a document counts, including through a Mermaid diagram, a
  stylesheet, or an exported file.
- **A document cannot reach the filesystem outside itself.** The webview has no filesystem
  permission; reading, scanning, watching and exporting all go through allowlisted
  `#[tauri::command]` functions. Reading or writing a path the user did not choose counts.
- **A document cannot change another document.** The rendered view is editable, and an edit is
  mapped back to the file through `data-sourcepos`. Anything that makes an edit land somewhere the
  reader did not select is silent corruption of their file, and counts.
- **An imported theme is data, not code.** It cannot execute, and it cannot make an export execute.

Also in scope: anything that gets code into a release — the build, the workflows, or a dependency.

## What does not count

- Denial of service from a deliberately pathological document. A 2 GB file or a billion-laughs
  expansion may well hang or exhaust memory; it costs you your own session.
- Findings that need the attacker to already run code as your user, or to have written to
  `config.json` first. At that point the machine is theirs.
- Unsigned installers. Known, [written up](docs/signing.md), and a money-and-identity problem
  rather than a code one.
- Reports from a scanner with no reachable path attached.

## What the project does about it

Each of these exists because of something that actually happened here, not as a checklist:

- `cargo-deny` and `osv-scanner` over both lockfiles, daily and on dependency changes
- a seven-day minimum release age on npm dependencies, so a compromised package has to survive a
  week of other people's scrutiny before it can be resolved here
- install scripts denied by default; the allowlist is one entry
- CodeQL over TypeScript and Rust, with the extended query pack
- every GitHub Action pinned to a commit SHA
- release artifacts carry SLSA build provenance — verify with
  `gh attestation verify <file> --repo gabmichels/lindo-md`

## Verifying a download

Every release has a `checksums-*.txt`, a provenance attestation, and a CycloneDX SBOM
(`sbom-frontend.cdx.json`, `sbom-rust.cdx.json`) listing everything compiled into it — so you can
scan what you downloaded rather than taking this repo's word for what is in it:

```bash
osv-scanner scan source --sbom sbom-rust.cdx.json
```

```bash
sha256sum -c checksums-windows-latest.txt
gh attestation verify lindo-md_1.0.0_x64-setup.exe --repo gabmichels/lindo-md
```

The attestation is the stronger of the two: a checksum proves the file matches the list, and the
attestation proves the file came from this repository's workflow, at a specific commit.
