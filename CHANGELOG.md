# Changelog

## 0.5.2 — restore compatible API profiles and fix XUL dropdown mounting

- Hides the native XHTML/XUL select layer before showing the custom opaque popup, preventing duplicate transparent options from overlapping the settings panel.
- Preserves and repairs DeepSeek, Qwen, SiliconFlow, OpenRouter, Ollama and LM Studio profiles during migration, while adding ChatGPT as a separate account option.

## 0.5.1 — opaque Zotero dropdowns

- Forces an opaque background for the in-dialog dropdown surface and each option in Zotero's XUL environment, with dark-scheme colors and regression checks for transparent rendering.

## 0.5.0 — evidence comparison matrix and reviewed Research Gaps

- Adds an editable, project-scoped comparison matrix with method, assumptions, datasets, metrics, quantitative results, limitations, verified quotations and PDF file pages.
- Separates automatically derived cells from researcher edits; incremental updates retain manual corrections and add newly analyzed papers.
- Copies the visible matrix as TSV, Word-compatible HTML or LaTeX, and supports filtering, sorting and custom comparison dimensions.
- Validates every synthesized finding against the evidence record that owns each quotation, reporting unknown, unverified, ambiguous and mismatched paper references.
- Adds pending, accepted and rejected review states for potential Research Gaps. Only accepted gaps with complete quote-to-paper verification are supplied to draft and chapter generation.
- Lets researchers edit a Gap claim in place; edited claims return to pending review before they can be accepted again.
- Adds per-gap reverse search across the Zotero library and OpenAlex, retaining candidate papers as review leads rather than treating search results as evidence.
- Keeps proceedings and preprints in OpenAlex candidate discovery and preserves resumable checkpoints, official ChatGPT sign-in, per-profile proxy settings and exemplar templates.
- Automatic matrix method and limitation cells use only quote-verified claims; reducer-only summary text remains available for manual checking instead of being presented as direct evidence.

## 0.4.0 — ChatGPT-plan OAuth and stable in-dialog selectors

- Fresh installations default to official “Sign in with ChatGPT” (eligible Plus/Pro account authorization) without requiring an API key; existing API profile selection is preserved on upgrade.
- Implements official dynamic OAuth client registration, PKCE, signed OIDC and scope checks, encrypted Gecko Login Manager credential storage, token refresh and sign-out. Never accesses ChatGPT/Codex cookies or private backends.
- Uses public OpenAI Responses API with required `store:false` and `stream:true`; account-specific available model lookup is exposed in settings.
- Per-profile proxy settings apply to OpenAI token/JWKS/model/inference traffic; external system-browser authorization retains the browser’s networking settings.
- Replaced platform-native HTML dropdown popup rendering with a single opaque, scrollable, keyboard-friendly in-dialog overlay to avoid interference with Zotero XUL controls.
- Preserves the v0.3.1 PDF evidence/Gap/template workflow, checkpoints and existing external API configurations.
- Added ChatGPT OAuth/JWT/refresh/Responses protocol mocks and browser selector UI regression tests. Live Zotero/Desktop OAuth end-to-end remains unverified.


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
