"""Validate manifest: every instrument's notes reference existing files (one-off probe)."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'client', 'public', 'samples')

m = json.load(open(os.path.join(PUB, 'manifest.json'), encoding='utf-8'))
total = 0
for kind, cfg in sorted(m['instruments'].items()):
    missing = 0
    for n in cfg['notes']:
        f = os.path.join(PUB, kind, n['file'])
        if not os.path.exists(f):
            missing += 1
            print(f'  MISSING: {kind}/{n["file"]}')
        if '#' in n['file']:
            print(f'  HASH-IN-NAME: {kind}/{n["file"]}')
    total += len(cfg['notes'])
    print(f'{kind:10s} {len(cfg["notes"]):3d} notes  loop={cfg["loop"]!s:5s} missing={missing}  src={cfg["source"][:40]}')
print(f'TOTAL: {total} notes across {len(m["instruments"])} instruments')
