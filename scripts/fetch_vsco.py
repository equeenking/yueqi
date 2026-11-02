"""Download the sustained takes of six VSCO 2 CE (Versilian Studios Chamber Orchestra, CC0-1.0)
instruments from the sgossner/VSCO-2-CE GitHub mirror into assets/real/<kind>/.

The GitHub repo ships WAV samples only — the SFZ mapping lives in Versilian's separate pack —
but the file naming is rigidly systematic, so the mapping is derived from the names: for every
kind we keep just the sustained articulation a melody needs (susvib / Sus / susLong / sus /
ArcoVib), measure the lowest + highest take to align each instrument's octave spelling (the
subtrees disagree: some label scientific pitch, some the player's written pitch an octave
lower), and emit a small synthetic SFZ + regions.json that build_samples.py's generic SFZ
collector reads unchanged. Staccato / pizzicato / tremolo takes are not extracted: the runtime
stretches any take across the roll, and staccatos would loop badly.

Usage: python scripts/fetch_vsco.py                # fetch all six instruments
       python scripts/fetch_vsco.py flute oboe     # just these ones
       python scripts/fetch_vsco.py --keep-tarball (don't delete the downloaded archive)
"""
import json
import os
import posixpath
import re
import shutil
import sys
import tarfile
import tempfile
import time

import numpy as np
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_samples import estimate_f0_wide, load, note_midi  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'real')

REPO = 'sgossner/VSCO-2-CE'
REF = 'master'
LICENSE = 'CC0-1.0'
AUTHOR = 'Versilian Studios / VSCO community'

# repo subtree (after the tarball's top-level folder) → local kind folder
TREES = {
    'flute':    'Woodwinds/Flute',
    'oboe':     'Woodwinds/Oboe',
    'clarinet': 'Woodwinds/Clarinet',
    'bassoon':  'Woodwinds/Bassoon',
    'horn':     'Brass/F Horn',
    'violin':   'Strings/Solo Violin',
}

# Sustained takes worth keeping, per kind: filename → (note, velocity band). Band 1 = soft,
# 2 = loud (mapped onto lovel/hivel 0-63 / 64-127); VSCO's middle dynamics collapse onto them —
# classroom melodies need the p/f contrast, not four shades of it (half the download size).
TAKES = {
    'flute':    (re.compile(r'LDFlute_susvib_([A-G]#?\d)_v1_(\d)\.wav$'),
                 lambda m: None),  # VSCO sampled the vibrato sustain at one dynamic only
    'oboe':     (re.compile(r'Oboe_Sus_([A-G]#?\d)_v(\d)_Main\.wav$'),
                 lambda m: 1 if m.group(2) == '1' else 2),
    'clarinet': (re.compile(r'DCClar_susLong_([A-G]#?\d)_v(\d)_rr1_sum\.wav$'),
                 lambda m: 1 if m.group(2) == '1' else 2),
    'bassoon':  (re.compile(r'PSBassoon_([A-G]#?\d)_v(\d)_1\.wav$'),
                 lambda m: 1 if m.group(2) == '1' else 2),  # _rr1/_rr2 files are the staccatos
    'horn':     (re.compile(r'MOHorn_sus_([A-G]#?\d)_v(\d)_(\d)\.wav$'),
                 lambda m: 1 if m.group(2) in ('1', '2') else 2),
    'violin':   (re.compile(r'LLVln_ArcoVib_([A-G]#?\d)_(p|f)\.wav$'),
                 lambda m: 1 if m.group(2) == 'p' else 2),
}

GH_TARBALL = f'https://api.github.com/repos/{REPO}/tarball/{REF}'


def download_tarball(path):
    """Stream the repo tarball to `path`; returns bytes downloaded or None."""
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'GreanTeaDawy-sample-fetcher'}
    for attempt in range(3):
        try:
            with requests.get(GH_TARBALL, timeout=120, headers=h, stream=True, allow_redirects=True) as r:
                if r.status_code != 200:
                    print(f'  tarball HTTP {r.status_code} on attempt {attempt + 1}')
                    time.sleep(3)
                    continue
                got, next_report = 0, 1 << 28
                with open(path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=1 << 22):
                        f.write(chunk)
                        got += len(chunk)
                        if got >= next_report:
                            print(f'  ... {got / (1 << 20):.0f} MB', flush=True)
                            next_report += 1 << 28
                return got
        except Exception as e:
            print(f'  attempt {attempt + 1} fail: {e}')
            time.sleep(3)
    return None


def extract_all(tar_path, kinds):
    """One streaming pass over the tarball; extracts only each subtree's sustained takes."""
    tar = tarfile.open(tar_path, 'r:gz')
    wanted = {sub + '/': kind for kind, sub in TREES.items() if kind in kinds}
    top = None
    stats = {k: 0 for k in kinds}

    for m in tar:
        if top is None and '/' in m.name:
            top = m.name.split('/')[0]
        name = m.name
        if top and name.startswith(top + '/'):
            name = name[len(top) + 1:]
        if m.isdir():
            continue
        kind = next((k for pre, k in wanted.items() if name.startswith(pre)), None)
        if kind is None:
            continue
        base = posixpath.basename(name)
        if not TAKES[kind][0].match(base):
            continue
        os.makedirs(os.path.join(SRC, kind), exist_ok=True)
        f = tar.extractfile(m)
        if f is None:
            continue
        with open(os.path.join(SRC, kind, base), 'wb') as out:
            shutil.copyfileobj(f, out)
        stats[kind] += 1
    tar.close()
    return stats


