#!/usr/bin/env python3
"""Generate a browser-only UI test fixture from REAL plugin source files."""
from pathlib import Path
import re
base=Path(__file__).resolve().parent.parent
html=(base/'addon/content/review.xhtml').read_text(encoding='utf-8')
css=(base/'addon/content/review.css').read_text(encoding='utf-8')
mock=(base/'tests/mock-zotero.js').read_text(encoding='utf-8')
html=re.sub(r'^<\?xml[^>]+\?>','',html)
html=re.sub(r'^<\?xml-stylesheet[^>]+\?>','',html)
html=re.sub(r'<window\b[^>]*>','<div class="zotero-mock-root">',html,count=1,flags=re.DOTALL)
html=html.replace('</window>','</div>').replace('html:','')
html=re.sub(r'<script src="chrome://zoteroreviewstudio/content/([^\"]+)"\s*/>','',html)
# Removing XUL script tags leaves their indentation-only lines behind. Keep
# the checked-in fixture deterministic and free of whitespace-only diff noise.
html=re.sub(r'(?m)^[ \t]+\n','\n',html)
source_order=['review-core.js','review-matrix.js','review-profiles.js','review-network.js','review-chatgpt.js','review-dropdown.js','review-checkpoints.js',
  'review-pages.js','review-chapters.js','review-engine.js','review-ui.js']
js='\n'.join('<script>'+ (base/'addon/content'/n).read_text(encoding='utf-8')+'</script>' for n in source_order)
page='<!DOCTYPE html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body><script>'+mock+'</script>'+html+js+'</body></html>'
file=base/'tests/ui-smoke.html';file.write_text(page,encoding='utf-8')
print(file)
