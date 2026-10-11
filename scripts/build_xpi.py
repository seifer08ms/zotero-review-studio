#!/usr/bin/env python3
"""Package addon/ directly as a Zotero XPI (ZIP-compatible archive)."""
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
src = root / "addon"
manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
assert manifest["applications"]["zotero"]["update_url"]
assert manifest["applications"]["zotero"]["strict_min_version"] == "7.0"
expected = ["bootstrap.js", "manifest.json", "prefs.js",
            "content/plugin.js", "content/review.xhtml", "content/review-core.js",
            "content/review-profiles.js", "content/review-network.js",
            "content/review-checkpoints.js", "content/review-pages.js",
            "content/review-chapters.js",
            "content/review-engine.js", "content/review-ui.js", "content/review.css"]
missing = [f for f in expected if not (src / f).is_file()]
if missing:
    raise SystemExit("Missing required addon files: " + ", ".join(missing))
outdir = root / "dist"
outdir.mkdir(exist_ok=True)
out = outdir / f"zotero-review-studio-{manifest['version']}.xpi"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in sorted(src.rglob("*")):
        if file.is_file() and not file.name.startswith("."):
            z.write(file, file.relative_to(src).as_posix())
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert "manifest.json" in z.namelist() and "bootstrap.js" in z.namelist()
print(out)
