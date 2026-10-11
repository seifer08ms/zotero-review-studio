# Contributing to Zotero Review Studio

Thank you for helping improve evidence-based academic review workflows.

## Development and tests

Requirements: Zotero 7 (for manual installation and validation), Node.js 22+, and Python 3.10+ for packaging. No npm install is required.

```bash
for test in core runtime exemplar profiles v3 incremental_resume pipeline_equivalence performance; do
  node "tests/${test}.test.js"
done
python3 scripts/build_xpi.py
python3 scripts/generate_update.py
```

Run `python3 tests/browser_smoke.py` optionally when Chromium and Playwright are installed. Live Zotero GUI and HTTP/SOCKS proxy testing are not covered by the Node mock suite.

## Changes and releases

- Open a pull request against `main` with details of the bug, expected behavior, testing, and Zotero version.
- Avoid uploading any personal PDFs, API keys, paper extracts, or Zotero profile files to issues or tests.
- Only bump `addon/manifest.json` version when preparing a new release. On push to `main`, CI checks and Auto Release run. Existing version tags are never overwritten.
- When changing text extraction, evidence grounding or quote locations, add tests that confirm research claims remain appropriately sourced and not fabricated.

## Security

Never commit API keys or real project checkpoint data. By default model keys are held only in window memory; the explicit "Remember API Key" option stores a plaintext Zotero preference, documented in the README. For security-sensitive findings, use a private reporting channel rather than attaching credentials to public issues.
