// Real recordings behind the instruments that have a sample bank.
//
// Lazy-load design — the manifest (metadata only, ~tens of KB) fetches first and fills every instrument's bank
// skeleton immediately, so the UI can show "采样" chips right away. The actual WAVs (1–6 MB per instrument,
// ~hundreds of MB total once Phase 2 lands) are then fetched and decoded one instrument at a time in the
// background (2-way concurrent). Any render path that hits an instrument whose notes still have no `data`
// falls through to the physical model — the ear hears the synth for that one click, then the real recording
// next time. Offline renders/exports call `waitForAllInstruments()` first so they always use every real take.
//
// Layers of a sampled note, in the order a sampler would apply them:
//   zone      the nearest recorded pitch (measured fundamental, never the file name: both libraries mislabel octaves)
//   round     robin across the takes of that pitch, so repeated notes are never bit-identical
//   pitch     resampled to the target frequency in one pass (also converts 48 kHz recordings to the render rate)
//   loop      bowed notes only: the sustain is crossfaded round until it fills the requested length
//   voice     brightness / body / vibrato of the instrument's own params shape the recording instead of generating it
//
// Everything is plain Float32Array work: no Web Audio node is created here, so an OfflineAudioContext export sounds
// exactly like the live engine.

const state = {
  base: '/samples/',
  manifest: null,
  banks: new Map(),              // model -> { loop, label, source, notes:[{midi,freq,layer,rr,vel,file,rate,data?}], byMidi, loaded, loading }
  loading: null,                 // Promise<manifest-loaded> — the `loadSampleBank` one-shot
  ready: false,                  // manifest loaded (banks have metadata skeletons; data may still be fetching)
  instrumentLoading: new Map(),  // model -> Promise<bank-fully-decoded>
};

export const sampleBankReady = () => state.ready;

/** Is there a real recording for this instrument? (true as soon as the manifest lists it — data may still be loading) */
export const hasSampleBank = (model) => state.banks.has(model);

/** Does this instrument's bank hold sustained takes (bowed / blown), i.e. does a note-off need a release? */
export const bankLooped = (model) => !!state.banks.get(model)?.loop;

/** Have we decoded every WAV of every instrument in the manifest? */
export const allInstrumentsLoaded = () =>
  state.ready && [...state.banks.values()].every((b) => b.loaded);

/** The recorded pitches of an instrument: [{ midi, freq, seconds }] — used by the UI to show its range. */
export function sampleRange(model) {
  const b = state.banks.get(model);
  if (!b) return null;
  const mids = b.notes.map((n) => n.midi);
  return { low: Math.min(...mids), high: Math.max(...mids), takes: b.notes.length };
}

/**
 * Load the manifest (metadata only) and kick off background prefetch for every instrument. Resolves
 * as soon as the manifest is parsed — call `waitForAllInstruments()` after this to block until all
 * WAVs are decoded (required for offline renders/stems). Safe to call twice.
 */
export function loadSampleBank(base = state.base) {
  if (state.loading) return state.loading;
  state.base = base;
  state.loading = (async () => {
    let manifest;
    try {
      // no-cache: the manifest grows when the bank gains instruments; the WAVs are immutable and force-cache
      const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      manifest = await res.json();
    } catch {
      return; // offline build / no bank: every instrument falls back to its physical model
    }
    state.manifest = manifest;
    // skeleton banks — notes hold metadata only; `data` is null until the WAV decodes
    for (const [model, def] of Object.entries(manifest.instruments || {})) {
      const bank = {
        loop: !!def.loop,
        label: def.label,
        source: def.source,
        notes: (def.notes || []).map((n) => ({ ...n, data: null })),
        byMidi: new Map(),
        loaded: false,
      };
      for (const n of bank.notes) {
        if (!bank.byMidi.has(n.midi)) bank.byMidi.set(n.midi, []);
        bank.byMidi.get(n.midi).push(n);
      }
      for (const list of bank.byMidi.values()) list.sort((a, b) => a.rr - b.rr);
      state.banks.set(model, bank);
    }
    state.ready = state.banks.size > 0;
    globalThis.dispatchEvent?.(new CustomEvent('samplebank-ready', { detail: { instruments: [...state.banks.keys()] } }));
    // start background prefetch (2-way concurrency) so instruments arrive a few seconds after the manifest
    if (state.banks.size) queueMicrotask(() => preloadAll());
  })();
  return state.loading;
}

