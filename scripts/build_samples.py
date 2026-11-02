"""Build the browser sample bank from the downloaded CC0 recordings.

Measures every file's real fundamental (harmonic-template search, not the file name: two libraries
mislabel octaves), copies the recordings into client/public/samples/<instrument>/ and writes a
manifest that the runtime sample bank reads.

Usage:  python scripts/build_samples.py [--copy]
"""
import glob
import json
import os
import re
import shutil
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'real')
PUB = os.path.join(ROOT, 'client', 'public', 'samples')

# erhu file names: suffix 5 = C4..B4, suffix 6 = C5..B5 (measured: erhu_c6 = 527.6 Hz = C5)
ERHU_NAMES = {
    'd5': 62, 'eb5': 63, 'e5': 64, 'f5': 65, 'gb5': 66, 'g5': 67, 'ab5': 68,
    'a5': 69, 'bb5': 70, 'b5': 71,
    'c6': 72, 'db6': 73, 'd6': 74, 'eb6': 75, 'e6': 76, 'f6': 77, 'gb6': 78,
    'g6': 79, 'ab6': 80, 'a6': 81,
}

# files whose spectrum does not match their name (guzheng-79 peaks at 112/236/326 Hz, not G5)
GUZHENG_SKIP = {79, 86}


def load(path):
    x, sr = sf.read(path, always_2d=True)
    x = x.mean(axis=1).astype(np.float64)
    return x, sr


def estimate_f0(x, sr, hint, span=1.5):
    """Harmonic-template search around `hint` (MIDI), ±span semitones."""
    s = int(0.10 * sr)
    seg = x[s:s + int(0.55 * sr)]
    if len(seg) < sr // 8:
        seg = x[:int(sr * 0.4)]
    seg = (seg - seg.mean()) * np.hanning(len(seg))
    n = 1 << 17
    X = np.abs(np.fft.rfft(seg, n))
    f = np.fft.rfftfreq(n, 1 / sr)
    h = 440.0 * 2 ** ((hint - 69) / 12.0)
    lo, hi = np.log2(h) + (-span / 12), np.log2(h) + (span / 12)
    best, bf = -1.0, h
    for cand in 2 ** np.linspace(lo, hi, 900):
        sc = 0.0
        for k in range(1, 9):
            fk = cand * k
            if fk >= sr / 2:
                break
            i = int(round(fk * n / sr))
            if i >= len(X) - 1:
                break
            sc += X[max(0, i - 4):i + 5].max() / (k ** 0.5)
        if sc > best:
            best, bf = sc, cand
    return bf


def collect_guzheng():
    out = []
    for path in sorted(glob.glob(os.path.join(SRC, 'guzheng', '*.flac'))):
        m = re.search(r'guzheng-(\d+)-v(\d+)-rr(\d+)', os.path.basename(path))
        if not m:
            continue
        nominal, layer, rr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if nominal in GUZHENG_SKIP:
            continue
        x, sr = load(path)
        f0 = estimate_f0(x, sr, nominal, span=0.7)
        out.append({
            'file': os.path.basename(path), 'midi': nominal, 'freq': round(f0, 3),
            'cents': round(1200 * np.log2(f0 / (440 * 2 ** ((nominal - 69) / 12))), 1),
            'layer': layer, 'rr': rr, 'dur': round(len(x) / sr, 2), 'sr': sr,
        })
    return out


def collect_erhu():
    out = []
    for path in sorted(glob.glob(os.path.join(SRC, 'erhu', '*.wav'))):
        m = re.match(r'erhu_([a-z]+[56])_sus_rr(\d+)', os.path.basename(path))
        if not m or m.group(1) not in ERHU_NAMES:
            continue
        nominal, rr = ERHU_NAMES[m.group(1)], int(m.group(2))
        x, sr = load(path)
        f0 = estimate_f0(x, sr, nominal, span=0.8)
        out.append({
            'file': os.path.basename(path), 'midi': nominal, 'freq': round(f0, 3),
            'cents': round(1200 * np.log2(f0 / (440 * 2 ** ((nominal - 69) / 12))), 1),
            'layer': 1, 'rr': rr, 'dur': round(len(x) / sr, 2), 'sr': sr,
        })
    return out


# ------------------------------------------------------------------ wind: 箫 xiao / 唢呐 suona
# Both sets label the *written* note of a transposing instrument: every take really sounds an octave
# higher than its file name (measured: Oboe_Sus_As2 = A#3, BassRecorder_Sus_C3 = C4), and the XSXB README's
# stated ranges (唢呐 A#3–F6, 箫 F3–C6) agree with the measurement. So nothing here trusts a file name:
# each take is searched over the nominal pitch ±1 octave, and the takes of one nominal pitch vote (median)
# on the zone's real MIDI number — one stray reading cannot move a note.
NOTE_PC = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}
SUS_MAX = 3.2     # a sustained take is looped, so it only needs the attack plus enough steady state
SUS_FADE = 0.03
XIAO_RE = re.compile(r'_(?:Sus|SusVib)_([A-Ga-g][sb#]?\d)_rr(\d+)_')
SUONA_RE = re.compile(r'_(?:Sus|Vib)_([A-Ga-g][sb#]?\d)_v(\d)_')
XUN_RE = re.compile(r'StdOcarina_Sus_([A-Ga-g][sb#]?\d)\.wav$')  # VCSL ocarina ≈ 埙: plain sustains only
GONG_MAX = 10.0   # the real gong rings 20-34 s; 10 s plus a fade covers the audible tail
GONG_FADE = 2.0   # the fade is part of the copy (a hard cut would click)