def collect_kind(kind):
    """Extracted files → take list; the tar carries some files twice, dedupe by name."""
    rx, band_of = TAKES[kind]
    takes = []
    for base in sorted(os.listdir(os.path.join(SRC, kind))):
        m = rx.match(base)
        if m and os.path.isfile(os.path.join(SRC, kind, base)):
            takes.append({'file': base, 'nominal': note_midi(m.group(1)), 'band': band_of(m)})
    return takes


def align_octave(kind, takes):
    """VSCO's octave spelling differs per subtree (some label scientific pitch, some the player's
    written pitch an octave lower): measure the lowest + highest take once and shift every
    keycenter a whole octave so the names agree within the ±8-semitone window build_samples
    searches. One round only: at the *original* nominal the ±12-semitone window's top edge is the
    true pitch (2×f0 stays outside), but after a shift the low probe can lock onto the second
    harmonic (measured: bassoon A#0 at hint 34 reads 116 Hz), so a verify round would mislead."""
    ordered = sorted(takes, key=lambda t: t['nominal'])
    devs = []
    for t in (ordered[0], ordered[-1]):
        x, sr = load(os.path.join(SRC, kind, t['file']))
        _, midi = estimate_f0_wide(x, sr, t['nominal'])
        devs.append(midi - t['nominal'])
    if abs(devs[0] - devs[1]) > 6:
        print(f'    !! {kind}: 低/高两端测音不一致 ({devs[0]:+.1f} / {devs[1]:+.1f})——人工检查 {TREES[kind]}')
        return False
    d = float(np.median(devs))
    if abs(d) <= 5:
        if abs(d) > 0.75:
            print(f'    {kind}: 实测整体偏 {d:+.1f} 半音（测音窗口内，交给 build_samples 校正）')
        return True
    step = 12 * round(d / 12)
    if step == 0 or abs(d) > 18:
        print(f'    !! {kind}: 实测偏移 {d:+.1f} 半音既非同度也非八度——人工检查 {TREES[kind]}')
        return False
    print(f'    {kind}: 文件名八度写法与实际差 {step:+d} 半音 → pitch_keycenter 整体移 {step}')
    for t in takes:
        t['nominal'] += step
    return True


def write_sfz_regions(kind, takes):
    """Synthetic SFZ + regions.json rows. collect_sfz only reads regions.json (one row per region:
    sfz/midi/sample[+lovel/hivel]); the SFZ itself is written so the assets folder stays playable
    in any SFZ sampler (Sforzando) for spot checks."""
    lines = ['// 合成 SFZ：scripts/fetch_vsco.py 按 VSCO 系统化文件名生成（GitHub 仓库只发 WAV 不发映射）',
             '<group>']
    regions = []
    for t in sorted(takes, key=lambda z: (z['band'] or 0, z['nominal'], z['file'])):
        ops = [f'sample={t["file"]} pitch_keycenter={t["nominal"]}']
        row = {'sfz': 'vsco.sfz', 'midi': t['nominal'], 'sample': t['file']}
        if t['band']:
            lo, hi = (t['band'] - 1) * 64, t['band'] * 64 - 1
            ops.append(f'lovel={lo} hivel={hi}')
            row['lovel'], row['hivel'] = lo, hi
        lines.append('<region> ' + ' '.join(ops))
        regions.append(row)
    with open(os.path.join(SRC, kind, 'vsco.sfz'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    return regions


def main():
    keep = '--keep-tarball' in sys.argv
    kinds = [k for k in sys.argv[1:] if k in TREES] or list(TREES)
    tar_path = os.path.join(tempfile.gettempdir(), 'vsco2ce.tar.gz')
    if not os.path.exists(tar_path):
        print(f'downloading {REPO} tarball (~2.3 GB) → {tar_path}', flush=True)
        if download_tarball(tar_path) is None:
            print('download failed')
            return 1
    else:
        print(f'reusing cached tarball {tar_path}')

    stats = extract_all(tar_path, kinds)
    ok = True
    for k in kinds:
        print(f'\n{k:<8} {stats[k]} sustained takes extracted ({TREES[k]})')
        if not stats[k]:
            ok = False
            print('  !! nothing extracted — naming mismatch with TAKES?')
            continue
        takes = collect_kind(k)
        if not align_octave(k, takes):
            ok = False
            continue
        regions = write_sfz_regions(k, takes)
        bands = sorted({(r.get('lovel', 0), r.get('hivel', 127)) for r in regions})
        mids = sorted({r['midi'] for r in regions})
        print(f'  {len(regions)} regions, {len(mids)} pitches {mids[0]}-{mids[-1]}, vel bands {bands}')
        manifest = {
            'repo': REPO,
            'source': f'{REPO}（{TREES[k]}）',
            'author': AUTHOR,
            'license': LICENSE,
            'regions': regions,
        }
        with open(os.path.join(SRC, k, 'regions.json'), 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    if ok and not keep:
        os.remove(tar_path)
        print('\ntarball deleted')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
