#!/usr/bin/env python3
"""Generate Zotero auto-update metadata from the built, checksum-verified XPI."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'addon' / 'manifest.json').read_text('utf-8'))
version = manifest['version']
addon_id = manifest['applications']['zotero']['id']
repo = 'seifer08ms/zotero-review-studio'
asset_name = f'zotero-review-studio-{version}.xpi'
xpi = root / 'dist' / asset_name
if not xpi.is_file():
    raise SystemExit(f'Build first; XPI missing: {xpi}')
digest = hashlib.sha256(xpi.read_bytes()).hexdigest()
result = {
    'addons': {
        addon_id: {
            'updates': [{
                'version': version,
                'update_link': f'https://github.com/{repo}/releases/download/v{version}/{asset_name}',
                'update_hash': 'sha256:' + digest,
                'applications': {
                    'zotero': {
                        'strict_min_version': manifest['applications']['zotero']['strict_min_version'],
                        'strict_max_version': manifest['applications']['zotero']['strict_max_version'],
                    }
                },
            }]
        }
    }
}
out = root / 'dist' / 'update.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(f'{out} (sha256:{digest})')