def note_midi(s):
    m = re.match(r'([A-Ga-g])([sb#]?)(-?\d)$', s)
    return 12 * (int(m.group(3)) + 1) + NOTE_PC[m.group(1).lower()] + (
        1 if m.group(2) in ('s', '#') else -1 if m.group(2) == 'b' else 0)


def estimate_f0_wide(x, sr, nominal, span=12.0):
    """Harmonic-template search over the nominal pitch ±`span` semitones (a name can be a whole octave off)."""
    s = int(0.15 * sr)
    seg = x[s:s + int(0.6 * sr)]
    if len(seg) < sr // 8:
        seg = x[:int(sr * 0.5)]
    seg = (seg - seg.mean()) * np.hanning(len(seg))
    n = 1 << 17
    X = np.abs(np.fft.rfft(seg, n))
    h = 440.0 * 2 ** ((nominal - 69) / 12.0)
    best, bf = -1.0, h
    for cand in 2 ** np.linspace(np.log2(h) - span / 12, np.log2(h) + span / 12, 1800):
        sc = 0.0
        for k in range(1, 9):
            fk = cand * k
            if fk >= sr / 2:
                break
            i = int(round(fk * n / sr))
            if i >= len(X) - 1:
                break
            sc += X[max(0, i - 4):i + 5].max() / (k ** 0.5)
        if sc > best:
            best, bf = sc, cand
    return bf, 69 + 12 * np.log2(bf / 440.0)


