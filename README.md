# Zotero Review Studio

[![Build and Test](https://github.com/seifer08ms/zotero-review-studio/actions/workflows/build.yml/badge.svg)](https://github.com/seifer08ms/zotero-review-studio/actions/workflows/build.yml)
[![Latest Release](https://img.shields.io/github/v/release/seifer08ms/zotero-review-studio)](https://github.com/seifer08ms/zotero-review-studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Current version: v0.3.1 (beta)** · [Download XPI](https://github.com/seifer08ms/zotero-review-studio/releases/latest/download/zotero-review-studio-0.3.1.xpi) · [中文说明](README.zh-CN.md)

> This is a beta release. Test with a small number of non-sensitive papers before production use.


A Zotero 7 review-writing workspace for selecting papers, sequential PDF evidence extraction, cross-paper research-gap synthesis, OpenAlex/Zotero discovery, deriving new review templates from published survey PDFs, and generating editable Markdown reviews.

## Major features (0.3.x)

- **Truly per-API proxy settings**: each saved OpenAI-compatible API profile independently chooses Follow Zotero, Force Direct, HTTP proxy or SOCKS5 proxy (host, port, and optional remote DNS). A trusted API relay/gateway is a separate optional setting. Custom/direct transports use per-request Gecko `nsIProxiedProtocolHandler` channels; Zotero's application-wide proxy settings remain untouched. Username/password-authenticated proxy servers are not supported.
- **Long-task resume**: per-chunk and per-paper JSON checkpoints to `Zotero.DataDirectory.dir/review-studio-projects`. Restore the latest paper selection and question, then resume compatible evidence analysis. Existing valid chunks and group summaries are reused; temporary paper errors are retried. No full PDF text or API keys are serialized.
- **Verified PDF page lookup**: opt-in, limited PDFWorker prefix-based search for the earliest physical PDF page containing a quote already matched in source text. Displays “unlocated” when verification fails; page numbers are not guessed by the model.
- **Chapter-only regeneration**: select an eligible Markdown section and regenerate it using saved evidence cards, preserving all other Markdown sections; unsaved Markdown edits are periodically checkpointed.

## Workflow

1. Select a few papers in Zotero, or discover more via Zotero's own search and OpenAlex. Explicitly opt in each additional work.
2. Choose a configured API, test it, acknowledge content transfer and run **Analyze Evidence & Gap**. Each paper is processed sequentially in bounded chunks, with source evidence ID and explicit uncertainty.
3. If interrupted, restore the latest project, verify original API/model and extraction settings, then click **Resume**.
4. Inspect source-verified limitations, inferred gaps, counterexamples and evidence; optionally verify PDF file page numbers.
5. Select an included review template, or create a reusable writing template from a **separate** published survey PDF that is not automatically part of the evidence pool.
6. Generate the review draft from existing evidence, edit Markdown, then optionally regenerate only one chapter. No repeat full-PDF analysis is needed when changing only the writing template.

## API keys and privacy

API keys remain in current window memory by default. Explicit opt-in stores a per-profile key in **plaintext Zotero preferences**. Cloning a profile deliberately excludes the key. The connection test sends only a fixed short prompt. Local project checkpoints store paper metadata and structured evidence, **not entire PDFs or API keys**. A third-party API gateway may see your key and transmitted paper excerpts; only use trusted authorized providers.

## Important limitations

For local Zotero 7.0.32, the Gecko per-request HTTP/SOCKS5 transport has been verified with mocked XPCOM interfaces, not a live running Gecko installation; actual proxy routing must be tested in the user's environment. Search/discovery is exploratory, not a systematic PRISMA review. PDF pages are physical file pages, not necessarily printed journal pages. PDF text extraction can fail or be expensive, so page lookup is opt-in and bounded. The plugin supports OpenAI-compatible Chat Completions, not arbitrary native model APIs. This is a beta requiring desktop validation.

Detailed Chinese instructions: [README.zh-CN.md](README.zh-CN.md).

## Development

```bash
node tests/core.test.js
node tests/runtime.test.js
node tests/exemplar.test.js
node tests/profiles.test.js
node tests/v3.test.js
python3 scripts/make_browser_smoke.py
python3 tests/browser_smoke.py # Chromium / Playwright required
python3 scripts/build_xpi.py
```

Build result: `dist/zotero-review-studio-0.3.1.xpi`. The plugin itself has no npm dependencies.

## Install & updates

1. Download `zotero-review-studio-0.3.1.xpi` from the [latest GitHub Release](https://github.com/seifer08ms/zotero-review-studio/releases/latest).
2. Zotero 7 → Tools → Plugins → gear → **Install Plugin From File**; choose the XPI and restart Zotero if prompted.
3. The XPI includes a Zotero `update_url`. GitHub Releases publish the corresponding `update.json` with a SHA-256 integrity hash, enabling supported automatic update checks.

## Automated GitHub releases

Push commits to `main` after changing `addon/manifest.json` to a **new version** (for example `0.3.2`). GitHub Actions runs the Node.js tests, builds the XPI, generates `update.json` and creates the `v0.3.2` GitHub Release automatically. If that version was already released, publishing is skipped; ordinary documentation-only commits do not re-release the same version.

See [CHANGELOG.md](CHANGELOG.md) for changes, [PERFORMANCE-REPORT.zh-CN.md](PERFORMANCE-REPORT.zh-CN.md) for benchmarks and [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

License: MIT.

## Performance improvements in v0.3.1

- Quotations are verified against a normalized PDF chunk once per chunk, avoiding repeated Unicode/whitespace processing for every claim (verification output unchanged).
- Gap evidence indexes are created once per render, not once per Gap card.
- Single-paper evidence is rendered lazily; closing a paper frees its DOM nodes while retaining all source-verified data.
- Each completed extraction chunk is still crash-resumable: small atomic per-paper sidecars replace repeated full-project checkpoint writes. v0.3.0 checkpoint files remain readable.
- A paper-ranker closure reuses query terms for candidate scoring; scores and citations are unchanged.
- PDFWorker calls for physical page location are deliberately unchanged; no unsupported speed-up is claimed.

For reproducible baseline/new measurements and limitations, see `PERFORMANCE-REPORT.zh-CN.md`. The figures are from Node.js and Chromium simulations, **not** a memory measurement in a running Zotero 7 client.

- Corrected the existing Gap-tab display mismatch (`gaps` vs `gapView`), verified with an actual visible browser view.
