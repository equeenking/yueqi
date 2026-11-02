// 弹奏视图（对标库乐队「智能乐器」）：屏幕钢琴键/音阶条、延音踏板、琶音器、调内和弦条、
// 低音条、鼓垫、现场伴奏。全部触摸友好：按下即发声，滑动可扫弦／刮奏；开录音后弹的内容写进当前通道。
// 琶音器与现场伴奏用 25ms 轮询 + 150ms 提前量的 lookahead 调度（与引擎 Transport 同模式），
// 经 store.arpNote 以 AudioContext 时间精确发声（自起自灭的一次性音符）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { STEP, PPQ, ticksPerBar, uid, INSTRUMENTS, INSTRUMENT_KINDS, noteName, chordNotes, voiceNear, diatonicChords, scaleNotes } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { Window } from './ui/Window.jsx';
import { Select } from './ui/Controls.jsx';
import { Icon } from './ui/Icon.jsx';
import { addChannel, exportWav } from '../lib/actions.js';
import { getEngine } from '../audio/index.js';

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcOf = (k) => PC[((k % 12) + 12) % 12];

// 兜底：音阶配不出三和弦（印度 thaats 等）时的宫商角徵羽（相对宫音半音）
const PENTA_FALLBACK = [
  { label: '宫', third: '', steps: [0, 4, 7] },
  { label: '商', third: 'm', steps: [2, 5, 9] },
  { label: '角', third: 'm', steps: [4, 7, 11] },
  { label: '徵', third: '', steps: [7, 11, 14] },
  { label: '羽', third: 'm', steps: [9, 12, 16] }
];
const CHORD_COLORS = ['#e8665a', '#f2a03d', '#f5d547', '#46c79a', '#5a8ef0', '#8f6cf0', '#c86be0'];
const BASS_COLORS = ['#3fb5d6', '#8f6cf0', '#c86be0'];

// 两个八度的白键（C…C）与黑键位置
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEYS = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]]; // [半音, 前面第几个白键]

// 琶音速率：每步多少拍
const ARP_RATES = { '1/4': 1, '1/8': 0.5, '1/8 三连': 1 / 3, '1/16': 0.25 };

// 现场伴奏：以和弦为基准的生成器（step/len 以 16 分步计，16 步 = 4/4 一小节）
// chord = { label, numeral, root, notes }，notes 是已按音区排好的和弦音
const AUTO_STYLES = [
  { id: 'pad', label: '长和弦', hint: '整小节铺住和弦', gen: (c) => c.notes.map((k) => ({ step: 0, key: k, vel: 0.6, len: 16 })) },
  { id: 'comp', label: '节奏伴奏', hint: '切分和弦，一打就有律动', gen: (c) =>
    [[0, 6], [6, 4], [10, 6]].flatMap(([s, l]) => c.notes.map((k) => ({ step: s, key: k, vel: 0.7, len: l }))) },
  { id: 'walk', label: '琶音行走', hint: '和弦音上下行流动', gen: (c) => {
    const seq = [...c.notes, ...c.notes.map((k) => k + 12).reverse()];
    const out = seq.map((k, i) => ({ step: i * 2, key: k, vel: 0.55 + (i % 6 === 0 ? 0.2 : 0), len: 2 }));
    out.push({ step: 14, key: c.notes[0], vel: 0.7, len: 2 });
    return out;
  } },
  { id: 'bass', label: '低音律动', hint: '根音与三音五音的行走', gen: (c) => {
    const b = c.root - 24;
    const third = c.notes[1] - c.notes[0];
    return [
      { step: 0, key: b, vel: 0.9, len: 6 },
      { step: 8, key: b + 7, vel: 0.85, len: 4 },
      { step: 12, key: b + third, vel: 0.85, len: 4 }
    ];
  } }
];

/** 延音踏板（库乐队式）：按住=延音，向右拖=锁定，再点一下=松开全部。 */
function SustainPad({ value, onSet }) {
  const start = useRef(null);
  const up = () => { if (start.current) onSet('release'); start.current = null; };
  return (
    <button className={`sustain-pad ${value !== 'off' ? 'on' : ''}`} title="延音：按住时抬手音不断；向右拖一下锁定，再点解锁"
      onPointerDown={(e) => { e.preventDefault(); start.current = { x: e.clientX }; onSet('hold'); }}
      onPointerMove={(e) => { if (start.current && e.clientX - start.current.x > 30) { start.current = null; onSet('lock'); } }}
      onPointerUp={up} onPointerCancel={up}>
      延音{value === 'locked' ? ' 🔒' : ''}
    </button>
  );
}