# ------------------------------------------------------------------ bass: FreePats electric-bass-YR
# Two SFZs — finger (FingerBassYR) and pick (PickedBassYR) — same pitch coverage (MIDI 28–40).
# We treat them as two velocity layers: layer 1 = finger (softer), layer 2 = pick (attacked).
def collect_bass():
    """FreePats electric bass — reads regions.json produced by fetch_freepats.py."""
    rpath = os.path.join(SRC, 'bass', 'regions.json')
    if not os.path.exists(rpath):
        return [], {}
    with open(rpath, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    manifest['regions'] = dedupe_sfzs(manifest['regions'])
    sfz_names = sorted({r['sfz'] for r in manifest['regions']})
    sfz_to_layer = {name: i + 1 for i, name in enumerate(sfz_names)}

    raw = []
    for r in manifest['regions']:
        path = os.path.join(SRC, 'bass', r['sample'])
        if not os.path.exists(path):
            continue
        layer = sfz_to_layer[r['sfz']]
        x, sr = load(path)
        f, midi = estimate_f0_wide(x, sr, r['midi'], span=8.0)
        raw.append({
            'orig_file': r['sample'].replace('/', os.sep),
            'nominal': r['midi'], 'measured': midi, 'freq': f,
            'dur': len(x) / sr, 'sr': sr,
            'layer': layer,
        })

    by_nom = {}
    for r in raw:
        by_nom.setdefault(r['nominal'], []).append(r)
    out = []
    rename_map = {}  # new-name → old-path-in-SRC
    for nom in sorted(by_nom):
        group = sorted(by_nom[nom], key=lambda z: (z['layer'], z['orig_file']))
        zone = int(round(float(np.median([g['measured'] for g in group]))))
        zone_f = nominal_freq(zone)
        for i, g in enumerate(group):
            cents = 1200 * np.log2(g['freq'] / zone_f)
            stray = abs(cents) > CENT_LIMIT
            vel = 0.35 if g['layer'] == 1 else 0.75
            # rename: finger  → E_L1.flac, pick → E_L2.flac (so both layers fit side-by-side)
            base = os.path.splitext(os.path.basename(g['orig_file']))[0]
            # '#' is the URL fragment delimiter — the runtime fetch of such a file 404s: ship with 's'
            new_name = f'{base}_L{g["layer"]}.wav'.replace('#', 's')  # always WAV — the copy step converts anyway
            rename_map[new_name] = g['orig_file']
            out.append({
                'file': new_name,
                'midi': zone,
                'freq': round(zone_f if stray else g['freq'], 3),
                'cents': 0.0 if stray else round(cents, 1),
                'layer': g['layer'], 'rr': 1,
                'vel': vel,
                'dur': round(min(g['dur'], 8.0), 2), 'sr': g['sr'],
                'trim': g['dur'] > 8.01, 'trimSec': 8.0, 'trimFade': 0.05,
                'calibrated': bool(stray),
            })
    return out, rename_map


# ------------------------------------------------------------------ generic SFZ instruments (FreePats)
# Each FreePats repo ships SFZ file(s) + audio; fetch_freepats.py turns them into regions.json
# (one row per SFZ region: key + sample path). This collector is bank-generic: each SFZ becomes a
# velocity layer, zones vote their real MIDI (median), then zones are thinned to ≈one per `stride`
# semitones — the runtime resamples between zones anyway, so a stride of 2–3 halves-to-thirds the
# download size for no audible cost. Long decays are capped with a fade so the WAVs stay small.
def dedupe_sfzs(regions):
    """Some repos carry the same SFZ twice under two names (space vs underscore). Collapse SFZs whose
    region sets are identical so a duplicated file does not become a phantom velocity layer."""
    sigs = {}
    for r in regions:
        sigs.setdefault(r['sfz'], set()).add((r['midi'], r['sample']))
    keep, seen = set(), set()
    for name in sorted(sigs):
        h = frozenset(sigs[name])
        if h in seen:
            continue
        seen.add(h)
        keep.add(name)
    return [r for r in regions if r['sfz'] in keep]


SFZ_SETS = {
    'piano':   dict(folder='piano',   loop=False, stride=3, max_rr=1, trim_sec=12.0, trim_fade=1.5,
                    label='钢琴',     source='freepats/upright-piano-KW（立式钢琴真实录音，CC0-1.0）'),
    'guitar':  dict(folder='guitar',  loop=False, stride=2, max_rr=2, trim_sec=8.0,  trim_fade=1.0,
                    label='古典吉他', source='freepats/spanish-classical-guitar（西班牙古典吉他，CC0-1.0）'),
    'ukulele': dict(folder='ukulele', loop=False, stride=2, max_rr=2, trim_sec=6.0,  trim_fade=0.8,
                    label='尤克里里', source='freepats/ukulele1（尤克里里真实录音，CC0-1.0）'),
    'ocarina': dict(folder='ocarina', loop=True,  stride=1, max_rr=2, trim_sec=5.0,  trim_fade=0.05,
                    label='陶笛',     source='freepats/ocarina1（陶笛真实录音，CC0-1.0）'),
    'bells':   dict(folder='bells',   loop=False, stride=2, max_rr=2, trim_sec=10.0, trim_fade=1.5,
                    label='管钟',     source='freepats/tubular-bells1（管钟真实录音，CC0-1.0）'),
    # timpani / hang: tuned professional takes whose SFZ keys are trustworthy — a harmonic-template search
    # would risk locking onto the timpani's strong quint mode (~1.5×) a fifth too high, so we skip measuring
    'timpani': dict(folder='timpani', loop=False, stride=1, max_rr=2, trim_sec=6.0, trim_fade=1.0,
                    label='定音鼓',   source='freepats/timpani（定音鼓真实录音，CC0-1.0）', measure=False),
    'hang':    dict(folder='hang',    loop=False, stride=1, max_rr=3, trim_sec=6.0, trim_fade=1.5,
                    label='手碟',     source='freepats/hang-D-minor（手碟真实录音，D 小调，CC0-1.0）', measure=False),
    'eguitar': dict(folder='eguitar', loop=False, stride=2, max_rr=2, trim_sec=8.0, trim_fade=1.0,
                    label='电吉他',   source='freepats/electric-guitar-FSBS-clean（电吉他清音真实录音，CC0-1.0）',
                    sfz_re=r'bridge 2026'),
    # 彼得与狼管弦组（VSCO-2-CE，fetch_vsco.py 只取持续音 take、力度坍缩成 p/f 两带）：全部 loop=True——
    # 吹管/弓弦的长音靠 makeLoopUnit 循环，4 秒 take 就能覆盖任意时值；trim_fade 与陶埙同理取极短淡出。
    'flute':    dict(folder='flute',    loop=True, stride=1, max_rr=2, trim_sec=4.0, trim_fade=0.05,
                     label='长笛',     source='sgossner/VSCO-2-CE（长笛真实录音，CC0-1.0）'),
    'oboe':     dict(folder='oboe',     loop=True, stride=1, max_rr=1, trim_sec=4.0, trim_fade=0.05,
                     label='双簧管',   source='sgossner/VSCO-2-CE（双簧管真实录音，CC0-1.0）'),
    'clarinet': dict(folder='clarinet', loop=True, stride=1, max_rr=1, trim_sec=4.0, trim_fade=0.05,
                     label='单簧管',   source='sgossner/VSCO-2-CE（单簧管真实录音，CC0-1.0）'),
    'bassoon':  dict(folder='bassoon',  loop=True, stride=1, max_rr=1, trim_sec=4.0, trim_fade=0.05,
                     label='巴松',     source='sgossner/VSCO-2-CE（巴松真实录音，CC0-1.0）'),
    'horn':     dict(folder='horn',     loop=True, stride=1, max_rr=2, trim_sec=4.0, trim_fade=0.05,
                     label='圆号',     source='sgossner/VSCO-2-CE（圆号真实录音，CC0-1.0）'),
    'violin':   dict(folder='violin',   loop=True, stride=1, max_rr=1, trim_sec=5.0, trim_fade=0.05,
                     label='小提琴',   source='sgossner/VSCO-2-CE（独奏小提琴真实录音，CC0-1.0）'),
}


def collect_sfz(kind):
    """Generic FreePats SFZ → (notes, rename map). Multiple SFZs become velocity layers."""
    cfg = SFZ_SETS[kind]
    rpath = os.path.join(SRC, cfg['folder'], 'regions.json')
    if not os.path.exists(rpath):
        return [], {}
    with open(rpath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    data['regions'] = dedupe_sfzs(data['regions'])
    keep_re = cfg.get('sfz_re')
    sfz_names = sorted({r['sfz'] for r in data['regions']})
    if keep_re:   # e.g. drop a repo's low-size re-record SFZ: same instrument, not a velocity layer
        sfz_names = [s for s in sfz_names if re.search(keep_re, s)]
        data['regions'] = [r for r in data['regions'] if r['sfz'] in sfz_names]
    # repos that ship lovel/hivel dynamics (eguitar soft/hard) layer by velocity band, not by SFZ —
    # a second SFZ there is often just a smaller re-record, and its regions carry the real dynamics
    bands = sorted({(r.get('lovel', 0), r.get('hivel', 127)) for r in data['regions']})
    banded = bands != [(0, 127)]
    band_id = {b: i + 1 for i, b in enumerate(bands)}
    sfz_to_layer = {name: i + 1 for i, name in enumerate(sfz_names)}
    multi = len(sfz_names) > 1 or banded
    n_layers = len(bands) if banded else len(sfz_names)

    raw = []
    for r in data['regions']:
        path = os.path.join(SRC, cfg['folder'], r['sample'])
        if not os.path.exists(path):
            continue
        x, sr = load(path)
        if cfg.get('measure', True):
            f0, midi = estimate_f0_wide(x, sr, r['midi'], span=8.0)
        else:
            f0, midi = nominal_freq(r['midi']), r['midi']   # trust the SFZ's own key label
        raw.append({'orig': r['sample'].replace('/', os.sep), 'nominal': r['midi'],
                    'measured': midi, 'freq': f0, 'dur': len(x) / sr, 'sr': sr,
                    'layer': band_id[(r.get('lovel', 0), r.get('hivel', 127))] if banded
                             else sfz_to_layer[r['sfz']]})

    # zone vote per (nominal, layer); takes within one zone are round-robins
    groups = {}
    for r in raw:
        groups.setdefault((r['nominal'], r['layer']), []).append(r)

    out, rename_map = [], {}
    # layer-major iteration: thin zones independently inside each velocity layer
    for layer in range(1, n_layers + 1):
        last_bucket = None
        for (nom, ly) in sorted((k for k in groups if k[1] == layer)):
            g = sorted(groups[(nom, ly)], key=lambda z: z['orig'])
            zone = int(round(float(np.median([z['measured'] for z in g]))))
            # thin zones evenly: skip when this zone falls in the same stride bucket as the kept one
            bucket = zone // cfg['stride']
            if bucket == last_bucket:
                continue
            last_bucket = bucket
            zone_f = nominal_freq(zone)
            if banded:
                lo, hi = bands[layer - 1]
                vel = max(0.15, min(0.95, (lo + hi) / 2 / 127.0))
            else:
                vel = 0.25 + 0.5 * (layer - 1) / max(1, n_layers - 1) if multi else 0.7
            for i, z in enumerate(g[:cfg['max_rr']]):
                cents = 1200 * np.log2(z['freq'] / zone_f)
                stray = abs(cents) > CENT_LIMIT
                base = os.path.splitext(os.path.basename(z['orig']))[0]
                # '#' is the URL fragment delimiter — the runtime fetch of such a file 404s: ship with 's'
                new_name = (f'{base}_L{layer}.wav' if multi else f'{base}.wav').replace('#', 's')
                if new_name in rename_map:  # same basename from two subfolders — keep both, suffix the rr
                    new_name = (f'{base}_rr{i + 1}_L{layer}.wav' if multi else f'{base}_rr{i + 1}.wav').replace('#', 's')
                rename_map[new_name] = z['orig']
                out.append({
                    'file': new_name, 'midi': zone,
                    'freq': round(zone_f if stray else z['freq'], 3),
                    'cents': 0.0 if stray else round(cents, 1),
                    'layer': layer, 'rr': i + 1,
                    'vel': round(vel, 2),
                    'dur': round(min(z['dur'], cfg['trim_sec']), 2), 'sr': z['sr'],
                    'trim': z['dur'] > cfg['trim_sec'] + 0.01,
                    'trimSec': cfg['trim_sec'], 'trimFade': cfg['trim_fade'],
                    'calibrated': bool(stray),
                })
    return out, rename_map


def collect_wind(folder, pattern, ext='flac'):
    """Sustained takes of one instrument, grouped into zones by their measured pitch."""
    raw = []
    for path in sorted(glob.glob(os.path.join(SRC, folder, f'*.{ext}'))):
        m = pattern.search(os.path.basename(path))
        if not m:
            continue
        nominal = note_midi(m.group(1))
        x, sr = load(path)
        f, midi = estimate_f0_wide(x, sr, nominal)
        raw.append({'file': os.path.basename(path), 'nominal': nominal, 'measured': midi,
                    'freq': f, 'dur': len(x) / sr, 'sr': sr})
    by_nom = {}
    for r in raw:
        by_nom.setdefault(r['nominal'], []).append(r)
    out = []
    for nom in sorted(by_nom):
        group = sorted(by_nom[nom], key=lambda z: z['file'])
        zone = int(round(float(np.median([g['measured'] for g in group]))))
        zone_f = nominal_freq(zone)
        for i, g in enumerate(group):
            cents = 1200 * np.log2(g['freq'] / zone_f)
            stray = abs(cents) > CENT_LIMIT
            out.append({
                'file': g['file'], 'midi': zone,
                'freq': round(zone_f if stray else g['freq'], 3),
                'cents': 0.0 if stray else round(cents, 1),
                'layer': 1, 'rr': i + 1,
                'dur': round(min(g['dur'], SUS_MAX), 2), 'sr': g['sr'],
                'trim': bool(min(g['dur'], SUS_MAX) < g['dur'] - 0.01),
                'calibrated': bool(stray),
            })
    return out


CENT_LIMIT = 25.0  # beyond this the measurement is the neighbour-string resonance, not the fundamental


def collect_xun():
    """VCSL ocarina sustains (the file names are the real pitches — spot-checked A3=437.7 Hz, C4=527.2 Hz)."""
    return collect_wind('ocarina', XUN_RE, ext='wav')


def collect_muyu():
    """VCSL slit drum ≈ 木鱼: two zones (measured Hi≈156 Hz, Lo≈108 Hz) × three hits."""
    out = []
    for path in sorted(glob.glob(os.path.join(SRC, 'slitdrum', '*.wav'))):
        m = re.match(r'LogDrum(Hi|Lo)_MedM_v(\d)', os.path.basename(path))
        if not m:
            continue
        zone = 51 if m.group(1) == 'Hi' else 45
        x, sr = load(path)
        f, midi = estimate_f0_wide(x, sr, zone)
        out.append({'file': os.path.basename(path), 'nominal': zone, 'measured': midi, 'freq': f,
                    'dur': len(x) / sr, 'sr': sr})
    by_zone = {}
    for r in out:
        by_zone.setdefault(r['nominal'], []).append(r)
    notes = []
    for zone in sorted(by_zone):
        group = sorted(by_zone[zone], key=lambda z: z['file'])
        zone_f = float(np.median([g['freq'] for g in group]))
        for i, g in enumerate(group):
            notes.append({'file': g['file'], 'midi': zone, 'freq': round(zone_f, 3), 'cents': 0.0,
                          'layer': 1, 'rr': i + 1, 'dur': round(g['dur'], 2), 'sr': g['sr']})
    return notes


def collect_gong():
    """VCSL gong: one big gong at five dynamics (measured ≈140 Hz) and a second ≈295 Hz, two takes."""
    VELOCITIES = {'p': 0.25, 'mp': 0.4, 'mf': 0.6, 'f': 0.8, 'fff': 1.0}
    takes = []  # (zone, freq, file, order)
    for path in sorted(glob.glob(os.path.join(SRC, 'gong', '*.wav'))):
        base = os.path.basename(path)
        if base == 'gong_scrape_mf.wav':
            continue
        x, sr = load(path)
        # the attack measurement is unreliable on a hard hit: search the low band where the hum settles.
        # gong_2_* is the second (smaller) gong ≈295 Hz = zone 62; the big gong ≈140 Hz = zone 49.
        zone = 62 if '_2_' in base else 49
        f, _ = estimate_f0_wide(x, sr, zone, span=5.0)
        takes.append({'file': base, 'zone': zone, 'f': f, 'sr': sr,
                      'dur': len(x) / sr, 'vel': VELOCITIES.get(base.replace('.wav', '').split('_')[-1], 0.5)})
    by_zone = {}
    for tk in takes:
        by_zone.setdefault(tk['zone'], []).append(tk)
    notes = []
    for zone in sorted(by_zone):
        group = sorted(by_zone[zone], key=lambda z: z['file'])
        # one zone = one real pitch: take the median measurement, all dynamics of that gong share it
        zone_f = float(np.median([g['f'] for g in group]))
        for i, g in enumerate(group):
            notes.append({'file': g['file'], 'midi': zone, 'freq': round(zone_f, 3), 'cents': 0.0,
                          'layer': 1, 'rr': i + 1, 'vel': g['vel'], 'dur': round(min(g['dur'], GONG_MAX), 2), 'sr': g['sr'],
                          'trim': bool(g['dur'] > GONG_MAX + 0.01), 'trimSec': GONG_MAX, 'trimFade': GONG_FADE})
    return notes


def nominal_freq(midi):
    return 440.0 * 2 ** ((midi - 69) / 12.0)


# ------------------------------------------------------------------ drum kits (FreePats, kind-split)
# A drum kit is not one melodic instrument: each drum kind gets its OWN bank and the runtime DRUMS voice
# plays the take exactly like the gong does (nearest zone, nearest velocity layer, resample by playback
# rate). Pieces are routed by sample-name prefix; the SFZ's lovel/hivel band gives each take its velocity
# so soft notes pick a soft take. Unpitched drums get no F0 measurement — the zone's nominal frequency is
# the resampling anchor (rate ≈ 1 sounds natural; the tune/pitch knob still works through it).
DRUM_ROUTER = {
    'drumkit2': [   # freepats/colomboADK — Colombo jazz drum kit (pre-mixed mono takes)
        (r'BassDrum-',       'kick',   36),
        (r'SideStick',       'rim',    37),
        (r'SnareDrum1-',     'snare',  38),   # primary snare only: 2/Dry are different drums
        (r'/LowTom-',        'tom',    41),
        (r'/MidTom-',        'tom',    45),
        (r'/HiTom-',         'tom',    48),
        (r'/ClosedHiHat-',   'hat',    42),
        (r'/(?:SemiOpen|Open|LongOpen)HiHat-', 'hat', 46),   # the open takes live one semitone zone up
        (r'Cymbal\d+iCrash', 'cymbal', 49),
    ],
    'wperc': [      # freepats/world-percussion — classroom/world percussion, routed onto existing kinds
        (r'/HandClap/',          'clap',       39),
        (r'/Claves/',            'claves',     75),
        (r'/Castanets/',         'castanets',  70),
        (r'/Tambourine/01_',     'tambourine', 54),   # 02_ is the fast-roll takes: wrong on a single tap
        (r'/Maracas/',           'shaker',     70),
        (r'/LowConga/',          'perc',       45),
        (r'/Conga/',             'perc',       48),   # '/Conga/' does not match 'HighConga' (no slash before it)
        (r'/HighConga/',         'perc',       50),
    ],
}
# one scale factor per kind (peak dBFS of the loudest take), so the kit sits next to its synth voice
# while keeping the recorded p→f dynamics BETWEEN takes intact — never normalise take-by-take
DRUM_PEAK = {'kick': -3.0, 'snare': -6.0, 'tom': -6.0, 'hat': -14.0, 'cymbal': -10.0, 'rim': -12.0,
             'clap': -6.0, 'claves': -10.0, 'castanets': -12.0, 'tambourine': -12.0,
             'shaker': -16.0, 'perc': -8.0}
DRUM_TRIM = {'cymbal': (6.0, 1.5), 'tambourine': (3.0, 0.8)}   # long rings capped with a soft fade
DRUM_LABELS = {'kick': '底鼓', 'snare': '军鼓', 'hat': '踩镲', 'tom': '通鼓', 'cymbal': '吊镲', 'rim': '边击',
               'clap': '拍手', 'claves': '响棒', 'castanets': '响板', 'tambourine': '铃鼓',
               'shaker': '沙锤', 'perc': '康加鼓'}
DRUM_MAX_RR = 6   # round-robin variety beyond six takes is inaudible in class use; keeps the bank small
DRUM_REPO = {'drumkit': 'muldjordkit', 'drumkit2': 'colomboADK', 'wperc': 'world-percussion'}


def collect_drumkit(kind):
    """Split one drum-kit repo into per-kind banks → {bank: (notes, rename_map, peak_gain)}."""
    rpath = os.path.join(SRC, kind, 'regions.json')
    if not os.path.exists(rpath):
        return {}
    with open(rpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    data['regions'] = dedupe_sfzs(data['regions'])
    router = DRUM_ROUTER[kind]

    banks = {}
    seen_names = set()
    for r in data['regions']:
        rel = r['sample'].replace('/', os.sep)
        route = next(((b, z) for pat, b, z in router if re.search(pat, r['sample'])), None)
        if route is None:
            continue
        bank, zone = route
        lo, hi = r.get('lovel', 0), r.get('hivel', 127)
        vel = round(max(0.15, min(0.95, (lo + hi) / 2 / 127.0)), 2)
        path = os.path.join(SRC, kind, rel)
        if not os.path.exists(path):
            continue
        x, sr = load(path)
        entry = banks.setdefault(bank, {'notes': [], 'renames': {}, 'maxabs': 0.0})
        # round-robins alternate within ONE velocity band: count (and cap) per zone×band,
        # or a soft take would slip into a loud note's rotation
        rr_id = 1 + len([n for n in entry['notes'] if n['midi'] == zone and n['vel'] == vel])
        if rr_id > DRUM_MAX_RR:
            continue   # enough round-robins of this drum at this dynamics
        base = os.path.basename(rel)
        parent = os.path.basename(os.path.dirname(rel))
        # wperc names repeat across folders (Castanets/01.flac, Claves/01.flac): prefix with the piece
        # the shipped name is always .wav (the copy step converts), so the rename keys match the notes
        stem = os.path.splitext(f'{parent}_{base}' if kind == 'wperc' else base)[0] + '.wav'
        new_name = stem.replace('#', 's')
        i = 2
        while new_name in seen_names:   # same take listed twice (e.g. two SFZs) — keep both copies
            stem2, ext = os.path.splitext(stem)
            new_name = f'{stem2}_{i}{ext}'.replace('#', 's')
            i += 1
        seen_names.add(new_name)
        entry['renames'][new_name] = rel
        trim = DRUM_TRIM.get(bank)
        dur = len(x) / sr
        entry['maxabs'] = max(entry['maxabs'], float(np.abs(x).max()))
        entry['notes'].append({
            'file': new_name, 'midi': zone, 'freq': round(nominal_freq(zone), 3), 'cents': 0.0,
            'layer': 1, 'rr': rr_id, 'vel': vel,
            'dur': round(min(dur, trim[0]) if trim else dur, 2), 'sr': sr,
            'trim': bool(trim and dur > trim[0] + 0.01),
            'trimSec': trim[0] if trim else 0, 'trimFade': trim[1] if trim else 0,
        })

    out = {}
    for bank, entry in banks.items():
        g = 10 ** (DRUM_PEAK[bank] / 20.0) / max(entry['maxabs'], 1e-9)
        for nt in entry['notes']:
            nt['dur'] = round(nt['dur'], 2)
        out[bank] = (entry['notes'], entry['renames'], g)
    return out


def calibrate(note):
    """Keep a small, real detune (players are not tuners); zero anything larger, which is a bad measurement.

    A zither's sympathetic strings put a second peak next to the fundamental (guzheng-55 measures 191.9 Hz
    while the string really is 196.0 Hz G3), so a wild reading must not shift the whole rendered note.
    """
    if abs(note['cents']) > CENT_LIMIT:
        note['freq'] = round(nominal_freq(note['midi']), 3)
        note['cents'] = 0.0
        note['calibrated'] = True
    return note


def main():
    do_copy = '--copy' in sys.argv
    os.makedirs(PUB, exist_ok=True)
    manifest = {
        'version': 1,
        'license': 'CC0-1.0（公有领域，可自由用于教学与作品发布）',
        'instruments': {},
    }
    LABELS = {'guzheng': '古筝', 'erhu': '二胡', 'xiao': '箫', 'suona': '唢呐', 'xun': '埙', 'muyu': '木鱼', 'gong': '大锣'}
    LOOPED = {'erhu': True, 'xiao': True, 'suona': True, 'xun': True}   # bowed / blown: the sustain is looped
    SOURCES = {
        'guzheng': 'freesound.org / Pufermufin（经 XSXB-Band-Samples 整理）',
        'erhu': 'sfzinstruments/aliexpress-erhu',
        'xiao': 'sgossner/VCSL（竖笛），经 XSXB-Band-Samples 加工成箫',
        'suona': 'sgossner/VSCO-2-CE（双簧管），经 XSXB-Band-Samples 加工成唢呐',
        'xun': 'sgossner/VCSL（陶土奥卡里那，CC0）——与埙同为陶土气鸣乐器',
        'muyu': 'sgossner/VCSL（开槽木鼓，CC0）',
        'gong': 'sgossner/VCSL（大锣真实录音，CC0）',
        'bass': 'freepats/electric-bass-YR（Yamaha RBX，finger + pick 两种演奏法，CC0-1.0）',
    }
    for name, gather, folder in (('guzheng', collect_guzheng, 'guzheng'),
                                 ('erhu', collect_erhu, 'erhu'),
                                 ('xiao', lambda: collect_wind('xiao', XIAO_RE), 'xiao'),
                                 ('suona', lambda: collect_wind('suona', SUONA_RE), 'suona'),
                                 ('xun', collect_xun, 'ocarina'),
                                 ('muyu', collect_muyu, 'slitdrum'),
                                 ('gong', collect_gong, 'gong')):
        notes = [calibrate(n) for n in gather()]
        if not notes:
            print(f'! {name}: no files')
            continue
        manifest['instruments'][name] = {
            'label': LABELS[name],
            'loop': LOOPED.get(name, False),
            'notes': notes,
            'source': SOURCES[name],
        }
        # VCSL spells sharps with '#', which is the URL fragment delimiter — the runtime fetch of such a
        # file 404s. Ship those files with an 's' instead (StdOcarina_Sus_C#5.wav → StdOcarina_Sus_Cs5.wav).
        # Browser `decodeAudioData` also does not support FLAC/OGG, so every sample ships as WAV regardless
        # of source codec (soundfile handles the decode on our side).
        dst = os.path.join(PUB, name)   # the runtime fetches samples/<instrument-name>/<file>
        if do_copy:
            os.makedirs(dst, exist_ok=True)
            for nt in notes:
                orig_name = nt['file']                             # before any rename/extension change
                if '#' in orig_name:
                    nt['file'] = orig_name.replace('#', 's')
                nt['file'] = os.path.splitext(nt['file'])[0] + '.wav'
                src = os.path.join(SRC, folder, orig_name)
                x, sr = load(src)
                if nt.get('trim'):
                    sec = nt.get('trimSec', SUS_MAX)
                    fade = nt.get('trimFade', SUS_FADE)
                    x = x[:int(sec * sr)]
                    f = max(1, int(fade * sr))
                    x[-f:] *= np.linspace(1, 0, f, dtype=np.float64)
                # ship mono float32 WAV — lightweight and decodeAudioData-friendly
                sf.write(os.path.join(dst, nt['file']), x.astype(np.float32), sr)
        else:
            # manifest-only run: still fix the file names so the manifest is consistent
            for nt in notes:
                if '#' in nt['file']:
                    nt['file'] = nt['file'].replace('#', 's')
                nt['file'] = os.path.splitext(nt['file'])[0] + '.wav'
        print(f'{name}: {len(notes)} files, {len({n["midi"] for n in notes})} pitches '
              f'{min(n["midi"] for n in notes)}-{max(n["midi"] for n in notes)}, '
              f'{sum(n["dur"] for n in notes):.1f}s total')
        worst = max(notes, key=lambda n: abs(n['cents']))
        bad = [n for n in notes if n.get('calibrated')]
        print(f'   保留真实音准偏差 ≤{CENT_LIMIT:.0f} 音分，最大 {worst["cents"]:+.1f}（{worst["file"]}）')
        if bad:
            print(f'   测量异常、已按标称音高处理 {len(bad)} 个：'
                  f'{", ".join(n["file"] for n in bad)}')

    # ------------------------------------------------------------------ bass (FreePats SFZ pipeline)
    LABELS['bass'] = '电子贝斯'
    LOOPED['bass'] = False  # plucked bass: decay is the natural instrument, not looped
    bass_notes, bass_rename = collect_bass()
    if bass_notes:
        bass_notes = [calibrate(n) for n in bass_notes]
        manifest['instruments']['bass'] = {
            'label': LABELS['bass'],
            'loop': LOOPED['bass'],
            'notes': bass_notes,
            'source': SOURCES['bass'],
        }
        folder = 'bass'
        dst = os.path.join(PUB, 'bass')
        if do_copy:
            os.makedirs(dst, exist_ok=True)
            for nt in bass_notes:
                orig_rel = bass_rename.get(nt['file'])
                if not orig_rel:
                    print(f'  ! bass rename missing for {nt["file"]}')
                    continue
                src = os.path.join(SRC, folder, orig_rel)
                if not os.path.exists(src):
                    print(f'  ! bass source missing: {src}')
                    continue
                x, sr = load(src)
                if nt.get('trim'):
                    sec = nt.get('trimSec', 8.0)
                    fade = nt.get('trimFade', 0.05)
                    x = x[:int(sec * sr)]
                    f = max(1, int(fade * sr))
                    x[-f:] *= np.linspace(1, 0, f, dtype=np.float64)
                sf.write(os.path.join(dst, nt['file']), x.astype(np.float32), sr)
        pitches = sorted({n['midi'] for n in bass_notes})
        print(f'bass: {len(bass_notes)} files (2 layers), {len(pitches)} pitches '
              f'{min(pitches)}-{max(pitches)}, {sum(n["dur"] for n in bass_notes):.1f}s total')
    else:
        print('! bass: no SFZ regions.json (run scripts/fetch_freepats.py first)')

    # ------------------------------------------------------------------ generic SFZ instruments (FreePats)
    for kind, cfg in SFZ_SETS.items():
        notes, renames = collect_sfz(kind)
        if not notes:
            print(f'! {kind}: no SFZ regions.json (run scripts/fetch_freepats.py first)')
            continue
        manifest['instruments'][kind] = {
            'label': cfg['label'],
            'loop': cfg['loop'],
            'notes': notes,
            'source': cfg['source'],
        }
        if do_copy:
            dst = os.path.join(PUB, kind)
            os.makedirs(dst, exist_ok=True)
            for nt in notes:
                orig_rel = renames.get(nt['file'])
                if not orig_rel or not os.path.exists(os.path.join(SRC, cfg['folder'], orig_rel)):
                    print(f'  ! {kind} source missing for {nt["file"]}')
                    continue
                x, sr = load(os.path.join(SRC, cfg['folder'], orig_rel))
                if nt.get('trim'):
                    sec = nt.get('trimSec', 8.0)
                    fade = nt.get('trimFade', 1.0)
                    x = x[:int(sec * sr)]
                    f = max(1, int(fade * sr))
                    x[-f:] *= np.linspace(1, 0, f, dtype=np.float64)
                sf.write(os.path.join(dst, nt['file']), x.astype(np.float32), sr)
        pitches = sorted({n['midi'] for n in notes})
        layers = sorted({n['layer'] for n in notes})
        print(f'{kind}: {len(notes)} files ({len(layers)} layers), {len(pitches)} pitches '
              f'{min(pitches)}-{max(pitches)}, {sum(n["dur"] for n in notes):.1f}s total')

    # ------------------------------------------------------------------ drum kits (FreePats, kind-split)
    # One repo feeds several drum kinds; each kind becomes its own bank the DRUMS voice plays like the gong.
    for kit in DRUM_ROUTER:
        kit_banks = collect_drumkit(kit)
        if not kit_banks:
            print(f'! {kit}: no drum regions.json (run scripts/fetch_freepats.py first)')
            continue
        for bank, (notes, renames, gain) in kit_banks.items():
            manifest['instruments'][bank] = {
                'label': DRUM_LABELS[bank],
                'loop': False,
                'notes': notes,
                'source': f'freepats/{DRUM_REPO[kit]}（真实录音，CC0-1.0）',
            }
            if do_copy:
                dst = os.path.join(PUB, bank)
                os.makedirs(dst, exist_ok=True)
                for nt in notes:
                    orig_rel = renames.get(nt['file'])
                    if not orig_rel:
                        print(f'  ! {kit}/{bank} rename missing for {nt["file"]}')
                        continue
                    src = os.path.join(SRC, kit, orig_rel)
                    if not os.path.exists(src):
                        print(f'  ! {kit}/{bank} source missing: {src}')
                        continue
                    x, sr = load(src)
                    x = x * gain   # one scale per kind: keeps the p→f dynamics between takes
                    if nt.get('trim'):
                        sec = nt.get('trimSec', 6.0)
                        fade = nt.get('trimFade', 1.5)
                        x = x[:int(sec * sr)]
                        f = max(1, int(fade * sr))
                        x[-f:] *= np.linspace(1, 0, f, dtype=np.float64)
                    sf.write(os.path.join(dst, nt['file']), x.astype(np.float32), sr)
            vels = sorted({n['vel'] for n in notes})
            print(f'{bank}: {len(notes)} files, vel layers {vels}, '
                  f'{sum(n["dur"] for n in notes):.1f}s total')

    path = os.path.join(PUB, 'manifest.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('manifest →', path)


if __name__ == '__main__':
    main()