/** Pre-decode every instrument in the bank, 2 at a time. The realtime engine doesn't block on this —
 *  it just falls through to the physical model until an instrument finishes landing. */
async function preloadAll() {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx(1, 1, 48000);
  const queue = [...state.banks.keys()];
  const worker = async () => {
    while (queue.length) {
      const model = queue.shift();
      await decodeInstrument(model, ctx);
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Fetches+decodes this many files at once. Firing every take of an instrument (35–38 files) at the
 *  browser in one burst deadlocks the load: Chromium serves 6 requests per host, and the queued
 *  fetches/decodes of two concurrent instruments can stall forever (observed: an instrument stuck at
 *  5/35 with the queue never advancing, while single fetches still succeed). A small window keeps the
 *  pipeline moving and the memory peak flat. */
const FILES_AT_A_TIME = 6;

/** Decode one instrument's WAVs into its bank (no-op if already decoded). Safe to call from realtime,
 *  background preload, or export code. Resolves when the bank is usable. */
export function decodeInstrument(model, ctxArg) {
  const bank = state.banks.get(model);
  if (!bank || bank.loaded) return Promise.resolve(bank);
  let p = state.instrumentLoading.get(model);
  if (p) return p;
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) return Promise.resolve(bank);
  const ctx = ctxArg || new Ctx(1, 1, 48000);
  p = (async () => {
    const decodeNote = async (note) => {
      try {
        const r = await fetch(`${state.base}${model}/${note.file}`, { cache: 'force-cache' });
        if (!r.ok) return;
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        note.data = buf.getChannelData(0).slice(); // copy: decoded buffer is shared
        note.rate = buf.sampleRate;
      } catch {
        /* one unreadable file must not cost the whole instrument */
      }
    };
    const pending = bank.notes.filter((n) => !n.data);
    for (let i = 0; i < pending.length; i += FILES_AT_A_TIME) {
      await Promise.all(pending.slice(i, i + FILES_AT_A_TIME).map(decodeNote));
    }
    bank.loaded = bank.notes.some((n) => n.data);
    state.instrumentLoading.delete(model);
    globalThis.dispatchEvent?.(new CustomEvent('samplebank-instrument-loaded', { detail: { model } }));
    return bank;
  })();
  state.instrumentLoading.set(model, p);
  return p;
}

/** Block until every instrument in the bank has finished decoding. Offline renders/exports must await this
 *  after `loadSampleBank()` so they get the real recordings — the live engine prefers to keep playing. */
export async function waitForAllInstruments() {
  await loadSampleBank();
  const pending = [...state.banks.keys()].map((m) => decodeInstrument(m));
  await Promise.all(pending);
}

const roundRobin = new Map(); // `${model}|${midi}` -> take counter

/**
 * Pick the take for one note: the nearest recorded pitch, rotating through that pitch's takes.
 * Returns null if the bank has not decoded its WAVs yet (caller should fall back to physical model).
 */
function pickTake(model, key, variant) {
  const bank = state.banks.get(model);
  if (!bank || !bank.notes.length) return null;
  // instrument still loading — renderSampledNote will fall through to the model
  if (!bank.notes[0]?.data) return null;
  let best = null;
  let bestDist = Infinity;
  for (const midi of bank.byMidi.keys()) {
    const d = Math.abs(midi - key);
    if (d < bestDist) { bestDist = d; best = midi; }
  }
  const list = bank.byMidi.get(best);
  if (!list || !list.length) return null;
  // banks with real velocity layers (VSCO winds: p vs f takes) must not rotate soft and hard hits
  // through one round-robin: pick the nearest recorded dynamic first, then alternate inside it
  let pool = list;
  if (list.some((n) => n.vel != null)) {
    const want = variant / 100;
    let vd = Infinity;
    for (const n of list) {
      const d = Math.abs(n.vel - want);
      if (d < vd) { vd = d; pool = list.filter((z) => z.vel === n.vel); }
    }
  }
  const id = `${model}|${key}|${variant}`;
  const n = roundRobin.get(id) || 0;
  roundRobin.set(id, n + 1);
  return pool[n % pool.length];
}

// ------------------------------------------------------------------ dsp

/**
 * Pick a take for a realtime (Web Audio) voice — world.js plays gong recordings directly through an
 * AudioBufferSourceNode instead of going through the note-buffer pipeline. Chooses the recorded pitch
 * closest in cents to `freq`, then (when the takes are velocity layers, i.e. they carry a `vel`) the
 * recorded dynamic closest to `velRaw`; without velocity layers it falls back to the take whose round-robin
 * slot matches. Deterministic: the same note renders identically in the live engine and in an export.
 */
export function getBankTake(model, freq, velRaw = 0.8) {
  const bank = state.banks.get(model);
  if (!bank || !bank.notes.length) return null;
  if (!bank.notes[0]?.data) return null; // instrument still loading
  let zone = null;
  let zd = Infinity;
  for (const midi of bank.byMidi.keys()) {
    const d = Math.abs(1200 * Math.log2(bank.byMidi.get(midi)[0].freq / freq));
    if (d < zd) { zd = d; zone = midi; }
  }
  const list = bank.byMidi.get(zone);
  if (!list || !list.length) return null;
  let take = list[0];
  let td = Infinity;
  for (const n of list) {
    const d = n.vel != null ? Math.abs(n.vel - velRaw) : Math.abs((n.rr - 0.5) / list.length - velRaw);
    if (d < td) { td = d; take = n; }
  }
  return take;
}

/** Cubic (Catmull-Rom) read from `src` at fractional index i — better than linear on the top octave, still cheap. */
function readCubic(src, i) {
  const i0 = Math.floor(i);
  const t = i - i0;
  const a = src[i0 - 1] ?? 0;
  const b = src[i0] ?? 0;
  const c = src[i0 + 1] ?? 0;
  const d = src[i0 + 2] ?? 0;
  const c0 = b;
  const c1 = 0.5 * (c - a);
  const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
  const c3 = 0.5 * (d - a) + 1.5 * (b - c);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

/** One-pole low-pass, in place (same kernel the physical models use). */
function lowpass(x, sr, hz) {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(hz, sr * 0.45)) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; }
}

/** RBJ peaking biquad, in place — the resonator body of a fiddle or a zither soundboard. */
function peaking(x, sr, f, q, gainDb) {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * cos) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha / A) / a0;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
}

