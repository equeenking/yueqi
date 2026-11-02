import { memo, useMemo, useRef, useState, useEffect } from 'react';
import { ticksPerBar, patternLength, songLength, uid, STEP, PPQ } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { Window } from './ui/Window.jsx';
import { Icon } from './ui/Icon.jsx';
import { Select, Led } from './ui/Controls.jsx';
import { usePlayheadLine, capturePointer } from '../lib/hooks.js';
import { longPressProps, attachPinchZoom, pinching } from '../lib/touch.js';
import { SNAP_OPTIONS, snapTicks, placeAudioClip, clonePattern, newPattern, gesture } from '../lib/actions.js';
import { getEngine } from '../audio/index.js';
import { AutomationCreateMenu } from './AutomationEditor.jsx';
import { DND_SAMPLE } from '../lib/dnd.js';

// must stay in sync with .pl-corner / .pl-headers widths in styles.css
const HEADW = 200;
// GarageBand-style track icon colors, used when a track has no clips yet (index-based fallback)
const TRACK_PALETTE = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ffd60a', '#64d2ff', '#5ac8fa', '#ff375f', '#ff6482', '#c8452c'];

/** Playback speed that brings a loop at `from` BPM to `to` BPM, using the tempo octave nearest the target. */
function fitRate(from, to) {
  let src = from;
  while (src * 1.5 < to) src *= 2;
  while (src / 1.5 > to) src /= 2;
  return Math.max(0.25, Math.min(4, Math.round((to / src) * 10000) / 10000));
}
const RULER = 24;

