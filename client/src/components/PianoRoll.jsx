import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { STEP, PPQ, ticksPerBar, patternLength, uid, noteName, chordNotes, STAMP_CHORDS, SCALES, scalePitchClasses, quantizeNotes, legatoNotes, humanizeNotes, INSTRUMENTS, scaleLabel } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { Window } from './ui/Window.jsx';
import { Icon } from './ui/Icon.jsx';
import { Select } from './ui/Controls.jsx';
import { usePlayheadLine, capturePointer, COARSE } from '../lib/hooks.js';
import { attachPinchZoom } from '../lib/touch.js';
import { SNAP_OPTIONS, snapTicks, gesture } from '../lib/actions.js';
import { getEngine } from '../audio/index.js';

const KEYW = 56;
const RULER = 22;
const VEL_H = 70;
const BLACK = new Set([1, 3, 6, 8, 10]);
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let clipboard = null;

function rowBackground(keyH, scalePcs, rootPc) {
  // one octave of rows (top = key 127), repeated
  const stops = [];
  for (let r = 0; r < 12; r++) {
    const pc = (127 - r) % 12;
    let color = BLACK.has(pc) ? 'var(--pr-black)' : 'var(--pr-white)';
    if (scalePcs && !scalePcs.includes(pc)) color = 'var(--pr-out)';
    if (scalePcs && pc === rootPc) color = 'var(--pr-root)';
    stops.push(`${color} ${r * keyH}px`, `${color} ${(r + 1) * keyH - 1}px`, `var(--pr-rowline) ${(r + 1) * keyH - 1}px`, `var(--pr-rowline) ${(r + 1) * keyH}px`);
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

export function PianoRoll() {
  const project = useStore((s) => s.project);
  const channelId = useStore((s) => s.pianoRollChannelId);
  const patternId = useStore((s) => s.selectedPatternId);
  const snap = useStore((s) => s.snap);
  const open = useStore((s) => s.windows.pianoRoll.open);
  const st = useStore.getState();

  const [tool, setTool] = useState('draw');
  const [stamp, setStamp] = useState('m');
  const [ppt, setPpt] = useState(1); // pixels per tick (24px per step)
  const [keyH, setKeyH] = useState(COARSE ? 18 : 14);
  const [scaleOn, setScaleOn] = useState(true);
  const [ghosts, setGhosts] = useState(true);
  const [help, setHelp] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null); // Map id -> note while dragging
  const [box, setBox] = useState(null);
  const lastLength = useRef(STEP * 2);
  const drag = useRef(null);
  const scrollRef = useRef(null);
  const rulerRef = useRef(null);
  const pptRef = useRef(ppt);
  pptRef.current = ppt;
  // 标尺双指捏合缩放(库乐队同款),捏合中点的内容位置不动
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return undefined;
    return attachPinchZoom(el, { get: () => pptRef.current, set: setPpt, min: 0.25, max: 4, scroller: scrollRef.current });
  }, []);
  const playRef = useRef(null);
  const gridRef = useRef(null);
  const velDrag = useRef(null);

  const channel = project.channels.find((c) => c.id === channelId) || project.channels[0];
  const pattern = project.patterns.find((p) => p.id === patternId) || project.patterns[0];
  const notes = useMemo(() => (channel ? pattern.notes[channel.id] || [] : []), [pattern, channel]);
  const patLen = patternLength(project, pattern);
  const bar = ticksPerBar(project);
  const snapT = snapTicks(snap, project);
  const gridTicks = Math.max(patLen + bar * 2, bar * 8);
  const gridW = gridTicks * ppt;
  const gridH = 128 * keyH;
  const scalePcs = scaleOn ? scalePitchClasses(project.key || 'C', project.scale || 'minor') : null;
  const rootPc = scalePcs ? scalePcs[0] : null;

  // drop stale selections
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(notes.map((n) => n.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [notes]);

  // scroll to the notes (or C5) when opening / switching channel
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    const keys = notes.map((n) => n.key);
    const center = keys.length ? keys.reduce((a, b) => a + b, 0) / keys.length : channel?.rootKey ?? 60;
    el.scrollTop = Math.max(0, (127 - center) * keyH - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, open]);

  usePlayheadLine(playRef, (tick) => {
    const s = useStore.getState();
    if (s.mode !== 'pattern') return null;
    return KEYW + (tick % patLen) * ppt;
  }, [patLen, ppt]);

  const dispatch = useCallback((ops, coalesce) => {
    if (!channel) return;
    useStore.getState().dispatch(ops, { coalesce });
  }, [channel]);

  if (!channel) {
    return (
      <Window name="pianoRoll" title="钢琴卷帘" icon="piano">
        <p className="empty-hint">请先添加通道。</p>
      </Window>
    );
  }

  const melodic = INSTRUMENTS[channel.instrument.kind].melodic;
  const view = preview ? notes.map((n) => preview.get(n.id) || n).concat([...preview.values()].filter((n) => n.__new)) : notes;

  // ---------------------------------------------------------------- geometry
  const pos = (e) => {
    const r = gridRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, tick: Math.max(0, x / ppt), key: Math.max(0, Math.min(127, 127 - Math.floor(y / keyH))) };
  };
  const snapDown = (t) => Math.floor(t / snapT) * snapT;
  const snapRound = (t) => Math.round(t / snapT) * snapT;
  const hit = (tick, key) => {
    for (let i = view.length - 1; i >= 0; i--) {
      const n = view[i];
      if (n.key === key && tick >= n.start && tick < n.start + n.length) return n;
    }
    return null;
  };
  const audition = (key, vel = 0.8) => getEngine()?.preview(channel.id, key, vel, 0.25);

  const commitUpdates = (changed, coalesce = 'pr-edit') => {
    if (!changed.length) return;
    dispatch([{ type: 'notes/update', patternId: pattern.id, channelId: channel.id, notes: changed.map((n) => ({ id: n.id, key: n.key, start: n.start, length: n.length, velocity: n.velocity })) }], coalesce);
  };
  const deleteIds = (ids) => {
    if (!ids.length) return;
    dispatch([{ type: 'notes/remove', patternId: pattern.id, channelId: channel.id, ids }]);
  };
  const addNotes = (list, coalesce) => {
    dispatch([{ type: 'notes/add', patternId: pattern.id, channelId: channel.id, notes: list }], coalesce);
  };

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e) => {
    if (e.button === 1) return;
    gridRef.current.focus({ preventScroll: true });
    st.unlockAudio();
    const p = pos(e);
    const n = hit(p.tick, p.key);
    capturePointer(e);

    if (e.button === 2 || tool === 'erase') {
      e.preventDefault();
      if (n) deleteIds([n.id]);
      drag.current = { mode: 'erase' };
      return;
    }
    if (n) {
      const edgePx = 7;
      const nearEnd = (n.start + n.length) * ppt - p.x < Math.min(edgePx, (n.length * ppt) / 3);
      let sel = selected;
      if (e.shiftKey) {
        sel = new Set(selected);
        if (sel.has(n.id)) sel.delete(n.id); else sel.add(n.id);
        setSelected(sel);
        if (!sel.has(n.id)) return;
      } else if (!selected.has(n.id)) {
        sel = new Set([n.id]);
        setSelected(sel);
      }
      const group = notes.filter((x) => sel.has(x.id));
      audition(n.key, n.velocity);
      lastLength.current = n.length;
      drag.current = {
        mode: nearEnd ? 'resize' : 'move', start: p, anchor: n, group, moved: false,
        duplicate: e.altKey && !nearEnd
      };
      return;
    }
    if (tool === 'select' || e.ctrlKey || e.metaKey) {
      drag.current = { mode: 'box', start: p, additive: e.shiftKey, box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } };
      setBox(drag.current.box);
      if (!e.shiftKey) setSelected(new Set());
      return;
    }
    if (e.pointerType === 'touch') {
      // touch screens: one finger drags the view, a tap draws (so scrolling never scribbles notes)
      const el = scrollRef.current;
      drag.current = { mode: 'touch', start: p, cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
      return;
    }
    const key = gesture('pr-draw');
    const created = drawAt(p, key);
    drag.current = { mode: 'move', start: p, anchor: created[0], group: created, moved: false, fresh: true, key };
  };

  /** Draw / stamp a new note (or chord) at a grid position. */
  const drawAt = (p, key = gesture('pr-draw')) => {
    const start = snapDown(p.tick);
    const length = lastLength.current;
    let keys = [p.key];
    if (tool === 'stamp') {
      const root = PC_NAMES[p.key % 12];
      keys = chordNotes(`${root}${stamp}`, Math.floor(p.key / 12) - 1);
    }
    const created = keys.map((k) => ({ id: uid('n'), key: k, start, length, velocity: 0.8 }));
    addNotes(created, key);
    keys.forEach((k) => audition(k));
    setSelected(new Set(created.map((c) => c.id)));
    return created;
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
      const n = hit(p.tick, p.key);
      if (n) deleteIds([n.id]);
      return;
    }
    if (d.mode === 'box') {
      d.box = { ...d.box, x1: p.x, y1: p.y };
      setBox(d.box);
      return;
    }
    const dt = p.tick - d.start.tick;
    const dk = p.key - d.start.key;
    if (!d.moved && Math.abs(dt * ppt) < 3 && dk === 0) return;
    d.moved = true;
    const map = new Map();
    if (d.mode === 'move') {
      const newAnchorStart = snapRound(d.anchor.start + dt);
      const shift = Math.max(-Math.min(...d.group.map((n) => n.start)), newAnchorStart - d.anchor.start);
      const kshift = Math.max(-Math.min(...d.group.map((n) => n.key)), Math.min(127 - Math.max(...d.group.map((n) => n.key)), dk));
      for (const n of d.group) {
        const moved = { ...n, start: n.start + shift, key: n.key + kshift };
        if (d.duplicate) { moved.id = `dup_${n.id}`; moved.__new = true; }
        map.set(d.duplicate ? moved.id : n.id, moved);
      }
      if (kshift !== d.lastK) { d.lastK = kshift; if (kshift) audition(d.anchor.key + kshift); }
    } else if (d.mode === 'resize') {
      const endTick = snapRound(d.anchor.start + d.anchor.length + dt);
      const delta = Math.max(snapT > 1 ? snapT : 1, endTick - d.anchor.start) - d.anchor.length;
      for (const n of d.group) map.set(n.id, { ...n, length: Math.max(snapT > 1 ? Math.min(snapT, n.length) : 1, n.length + delta) });
    }
    setPreview(map);
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'touch') {
      if (!d.moved && e?.type !== 'pointercancel') drawAt(d.start);
      return;
    }
    if (d.mode === 'box') {
      const b = d.box;
      const t0 = Math.min(b.x0, b.x1) / ppt;
      const t1 = Math.max(b.x0, b.x1) / ppt;
      const k1 = 127 - Math.floor(Math.min(b.y0, b.y1) / keyH);
      const k0 = 127 - Math.floor(Math.max(b.y0, b.y1) / keyH);
      const ids = notes.filter((n) => n.key >= k0 && n.key <= k1 && n.start < t1 && n.start + n.length > t0).map((n) => n.id);
      setSelected((sel) => new Set([...(d.additive ? sel : []), ...ids]));
      setBox(null);
      return;
    }
    if ((d.mode === 'move' || d.mode === 'resize') && d.moved && preview) {
      const list = [...preview.values()];
      if (d.duplicate) {
        const created = list.map((n) => ({ id: uid('n'), key: n.key, start: n.start, length: n.length, velocity: n.velocity }));
        addNotes(created);
        setSelected(new Set(created.map((n) => n.id)));
      } else {
        commitUpdates(list, d.fresh ? d.key : gesture('pr-edit'));
        if (d.mode === 'resize') lastLength.current = list[0]?.length || lastLength.current;
      }
    }
    setPreview(null);
  };

  // ---------------------------------------------------------------- keyboard
  const selectedNotes = () => notes.filter((n) => selected.has(n.id));
  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const sel = selectedNotes();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteIds(sel.map((n) => n.id));
      return;
    }
    if (mod && e.code === 'KeyA') { e.preventDefault(); setSelected(new Set(notes.map((n) => n.id))); return; }
    if (mod && e.code === 'KeyC') { e.preventDefault(); clipboard = (sel.length ? sel : notes).map((n) => ({ ...n })); st.toast(`已复制 ${clipboard.length} 个音符`, 'info', 1000); return; }
    if (mod && e.code === 'KeyX') { e.preventDefault(); clipboard = sel.map((n) => ({ ...n })); deleteIds(sel.map((n) => n.id)); return; }
    if (mod && (e.code === 'KeyV' || e.code === 'KeyD')) {
      e.preventDefault();
      const src = e.code === 'KeyD' ? sel : clipboard;
      if (!src?.length) return;
      const minS = Math.min(...src.map((n) => n.start));
      const maxE = Math.max(...src.map((n) => n.start + n.length));
      const span = Math.ceil((maxE - minS) / PPQ) * PPQ;
      const offset = e.code === 'KeyD' ? span : (Math.ceil(maxE / PPQ) * PPQ - minS);
      const created = src.map((n) => ({ id: uid('n'), key: n.key, start: n.start + offset, length: n.length, velocity: n.velocity }));
      addNotes(created);
      setSelected(new Set(created.map((n) => n.id)));
      return;
    }
    if (mod && e.code === 'KeyQ') { e.preventDefault(); doQuantize(); return; }
    const target = sel.length ? sel : null;
    if (!target) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      if (target.some((n) => n.key + d < 0 || n.key + d > 127)) return;
      commitUpdates(target.map((n) => ({ ...n, key: n.key + d })), 'pr-transpose');
      audition(target[0].key + d);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (snapT || STEP);
      if (target.some((n) => n.start + d < 0)) return;
      commitUpdates(target.map((n) => ({ ...n, start: n.start + d })), 'pr-nudge');
    }
  };

  const applyTransform = (fn, label) => {
    const target = selected.size ? selectedNotes() : notes;
    if (!target.length) return;
    commitUpdates(fn(target), label);
  };
  const doQuantize = () => applyTransform((list) => quantizeNotes(list, snapT > 1 ? snapT : STEP), 'pr-q');

  // ---------------------------------------------------------------- velocity lane
  const onVelPointer = (e, down) => {
    if (down) { capturePointer(e); velDrag.current = true; }
    if (!velDrag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const tick = x / ppt;
    const v = Math.max(0.02, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    const pool = selected.size ? notes.filter((n) => selected.has(n.id)) : notes;
    const hits = pool.filter((n) => Math.abs(n.start - tick) * ppt < 5 || (tick >= n.start && tick < n.start + Math.min(n.length, STEP)));
    if (hits.length) commitUpdates(hits.map((n) => ({ ...n, velocity: v })), 'pr-vel');
  };

  // ---------------------------------------------------------------- render
  const beatW = PPQ * ppt;
  const stepW = STEP * ppt;
  const barW = bar * ppt;
  const gridStyle = {
    width: gridW,
    height: gridH,
    backgroundImage: [
      'linear-gradient(to right, var(--grid-bar) 1px, transparent 1px)',
      'linear-gradient(to right, var(--grid-beat) 1px, transparent 1px)',
      stepW >= 8 ? 'linear-gradient(to right, var(--grid-step) 1px, transparent 1px)' : 'none',
      rowBackground(keyH, scalePcs, rootPc)
    ].join(', '),
    backgroundSize: `${barW}px 100%, ${beatW}px 100%, ${stepW}px 100%, 100% ${12 * keyH}px`
  };

  const ghostNotes = ghosts
    ? project.channels.filter((c) => c.id !== channel.id && pattern.notes[c.id]?.length && INSTRUMENTS[c.instrument.kind].melodic)
      .flatMap((c) => pattern.notes[c.id].map((n) => ({ ...n, color: c.color, cid: c.id })))
    : [];

  const toolBtn = (t, icon, title) => (
    <button className={`tbtn small ${tool === t ? 'active' : ''}`} title={title} onClick={() => setTool(t)}><Icon name={icon} size={14} /></button>
  );

  const toolbar = (
    <>
      <Select value={channel.id} title="通道" className="pr-channel" onChange={(id) => useStore.setState({ pianoRollChannelId: id, selectedChannelId: id })}
        options={project.channels.map((c) => ({ value: c.id, label: c.name }))} />
      <span className="sep" />
      {toolBtn('draw', 'draw', '绘制（单击添加，拖动移动）')}
      {toolBtn('select', 'select', '选择（框选）。Ctrl+拖动也可选择')}
      {toolBtn('erase', 'erase', '擦除（或右键音符）')}
      {toolBtn('stamp', 'stamp', '和弦印章')}
      {tool === 'stamp' && (
        <Select value={stamp} onChange={setStamp} title="和弦类型" options={STAMP_CHORDS.map(([label, q]) => ({ value: q, label }))} />
      )}
      <span className="sep" />
      <Icon name="magnet" size={13} />
      <Select value={snap} onChange={(v) => st.setPref('snap', v)} title="吸附" options={SNAP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      <span className="sep" />
      <button className="tbtn small text" title="量化（Ctrl+Q）——选区或全部" onClick={doQuantize}>Q</button>
      <button className="tbtn small text" title="连奏——把音符延长到下一个" onClick={() => applyTransform(legatoNotes, 'pr-legato')}>连</button>
      <button className="tbtn small text" title="人性化时值与力度" onClick={() => applyTransform((l) => humanizeNotes(l, { timing: 3, velocity: 0.12 }), 'pr-human')}>人性</button>
      <button className="tbtn small text" title="向上移八度" onClick={() => applyTransform((l) => (l.some((n) => n.key > 115) ? l : l.map((n) => ({ ...n, key: n.key + 12 }))), 'pr-oct')}>+8va</button>
      <button className="tbtn small text" title="向下移八度" onClick={() => applyTransform((l) => (l.some((n) => n.key < 12) ? l : l.map((n) => ({ ...n, key: n.key - 12 }))), 'pr-oct')}>-8va</button>
      <span className="sep" />
      <button className={`tbtn small text ${scaleOn ? 'active' : ''}`} title="高亮音阶" onClick={() => setScaleOn(!scaleOn)}>音阶</button>
      {scaleOn && (
        <>
          <Select value={project.key || 'C'} title="音高" onChange={(v) => st.dispatch([{ type: 'project/update', patch: { key: v } }])} options={PC_NAMES} />
          <Select value={project.scale || 'minor'} title="音阶" onChange={(v) => st.dispatch([{ type: 'project/update', patch: { scale: v } }])} options={Object.keys(SCALES).map((k) => ({ value: k, label: scaleLabel(k) }))} />
        </>
      )}
      <button className={`tbtn small text ${ghosts ? 'active' : ''}`} title="显示其它通道为幽灵音符" onClick={() => setGhosts(!ghosts)}>幽灵</button>
      <button className="tbtn small text" title="用生成器插件生成音符" onClick={() => st.openWindow('generate')}>生成</button>
      <span className="sep" />
      <button className="tbtn small" title="缩小" onClick={() => setPpt((z) => Math.max(0.25, z / 1.4))}><Icon name="zoomOut" size={14} /></button>
      <button className="tbtn small" title="放大" onClick={() => setPpt((z) => Math.min(4, z * 1.4))}><Icon name="zoomIn" size={14} /></button>
      <button className="tbtn small text" title="加高琴键" onClick={() => setKeyH((h) => (h >= 22 ? 10 : h + 4))}>↕</button>
      <span className="sep" />
      <button className={`tbtn small text ${help ? 'active' : ''}`} title="怎么用？点开提示" onClick={() => setHelp(!help)}>?</button>
    </>
  );

  const bars = [];
  for (let b = 0; b * bar < gridTicks; b++) bars.push(b);

  return (
    <Window name="pianoRoll" title={`钢琴卷帘 — ${channel.name} · ${pattern.name}`} icon="piano" toolbar={toolbar} minW={480} minH={240} className="piano-roll">
      <div className="pr-scroll" ref={scrollRef} onWheel={(e) => {
        if (e.ctrlKey) { e.preventDefault(); setPpt((z) => Math.max(0.25, Math.min(4, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }
      }}>
        <div className="pr-inner" style={{ width: KEYW + gridW, height: RULER + gridH + VEL_H }}>
          <div className="pr-ruler" ref={rulerRef} style={{ width: KEYW + gridW }} title="双指捏合缩放">
            <div className="pr-corner">{melodic ? '' : 'drum'}</div>
            {bars.map((b) => <span key={b} className="pr-bar" style={{ left: KEYW + b * barW }}>{b + 1}</span>)}
            <div className="pr-end" style={{ left: KEYW + patLen * ppt }} title="片段结尾" />
          </div>
          <div className="pr-body">
            <div className="pr-keys" style={{ height: gridH }}>
              {Array.from({ length: 128 }, (_, i) => {
                const key = 127 - i;
                const pc = key % 12;
                return (
                  <div key={key} className={`pr-key ${BLACK.has(pc) ? 'black' : 'white'} ${pc === 0 ? 'c' : ''}`} style={{ height: keyH }}
                    onPointerDown={(e) => { e.preventDefault(); st.liveNoteOn(key, 0.8, channel.id); }}
                    onPointerUp={() => st.liveNoteOff(key, channel.id)} onPointerLeave={() => st.liveNoteOff(key, channel.id)}>
                    {(pc === 0 || keyH >= 16) && <span>{noteName(key)}</span>}
                  </div>
                );
              })}
            </div>
            <div className="pr-grid piano-roll-grid" ref={gridRef} tabIndex={0} style={gridStyle}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
              <div className="pr-outside" style={{ left: patLen * ppt }} />
              {ghostNotes.map((n) => (
                <div key={`g${n.cid}${n.id}`} className="pr-ghost" style={{ left: n.start * ppt, top: (127 - n.key) * keyH, width: Math.max(2, n.length * ppt - 1), height: keyH - 1, background: n.color }} />
              ))}
              {view.map((n) => (
                <div key={n.id} className={`pr-note ${selected.has(n.id) ? 'sel' : ''}`}
                  style={{ left: n.start * ppt, top: (127 - n.key) * keyH + 0.5, width: Math.max(3, n.length * ppt - 1), height: keyH - 2, '--note-color': channel.color, '--vel': 0.4 + n.velocity * 0.6 }}>
                  {n.length * ppt > 26 && keyH >= 12 && <span>{noteName(n.key)}</span>}
                </div>
              ))}
              {box && <div className="pr-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
            </div>
          </div>
          <div className="pr-vel" style={{ width: KEYW + gridW, height: VEL_H }}>
            <div className="pr-vel-label">力度</div>
            <div className="pr-vel-lane" style={{ width: gridW }} onPointerDown={(e) => onVelPointer(e, true)} onPointerMove={(e) => onVelPointer(e, false)} onPointerUp={() => { velDrag.current = null; }}>
              {view.map((n) => (
                <div key={n.id} className={`pr-vel-bar ${selected.has(n.id) ? 'sel' : ''}`} style={{ left: n.start * ppt, height: `${n.velocity * 100}%`, '--note-color': channel.color }} />
              ))}
            </div>
          </div>
          <div ref={playRef} className="pr-playhead" style={{ height: RULER + gridH }} />
        </div>
      </div>
      {help && (
        <div className="win-help" onClick={() => setHelp(false)}>
          <div className="win-help-card" onClick={(e) => e.stopPropagation()}>
            <h4>钢琴卷帘怎么用？</h4>
            <ul>
              <li><b>在格子上单击</b>画出音符；拖动音符移动，拖右边缘改长短。</li>
              <li><b>右键音符</b>删除；点左边的琴键可以试听音高。</li>
              <li>工具栏选「和弦印章」后再点格子，<b>一键画出一个和弦</b>。</li>
              <li>下方的「力度」条：上下拖动调音符强弱。</li>
              <li>「音阶」开关会只亮出调内音，顺着亮行画就好听。</li>
              <li>触屏：一指拖动滚动画面，<b>轻点</b>画音符。</li>
            </ul>
            <button className="btn tiny" onClick={() => setHelp(false)}>知道了</button>
          </div>
        </div>
      )}
    </Window>
  );
}
