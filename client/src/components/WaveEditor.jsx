// The wave editor: open a sample, select, cut/copy/paste, fades, gain, normalise, reverse, speed, stretch, pitch shift
// and pitch correction (the Pitch tab), with undo/redo; save as a new sample or over the original (every project that
// uses it changes, after a warning that says which).
import { useState, useRef, useEffect, useCallback } from 'react';
import { clipLength, sliceClip, deleteRange, insertClip, cropClip, waveformPeaks, nearestZeroCrossing } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { Window } from './ui/Window.jsx';
import { Icon } from './ui/Icon.jsx';
import { useElementSize, capturePointer } from '../lib/hooks.js';
import { decodeSample, editClip, clipToBuffer, saveClipAsSample, replaceSampleAudio } from '../lib/audioEdit.js';
import { PitchView } from './PitchView.jsx';

const HISTORY_BYTES = 256 * 1024 * 1024; // undo keeps whole clips: drop the oldest steps beyond this
const RULER = 18;
const MIN_SPAN = 48; // frames visible at the deepest zoom
let clipboard = null; // copied audio, shared by every sample opened in the editor
let stateSeq = 0;
let docSeq = 0; // each loaded document gets its own key: a save that finishes later only touches the one it saved
const bufferCache = new WeakMap(); // clip -> AudioBuffer (one per edit state)

const clipBytes = (c) => c.channels.reduce((a, ch) => a + ch.byteLength, 0);

/** 1.234 s, or 2:03.456 from a minute up. */
export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '–';
  if (sec < 60) return `${sec.toFixed(3)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(3).padStart(6, '0')}`;
}

const STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function bufferFor(ctx, clip) {
  let b = bufferCache.get(clip);
  if (!b) bufferCache.set(clip, (b = clipToBuffer(ctx, clip)));
  return b;
}