/**
 * Cut a seamless loop unit out of a held recording: take `startSample`..end and crossfade its tail into its own
 * head, so repeating the unit has no seam at all. Returns the unit (at the recording's rate).
 */
function makeLoopUnit(src, startSample, fadeSamples) {
  const from = Math.max(0, Math.min(src.length - 1, Math.round(startSample)));
  const span = src.length - from;
  const fade = Math.max(16, Math.min(fadeSamples, Math.floor(span / 3)));
  const outLen = Math.max(64, span - fade);
  const unit = new Float32Array(outLen);
  unit.set(src.subarray(from, from + outLen));
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    unit[outLen - fade + i] = unit[outLen - fade + i] * (1 - w) + src[from + i] * w;
  }
  return unit;
}

/** Read `unit` as a forever-looping source, advancing `step` samples of it per output sample. */
function readLoop(unit, i, step) {
  const pos = (i * step) % unit.length;
  return readCubic(unit, pos);
}

// ------------------------------------------------------------------ voicing

/**
 * Render one sampled note, or null when the instrument has no bank (or the bank hasn't finished decoding yet).
 * `p` is the instrument's own param set; only the keys it understands are used, so a bank can be dropped behind an
 * existing UI without adding knobs.
 */
export function renderSampledNote(model, sr, key, layerVelocity, params) {
  const p = params || {};
  const bank = state.banks.get(model);
  if (!bank || !bank.notes.length) return null;
  if (!bank.notes[0]?.data) return null; // still loading — caller falls back to physical model
  const take = pickTake(model, key, Math.round(layerVelocity * 100));
  if (!take) return null;

  const target = 440 * Math.pow(2, (key - 69) / 12);
  const step = (take.freq / target) * (take.rate / sr);
  // wind and reeds have no `brightness` knob: their 音色/明亮度 knob is `tone`, and it drives the same filter
  const brightness = p.brightness ?? p.tone ?? 0.6;

  // voice length: plucked notes keep their recorded decay (the recording *is* the decay); bowed notes are held
  const sustain = p.sustain != null ? p.sustain : (bank.loop ? 3.0 : 2.2);
  const naturalSec = take.data.length / take.rate;
  const wantSec = bank.loop
    ? Math.max(0.35, Math.min(sustain * 1.15, 9))
    : Math.min(naturalSec / step * 0.999, Math.max(0.3, sustain * 1.6));
  const outLen = Math.max(512, Math.ceil(wantSec * sr));
  const out = new Float32Array(outLen);

  if (bank.loop) {
    // a bow holds the note: loop the steady state (after the 0.12 s attack) instead of letting it die away
    const unit = makeLoopUnit(take.data, 0.12 * take.rate, 0.05 * take.rate);
    const unitStep = step;
    for (let i = 0; i < outLen; i++) out[i] = readLoop(unit, i, unitStep);
  } else {
    for (let i = 0; i < outLen; i++) out[i] = readCubic(take.data, i * step);
  }

  // ---- the instrument's params, applied to the recording -----------------
  // brightness: the zither's 义甲 / the player's bow pressure, a low-pass whose corner follows it
  lowpass(out, sr, 900 + Math.pow(brightness, 1.4) * 14000);
  // body: soundboard / snakeskin resonance
  const body = p.body ?? 0.6;
  if (body > 0.01) peaking(out, sr, bank.loop ? 760 : 320, 1.1, (body - 0.5) * 7);
  // a plucked zither's airy top end comes from the soundboard, not a filter: lift it a little when bright
  if (!bank.loop && brightness > 0.5) peaking(out, sr, 4200, 0.9, (brightness - 0.5) * 6);
  // double reeds: the 鼻音 knob pushes the horn's formants, which is what makes a suona cut through a street band
  if (p.nasal != null && Math.abs(p.nasal - 0.5) > 0.01) {
    peaking(out, sr, 1350, 2.2, (p.nasal - 0.5) * 7);
    peaking(out, sr, 3100, 2.0, (p.nasal - 0.5) * 5);
  }

  // vibrato: baked into the recording (a real player's 揉弦 is continuous pitch motion, not an LFO on a static sample)
  const vib = p.vibrato ?? 0;
  if (vib > 0.02 && bank.loop) {
    const rate = p.vibratoRate ?? 5;
    const depth = vib * 45; // cents
    const src2 = out.slice();
    const delay = Math.round(0.12 * sr);
    let idx = 0;
    for (let i = 0; i < outLen; i++) {
      out[i] = readCubic(src2, idx);
      const cents = i < delay ? 0 : depth * Math.sin((2 * Math.PI * rate * (i - delay)) / sr);
      idx += Math.pow(2, cents / 1200); // phase accumulation: the pitch follows the sine, the phase never jumps
      if (idx >= src2.length) idx -= src2.length;
    }
  }

  // velocity: harder notes are brighter and louder; the levels follow the same -18 dBFS attack-RMS target as the models
  if (layerVelocity < 0.9) {
    lowpass(out, sr, 1400 + layerVelocity * 9000);
  }

  // attack / release shaping
  const atk = Math.max(0.001, p.attack ?? 0.004);
  const atkLen = Math.min(Math.round(atk * sr), Math.round(outLen * 0.5));
  for (let i = 0; i < atkLen; i++) out[i] *= i / atkLen;
  const rel = Math.max(0.02, p.release ?? 0.2);
  const relLen = Math.min(Math.round(rel * sr), Math.round(outLen * 0.6));
  for (let i = 0; i < relLen; i++) out[outLen - 1 - i] *= i / relLen;

  // click guard on both ends of the buffer
  const guard = Math.min(Math.round(0.002 * sr), Math.round(outLen / 4));
  for (let i = 0; i < guard; i++) { out[i] *= i / guard; out[outLen - 1 - i] *= i / guard; }
  return out;
}

/** Loudness levelling shared with the physical models (attack-window RMS → -18 dBFS, soft-kneed peaks).
 *
 * A plucked note is judged by its attack, but a held one (bowed / blown) is judged by the level it settles to — and
 * those two differ by 10 dB and more on a sustained take. `fromSec` moves the measuring window past the attack so a
 * looping note is levelled by its steady state, which is what the ear compares. */
export function levelRecording(x, sr, fadeMs = 30, fromSec = 0) {
  const attackRms = Math.pow(10, -18 / 20);
  const knee = 0.75;
  const at = Math.min(Math.max(0, Math.round(fromSec * sr)), Math.max(0, x.length - 1));
  const n = Math.min(x.length - at, Math.round(sr * 0.3));
  let s = 0;
  for (let i = 0; i < n; i++) s += x[at + i] * x[at + i];
  const rms = Math.sqrt(s / Math.max(1, n));
  const g = rms > 1e-9 ? attackRms / rms : 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * g;
    const a = Math.abs(v);
    x[i] = a <= knee ? v : Math.sign(v) * (knee + 0.2 * Math.tanh((a - knee) / 0.2));
  }
  const f = Math.min(x.length, Math.round((sr * fadeMs) / 1000));
  for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f;
  return x;
}