export function Play() {
  const project = useStore((s) => s.project);
  const selectedChannelId = useStore((s) => s.selectedChannelId);
  const recording = useStore((s) => s.recording);
  const playing = useStore((s) => s.playing);
  const [octave, setOctave] = useState(4);
  const [pressed, setPressed] = useState(() => new Set()); // 按下的琴键（高亮）
  const [padHit, setPadHit] = useState(null);
  const [scaleOn, setScaleOn] = useState(false); // 音阶模式：只显示调内音
  const [sustain, setSustain] = useState('off'); // off | hold | locked
  const [sevenths, setSevenths] = useState(false); // 和弦条：三和弦 ⇄ 七和弦
  const [arp, setArp] = useState({ on: false, order: '上行', rate: '1/8', octaves: 2, latch: false });
  const [auto, setAuto] = useState({ on: false, style: 'comp', chord: null }); // 现场伴奏
  const glide = useRef(false); // 手指按住琴键区时滑动=刮奏
  const strum = useRef(false); // 手指按住和弦条时滑动=扫弦
  const arpKeys = useRef([]); // 琶音器收集的音
  const sustainRing = useRef([]); // 延音中还没收掉的音

  const ch = project.channels.find((c) => c.id === selectedChannelId) || project.channels[0];
  const root = PC.indexOf(project.key || 'C'); // 宫音（项目调性）
  const mid = 60 + root; // 宫音在中音区
  const chRef = useRef(ch);
  chRef.current = ch;
  const arpRef = useRef(arp);
  arpRef.current = arp;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  // ---- 调内和弦条：跟随项目调性（五声音阶自动借同名七声；配不出三和弦就宫商角徵羽兜底） ----
  const strips = useMemo(() => {
    const key = project.key || 'C';
    const scale = project.scale || 'minor';
    let list = null;
    try {
      list = diatonicChords(key, scale, { sevenths });
    } catch {
      try { list = diatonicChords(key, scale.includes('m') && scale !== 'major' ? 'minor' : 'major', { sevenths }); } catch { list = null; }
    }
    if (list) {
      return list.map((c, i) => {
        const notes = voiceNear(chordNotes(c.chord, 4), mid + 2);
        return { label: c.chord, numeral: c.numeral, root: notes[0], notes, color: CHORD_COLORS[i % CHORD_COLORS.length] };
      });
    }
    return PENTA_FALLBACK.map((c, i) => ({
      label: `${c.label} ${pcOf(mid + c.steps[0])}`, numeral: c.label + (c.third ? 'm' : ''),
      root: mid + c.steps[0], notes: c.steps.map((t) => mid + t), color: CHORD_COLORS[i]
    }));
  }, [project.key, project.scale, sevenths, mid]);

  const bassStrips = useMemo(() => {
    // I、V、vi（没有就取前三个）的低音
    const idx = [0, 4, 5].filter((i) => i < strips.length);
    return (idx.length ? idx : [0, 1, 2]).map((i, n) => ({
      label: strips[i].label, root: strips[i].root - 24, color: BASS_COLORS[n % BASS_COLORS.length]
    }));
  }, [strips]);

  // ---- 音阶模式的调内音（两个八度） ----
  const scaleKeys = useMemo(() => {
    if (!scaleOn) return null;
    try { return scaleNotes(project.key || 'C', project.scale || 'minor', octave, 2); } catch { return null; }
  }, [scaleOn, project.key, project.scale, octave]);

  // ---- 发音路由：琶音器开着时收集成和弦；延音时抬手不收音 ----
  const noteOn = (key, vel = 0.8) => {
    if (!ch) return;
    if (arp.on) {
      if (arp.latch && arpKeys.current.length) {
        // 锁存下点新音 = 把锁住的琶音整体移过去（库乐队行为）
        const shift = key - Math.min(...arpKeys.current);
        arpKeys.current = [...new Set(arpKeys.current.map((k) => k + shift))];
      } else {
        arpKeys.current = [...new Set([...arpKeys.current, key])];
      }
      return;
    }
    useStore.getState().liveNoteOn(key, vel, ch.id);
    setPressed((p) => { const n = new Set(p); n.add(`${ch.id}:${key}`); return n; });
  };
  const noteOff = (key) => {
    if (!ch) return;
    if (arp.on) {
      if (!arp.latch) arpKeys.current = arpKeys.current.filter((k) => k !== key);
      return; // 锁存：抬手延续，点新音移调
    }
    setPressed((p) => { const n = new Set(p); n.delete(`${ch.id}:${key}`); return n; });
    if (sustain !== 'off') { sustainRing.current = [...new Set([...sustainRing.current, key])]; return; }
    useStore.getState().liveNoteOff(key, ch.id);
  };
  const noteOffRef = useRef(noteOff);
  noteOffRef.current = noteOff;

  const releaseSustain = () => {
    if (!ch) return;
    const s = useStore.getState();
    for (const k of sustainRing.current) s.liveNoteOff(k, ch.id);
    sustainRing.current = [];
  };
  const setSustainState = (v) => {
    if (v === 'hold') setSustain('hold');
    else if (v === 'lock') setSustain('locked');
    else { releaseSustain(); setSustain('off'); }
  };

  const playChord = (keys, { vel = 0.85, dur = 750 } = {}) => {
    for (const k of keys) noteOn(k, vel);
    setTimeout(() => { for (const k of keys) noteOffRef.current(k); }, dur);
  };

  // 手指抬起（可能不在原按键上）：统一收掉所有按住的音
  useEffect(() => {
    const up = () => {
      glide.current = false;
      strum.current = false;
      if (arpRef.current.on && !arpRef.current.latch) arpKeys.current = []; // 手指都离屏了：琶音的和弦清空
      setPressed((p) => {
        const s = useStore.getState();
        for (const held of p) {
          const i = held.indexOf(':');
          const key = Number(held.slice(i + 1));
          const cid = held.slice(0, i);
          if (cid === chRef.current?.id) noteOffRef.current(key);
          else s.liveNoteOff(key, cid);
        }
        return new Set();
      });
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  // ---- 琶音器调度：25ms 轮询，150ms 提前量，按项目 BPM 的速率循环收集到的音 ----
  useEffect(() => {
    if (!arp.on) { arpKeys.current = []; return undefined; }
    let idx = 0;
    let next = null;
    const timer = setInterval(() => {
      const eng = getEngine();
      const a = arpRef.current;
      if (!eng || eng.ctx.state !== 'running' || !chRef.current) return;
      const s = useStore.getState();
      const stepSec = (60 / s.project.bpm) * ARP_RATES[a.rate];
      if (next == null) next = eng.ctx.currentTime + 0.1;
      const held = [...new Set(arpKeys.current)].sort((x, y) => x - y);
      if (!held.length) { next = Math.max(next, eng.ctx.currentTime + 0.05); return; } // 没音就等，等到了从头起
      const seq = [];
      for (let o = 0; o < a.octaves; o++) for (const k of held) seq.push(k + 12 * o);
      const pattern = a.order === '下行' ? [...seq].reverse()
        : a.order === '上下' ? [...seq, ...[...seq].reverse().slice(1, -1)]
          : seq;
      const ahead = eng.ctx.currentTime + 0.16;
      while (next < ahead) {
        const key = a.order === '随机' ? pattern[Math.floor(Math.random() * pattern.length)] : pattern[idx % pattern.length];
        s.arpNote(Math.max(0, Math.min(127, key)), 0.8, chRef.current.id, next, stepSec * 0.95);
        idx++;
        next += stepSec;
      }
    }, 25);
    return () => clearInterval(timer);
  }, [arp.on]);

  // ---- 现场伴奏调度：整小节生成，和弦条点哪移到哪 ----
  useEffect(() => {
    if (!auto.on || !auto.chord) return undefined;
    let barStart = null;
    const timer = setInterval(() => {
      const eng = getEngine();
      const a = autoRef.current;
      if (!eng || eng.ctx.state !== 'running' || !a.on || !a.chord || !chRef.current) return;
      const s = useStore.getState();
      const barTicks = ticksPerBar(s.project);
      const secPerTick = 60 / (s.project.bpm * PPQ);
      const stepsPerBar = barTicks / STEP;
      const style = AUTO_STYLES.find((x) => x.id === a.style);
      if (!style) return;
      if (barStart == null) barStart = eng.ctx.currentTime + 0.12;
      const ahead = eng.ctx.currentTime + 0.2;
      while (barStart < ahead) {
        for (const ev of style.gen(a.chord)) {
          if (ev.step >= stepsPerBar) continue; // 3/4 等短小节：出界的事件不排
          s.arpNote(ev.key, ev.vel, chRef.current.id, barStart + ev.step * STEP * secPerTick, Math.max(0.05, ev.len * STEP * secPerTick * 0.95));
        }
        barStart += barTicks * secPerTick;
      }
    }, 25);
    return () => clearInterval(timer);
  }, [auto.on, auto.chord, auto.style]);

  // ---- 和弦条按下：现场伴奏中=换和弦；琶音器中=喂给它；否则=一次性扫响 ----
  const stripDown = (strip, vel = 0.85) => {
    if (auto.on) {
      if (auto.chord?.label === strip.label) setAuto({ ...auto, on: false, chord: null }); // 再点同一条=停
      else setAuto({ ...auto, chord: strip });
      return;
    }
    if (arp.on) { for (const k of strip.notes) noteOn(k, vel); return; }
    playChord(strip.notes, { vel });
  };
  const stripUp = (strip) => {
    if (arp.on && !arp.latch) arpKeys.current = arpKeys.current.filter((x) => !strip.notes.includes(x));
  };

  if (!ch) {
    return (
      <Window name="play" title="弹奏" icon="music">
        <p className="empty-hint">先在通道架里添加一个乐器，再来弹。</p>
      </Window>
    );
  }

  // ---- 把当前风格与和弦写两小节进所选片段（备课用：课上直接放） ----
  const writeToPattern = () => {
    const s = useStore.getState();
    let target = ch;
    if (INSTRUMENTS[ch.instrument.kind]?.melodic === false) {
      const mel = s.project.channels.find((c) => c.instrument.kind !== 'plugin' && INSTRUMENTS[c.instrument.kind]?.melodic !== false);
      if (mel) target = mel;
    }
    const pat = s.project.patterns.find((p) => p.id === s.selectedPatternId) || s.project.patterns[0];
    if (target.id !== s.selectedChannelId) s.selectChannel(target.id);
    const style = AUTO_STYLES.find((x) => x.id === auto.style);
    const c1 = auto.chord || strips[0];
    const c2 = strips[4 % strips.length] || strips[0] || c1; // 第二小节给 V（没有就 I）
    const bar = ticksPerBar(s.project);
    const N = (key, start, length, velocity) => ({ id: uid('n'), key, start, length, velocity });
    const notes = [];
    for (const [c, barTick] of [[c1, 0], [c2, bar]]) {
      for (const ev of style.gen(c)) notes.push(N(ev.key, barTick + ev.step * STEP, ev.len * STEP, ev.vel));
    }
    const ops = [];
    if (pat.length < 2 * bar) ops.push({ type: 'pattern/update', id: pat.id, patch: { length: 2 * bar } });
    ops.push({ type: 'notes/set', patternId: pat.id, channelId: target.id, notes });
    s.dispatch(ops);
    s.toast(`已把「${style.label} · ${c1.label}→${c2.label}」写进 ${target.name}`, 'success');
  };

  const drumChannels = project.channels.filter((c) => c.instrument.kind !== 'plugin' && INSTRUMENTS[c.instrument.kind]?.melodic === false).slice(0, 8);

  // ---- 琴键：两个八度，白键 flex 布局，黑键按白键边界定位 ----
  const base = 12 * (octave + 1);
  const whites = [];
  for (let o = 0; o < 2; o++) for (const s of WHITE_STEPS) whites.push(base + o * 12 + s);
  whites.push(base + 24);
  const blacks = [];
  for (let o = 0; o < 2; o++) for (const [s, wi] of BLACK_KEYS) blacks.push({ key: base + o * 12 + s, wi: wi + o * 7 });
  const unit = 100 / whites.length;

  const drumQuickAdd = INSTRUMENT_KINDS.filter((k) => INSTRUMENTS[k].category === 'drums').slice(0, 3);

  return (
    <Window name="play" title={`弹奏 — ${ch.name}`} icon="music" minW={380} minH={320} className="play">
      <div className="play-body">
        <div className="play-target">
          <span className="dot" style={{ background: ch.color }} />
          弹给：
          <Select value={ch.id} onChange={(id) => useStore.getState().selectChannel(id)} title="选择要弹的乐器"
            options={project.channels.map((c) => ({ value: c.id, label: c.name }))} />
          {recording && playing && <span className="play-rec">● 录音中，弹的音会写进片段</span>}
        </div>

        {scaleKeys ? (
          <div className="pk pk-scale" onPointerDown={() => { glide.current = true; }}>
            {scaleKeys.map((key) => (
              <button key={key}
                className={`pk-bar ${pcOf(key) === pcOf(scaleKeys[0]) ? 'root' : ''} ${pressed.has(`${ch.id}:${key}`) ? 'down' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); noteOn(key); }}
                onPointerEnter={() => { if (glide.current) noteOn(key); }}
                onPointerLeave={() => noteOff(key)}
                onPointerUp={() => noteOff(key)}>
                <span className="pk-bar-name">{noteName(key)}</span>
                {pcOf(key) === pcOf(scaleKeys[0]) && <span className="pk-bar-root">宫</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="pk" onPointerDown={() => { glide.current = true; }}>
            {whites.map((key) => (
              <div key={key} className={`pk-white ${pressed.has(`${ch.id}:${key}`) ? 'down' : ''} ${pcOf(key) === 'C' ? 'c' : ''}`}
                style={{ left: `${whites.indexOf(key) * unit}%`, width: `${unit}%` }}
                onPointerDown={(e) => { e.preventDefault(); noteOn(key); }}
                onPointerEnter={() => { if (glide.current) noteOn(key); }}
                onPointerLeave={() => noteOff(key)}
                onPointerUp={() => noteOff(key)}>
                {pcOf(key) === 'C' && <span className="pk-note">{noteName(key)}</span>}
              </div>
            ))}
            {blacks.map(({ key, wi }) => (
              <div key={key} className={`pk-black ${pressed.has(`${ch.id}:${key}`) ? 'down' : ''}`}
                style={{ left: `calc(${(wi + 1) * unit}% - ${unit * 0.31}%)`, width: `${unit * 0.62}%` }}
                onPointerDown={(e) => { e.preventDefault(); noteOn(key); }}
                onPointerEnter={() => { if (glide.current) noteOn(key); }}
                onPointerLeave={() => noteOff(key)}
                onPointerUp={() => noteOff(key)} />
            ))}
          </div>
        )}
        <div className="play-oct">
          <button className="btn tiny" onClick={() => setOctave((o) => Math.max(1, o - 1))}>− 八度</button>
          <span className="play-oct-num">{scaleKeys ? `${noteName(scaleKeys[0])} 起` : `C${octave}–C${octave + 2}`}</span>
          <button className="btn tiny" onClick={() => setOctave((o) => Math.min(6, o + 1))}>＋ 八度</button>
          <button className={`btn tiny ${scaleOn ? 'primary' : ''}`} title="音阶模式：只显示调内音条，怎么弹都不跑调"
            onClick={() => setScaleOn(!scaleOn)}>音阶</button>
          <SustainPad value={sustain} onSet={setSustainState} />
          <span className="play-hint">按住滑动可以{scaleKeys ? '滑奏' : '刮奏'}</span>
        </div>

        <span className="play-label">琶音器 — 开着时，弹的音自动变成琶音</span>
        <div className="arp-row">
          <button className={`btn tiny ${arp.on ? 'primary' : ''}`} onClick={() => setArp({ ...arp, on: !arp.on })}>
            {arp.on ? '● 琶音中' : '运行'}
          </button>
          <Select value={arp.order} onChange={(v) => setArp({ ...arp, order: v })} title="音符顺序" className="arp-sel"
            options={['上行', '下行', '上下', '随机'].map((v) => ({ value: v, label: v }))} />
          <Select value={arp.rate} onChange={(v) => setArp({ ...arp, rate: v })} title="音符速率" className="arp-sel"
            options={Object.keys(ARP_RATES).map((v) => ({ value: v, label: v }))} />
          <Select value={arp.octaves} onChange={(v) => setArp({ ...arp, octaves: v })} title="跨越几个八度" className="arp-sel"
            options={[1, 2, 3, 4].map((v) => ({ value: v, label: `${v} 个八度` }))} />
          <button className={`btn tiny ${arp.latch ? 'primary' : ''}`} title="锁住当前琶音；点新音会整体移调过去"
            onClick={() => setArp({ ...arp, latch: !arp.latch })}>锁存</button>
        </div>

        <span className="play-label">
          和弦条（{project.key || 'C'} 调内）— 按住扫过去就是扫弦{auto.on ? '；现场伴奏中：点一条就移到那个和弦，再点同一条停' : ''}
        </span>
        <div className="chord-strips" onPointerDown={() => { strum.current = true; }}>
          {strips.map((c) => (
            <button key={c.label} className={`chord-strip ${auto.on && auto.chord?.label === c.label ? 'down' : ''}`} style={{ background: c.color }}
              onPointerDown={(e) => { e.preventDefault(); stripDown(c); }}
              onPointerUp={() => stripUp(c)} onPointerLeave={() => stripUp(c)}
              onPointerEnter={() => { if (strum.current && !auto.on && !arp.on) playChord(c.notes, { vel: 0.75, dur: 500 }); }}>
              <b>{c.label}</b>
              <small>{c.numeral}</small>
            </button>
          ))}
          <button className={`chord-strip sevenths ${sevenths ? 'down' : ''}`} title="三和弦 ⇄ 七和弦（更爵士）"
            onClick={() => setSevenths(!sevenths)}>
            <b>7</b><small>{sevenths ? '七和弦' : '三和弦'}</small>
          </button>
        </div>
        <div className="bass-strips" onPointerDown={() => { strum.current = true; }}>
          {bassStrips.map((b) => (
            <button key={b.label} className="bass-strip" style={{ background: b.color }}
              onPointerDown={(e) => { e.preventDefault(); playChord([b.root], { vel: 0.95, dur: 950 }); }}
              onPointerEnter={() => { if (strum.current) playChord([b.root], { vel: 0.8, dur: 650 }); }}>
              低音 {b.label}
            </button>
          ))}
        </div>

        <span className="play-label">鼓垫</span>
        {drumChannels.length ? (
          <div className="pad-grid">
            {drumChannels.map((d) => (
              <button key={d.id} className={`pad ${padHit === d.id ? 'down' : ''}`} style={{ '--pad-color': d.color }}
                onPointerDown={(e) => { e.preventDefault(); setPadHit(d.id); useStore.getState().liveNoteOn(d.rootKey, 1, d.id); setTimeout(() => useStore.getState().liveNoteOff(d.rootKey, d.id), 120); }}
                onPointerUp={() => setPadHit(null)} onPointerLeave={() => setPadHit(null)}>
                {d.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="play-hint pad-hint">
            还没有鼓：从浏览器「声音」页添加，或
            {drumQuickAdd.map((k) => (
              <button key={k} className="btn tiny" onClick={() => addChannel(k)}>＋ {INSTRUMENTS[k].label}</button>
            ))}
          </div>
        )}

        <span className="play-label">现场伴奏 — 选风格后点上面的和弦条，就跟着那个和弦循环演奏</span>
        <div className="auto-grid">
          {AUTO_STYLES.map((s) => (
            <button key={s.id} className={`btn auto-style ${auto.style === s.id ? 'primary' : ''}`}
              onClick={() => setAuto((a) => ({ ...a, style: s.id, on: a.chord ? true : a.on }))}>
              
              <b>{s.label}</b><small>{s.hint}</small>
            </button>
          ))}
          <button className="btn auto-style danger" disabled={!auto.on && !auto.chord}
            onClick={() => setAuto({ ...auto, on: false, chord: null })}>
            <b>■ 停止</b><small>停下循环，清掉和弦</small>
          </button>
          <button className="btn auto-style" onClick={writeToPattern} title="把当前风格与和弦写两小节进所选片段">
            <b>✎ 写入片段</b><small>备课时先写好，课上直接放</small>
          </button>
        </div>
        {auto.on && !auto.chord && <span className="play-hint">选好风格了——现在点一个和弦条，伴奏就开始。</span>}

        <span className="play-label">分享</span>
        <button className="btn play-share" title="渲染整首歌为 16 位 WAV——班级电脑、投影都能直接放" onClick={() => exportWav('song', { bitDepth: 16 })}>
          <Icon name="download" size={13} /> 导出歌曲 WAV（带去课堂）
        </button>
      </div>
    </Window>
  );
}