/** Draw a waveform (all channels in lanes) of frames [view.start, view.end) with the selection. */
function drawWave(canvas, clip, view, sel, { ruler = true } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const span = view.end - view.start;
  const xAt = (f) => ((f - view.start) / span) * W;
  const top = ruler ? RULER : 0;
  // selection
  if (sel.end > sel.start) {
    g.fillStyle = 'rgba(245, 159, 66, 0.2)';
    g.fillRect(xAt(sel.start), top, Math.max(1, xAt(sel.end) - xAt(sel.start)), H - top);
  }
  const lanes = clip.channels.length;
  const laneH = (H - top) / lanes;
  for (let ch = 0; ch < lanes; ch++) {
    const y0 = top + ch * laneH;
    const mid = y0 + laneH / 2;
    const amp = laneH / 2 - 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    g.beginPath();
    g.moveTo(0, mid + 0.5);
    g.lineTo(W, mid + 0.5);
    if (ch > 0) { g.moveTo(0, y0 + 0.5); g.lineTo(W, y0 + 0.5); }
    g.stroke();
    g.fillStyle = g.strokeStyle = '#9ad94f';
    const perPx = span / W;
    if (perPx > 1) {
      const cols = Math.ceil(W);
      const peaks = waveformPeaks(clip, view.start, view.end, cols, ch);
      g.beginPath();
      for (let x = 0; x < cols; x++) {
        const lo = peaks[2 * x];
        const hi = peaks[2 * x + 1];
        g.rect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      g.fill();
    } else {
      // zoomed in: the actual samples, joined (dots when they are far apart)
      const c = clip.channels[ch];
      g.lineWidth = 1.2;
      g.beginPath();
      const a = Math.max(0, Math.floor(view.start) - 1);
      const b = Math.min(c.length, Math.ceil(view.end) + 1);
      for (let i = a; i < b; i++) {
        const x = xAt(i);
        const y = mid - c[i] * amp;
        if (i === a) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      if (1 / perPx > 8) for (let i = a; i < b; i++) g.fillRect(xAt(i) - 1.5, mid - c[i] * amp - 1.5, 3, 3);
    }
  }
  if (ruler) drawRuler(g, W, view, clip.sampleRate);
  // cursor
  if (sel.end === sel.start) {
    g.fillStyle = '#f59f42';
    g.fillRect(Math.round(xAt(sel.start)), top, 1, H - top);
  }
}

function drawRuler(g, W, view, sr) {
  const pxPerSec = (W / (view.end - view.start)) * sr;
  const step = STEPS.find((s) => s * pxPerSec >= 70) || 600;
  g.fillStyle = '#1b2026';
  g.fillRect(0, 0, W, RULER);
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  g.font = '10px ui-monospace, monospace';
  g.textBaseline = 'middle';
  const t0 = Math.ceil(view.start / sr / step) * step;
  g.beginPath();
  for (let t = t0; t * sr <= view.end; t += step) {
    const x = Math.round(((t * sr - view.start) / (view.end - view.start)) * W) + 0.5;
    g.moveTo(x, RULER - 6);
    g.lineTo(x, RULER);
    const label = step < 0.01 ? `${(t * 1000).toFixed(1)}ms` : step < 1 ? `${t.toFixed(step < 0.1 ? 2 : 1)}s` : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round(t)}s`;
    g.fillText(label, x + 3, RULER / 2);
  }
  g.stroke();
}

/** Zoomed view of `span` frames centred on `center`, kept inside the clip. */
function viewAround(len, center, span) {
  const s = Math.max(Math.min(len, MIN_SPAN), Math.min(len, span));
  let a = center - s / 2;
  a = Math.max(0, Math.min(len - s, a));
  return { start: a, end: a + s };
}

export function WaveEditor() {
  const open = useStore((s) => !!s.windows.waveEditor?.open);
  const sampleId = useStore((s) => s.editSampleId);
  const sample = useStore((s) => s.samples.find((x) => x.id === s.editSampleId) || null);
  const tab = useStore((s) => s.editTab);
  const [doc, setDoc] = useState(null); // { id, rev, clip, past, future, stateId, savedId }
  const [load, setLoad] = useState({ status: 'idle', error: null });
  const [busy, setBusy] = useState(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [view, setView] = useState({ start: 0, end: 1 });
  const [loop, setLoop] = useState(false);
  const [snapZero, setSnapZero] = useState(true);
  const [play, setPlay] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const docRef = useRef(null); // the document as rendered last (edits that finish later check it hasn't changed)
  const bodyRef = useRef(null);
  const pitchMemory = useRef(null); // the Pitch tab's notes and settings, kept while switching tabs
  const waveRef = useRef(null);
  const overviewRef = useRef(null);
  const playheadRef = useRef(null);
  const drag = useRef(null);
  const saving = useRef(false);
  const size = useElementSize(waveRef);
  const st = useStore.getState();
  const clip = doc?.clip || null;
  docRef.current = doc;
  const busyRef = useRef(null); // the busy state as rendered last (a save that waited for a dialog checks it again)
  busyRef.current = busy;
  const len = clip ? clipLength(clip) : 0;
  const sr = clip?.sampleRate || 44100;
  const dirty = !!doc && doc.stateId !== doc.savedId;
  const hasSel = sel.end > sel.start;
  // the sample was replaced (by Claude or another tab) since this audio was loaded, or deleted
  const stale = !!doc && !!sample && doc.id === sample.id && doc.rev !== (sample.rev || 1);
  const deleted = !!doc && !sample;
  const name = sample?.name || doc?.name || '采样';

  useEffect(() => { useStore.setState({ editorDirty: dirty }); }, [dirty]);
  // closing the browser tab with unsaved edits asks first
  const savingNow = useStore((s) => s.editorSaving);
  useEffect(() => {
    if (!dirty && !savingNow) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, savingNow]);

  // load the sample — again when it was replaced elsewhere and nothing here is unsaved (or after Reload)
  useEffect(() => {
    if (!open || !sample) return undefined;
    // not while an edit is running (its result belongs to this audio), nor over unsaved work or a redo history
    if (doc && doc.id === sample.id && doc.loadedFor === reloadKey && (doc.rev === (sample.rev || 1) || dirty || busy || doc.future.length || saving.current)) return undefined;
    let live = true;
    setLoad({ status: 'loading', error: null });
    decodeSample(sample).then((c) => {
      if (!live) return;
      const id = ++stateSeq;
      pitchMemory.current = null;
      setDoc({ key: ++docSeq, id: sample.id, name: sample.name, rev: sample.rev || 1, clip: c, past: [], future: [], stateId: id, savedId: id, loadedFor: reloadKey });
      setSel({ start: 0, end: 0 });
      setView({ start: 0, end: Math.max(1, clipLength(c)) });
      setLoad({ status: 'ready', error: null });
    }, (e) => { if (live) setLoad({ status: 'error', error: e.message }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sample?.id, sample?.rev, dirty, busy, reloadKey]);

  // closing the window lets go of the audio (and the undo history)
  useEffect(() => {
    if (open) return;
    play?.stop();
    setPlay(null);
    setDoc(null);
    setLoad({ status: 'idle', error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // redraw
  useEffect(() => {
    if (!clip || tab !== 'wave' || !waveRef.current) return;
    drawWave(waveRef.current, clip, view, sel);
  }, [clip, view, sel, size.width, size.height, tab]);
  useEffect(() => {
    const cv = overviewRef.current;
    if (!clip || !cv) return;
    drawWave(cv, clip, { start: 0, end: len }, { start: 0, end: 0 }, { ruler: false });
    const g = cv.getContext('2d');
    const W = cv.clientWidth;
    g.strokeStyle = '#f59f42';
    g.lineWidth = 1;
    g.strokeRect((view.start / len) * W + 0.5, 0.5, Math.max(2, ((view.end - view.start) / len) * W) - 1, cv.clientHeight - 1);
  }, [clip, view, len, size.width]);

  // playhead (moved directly, no re-render), following the playback
  useEffect(() => {
    if (!play) { if (playheadRef.current) playheadRef.current.style.display = 'none'; return undefined; }
    let id;
    const tick = () => {
      const ctx = play.src.context;
      let t = ctx.currentTime - play.startedAt;
      if (t < 0) t = 0;
      if (play.loop) t %= play.duration; else t = Math.min(t, play.duration);
      const frame = (play.offset + t) * play.rate;
      const el = playheadRef.current;
      if (el?.parentElement) {
        const W = el.parentElement.clientWidth;
        const x = ((frame - view.start) / (view.end - view.start)) * W;
        el.style.display = x >= 0 && x <= W ? 'block' : 'none';
        el.style.transform = `translateX(${x}px)`;
        if (x > W && !play.loop) setView((v) => viewAround(len, frame + (v.end - v.start) / 2 - (v.end - v.start) * 0.05, v.end - v.start));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [play, view, len]);

  const stopPlay = useCallback(() => { play?.stop(); setPlay(null); }, [play]);
  useEffect(() => () => play?.stop(), [play]);

  /** Play `c` (default: the current audio) — the selection, or from the cursor to the end. */
  const playClip = useCallback(async (c = clip, { range = sel } = {}) => {
    if (!c) return;
    play?.stop();
    const eng = await useStore.getState().unlockAudio();
    if (!eng) return;
    const buf = bufferFor(eng.ctx, c);
    const rate = c.sampleRate;
    const n = clipLength(c);
    const ranged = range.end > range.start;
    let offset = Math.min(range.start, n) / rate;
    if (!ranged && offset >= buf.duration - 0.01) offset = 0;
    const duration = ranged ? (Math.min(range.end, n) - Math.min(range.start, n)) / rate : buf.duration - offset;
    const h = eng.playBuffer(buf, { offset, duration, loop: loop && ranged });
    h.rate = rate;
    h.onEnded = () => setPlay((p) => (p === h ? null : p));
    setPlay(h);
  }, [clip, sel, loop, play]);

  const togglePlay = () => (play ? stopPlay() : playClip());

  // keep the keyboard in the editor after a button (which may now be disabled) did an edit, so Ctrl+Z undoes it here
  const keepFocus = () => requestAnimationFrame(() => {
    const el = bodyRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  });

  /** A new edit state (one undo step). */
  const commit = useCallback((next, label) => {
    setDoc((d) => {
      let past = [...d.past, { clip: d.clip, stateId: d.stateId, label }];
      let bytes = past.reduce((a, e) => a + clipBytes(e.clip), 0) + clipBytes(next);
      while (bytes > HISTORY_BYTES && past.length > 1) { bytes -= clipBytes(past[0].clip); past = past.slice(1); }
      return { ...d, clip: next, past, future: [], stateId: ++stateSeq };
    });
    keepFocus();
  }, []);

  const fitSel = (c, s) => {
    const n = clipLength(c);
    return { start: Math.min(s.start, n), end: Math.min(s.end, n) };
  };

  /** Run a named edit on the selection (or the whole sample). `after(newClip)` sets the selection afterwards. */
  const runOp = async (op, label, after) => {
    if (!clip || busy) return;
    const ranged = hasSel ? { start: sel.start / sr, end: sel.end / sr } : {};
    setBusy(`${label}…`);
    try {
      const r = await editClip(clip, { ...ranged, ...op });
      if (docRef.current?.clip !== clip) return st.toast(`${label}：这期间音频变了，结果已丢弃`, 'warn');
      play?.stop();
      commit(r.clip, label);
      setSel(after ? after(r.clip) : fitSel(r.clip, sel));
      setView(viewAfter(clipLength(r.clip)));
      if (r.note) st.toast(r.note, 'info', 2200);
    } catch (e) {
      st.toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /** The view after the length changed to n: a whole-sample view stays whole, a zoomed one stays inside the audio. */
  const viewAfter = (n, whole = false) => (v) => {
    if (whole || (v.start <= 0 && v.end >= len)) return { start: 0, end: Math.max(1, n) };
    return v.end > n ? viewAround(n, (v.start + v.end) / 2, v.end - v.start) : v;
  };
  const syncEdit = (next, label, nextSel) => {
    if (busy) return;
    play?.stop();
    commit(next, label);
    setSel(nextSel);
    setView(viewAfter(clipLength(next), label === 'Trim'));
  };

  const copy = () => { if (hasSel) { clipboard = sliceClip(clip, sel.start, sel.end); st.toast(`已复制 ${fmtTime((sel.end - sel.start) / sr)}`, 'info', 1200); } };
  const cut = () => { if (!hasSel || busy) return; copy(); syncEdit(deleteRange(clip, sel.start, sel.end), '剪切', { start: sel.start, end: sel.start }); };
  const del = () => { if (hasSel) syncEdit(deleteRange(clip, sel.start, sel.end), '删除', { start: sel.start, end: sel.start }); };
  const crop = () => { if (hasSel) syncEdit(cropClip(clip, sel.start, sel.end), '裁切', { start: 0, end: 0 }); };
  const paste = () => {
    if (!clipboard) return st.toast('还没有复制任何内容', 'warn', 1500);
    const next = insertClip(clip, sel.start, clipboard, hasSel ? sel.end : undefined);
    const added = clipLength(next) - (len - (hasSel ? sel.end - sel.start : 0));
    syncEdit(next, '粘贴', { start: sel.start, end: sel.start + added });
  };
  const undo = () => {
    if (!doc?.past.length || busy) return;
    play?.stop();
    setDoc((d) => {
      const prev = d.past[d.past.length - 1];
      return { ...d, clip: prev.clip, stateId: prev.stateId, past: d.past.slice(0, -1), future: [{ clip: d.clip, stateId: d.stateId, label: prev.label }, ...d.future] };
    });
    const back = doc.past[doc.past.length - 1].clip;
    setSel((s) => fitSel(back, s));
    setView(viewAfter(clipLength(back)));
    keepFocus();
  };
  const redo = () => {
    if (!doc?.future.length || busy) return;
    play?.stop();
    setDoc((d) => {
      const next = d.future[0];
      return { ...d, clip: next.clip, stateId: next.stateId, future: d.future.slice(1), past: [...d.past, { clip: d.clip, stateId: d.stateId, label: next.label }] };
    });
    const fwd = doc.future[0].clip;
    setSel((s) => fitSel(fwd, s));
    setView(viewAfter(clipLength(fwd)));
    keepFocus();
  };
  const selectAll = () => setSel({ start: 0, end: len });

  const ask = async (title, label, value, check) => {
    const v = await st.prompt({ title, label, value: String(value) });
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || (check && !check(n))) { st.toast(`「${v}」不是有效的值`, 'error'); return null; }
    return n;
  };
  const newLength = (factor) => (c) => (hasSel ? { start: sel.start, end: sel.start + Math.round((sel.end - sel.start) * factor) } : fitSel(c, { start: 0, end: 0 }));
  const process = {
    fadeIn: () => runOp({ op: 'fade_in', curve: 'exp', ...(hasSel ? {} : { end: len / sr }) }, '淡入'),
    fadeOut: () => runOp({ op: 'fade_out', curve: 'exp', ...(hasSel ? {} : { start: 0 }) }, '淡出'),
    normalize: () => runOp({ op: 'normalize', peakDb: -1 }, '归一'),
    reverse: () => runOp({ op: 'reverse' }, '反向'),
    silence: () => hasSel && runOp({ op: 'silence' }, '静音'),
    gain: async () => { const db = await ask('调整电平', '增益（分贝，-48 … 48）', 3, (n) => Math.abs(n) <= 48); if (db !== null) runOp({ op: 'gain', db }, `Gain ${db > 0 ? '+' : ''}${db} dB`); },
    invert: () => runOp({ op: 'invert' }, '反相'),
    removeDc: () => runOp({ op: 'remove_dc' }, '去除直流偏置'),
    trimSilence: () => runOp({ op: 'trim_silence' }, '裁掉静音', () => ({ start: 0, end: 0 })),
    mono: () => runOp({ op: 'mono' }, '转为单声道'),
    stereo: () => runOp({ op: 'stereo' }, '转为立体声'),
    speed: async () => { const r = await ask('改变速度（连同音高）', 'Rate: 2 = twice as fast and an octave up (0.25 … 4)', 1.5, (n) => n >= 0.25 && n <= 4); if (r !== null) runOp({ op: 'speed', rate: r }, `Speed ×${r}`, newLength(1 / r)); },
    stretch: async () => { const r = await ask('时间伸缩（保持音高）', 'Rate: 2 = twice as fast, 0.5 = twice as long (0.25 … 4)', 0.8, (n) => n >= 0.25 && n <= 4); if (r !== null) runOp({ op: 'stretch', rate: r }, `Stretch ×${r}`, newLength(1 / r)); },
    pitch: async () => { const s = await ask('移调（保持长度）', '半音数（-24 … 24，可用小数表示音分）', 2, (n) => Math.abs(n) <= 24 && n !== 0); if (s !== null) runOp({ op: 'pitch_shift', semitones: s }, `Pitch ${s > 0 ? '+' : ''}${s} st`); }
  };
  const moreMenu = () => [
    { header: hasSel ? '选区' : '整个采样' },
    { label: '增益…', onClick: process.gain },
    { label: '静音', disabled: !hasSel, onClick: process.silence },
    { label: '极性反相', onClick: process.invert },
    { label: '去除直流／低频隆隆声', onClick: process.removeDc },
    { label: '改变速度…', onClick: process.speed },
    { label: '时间伸缩…', onClick: process.stretch },
    { label: '移调…', onClick: process.pitch },
    '-',
    { header: '整个采样' },
    { label: '裁掉首尾静音', onClick: process.trimSilence },
    clip?.channels.length === 2 ? { label: '转为单声道', onClick: process.mono } : { label: '转为立体声', onClick: process.stereo }
  ];
  const menuAt = (e, items) => {
    const r = e.currentTarget.getBoundingClientRect();
    st.showContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 2 }, items);
  };

  // ---- zoom & scroll
  const zoom = (factor, center = hasSel ? (sel.start + sel.end) / 2 : (view.start + view.end) / 2) => setView((v) => viewAround(len, center, (v.end - v.start) * factor));
  const fit = () => setView({ start: 0, end: Math.max(1, len) });
  const zoomSel = () => hasSel && setView(viewAround(len, (sel.start + sel.end) / 2, (sel.end - sel.start) * 1.1));
  const onWheel = (e) => {
    if (!clip) return;
    const W = e.currentTarget.clientWidth;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const at = view.start + ((e.clientX - rect.left) / W) * (view.end - view.start);
      const f = Math.exp(e.deltaY * 0.0025);
      setView((v) => {
        const span = Math.max(MIN_SPAN, Math.min(len, (v.end - v.start) * f));
        const k = (at - v.start) / (v.end - v.start);
        let a = at - k * span;
        a = Math.max(0, Math.min(len - span, a));
        return { start: a, end: a + span };
      });
    } else {
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / W * (view.end - view.start);
      setView((v) => { const span = v.end - v.start; const a = Math.max(0, Math.min(len - span, v.start + d)); return { start: a, end: a + span }; });
    }
  };
  // the wheel must not scroll the page (React's onWheel is passive)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const stop = (e) => { if (e.target.closest?.('.we-canvas')) e.preventDefault(); };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  });

  // ---- selecting with the pointer
  const frameAtX = (x, W) => Math.max(0, Math.min(len, Math.round(view.start + (x / W) * (view.end - view.start))));
  const snap = (f) => (snapZero && f > 0 && f < len ? nearestZeroCrossing(clip, f, Math.round(sr * 0.002)) : f);
  const onPointerDown = (e) => {
    if (!clip || e.button !== 0) return;
    capturePointer(e);
    bodyRef.current?.focus({ preventScroll: true });
    const rect = e.currentTarget.getBoundingClientRect();
    const f = frameAtX(e.clientX - rect.left, rect.width);
    const anchor = e.shiftKey ? (Math.abs(f - sel.start) < Math.abs(f - sel.end) ? sel.end : sel.start) : f;
    drag.current = { anchor, rect, moved: e.shiftKey };
    if (e.shiftKey) setSel({ start: Math.min(anchor, f), end: Math.max(anchor, f) });
    else setSel({ start: f, end: f });
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const f = frameAtX(e.clientX - d.rect.left, d.rect.width);
    if (!d.moved && Math.abs(e.clientX - d.rect.left - ((d.anchor - view.start) / (view.end - view.start)) * d.rect.width) < 3) return;
    d.moved = true;
    setSel({ start: Math.min(d.anchor, f), end: Math.max(d.anchor, f) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) setSel((s) => (s.end - s.start > 0 ? { start: snap(s.start), end: snap(s.end) } : s));
  };
  const onOverview = (e) => {
    if (!clip || (e.type === 'pointermove' && !(e.buttons & 1))) return;
    if (e.type === 'pointerdown') capturePointer(e);
    const rect = e.currentTarget.getBoundingClientRect();
    const center = ((e.clientX - rect.left) / rect.width) * len;
    setView((v) => viewAround(len, center, v.end - v.start));
  };

  // ---- keyboard (while the editor has focus; the studio's shortcuts and computer-keyboard piano stay out of it)
  const onKeyDown = (e) => {
    if (e.target.closest('input, select, textarea')) return;
    // Space / Enter on a focused button press that button (not play) and stay away from the studio's shortcuts
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button')) { e.stopPropagation(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (mod && k === 'z') (e.shiftKey ? redo : undo)();
    else if (mod && k === 'y') redo();
    else if (mod && k === 'x') cut();
    else if (mod && k === 'c') copy();
    else if (mod && k === 'v') paste();
    else if (mod && k === 'a') selectAll();
    else if (e.key === ' ') togglePlay();
    else if (e.key === 'Delete' || e.key === 'Backspace') del();
    else if (e.key === 'Home') { setSel({ start: 0, end: 0 }); setView((v) => viewAround(len, (v.end - v.start) / 2, v.end - v.start)); }
    else if (e.key === 'End') setSel({ start: len, end: len });
    else if (e.key === '+' || e.key === '=') zoom(0.5);
    else if (e.key === '-') zoom(2);
    else if (e.key === 'Escape') setSel((s) => ({ start: s.start, end: s.start }));
    else handled = !mod && e.key.length === 1; // keep letters from playing the computer-keyboard piano
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // ---- saving: what was on screen when Save was clicked is what gets saved (an edit that lands during the upload stays
  // unsaved), and only into that document — the editor may show another sample, or be closed, by the time it finishes
  const SAVING = '保存中…';
  const canStillSave = (snap) => {
    if (docRef.current?.key !== snap.key) { st.toast('编辑器现在显示的是别的音频，因此没有保存', 'warn'); return false; }
    if (busyRef.current) { st.toast(`等「${busyRef.current.replace(/…$/, '')}」做完再保存`, 'warn'); return false; }
    return true;
  };
  // the Save buttons are disabled while saving: the focus moves to the editor (from a disabled button it would drop to
  // the page, where Space plays the song and Ctrl+Z undoes the project) — and stays wherever the user takes it next
  const startSaving = () => {
    bodyRef.current?.focus({ preventScroll: true });
    setBusy(SAVING);
    saving.current = true;
    useStore.setState({ editorSaving: true });
  };
  const endSaving = () => {
    saving.current = false;
    useStore.setState({ editorSaving: false });
    setBusy((b) => (b === SAVING ? null : b));
  };
  const saveAsNew = async () => {
    const snap = docRef.current;
    if (!snap?.clip || busy) return;
    if (!clipLength(snap.clip)) return st.toast('采样是空的：请撤销，或先粘贴一些音频', 'warn');
    const newName = await st.prompt({ title: '另存为新采样', label: '名称', value: `${Array.from(name).slice(0, 75).join('')} edit` });
    if (!newName?.trim() || !canStillSave(snap)) return;
    startSaving();
    try {
      const item = await saveClipAsSample(snap.clip, { name: newName.trim(), folderId: sample?.folderId ?? null });
      setDoc((d) => (d?.key === snap.key ? { ...d, id: item.id, name: item.name, rev: item.rev || 1, savedId: snap.stateId } : d));
      if (docRef.current?.key === snap.key) useStore.setState({ editSampleId: item.id });
      st.toast(`已另存为「${item.name}」`, 'success', 1800);
    } catch (e) {
      st.toast(e.message, 'error');
    } finally {
      endSaving();
    }
  };
  const replaceOriginal = async () => {
    const snap = docRef.current;
    const target = sample;
    if (!snap?.clip || !target || busy) return;
    if (!clipLength(snap.clip)) return st.toast('采样是空的：请撤销，或先粘贴一些音频', 'warn');
    let usage = [];
    try { usage = (await api.sampleUsage([target.id]))[target.id] || []; } catch { /* checked again by the server */ }
    const where = usage.map((u) => `• ${u.projectName}${u.channels.length ? ` — channel${u.channels.length > 1 ? 's' : ''} ${u.channels.join(', ')}` : ''}${u.clips ? ` — ${u.clips} clip${u.clips > 1 ? 's' : ''}` : ''}`).join('\n');
    const message = (stale ? 'It was replaced elsewhere (by Claude or another tab) since you opened it: that version would be overwritten too.\n\n' : '') + (usage.length
      ? `It is used in ${usage.length} project${usage.length > 1 ? 's' : ''}, which will all play the edited audio:\n${where}\n\nThe original audio can't be brought back. Use "另存为新采样" to keep both.`
      : `目前没有工程在用它的原始音频，替换后找不回来。想两份都留，请用「另存为新采样」。`);
    if (!(await st.confirm({ title: `Replace "${target.name}" with the edited audio?`, message, danger: true, okLabel: '替换原采样' })) || !canStillSave(snap)) return;
    startSaving();
    try {
      const item = await replaceSampleAudio(target, snap.clip);
      setDoc((d) => (d?.key === snap.key ? { ...d, rev: item.rev || 1, name: item.name, savedId: snap.stateId } : d));
      st.toast(`已替换「${item.name}」${usage.length ? `，涉及 ${usage.length} 个工程` : ''}`, 'success', 1800);
    } catch (e) {
      st.toast(e.status === 404 ? `"${target.name}" was deleted meanwhile, so it wasn't replaced${docRef.current?.key === snap.key ? ' (Save as new keeps this audio)' : ''}` : e.message, e.status === 404 ? 'warn' : 'error');
    } finally {
      endSaving();
    }
  };
  const onClose = async () => {
    if (saving.current) return st.toast('还在保存 — 等保存完再关闭编辑器', 'warn');
    if (dirty && !(await st.confirm({ title: '丢弃未保存的修改？', message: `Your changes to "${name}" have not been saved.`, danger: true, okLabel: '丢弃' }))) return;
    st.closeWindow('waveEditor');
  };

  const tabs = (
    <div className="we-tabs" role="tablist" aria-label="编辑视图" onKeyDown={(e) => {
      // the tabs live in the title bar: Space/Enter press them (not the studio's play), ←/→ switch
      if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const list = e.currentTarget;
        useStore.setState({ editTab: tab === 'wave' ? 'pitch' : 'wave' });
        requestAnimationFrame(() => list.querySelector('[aria-selected="true"]')?.focus());
      }
    }}>
      {[['wave', '波形'], ['pitch', '音高']].map(([k, label]) => (
        // one tab stop for the group (←/→ move between tabs); a tab pressed from the keyboard keeps the focus
        <button key={k} role="tab" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className={tab === k ? 'on' : ''} onClick={(e) => { useStore.setState({ editTab: k }); if (e.detail !== 0) keepFocus(); }}>{label}</button>
      ))}
    </div>
  );
  const title = sample || doc ? `Edit — ${name}${dirty ? ' •' : ''}` : '波形编辑器';
  const selSec = hasSel ? (sel.end - sel.start) / sr : 0;

  return (
    <Window name="waveEditor" title={title} icon="wave" toolbar={tabs} minW={420} minH={300} className="wave-editor" onClose={onClose}>
      {!sampleId || (!sample && !doc) ? (
        <p className="empty-hint">{sampleId ? '此采样已被删除。' : '请从浏览器打开采样（采样 → ⋯ → 在波形编辑器中编辑）。'}</p>
      ) : load.status === 'error' ? (
        <p className="empty-hint error">Could not open the sample: {load.error}</p>
      ) : !clip ? (
        <p className="empty-hint">载入中…</p>
      ) : (
        <div className="we-body" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="波形编辑器" data-testid="wave-editor" data-keyboard-home>
          {deleted && <p className="we-banner" role="status">此采样已被删除。 <b>另存为新采样</b> 把这段音频保留为新采样。</p>}
          {stale && busy !== SAVING && (dirty || doc.future.length > 0) && (
            <p className="we-banner" role="status">&ldquo;{name}&rdquo; was replaced elsewhere (by Claude or another tab); {dirty ? '你的修改在旧版音频上。' : '这是旧版音频（连同它的撤销历史）。'}
              <button className="btn tiny" disabled={!!busy} onClick={() => { pitchMemory.current = null; setReloadKey((k) => k + 1); }}>{dirty ? '重新载入（丢弃我的修改）' : '重新加载'}</button>
            </p>
          )}
          <div className="we-tools" role="toolbar" aria-label="编辑" onMouseDown={(e) => { if (e.target.closest('button')) { e.preventDefault(); bodyRef.current?.focus({ preventScroll: true }); } }}>
            <button className="tbtn" title="撤销（Ctrl+Z）" aria-label="撤销" disabled={!doc.past.length || !!busy} onClick={undo}><Icon name="undo" size={14} /></button>
            <button className="tbtn" title="重做（Ctrl+Shift+Z）" aria-label="重做" disabled={!doc.future.length || !!busy} onClick={redo}><Icon name="redo" size={14} /></button>
            <span className="sep" />
            <button className={`tbtn ${play ? 'active' : ''}`} title="播放选区，或从光标处播放（空格）" aria-label={play ? '停止' : '播放'} onClick={togglePlay}><Icon name={play ? 'stop' : 'play'} size={14} /></button>
            <button className={`tbtn ${loop ? 'active' : ''}`} title="循环选区" aria-label="循环" aria-pressed={loop} onClick={() => setLoop(!loop)}><Icon name="loop" size={14} /></button>
            <span className="sep" />
            {tab === 'wave' && (
              <>
                <button className="tbtn" title="剪切（Ctrl+X）" aria-label="剪切" disabled={!hasSel || !!busy} onClick={cut}><Icon name="scissors" size={14} /></button>
                <button className="tbtn" title="复制（Ctrl+C）" aria-label="复制" disabled={!hasSel} onClick={copy}><Icon name="copy" size={14} /></button>
                <button className="tbtn" title="粘贴到光标处，或覆盖选区（Ctrl+V）" aria-label="粘贴" disabled={!!busy} onClick={paste}><Icon name="paste" size={14} /></button>
                <button className="tbtn" title="删除选区（Del）" aria-label="删除选区" disabled={!hasSel || !!busy} onClick={del}><Icon name="trash" size={14} /></button>
                <button className="tbtn text" title="只保留选区" disabled={!hasSel || !!busy} onClick={crop}>裁切</button>
                <span className="sep" />
                <button className="tbtn" title="淡入（选区，或整段采样）" aria-label="淡入" disabled={!!busy} onClick={process.fadeIn}><Icon name="fadeIn" size={14} /></button>
                <button className="tbtn" title="淡出（选区，或整段采样）" aria-label="淡出" disabled={!!busy} onClick={process.fadeOut}><Icon name="fadeOut" size={14} /></button>
                <button className="tbtn text" title="把峰值归一到 -1 dBFS" disabled={!!busy} onClick={process.normalize}>归一</button>
                <button className="tbtn text" title="反向" disabled={!!busy} onClick={process.reverse}>反向</button>
                <button className="tbtn text" title="更多处理" aria-haspopup="menu" disabled={!!busy} onClick={(e) => menuAt(e, moreMenu())}>更多 ▾</button>
                <span className="sep" />
                <button className="tbtn" title="放大（＋，Ctrl+滚轮）" aria-label="放大" onClick={() => zoom(0.5)}><Icon name="zoomIn" size={14} /></button>
                <button className="tbtn" title="缩小（−）" aria-label="缩小" onClick={() => zoom(2)}><Icon name="zoomOut" size={14} /></button>
                <button className="tbtn text" title="显示整段采样" onClick={fit}>适应</button>
                <button className="tbtn text" title="缩放到选区" disabled={!hasSel} onClick={zoomSel}>选区</button>
                <label className="we-check" title="选区在波形过零处起止（切点不会咔哒）">
                  <input type="checkbox" checked={snapZero} onChange={(e) => setSnapZero(e.target.checked)} /> Zero-cross
                </label>
              </>
            )}
          </div>
          {tab === 'wave' ? (
            <div className="we-wave we-canvas" onWheel={onWheel}>
              <canvas ref={waveRef} className="we-main" data-testid="wave-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                onDoubleClick={selectAll} />
              <div ref={playheadRef} className="we-playhead" />
            </div>
          ) : (
            <PitchView memory={pitchMemory} clip={clip} view={view} setView={setView} sel={sel} setSel={setSel} onWheel={onWheel} busy={busy} setBusy={setBusy}
              onApply={(next, label, base) => {
                if (docRef.current?.clip !== base) { st.toast(`${label}：这期间音频变了，结果已丢弃`, 'warn'); return false; }
                play?.stop();
                commit(next, label);
                return true;
              }} playClip={playClip} stopPlay={stopPlay} playing={!!play} playheadRef={playheadRef} />
          )}
          <canvas ref={overviewRef} className="we-overview we-canvas" title="总览：拖动可滚动" onPointerDown={onOverview} onPointerMove={onOverview} onWheel={onWheel} />
          <div className="we-foot">
            <span className="we-name">{name}{dirty ? ' •' : ''}</span>
            <span className="we-info" data-testid="wave-info">
              {hasSel ? <>Selection {fmtTime(sel.start / sr)} – {fmtTime(sel.end / sr)} <b>({fmtTime(selSec)})</b></> : <>Cursor {fmtTime(sel.start / sr)}</>}
              <span className="muted"> · {fmtTime(len / sr)} · {sr / 1000} kHz · {clip.channels.length === 1 ? 'mono' : 'stereo'}</span>
            </span>
            {busy && <span className="we-busy" role="status">{busy}</span>}
            <span className="spacer" />
            <button className="btn tiny" disabled={!!busy || !sample || !dirty} title="覆盖采样：所有用到它的项目都会播放编辑后的音频" onClick={replaceOriginal}>替换原始…</button>
            <button className="btn tiny primary" disabled={!!busy} title="保留原始，把编辑后的音频存为新采样" onClick={saveAsNew}>另存为…</button>
          </div>
        </div>
      )}
    </Window>
  );
}
