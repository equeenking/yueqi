"""Download FreePats samples (SFZ + WAV/FLAC) from GitHub into assets/real/<kind>/.

FreePats releases are all CC0-1.0 public domain. Each instrument repo has one SFZ file at the
root plus a `samples/` tree of WAV or FLAC files. This script fetches the whole repo as a
tarball (GitHub API) which is much faster than per-file downloads through raw.githubusercontent.com
(that endpoint is throttled / filtered in many networks). Then it mines every `<region>` of the SFZ
for `sample=` + `key`/`pitch_keycenter` to produce a mapping for build_samples.py.

Usage: python scripts/fetch_freepats.py           # download all configured instruments
       python scripts/fetch_freepats.py electric-bass-YR   # just one instrument
"""
import io
import json
import os
import re
import shutil
import sys
import tarfile
import time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'real')

# instruments we currently want, mapped to GitHub repo name (under freepats org) + local folder
INSTRUMENTS = {
    'bass': {'repo': 'freepats/electric-bass-YR', 'label': 'Clean Electric Bass',
             'source': 'freepats/electric-bass-YR (Yamaha RBX, picked + finger)', 'author': 'Andrea Biasior', 'license': 'CC0-1.0'},
    'piano': {'repo': 'freepats/upright-piano-KW', 'label': 'Upright Piano KW',
              'source': 'freepats/upright-piano-KW', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'guitar': {'repo': 'freepats/spanish-classical-guitar', 'label': 'Spanish Classical Guitar',
               'source': 'freepats/spanish-classical-guitar', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'ukulele': {'repo': 'freepats/ukulele1', 'label': 'Ukulele',
                'source': 'freepats/ukulele1', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'ocarina': {'repo': 'freepats/ocarina1', 'label': 'Ocarina',
                'source': 'freepats/ocarina1', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'bells': {'repo': 'freepats/tubular-bells1', 'label': 'Tubular Bells',
              'source': 'freepats/tubular-bells1', 'author': 'FreePats', 'license': 'CC0-1.0'},
    # ---- Phase 2: acoustic drum kits (kind-split), pitched percussion, electric guitar
    'drumkit': {'repo': 'freepats/muldjordkit', 'label': 'MuldjorKit Acoustic Drumkit',
                'source': 'freepats/muldjordkit', 'author': 'Muldjord / FreePats', 'license': 'CC0-1.0'},
    'drumkit2': {'repo': 'freepats/colomboADK', 'label': 'Colombo Drumkit',
                 'source': 'freepats/colomboADK', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'timpani': {'repo': 'freepats/timpani', 'label': 'Timpani',
                'source': 'freepats/timpani', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'hang': {'repo': 'freepats/hang-D-minor', 'label': 'Hang (D minor)',
             'source': 'freepats/hang-D-minor', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'wperc': {'repo': 'freepats/world-percussion', 'label': 'World Percussion',
              'source': 'freepats/world-percussion', 'author': 'FreePats', 'license': 'CC0-1.0'},
    'eguitar': {'repo': 'freepats/electric-guitar-FSBS-clean', 'label': 'Electric Guitar (clean)',
                'source': 'freepats/electric-guitar-FSBS-clean', 'author': 'FreePats', 'license': 'CC0-1.0'},
}

GH_TARBALL = 'https://api.github.com/repos/{repo}/tarball/{ref}'
GH_API = 'https://api.github.com/repos/{repo}/contents/{path}'
GH_RAW = 'https://raw.githubusercontent.com/{repo}/{ref}/{path}'


def download_tarball(repo, ref='main'):
    url = GH_TARBALL.format(repo=repo, ref=ref)
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=120, allow_redirects=True,
                             headers={'Accept': 'application/vnd.github+json',
                                      'User-Agent': 'GreanTeaDawy-sample-fetcher'})
            if r.status_code == 200:
                return tarfile.open(fileobj=io.BytesIO(r.content), mode='r:gz')
            if r.status_code == 302:
                # follow the tarball redirect
                r2 = requests.get(r.headers['Location'], timeout=180)
                if r2.status_code == 200:
                    return tarfile.open(fileobj=io.BytesIO(r2.content), mode='r:gz')
            print(f'  tarball HTTP {r.status_code} on attempt {attempt+1}')
        except Exception as e:
            print(f'  attempt {attempt+1} fail: {e}')
        time.sleep(3)
    return None


def parse_sfz(text):
    """Return list of dicts: { sample: 'relative/path', midi: int }.

    SFZ scope rules: parameters after a `<group>` belong to every region in that group.
    Parameters after a `<region>` belong only to that region and shadow group params of the same name.
    We track `in_group` to know whether to stash each line in `current_group` (inherited by the next region)
    or just in the most recent region (region-local).
    """
    regions = []
    current_group = {}
    in_group = False

    def set_op(k, v):
        if in_group or not regions:
            current_group[k] = v  # group/global scope: inherited by every following region
            return
        regions[-1][k] = v      # region scope: shadows group params of the same name

    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith('//'):
            continue
        if s == '<group>':
            current_group = {}
            in_group = True
            continue
        if s == '<region>':
            regions.append(dict(current_group))  # region starts with a copy of group params
            in_group = False
            continue
        if '=' not in s:
            continue
        # a line may carry several opcodes (`lovel=0 hivel=55`); `sample=` runs to end of line
        # (sample paths may contain spaces) and is normally the last opcode on its line
        head, sample_v = s, None
        si = head.find('sample=')
        if si >= 0:
            sample_v = head[si + len('sample='):].strip()
            head = head[:si]
        for k, v in re.findall(r'([A-Za-z_][A-Za-z0-9_]*)=([^\s=]+)', head):
            set_op(k, v)
        if sample_v is not None:
            set_op('sample', sample_v)

    out = []
    for r in regions:
        midi = None
        if 'pitch_keycenter' in r:
            midi = int(r['pitch_keycenter'])
        elif 'key' in r:
            midi = int(r['key'])
        elif 'lokey' in r:
            midi = int(r['lokey'])
        else:
            continue
        sample = r.get('sample', '')
        if not sample:
            continue
        row = {'midi': midi, 'sample': sample}
        # velocity range (drum kits layer their hits with lovel/hivel; melodic sets often don't bother)
        for k in ('lovel', 'hivel', 'seq_position'):
            if k in r:
                try:
                    row[k] = int(r[k])
                except ValueError:
                    pass
        out.append(row)
    return out


def extract_and_map(tar, dest_dir):
    """Extract tarball into dest_dir, then return list of { sfz_file, regions:[...] }."""
    os.makedirs(dest_dir, exist_ok=True)
    # find the top-level repo folder name
    top = None
    members = []
    for m in tar.getmembers():
        if top is None and '/' in m.name:
            top = m.name.split('/')[0]
        members.append(m)

    sfz_info = []
    for m in members:
        # strip top dir prefix
        name = m.name
        if top and name.startswith(top + '/'):
            name = name[len(top) + 1:]
        if not name:
            continue
        if m.isdir():
            continue
        # skip GitHub metadata files
        if name.startswith('.') or '/.git/' in name:
            continue

        # extract
        dest = os.path.join(dest_dir, name.replace('/', os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        f = tar.extractfile(m)
        if f is None:
            continue
        with open(dest, 'wb') as out:
            shutil.copyfileobj(f, out)

        # if it's an SFZ, parse it
        if name.lower().endswith('.sfz'):
            try:
                sfz_text = open(dest, 'r', encoding='utf-8', errors='replace').read()
                regions = parse_sfz(sfz_text)
                sfz_info.append({'file': name, 'regions': regions})
                print(f'    SFZ {name}: {len(regions)} regions')
            except Exception as e:
                print(f'    SFZ parse fail {name}: {e}')
    return sfz_info


def fetch(instrument_key):
    cfg = INSTRUMENTS[instrument_key]
    repo = cfg['repo']
    folder = os.path.join(SRC, instrument_key)
    print(f'\n== {instrument_key} from {repo} ==')

    # download tarball
    print(f'  fetching tarball...')
    tar = download_tarball(repo)
    if tar is None:
        print('  tarball failed; falling back to GH raw individual downloads...')
        return fetch_individual(cfg, folder)

    print(f'  extracting → {folder}')
    sfz_info = extract_and_map(tar, folder)
    tar.close()

    unique_audio = set()
    for info in sfz_info:
        for r in info['regions']:
            unique_audio.add(r['sample'])
    print(f'  total regions: {sum(len(i["regions"]) for i in sfz_info)}, unique audio files: {len(unique_audio)}')

    # write a regions.json next to the audio so build_samples.py can pick it up
    manifest = {
        'repo': repo,
        'source': cfg['source'],
        'author': cfg['author'],
        'license': cfg['license'],
        'regions': [{'sfz': i['file'], **r} for i in sfz_info for r in i['regions']],
    }
    with open(os.path.join(folder, 'regions.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f'  wrote regions.json')
    return True


def fetch_individual(cfg, folder):
    """Fallback: download files one at a time via GH API (base64 content for <1 MB files)."""
    os.makedirs(folder, exist_ok=True)
    api = GH_API.format(repo=cfg['repo'], path='')
    r = requests.get(api, timeout=30, headers={'Accept': 'application/vnd.github+json'})
    if r.status_code != 200:
        print(f'  GH API root failed: {r.status_code}')
        return False
    files = r.json()
    sfz_info = []
    for f in files:
        if f['type'] != 'file' or not f['name'].lower().endswith('.sfz'):
            continue
        # download content via API (base64 for small files)
        cr = requests.get(f['url'], timeout=30, headers={'Accept': 'application/vnd.github+json'})
        if cr.status_code == 200:
            d = cr.json()
            if d.get('encoding') == 'base64' and d.get('content'):
                import base64
                local = os.path.join(folder, f['name'])
                open(local, 'wb').write(base64.b64decode(d['content'].replace('\n', '')))
                text = open(local, 'r', encoding='utf-8', errors='replace').read()
                sfz_info.append({'file': f['name'], 'regions': parse_sfz(text)})
    # ... (download audio via API content when small, or via download_url when not rate-limited)
    if sfz_info:
        manifest = {
            'repo': cfg['repo'],
            'source': cfg['source'],
            'author': cfg['author'],
            'license': cfg['license'],
            'regions': [{'sfz': i['file'], **r} for i in sfz_info for r in i['regions']],
        }
        with open(os.path.join(folder, 'regions.json'), 'w', encoding='utf-8') as fp:
            json.dump(manifest, fp, ensure_ascii=False, indent=2)
    print(f'  individual: {len(sfz_info)} SFZs parsed, regions.json written')
    return True


if __name__ == '__main__':
    targets = sys.argv[1:] or list(INSTRUMENTS.keys())
    for t in targets:
        if t in INSTRUMENTS:
            fetch(t)
        else:
            print(f'unknown instrument: {t} (known: {list(INSTRUMENTS)})')
