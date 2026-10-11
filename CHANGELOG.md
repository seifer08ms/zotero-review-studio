# Changelog

## 0.3.1 — evidence-UI virtualization and incremental checkpoint I/O

- Evidence verification now normalizes each PDF text chunk only once, not once per claim. The exact quote-matching rule and all evidence IDs remain unchanged.
- Built one cross-paper evidence index per Gap render rather than rebuilding it for each Gap card; Gap content and provenance buttons remain identical.
- Fixed a v0.3.0 tab-ID mismatch that could hide the Gap view after analysis (`gaps` versus `gapView`); its underlying analytical conclusions remain unchanged.
- Evidence details are lazily rendered when a paper is expanded and removed on collapse. All evidence remains viewable, including verified quotations and clickable PDF-page buttons.
- Checkpoint chunks now use small per-paper atomic sidecars; a consolidated project snapshot is saved after each paper and for group/final synthesis. Crash-resumable after every completed chunk, compatible with existing v0.3.0 JSON projects and resistant to stale sidecars from a new run. A monotonic checkpoint serial also prevents crash-leftover sidecars from overwriting newer full-paper results.
- Normalized the search query once per discovery operation using a reusable ranker, preserving ranking scores and sorted results.
- Reuses normalized quote strings during physical PDF page lookup but deliberately retains the original PDFWorker call budget, binary search and page-location behavior.
- Added exact request/prompt/evidence/Gap/draft equivalence tests versus v0.3.0, API-proxy and resumable-checkpoint regression tests, and browser DOM/resource benchmarks. See PERFORMANCE-REPORT.zh-CN.md.


## 0.3.0 — independent API proxies, resumable analysis and verified source pages

- Added an **independent proxy mode per API profile**: Follow Zotero, Force Direct, HTTP proxy or SOCKS5 proxy, including remote-DNS option. Uses per-request Gecko channels and does not mutate global proxy preferences; the API gateway option remains separate.
- Added local, incremental JSON checkpoints during full-text chunk extraction and per-paper/group synthesis, latest-project restoration, compatible resume, and retry of temporarily failed papers.
- Saved checkpoint inputs include selected paper metadata/question/model/chunk settings but no API key or complete source PDF text.
- Added manual Gap evidence-to-physical-PDF-page lookup via Zotero PDFWorker extracted-page prefixes; unverified or unmatched quotes have no invented page number.
- Added Markdown chapter selection and chapter-only regeneration without rewriting neighboring sections; chapter changes and manual draft edits can be persisted.
- Added Node.js XPCOM transport mocks, checkpoint interruption/resume, source-page and chapter-preservation tests, and browser UI workflow smoke tests.
- Maintains separate exemplar-structure extraction, strict opt-in supplementary searches and two-stage evidence/draft workflow.

## 0.2.0 — API profiles and two-stage review workflow

- Added independent OpenAI-compatible API configurations, with provider presets for OpenAI, DeepSeek, Qwen, SiliconFlow, OpenRouter, Ollama and LM Studio; quick profile switching in the toolbar.
- Added configuration add/clone/delete and isolated per-profile API keys; clone never copies credentials. Keys are session-only unless explicitly stored as plaintext in Zotero preferences.
- Added per-profile Zotero/system networking or explicit trusted API relay URL (not a per-request HTTP/SOCKS proxy).
- Added safe non-paper connection test, API JSON compatibility option and configurable request timeout; automatically clears data-transfer consent when switching API or endpoint.
- Split the pipeline into **Stage 1: evidence + Research Gap analysis** and **Stage 2: template-based draft generation**, without re-reading PDFs when only changing the writing template.
- Added pre-run checklist, maximum-call estimate and post-analysis input-change invalidation to prevent drafts using stale literature selections.
- Preserved optional published-review-to-editable-template extraction, local and OpenAlex discovery, evidence provenance and Zotero note export.
- Added API profile security and workflow simulation tests.

## 0.1.0 — initial beta

- Zotero 7 bootstrap plugin with a dedicated evidence-review dialog.
- Sequential local-PDF full-text chunking and grounded per-paper methods/gaps extraction.
- Hierarchical multi-paper synthesis with verified snippets, contradictions, and uncertainty reporting.
- Explicit opt-in library search and OpenAlex candidate discovery; abstract-level-only external evidence unless PDF imported.
- Five built-in review-writing templates plus editable persistent custom templates.
- Existing published review → reusable review template workflow, with staged structural analysis.
- Local note save/copy Markdown and explicit model data-transfer consent.