const PatternPreview = memo(function PatternPreview({ pattern, project, clip, id }) {
  const len = patternLength(project, pattern);
  let lo = 127;
  let hi = 0;
  const all = [];
  for (const list of Object.values(pattern.notes)) for (const n of list) { all.push(n); lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
  if (!all.length) return null;
  const range = Math.max(8, hi - lo + 3);
  const reps = [];
  const first = -Math.floor(clip.offset / len);
  for (let k = first; (k * len) - (clip.offset % len) < clip.length; k++) reps.push(k * len - (clip.offset % len));
  return (
    <svg className="clip-notes" viewBox={`0 0 ${clip.length} ${range}`} preserveAspectRatio="none">
      <defs>
        <g id={id}>
          {all.map((n) => <rect key={n.id} x={n.start} y={hi + 1 - n.key} width={Math.max(4, n.length - 3)} height={0.85} />)}
        </g>
      </defs>
      {reps.map((x) => <use key={x} href={`#${id}`} x={x} />)}
      {reps.slice(1).map((x) => <line key={`l${x}`} x1={x} x2={x} y1={0} y2={range} className="clip-loop-line" />)}
    </svg>
  );
});

/** Fade-in/out ramps drawn over an audio clip. */
function FadeOverlay({ clip, ppt }) {
  if (!clip.fadeIn && !clip.fadeOut) return null;
  const w = clip.length * ppt;
  return (
    <svg className="clip-fades" viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" aria-hidden="true">
      {clip.fadeIn > 0 && <polygon points={`0,0 ${clip.fadeIn * ppt},0 0,100`} />}
      {clip.fadeOut > 0 && <polygon points={`${w},0 ${w - clip.fadeOut * ppt},0 ${w},100`} />}
    </svg>
  );
}

function AudioPreview({ clip, bpm }) {
  useStore((s) => s.sampleBuffersRev); // re-render when the engine finishes decoding a sample
  const buf = getEngine()?.samples.get(clip.refId);
  const peaks = useMemo(() => {
    if (!buf) return null;
    const d = buf.getChannelData(0);
    const N = 200;
    const out = [];
    const perTick = (buf.sampleRate * (60 / bpm) / PPQ) * (clip.rate || 1);
    const startS = clip.offset * perTick;
    const endS = Math.min(d.length, startS + clip.length * perTick);
    const block = Math.max(1, Math.floor((endS - startS) / N));
    for (let i = 0; i < N; i++) {
      let m = 0;
      const s0 = Math.floor(startS + i * block);
      for (let j = s0; j < s0 + block && j < endS; j += 4) m = Math.max(m, Math.abs(d[j]));
      out.push(m);
    }
    return out;
  }, [buf, clip.offset, clip.length, clip.rate, bpm]);
  if (!peaks) return <div className="clip-loading">audio</div>;
  const pts = peaks.map((p, i) => `${i},${50 - p * 48}`).join(' ') + ' ' + peaks.map((p, i) => `${peaks.length - 1 - i},${50 + peaks[peaks.length - 1 - i] * 48}`).join(' ');
  return (
    <svg className="clip-wave" viewBox={`0 0 ${peaks.length - 1} 100`} preserveAspectRatio="none">
      <polygon points={pts} />
    </svg>
  );
}

function AutomationPreview({ automation, clip }) {
  const reps = [];
  for (let x = -clip.offset % automation.length; x < clip.length; x += automation.length) reps.push(x);
  return (
    <svg className="clip-auto" viewBox={`0 0 ${clip.length} 100`} preserveAspectRatio="none">
      {reps.map((x) => (
        <polyline key={x} points={automation.points.map((p) => `${x + p.t},${100 - p.v * 92 - 4}`).join(' ')} />
      ))}
    </svg>
  );
}

export function Playlist() {
  const project = useStore((s) => s.project);
  const selectedPatternId = useStore((s) => s.selectedPatternId);
  const snap = useStore((s) => s.snap);
  const songStart = useStore((s) => s.songStart);
  const loopRegion = useStore((s) => s.loopRegion);
  const st = useStore.getState();
  const [tool, setTool] = useState('draw');
  const scrollRef = useRef(null);
  const [ppt, setPpt] = useState(0.18); // px per tick
  const rulerRef = useRef(null);
  const pptRef = useRef(ppt);
  pptRef.current = ppt;
  // 标尺双指捏合缩放(库乐队同款),捏合中点的内容位置不动
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return undefined;
    return attachPinchZoom(el, { get: () => pptRef.current, set: setPpt, min: 0.03, max: 2, scroller: scrollRef.current });
  }, []);
  const [trackH, setTrackH] = useState(40);
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [box, setBox] = useState(null);
  const [help, setHelp] = useState(false);
  const drag = useRef(null);
  const gridRef = useRef(null);
  const playRef = useRef(null);

  const bar = ticksPerBar(project);
  const sLen = songLength(project);
  const gridTicks = Math.max(sLen + bar * 16, bar * 48);
  const gridW = gridTicks * ppt;
  const tracks = project.playlist.tracks;
  const gridH = tracks.length * trackH;
  const snapT = Math.max(snapTicks(snap, project), STEP);
  const clips = preview ? project.playlist.clips.map((c) => preview.get(c.id) || c).concat([...preview.values()].filter((c) => c.__new)) : project.playlist.clips;

  usePlayheadLine(playRef, (tick) => (useStore.getState().mode === 'song' ? HEADW + tick * ppt : null), [ppt]);

  const pos = (e) => {
    const r = gridRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, tick: Math.max(0, x / ppt), track: Math.max(0, Math.min(tracks.length - 1, Math.floor(y / trackH))) };
  };
  const snapDown = (t) => Math.floor(t / snapT) * snapT;
  const snapRound = (t) => Math.round(t / snapT) * snapT;
  const hitClip = (p) => {
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.track === p.track && p.tick >= c.start && p.tick < c.start + c.length) return c;
    }
    return null;
  };
  const clipLabel = (c) => {
    if (c.kind === 'pattern') return project.patterns.find((p) => p.id === c.refId)?.name || '?';
    if (c.kind === 'automation') return project.automations.find((a) => a.id === c.refId)?.name || '自动化';
    return useStore.getState().samples.find((s) => s.id === c.refId)?.name || '音频';
  };
  const clipColor = (c) => {
    if (c.kind === 'pattern') return project.patterns.find((p) => p.id === c.refId)?.color || '#888';
    if (c.kind === 'automation') return project.automations.find((a) => a.id === c.refId)?.color || '#7fd1b9';
    return '#6b8fb3';
  };
  // track icon color: the first clip on the track, else a palette color by position
  const trackColor = (i) => {
    const c = project.playlist.clips.find((x) => x.track === i);
    return c ? clipColor(c) : TRACK_PALETTE[i % TRACK_PALETTE.length];
  };
  // GarageBand-like "open in editor": for a pattern clip pick the channel to edit — the selected one
  // if it has notes in this pattern, else the first channel that does
  const rollChannel = (patternId) => {
    const pat = project.patterns.find((p) => p.id === patternId);
    const sel = useStore.getState().selectedChannelId;
    return project.channels.find((x) => x.id === sel && pat?.notes[x.id]?.length)
      || project.channels.find((x) => pat?.notes[x.id]?.length)
      || project.channels.find((x) => x.id === sel)
      || project.channels[0];
  };

  const removeClips = (ids) => ids.length && st.dispatch([{ type: 'clip/remove', ids }]);
  const gainLabel = (c) => { const db = Math.round(20 * Math.log10(Math.max(1e-4, c.gain ?? 1)) * 10) / 10; return `${db > 0 ? '+' : ''}${db} dB`; };
  // detected loop tempo of a sample (null for one-shots / unknown)
  const tempoOf = (sampleId) => {
    const t = useStore.getState().samples.find((x) => x.id === sampleId)?.analysis?.tempo;
    return t && t.confidence >= 0.2 ? t.bpm : null;
  };

  const clipMenu = (e, c) => st.showContextMenu(e, [
    { header: clipLabel(c) },
    c.kind === 'pattern' && { label: '在钢琴卷帘中打开', shortcut: 'F7', onClick: () => { st.selectPattern(c.refId); const ch = rollChannel(c.refId); if (ch) st.openPianoRoll(ch.id); } },
    c.kind === 'pattern' && { label: '编辑片段', onClick: () => { st.selectPattern(c.refId); st.openWindow('channelRack'); } },
    c.kind === 'pattern' && { label: '变为独立片段', onClick: () => {
      const id = clonePattern(c.refId);
      if (id) st.dispatch([{ type: 'clip/update', id: c.id, patch: { refId: id } }]);
    } },
    c.kind === 'automation' && { label: '编辑自动化', onClick: () => { useStore.setState({ selectedAutomationId: c.refId }); st.openWindow('automation'); } },
    c.kind === 'audio' && { label: `Clip gain… (${gainLabel(c)})`, onClick: async () => {
      const v = await st.prompt({ title: '片段增益', label: 'Gain in dB (0 = as recorded)', value: String(Math.round(20 * Math.log10(Math.max(1e-4, c.gain ?? 1)) * 10) / 10) });
      const db = Number(v);
      if (v !== null && Number.isFinite(db)) st.dispatch([{ type: 'clip/update', id: c.id, patch: { gain: Math.pow(10, Math.max(-60, Math.min(12, db)) / 20) } }]);
    } },
    c.kind === 'audio' && { label: '淡入淡出…', onClick: async () => {
      const v = await st.prompt({ title: '淡入 / 淡出', label: 'Fade-in and fade-out in beats, e.g. "0.5 2"', value: `${Math.round(((c.fadeIn || 0) / PPQ) * 100) / 100} ${Math.round(((c.fadeOut || 0) / PPQ) * 100) / 100}` });
      const [fi, fo] = String(v ?? '').trim().split(/[\s,/]+/).map(Number);
      if (v !== null && Number.isFinite(fi)) st.dispatch([{ type: 'clip/update', id: c.id, patch: { fadeIn: Math.max(0, Math.round(fi * PPQ)), fadeOut: Math.max(0, Math.round((Number.isFinite(fo) ? fo : fi) * PPQ)) } }]);
    } },
    c.kind === 'audio' && ((c.rate ?? 1) !== 1 || tempoOf(c.refId)) && { label: (c.rate ?? 1) === 1 ? `Fit to ${project.bpm} BPM (repitch from ${tempoOf(c.refId)})` : '原速', onClick: () => {
      const old = c.rate || 1;
      const rate = old === 1 ? fitRate(tempoOf(c.refId), project.bpm) : 1;
      // keep the same audio under the clip: its length and trim offset scale with the speed
      st.dispatch([{ type: 'clip/update', id: c.id, patch: { rate, length: Math.max(1, Math.round((c.length * old) / rate)), offset: Math.round((c.offset * old) / rate) } }]);
    } },
    { label: c.mute ? '取消片段静音' : '片段静音', onClick: () => st.dispatch([{ type: 'clip/update', id: c.id, patch: { mute: !c.mute } }]) },
    { label: '在后面复制一份', onClick: () => st.dispatch([{ type: 'clip/add', clips: [{ ...c, id: uid('clip'), start: c.start + c.length }] }]) },
    { label: '删除', danger: true, onClick: () => removeClips(selected.has(c.id) ? [...selected] : [c.id]) }
  ].filter(Boolean));

  const trackMenu = (e, i, t) => st.showContextMenu(e, [
    { header: t.name },
    { label: '重命名轨道…', onClick: async () => { const name = await st.prompt({ title: '重命名轨道', value: t.name }); if (name) st.dispatch([{ type: 'track/update', index: i, patch: { name } }]); } },
    { label: t.mute ? '取消静音' : '静音', onClick: () => st.dispatch([{ type: 'track/update', index: i, patch: { mute: !t.mute } }]) },
    { label: '清空轨道', onClick: () => removeClips(project.playlist.clips.filter((c) => c.track === i).map((c) => c.id)) },
    project.playlist.tracks.length > 1 && {
      label: '删除轨道', danger: true, onClick: async () => {
        const n = project.playlist.clips.filter((c) => c.track === i).length;
        if (!(await st.confirm({ title: '删除轨道', message: `删除轨道「${t.name}」？上面的 ${n} 个片段会一起删掉。`, danger: true, okLabel: '删除' }))) return;
        st.dispatch([{ type: 'track/remove', index: i }]);
      }
    }
  ].filter(Boolean));

  const onPointerDown = (e) => {
    if (e.button === 1) return;
    gridRef.current.focus({ preventScroll: true });
    const p = pos(e);
    const c = hitClip(p);
    if (e.button === 2) {
      e.preventDefault();
      if (c) clipMenu(e, c);
      return;
    }
    capturePointer(e);
    if (tool === 'erase') {
      if (c) removeClips([c.id]);
      drag.current = { mode: 'erase' };
      return;
    }
    if (c) {
      const x0 = c.start * ppt;
      const x1 = (c.start + c.length) * ppt;
      const edge = Math.min(8, (x1 - x0) / 3);
      const mode = p.x > x1 - edge ? 'resize' : p.x < x0 + edge && c.kind !== 'automation' ? 'trim' : 'move';
      let sel = selected;
      if (e.ctrlKey || e.metaKey) {
        sel = new Set(selected);
        if (sel.has(c.id)) sel.delete(c.id); else sel.add(c.id);
        setSelected(sel);
        return;
      }
      if (!selected.has(c.id)) { sel = new Set([c.id]); setSelected(sel); }
      if (c.kind === 'pattern') st.selectPattern(c.refId);
      const group = project.playlist.clips.filter((x) => sel.has(x.id));
      drag.current = { mode, start: p, anchor: c, group, moved: false, duplicate: e.shiftKey && mode === 'move' };
      return;
    }
    if (tool === 'select' || e.ctrlKey || e.metaKey) {
      drag.current = { mode: 'box', box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } };
      setBox(drag.current.box);
      setSelected(new Set());
      return;
    }
    if (e.pointerType === 'touch') {
      // touch screens: one finger drags the view, a tap paints (so scrolling never paints clips)
      const el = scrollRef.current;
      drag.current = { mode: 'touch', start: p, cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
      return;
    }
    const key = gesture('pl-draw');
    const clip = paintAt(p, key);
    if (clip) drag.current = { mode: 'move', start: p, anchor: clip, group: [clip], moved: false, fresh: true, key };
  };

  /** Paint the selected pattern as a new clip at a grid position. */
  const paintAt = (p, key = gesture('pl-draw')) => {
    const pat = project.patterns.find((x) => x.id === selectedPatternId);
    if (!pat) return null;
    const clip = { id: uid('clip'), kind: 'pattern', refId: pat.id, track: p.track, start: snapDown(p.tick), length: patternLength(project, pat), offset: 0, mute: false };
    st.dispatch([{ type: 'clip/add', clips: [clip] }], { coalesce: key });
    setSelected(new Set([clip.id]));
    return clip;
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'touch') {
      const dx = e.clientX - d.cx;
      const dy = e.clientY - d.cy;
      if (!d.moved && Math.hypot(dx, dy) < 8) return;
      d.moved = true;
      scrollRef.current.scrollLeft = d.sl - dx;
      scrollRef.current.scrollTop = d.st - dy;
      return;
    }
    const p = pos(e);
    if (d.mode === 'erase') {
      const c = hitClip(p);
      if (c) removeClips([c.id]);
      return;
    }
    if (d.mode === 'box') {
      d.box = { ...d.box, x1: p.x, y1: p.y };
      setBox(d.box);
      return;
    }
    const dt = p.tick - d.start.tick;
    const dTrack = p.track - d.start.track;
    if (!d.moved && Math.abs(dt * ppt) < 3 && dTrack === 0) return;
    d.moved = true;
    const map = new Map();
    if (d.mode === 'move') {
      const shift = Math.max(-Math.min(...d.group.map((c) => c.start)), snapRound(d.anchor.start + dt) - d.anchor.start);
      const tshift = Math.max(-Math.min(...d.group.map((c) => c.track)), Math.min(tracks.length - 1 - Math.max(...d.group.map((c) => c.track)), dTrack));
      for (const c of d.group) {
        const m = { ...c, start: c.start + shift, track: c.track + tshift };
        if (d.duplicate) { m.id = `dup_${c.id}`; m.__new = true; }
        map.set(m.id, m);
      }
    } else if (d.mode === 'resize') {
      const end = snapRound(d.anchor.start + d.anchor.length + dt);
      const delta = Math.max(snapT, end - d.anchor.start) - d.anchor.length;
      for (const c of d.group) map.set(c.id, { ...c, length: Math.max(snapT, c.length + delta) });
    } else if (d.mode === 'trim') {
      const ns = Math.max(0, Math.min(d.anchor.start + d.anchor.length - snapT, snapRound(d.anchor.start + dt)));
      const delta = ns - d.anchor.start;
      for (const c of d.group) {
        let dd = Math.max(0, c.start + delta) - c.start;
        let offset;
        if (c.kind === 'pattern') {
          // patterns loop, so extending a clip to the left just starts earlier in the loop
          const plen = patternLength(project, project.patterns.find((x) => x.id === c.refId));
          offset = (((c.offset + dd) % plen) + plen) % plen;
        } else {
          dd = Math.max(dd, -c.offset); // audio/automation can't start before their own beginning
          offset = c.offset + dd;
        }
        map.set(c.id, { ...c, start: c.start + dd, length: Math.max(snapT, c.length - dd), offset });
      }
    }
    setPreview(map);
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'touch') {
      if (!d.moved && e?.type !== 'pointercancel') paintAt(d.start);
      return;
    }
    if (d.mode === 'box') {
      const b = d.box;
      const t0 = Math.min(b.x0, b.x1) / ppt;
      const t1 = Math.max(b.x0, b.x1) / ppt;
      const r0 = Math.floor(Math.min(b.y0, b.y1) / trackH);
      const r1 = Math.floor(Math.max(b.y0, b.y1) / trackH);
      setSelected(new Set(project.playlist.clips.filter((c) => c.track >= r0 && c.track <= r1 && c.start < t1 && c.start + c.length > t0).map((c) => c.id)));
      setBox(null);
      return;
    }
    if (d.moved && preview) {
      const list = [...preview.values()];
      if (d.duplicate) {
        const created = list.map(({ __new, ...c }) => ({ ...c, id: uid('clip') }));
        st.dispatch([{ type: 'clip/add', clips: created }]);
        setSelected(new Set(created.map((c) => c.id)));
      } else {
        st.dispatch([{ type: 'clip/update', clips: list.map((c) => ({ id: c.id, start: c.start, length: c.length, offset: c.offset, track: c.track })) }], { coalesce: d.fresh ? d.key : null });
      }
    }
    setPreview(null);
  };

  const onDoubleClick = (e) => {
    const c = hitClip(pos(e));
    if (!c) return;
    // GarageBand convention: double-tap a region to open its editor (piano roll); step editing
    // stays one click away via the clip menu's 编辑片段 / the channel rack window
    if (c.kind === 'pattern') { st.selectPattern(c.refId); const ch = rollChannel(c.refId); if (ch) st.openPianoRoll(ch.id); }
    if (c.kind === 'automation') { useStore.setState({ selectedAutomationId: c.refId }); st.openWindow('automation'); }
  };

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeClips([...selected]); setSelected(new Set()); }
    if (mod && e.code === 'KeyA') { e.preventDefault(); setSelected(new Set(project.playlist.clips.map((c) => c.id))); }
    if (mod && e.code === 'KeyD') {
      e.preventDefault();
      const sel = project.playlist.clips.filter((c) => selected.has(c.id));
      if (!sel.length) return;
      const span = Math.max(...sel.map((c) => c.start + c.length)) - Math.min(...sel.map((c) => c.start));
      const created = sel.map((c) => ({ ...c, id: uid('clip'), start: c.start + Math.ceil(span / bar) * bar }));
      st.dispatch([{ type: 'clip/add', clips: created }]);
      setSelected(new Set(created.map((c) => c.id)));
    }
  };

  const onDrop = (e) => {
    const smp = e.dataTransfer.getData(DND_SAMPLE);
    if (!smp) return;
    e.preventDefault();
    const p = pos(e);
    placeAudioClip(JSON.parse(smp), p.track, snapDown(p.tick));
  };

  // ruler: click = song start position, drag = loop region, right-click = clear loop
  const rulerDrag = useRef(null);
  const rulerTick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.round((e.clientX - r.left - HEADW) / ppt / bar) * bar);
  };
  const onRulerDown = (e) => {
    if (e.button === 2) {
      e.preventDefault();
      const at = rulerTick(e);
      st.showContextMenu(e, [
        { label: `在第 ${Math.round(at / bar) + 1} 小节加段落标记…`, onClick: async () => {
          const name = await st.prompt({ title: '添加标记', label: '段落名称（例如：主歌、副歌、高潮）', value: '' });
          if (name) st.dispatch([{ type: 'marker/add', markers: [{ id: uid('mk'), tick: at, name: name.slice(0, 64) }] }]);
        } },
        loopRegion && { label: '清除循环区', onClick: () => st.setLoopRegion(null) }
      ].filter(Boolean));
      return;
    }
    if (pinching(e.currentTarget)) { rulerDrag.current = null; return; } // 双指捏合中:让位给缩放
    capturePointer(e);
    rulerDrag.current = { t0: rulerTick(e), moved: false };
  };
  const onRulerMove = (e) => {
    const d = rulerDrag.current;
    if (!d || pinching(e.currentTarget)) return;
    const t = rulerTick(e);
    if (t !== d.t0) {
      d.moved = true;
      st.setLoopRegion({ start: Math.min(d.t0, t), end: Math.max(d.t0, t) });
    }
  };
  const onRulerUp = (e) => {
    const d = rulerDrag.current;
    rulerDrag.current = null;
    if (pinching(e.currentTarget)) return;
    if (d && !d.moved) {
      const r = e.currentTarget.getBoundingClientRect();
      const t = Math.max(0, Math.floor((e.clientX - r.left - HEADW) / ppt / PPQ) * PPQ);
      st.setSongStart(t);
      if (useStore.getState().mode !== 'song') st.setMode('song'); // read fresh: this component doesn't subscribe to mode
    }
  };

  const toolBtn = (t, icon, title) => (
    <button className={`tbtn small ${tool === t ? 'active' : ''}`} title={title} onClick={() => setTool(t)}><Icon name={icon} size={14} /></button>
  );
  const toolbar = (
    <>
      {toolBtn('draw', 'draw', '绘制：单击放置所选片段，拖动片段移动，拖动边缘改变长度／裁切')}
      {toolBtn('select', 'select', '选择（框选）。Ctrl+拖动也可选择。Shift+拖动为复制')}
      {toolBtn('erase', 'erase', '擦除（或右键片段打开选项）')}
      <span className="sep" />
      <span className="label">绘制</span>
      <Select value={selectedPatternId} onChange={(id) => st.selectPattern(id)} title="要绘制的片段"
        options={project.patterns.map((p) => ({ value: p.id, label: p.name }))} />
      <button className="tbtn small" title="新建片段" onClick={() => newPattern()}><Icon name="plus" size={13} /></button>
      <span className="sep" />
      <Icon name="magnet" size={13} />
      <Select value={snap} onChange={(v) => st.setPref('snap', v)} title="吸附" options={SNAP_OPTIONS.filter((o) => o.ticks >= STEP).map((o) => ({ value: o.value, label: o.label }))} />
      <span className="sep" />
      <AutomationCreateMenu />
      <button className="tbtn small" title="添加 4 轨" onClick={() => st.dispatch([{ type: 'track/add', count: 4 }])}><Icon name="plus" size={13} /></button>
      <button className="tbtn small" title="缩小" onClick={() => setPpt((z) => Math.max(0.03, z / 1.4))}><Icon name="zoomOut" size={14} /></button>
      <button className="tbtn small" title="放大" onClick={() => setPpt((z) => Math.min(2, z * 1.4))}><Icon name="zoomIn" size={14} /></button>
      <button className="tbtn small text" title="轨道高度" onClick={() => setTrackH((h) => (h >= 72 ? 28 : h + 14))}>↕</button>
      <button className="tbtn small text" title="在歌曲起点添加标记（段落名）" onClick={async () => {
        const at = Math.round(songStart / bar) * bar;
        const name = await st.prompt({ title: `在第 ${at / bar + 1} 小节加段落标记`, label: '段落名称（例如：主歌、副歌、高潮）', value: '' });
        if (name) st.dispatch([{ type: 'marker/add', markers: [{ id: uid('mk'), tick: at, name: name.slice(0, 64) }] }]);
      }}>+ 标记</button>
      {loopRegion && <button className="tbtn small text active" title="清除循环区" onClick={() => st.setLoopRegion(null)}>Loop ✕</button>}
      <span className="sep" />
      <button className={`tbtn small text ${help ? 'active' : ''}`} title="怎么用？点开提示" onClick={() => setHelp(!help)}>?</button>
    </>
  );

  const bars = [];
  const labelEvery = ppt * bar < 30 ? 4 : 1;
  for (let b = 0; b * bar < gridTicks; b++) bars.push(b);

  return (
    <Window name="playlist" title={`播放列表 — ${project.name}`} icon="playlist" toolbar={toolbar} minW={480} minH={200} className="playlist">
      <div className="pl-scroll" ref={scrollRef} onWheel={(e) => {
        if (e.ctrlKey) { e.preventDefault(); setPpt((z) => Math.max(0.03, Math.min(2, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }
      }}>
        <div className="pl-inner" style={{ width: HEADW + gridW, height: RULER + gridH }}>
          <div className="pl-ruler" ref={rulerRef} style={{ width: HEADW + gridW }} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onContextMenu={(e) => e.preventDefault()}
            title="单击：设起点 · 拖动：循环区 · 右键：加标记／清除循环">
            <div className="pl-corner">{project.bpm} BPM · {Math.ceil(sLen / bar)} 小节</div>
            {loopRegion && <div className="pl-loop" style={{ left: HEADW + loopRegion.start * ppt, width: (loopRegion.end - loopRegion.start) * ppt }} />}
            {bars.filter((b) => b % labelEvery === 0).map((b) => <span key={b} className="pl-bar" style={{ left: HEADW + b * bar * ppt }}>{b + 1}</span>)}
            <div className="pl-start" style={{ left: HEADW + songStart * ppt }} />
            {(project.markers || []).map((m) => (
              <button key={m.id} className="pl-marker" style={{ left: HEADW + m.tick * ppt }} title={`${m.name} — 单击：从这里开始播放 · 右键：重命名/删除`}
                onClick={() => { st.setSongStart(m.tick); if (useStore.getState().mode !== 'song') st.setMode('song'); }}
                {...longPressProps((e) => st.showContextMenu(e, [
                  { header: m.name },
                  { label: '重命名…', onClick: async () => { const name = await st.prompt({ title: '重命名标记', value: m.name }); if (name) st.dispatch([{ type: 'marker/update', id: m.id, patch: { name } }]); } },
                  { label: '删除标记', danger: true, onClick: () => st.dispatch([{ type: 'marker/remove', ids: [m.id] }]) }
                ]))}>{m.name}</button>
            ))}
          </div>
          <div className="pl-body">
            <div className="pl-headers">
              {tracks.map((t, i) => (
                <div key={t.id} className={`pl-track-head ${t.mute ? 'muted' : ''}`} style={{ height: trackH }}
                  {...longPressProps((e) => trackMenu(e, i, t))}>
                  <span className="tr-icon" style={{ background: `linear-gradient(150deg, ${trackColor(i)}, color-mix(in srgb, ${trackColor(i)} 55%, #000))` }}>
                    <Icon name="music" size={15} />
                  </span>
                  <span className="pl-track-name">{t.name}</span>
                  <Led on={!t.mute} label={`${t.name} on`} onClick={() => st.dispatch([{ type: 'track/update', index: i, patch: { mute: !t.mute } }])} title={t.mute ? '取消轨道静音' : '轨道静音'} />
                  <button className="pl-track-menu" title="轨道菜单：重命名、静音、清空、删除" onClick={(e) => trackMenu(e, i, t)}><Icon name="dots" size={12} /></button>
                </div>
              ))}
              <button className="pl-add-track" title="添加一条新轨道" onClick={() => st.dispatch([{ type: 'track/add', count: 1 }])}>
                <Icon name="plus" size={12} /> 轨道
              </button>
            </div>
            <div className="pl-grid playlist-grid" ref={gridRef} tabIndex={0}
              style={{
                width: gridW, height: gridH,
                backgroundImage: `linear-gradient(to right, var(--grid-bar) 1px, transparent 1px), linear-gradient(to right, var(--grid-beat) 1px, transparent 1px), linear-gradient(to bottom, var(--pl-rowline) 1px, transparent 1px)`,
                backgroundSize: `${bar * ppt}px 100%, ${ppt * PPQ >= 6 ? PPQ * ppt : bar * ppt}px 100%, 100% ${trackH}px`
              }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_SAMPLE)) e.preventDefault(); }} onDrop={onDrop}>
              {loopRegion && <div className="pl-loop-band" style={{ left: loopRegion.start * ppt, width: (loopRegion.end - loopRegion.start) * ppt }} />}
              {clips.map((c) => {
                const pattern = c.kind === 'pattern' ? project.patterns.find((p) => p.id === c.refId) : null;
                const automation = c.kind === 'automation' ? project.automations.find((a) => a.id === c.refId) : null;
                return (
                  <div key={c.id} className={`clip ${c.kind} ${selected.has(c.id) ? 'sel' : ''} ${c.mute || tracks[c.track]?.mute ? 'muted' : ''}`}
                    style={{ left: c.start * ppt, top: c.track * trackH + 1, width: Math.max(4, c.length * ppt - 1), height: trackH - 2, '--clip-color': clipColor(c) }}>
                    <div className="clip-title">{clipLabel(c)}</div>
                    {c.length * ppt >= 44 && (
                      <button className="clip-dots" title="片段菜单：复制、淡入淡出、删除…" onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); clipMenu(e, c); }}><Icon name="dots" size={11} /></button>
                    )}
                    <div className="clip-body">
                      {pattern && <PatternPreview pattern={pattern} project={project} clip={c} id={`pp_${c.id}`} />}
                      {c.kind === 'audio' && <AudioPreview clip={c} bpm={project.bpm} />}
                      {c.kind === 'audio' && <FadeOverlay clip={c} ppt={ppt} />}
                      {automation && <AutomationPreview automation={automation} clip={c} />}
                    </div>
                  </div>
                );
              })}
              {box && <div className="pr-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
              {!project.playlist.clips.length && (
                <div className="pl-empty" style={{ left: 16, top: 12 }}>点这里画出「{project.patterns.find((p) => p.id === selectedPatternId)?.name}」，然后切到「歌曲」播放。</div>
              )}
            </div>
          </div>
          <div ref={playRef} className="pl-playhead" style={{ height: RULER + gridH }} />
        </div>
      </div>
      {help && (
        <div className="win-help" onClick={() => setHelp(false)}>
          <div className="win-help-card" onClick={(e) => e.stopPropagation()}>
            <h4>播放列表怎么用？</h4>
            <ul>
              <li>上方选择要放的「片段」，然后<b>在格子上单击</b>就画出一个片段。</li>
              <li><b>拖动片段</b>移动位置；拖右边缘加长，拖左边缘裁掉开头。</li>
              <li>点片段标题上的 <b>⋯</b>（或右键片段）：复制、淡入淡出、删除等。</li>
              <li>左侧轨道名字旁的 <b>⋯</b>：重命名、静音、清空、删除这条轨道；列表底部 <b>＋ 轨道</b> 新建。</li>
              <li>顶部标尺：<b>单击</b>定播放起点，<b>拖动</b>出循环区。</li>
              <li>摆好后切到工具栏的「歌曲」模式按空格，整首就连起来播了。</li>
            </ul>
            <button className="btn tiny" onClick={() => setHelp(false)}>知道了</button>
          </div>
        </div>
      )}
    </Window>
  );
}
