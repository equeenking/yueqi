// Realtime engine singleton. Browsers only allow audio after a user gesture,
// so the AudioContext is created lazily by ensureEngine() (called from click/key handlers).
import { AudioEngine } from './engine.js';
import { loadSampleBank } from './sampleBank.js';
import { clearModelCache } from './models.js';

let engine = null;
const listeners = new Set();

// The recordings behind guzheng and erhu start downloading as soon as the page is idle (decoding needs no gesture),
// so the sample-only instruments are offered almost by the time the first note is played. Until then a channel of
// one is silent rather than wrong — see modelOf in models.js.
let bankPromise = null;
function ensureBank() {
  if (!bankPromise) {
    bankPromise = loadSampleBank().then(() => {
      // notes rendered before the bank arrived are the synthesized ones: they must not be served now
      clearModelCache();
      if (engine) engine.prewarmModels();
    });
  }
  return bankPromise;
}
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => ensureBank(), { timeout: 2500 });
  else setTimeout(() => ensureBank(), 800);
}

export function getEngine() {
  return engine;
}

export function onEngineReady(fn) {
  listeners.add(fn);
  if (engine) fn(engine);
  return () => listeners.delete(fn);
}

export async function ensureEngine() {
  if (!engine) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    engine = new AudioEngine(ctx);
    for (const fn of listeners) fn(engine);
  }
  ensureBank();
  if (engine.ctx.state === 'suspended') {
    try { await engine.ctx.resume(); } catch { /* needs a gesture */ }
  }
  return engine;
}

