import { memo, useRef, useState } from 'react';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_CATEGORIES, STEP, patternLength, uid, COLORS } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { Window } from './ui/Window.jsx';
import { Knob } from './ui/Knob.jsx';
import { Led, DragNumber } from './ui/Controls.jsx';
import { Icon } from './ui/Icon.jsx';
import { usePlayheadLine, COARSE } from '../lib/hooks.js';
import { longPressProps } from '../lib/touch.js';
import {
  addChannel, cloneChannel, renameChannel, deleteChannel, fillSteps, shiftSteps, randomizeSteps,
  setPatternSteps, addSamplerChannel, gesture
} from '../lib/actions.js';
import { getEngine } from '../audio/index.js';
import { DND_INSTRUMENT, DND_SAMPLE, isStudioDrag } from '../lib/dnd.js';

// 触屏设备上放大步进格子（≥32px 高），桌面保持紧凑
const STEP_W = COARSE ? 26 : 18;
const STEP_GAP = COARSE ? 6 : 2;
const STEP_H = COARSE ? 32 : 24;
const GROUP_GAP = 5;
export const stepX = (i) => i * (STEP_W + STEP_GAP) + Math.floor(i / 4) * GROUP_GAP;

function isStepView(notes, channel) {
  if (!notes?.length) return true;
  return notes.every((n) => n.start % STEP === 0 && n.key === channel.rootKey && n.length <= STEP * 2);
}

const paint = { active: false, state: 'off', channelId: null, key: null }; // state: off|on|accent; key: one undo step per paint stroke

const StepRow = memo(function StepRow({ channel, notes, steps, patternId }) {
  const st = useStore.getState();
  const byStep = new Map();
  for (const n of notes || []) if (n.start % STEP === 0) byStep.set(n.start / STEP, n);

  // 三态步进(库乐队 Beat Sequencer 式):off=删,on=普通(0.8),accent=重音(1.0)
  const setStep = (i, state) => {
    const existing = byStep.get(i);
    if (state === 'off') {
      if (existing) {
        const ids = (notes || []).filter((n) => n.start === i * STEP).map((n) => n.id);
        st.dispatch([{ type: 'notes/remove', patternId, channelId: channel.id, ids }], { coalesce: paint.key });
      }
      return;
    }
    const vel = state === 'accent' ? 1 : 0.8;
    if (!existing) {
      st.dispatch([{ type: 'notes/add', patternId, channelId: channel.id, notes: [{ id: uid('n'), key: channel.rootKey, start: i * STEP, length: STEP, velocity: vel }] }], { coalesce: paint.key });
    } else if (existing.velocity !== vel) {
      st.dispatch([{ type: 'notes/update', patternId, channelId: channel.id, notes: [{ id: existing.id, velocity: vel }] }], { coalesce: paint.key });
    }
  };

  const cells = [];
  for (let i = 0; i < steps; i++) {
    const n = byStep.get(i);
    const group = Math.floor(i / 4) % 2;
    cells.push(
      <button key={i} className={`step g${group} ${n ? 'on' : ''} ${n?.velocity >= 0.98 ? 'accent' : ''}`} style={{ left: stepX(i), width: STEP_W, height: STEP_H, '--vel': n ? 0.45 + n.velocity * 0.55 : 0 }}
        aria-label={`步 ${i + 1}${n ? (n.velocity >= 0.98 ? ' 重音' : ' 开启') : ''}`}
        onPointerDown={(e) => {
          if (e.button === 2) return;
          e.preventDefault();
          paint.active = true;
          // 点按循环:空→开→重音→关;拖刷沿用首格的状态
          paint.state = !n ? 'on' : n.velocity >= 0.98 ? 'off' : 'accent';
          paint.key = gesture('paint');
          paint.channelId = channel.id;
          setStep(i, paint.state);
          if (paint.state !== 'off') getEngine()?.preview(channel.id, channel.rootKey, paint.state === 'accent' ? 1 : 0.8, 0.2);
        }}
        onPointerEnter={() => { if (paint.active && paint.channelId === channel.id) setStep(i, paint.state); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStep(i, 'off'); }}
        onWheel={(e) => {
          if (!n) return;
          e.stopPropagation();
          const v = Math.max(0.05, Math.min(1, n.velocity + (e.deltaY < 0 ? 0.05 : -0.05)));
          st.dispatch([{ type: 'notes/update', patternId, channelId: channel.id, notes: [{ id: n.id, velocity: v }] }], { coalesce: `vel:${n.id}` });
        }}
      />
    );
  }
  return <div className="steps" style={{ width: stepX(steps), height: STEP_H }}>{cells}</div>;
});

function MiniRoll({ notes, length, onOpen }) {
  if (!notes?.length) return null;
  let lo = 127;
  let hi = 0;
  for (const n of notes) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
  const range = Math.max(12, hi - lo + 1);
  return (
    <button className="mini-roll" style={{ height: STEP_H }} onClick={onOpen} title="在钢琴卷帘中打开">
      <svg viewBox={`0 0 ${length} ${range}`} preserveAspectRatio="none">
        {notes.map((n) => <rect key={n.id} x={n.start} y={hi - n.key + (range - (hi - lo + 1)) / 2} width={Math.max(6, n.length - 2)} height={0.9} />)}
      </svg>
    </button>
  );
}

const ChannelRow = memo(function ChannelRow({ channel, notes, steps, length, patternId, selected, mixerCount, index }) {
  const st = useStore.getState();
  const stepView = isStepView(notes, channel);
  const menu = (e) => st.showContextMenu(e, [
    { header: channel.name },
    { label: '钢琴卷帘', shortcut: 'F7', onClick: () => st.openPianoRoll(channel.id) },
    { label: '通道设置', onClick: () => st.openChannelSettings(channel.id) },
    { label: '重命名…', onClick: () => renameChannel(channel.id) },
    { label: '颜色', submenu: COLORS.map((c) => ({ label: <span className="swatch-label"><span className="swatch" style={{ background: c }} />{c}</span>, onClick: () => st.dispatch([{ type: 'channel/update', id: channel.id, patch: { color: c } }]) })) },
    { label: '复制通道', onClick: () => cloneChannel(channel.id) },
    '-',
    { label: '每 2 步填充', onClick: () => fillSteps(patternId, channel.id, 2) },
    { label: '每 4 步填充', onClick: () => fillSteps(patternId, channel.id, 4) },
    { label: '每 8 步填充', onClick: () => fillSteps(patternId, channel.id, 8) },
    { label: '左移一步', onClick: () => shiftSteps(patternId, channel.id, -1) },
    { label: '右移一步', onClick: () => shiftSteps(patternId, channel.id, 1) },
    { label: '随机填充', onClick: () => randomizeSteps(patternId, channel.id) },
    { label: '清空', onClick: () => st.dispatch([{ type: 'notes/remove', patternId, channelId: channel.id }]) },
    '-',
    { label: '上移', disabled: index === 0, onClick: () => st.dispatch([{ type: 'channel/move', id: channel.id, index: index - 1 }]) },
    { label: '下移', onClick: () => st.dispatch([{ type: 'channel/move', id: channel.id, index: index + 1 }]) },
    { label: '删除', danger: true, onClick: () => deleteChannel(channel.id) }
  ]);
  const upd = (patch, key) => st.dispatch([{ type: 'channel/update', id: channel.id, patch }], { coalesce: key ? `${key}:${channel.id}` : null });
  return (
    <div className={`ch-row ${selected ? 'selected' : ''} ${channel.mute ? 'muted' : ''}`} {...longPressProps(menu)}>
      <Led on={!channel.mute} label={`${channel.name} on`} title={channel.mute ? '取消静音（Ctrl+单击：独奏）' : '静音（Ctrl+单击：独奏）'} color="var(--led)"
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) upd({ solo: !channel.solo });
          else upd({ mute: !channel.mute });
        }} />
      <Knob value={channel.pan} min={-1} max={1} def={0} bipolar size={22} title={`声像 ${Math.round(channel.pan * 100)}`} onChange={(v) => upd({ pan: v }, 'pan')} />
      <Knob value={channel.volume} min={0} max={1.25} def={0.78} size={22} title={`音量 ${Math.round(channel.volume * 100)}%`} onChange={(v) => upd({ volume: v }, 'vol')} />
      <DragNumber value={channel.mixerTrack} min={0} max={mixerCount - 1} step={1} sensitivity={0.08} className="ch-mixer"
        format={(v) => (v === 0 ? 'M' : String(v))} title="混音台插入（拖动／双击）"
        onChange={(v) => upd({ mixerTrack: v }, 'route')} />
      <button className={`ch-name ${channel.solo ? 'solo' : ''}`} style={{ '--ch-color': channel.color }}
        onClick={() => { st.selectChannel(channel.id); }}
        onDoubleClick={() => st.openChannelSettings(channel.id)}
        title={`${channel.name} — ${INSTRUMENTS[channel.instrument.kind].label}${channel.instrument.preset && channel.instrument.preset !== INSTRUMENTS[channel.instrument.kind].label ? `（预设：${channel.instrument.preset}）` : ''}。双击打开设置`}>
        {channel.name}
      </button>
      <div className="ch-steps" style={{ height: STEP_H }}>
        {stepView
          ? <StepRow channel={channel} notes={notes} steps={steps} patternId={patternId} />
          : <MiniRoll notes={notes} length={length} onOpen={() => st.openPianoRoll(channel.id)} />}
      </div>
      <button className="ch-pr" title="通道菜单：填充、移位、随机、复制、删除…" onClick={menu}><Icon name="dots" size={13} /></button>
      <button className="ch-pr" title="在钢琴卷帘中打开（F7）" onClick={() => st.openPianoRoll(channel.id)}><Icon name="piano" size={13} /></button>
    </div>
  );
});

function AddChannelButton() {
  const st = useStore.getState();
  return (
    <button className="btn add-channel" title="添加通道" onClick={(e) => st.showContextMenu(e, [
      { header: '添加乐器' },
      // category → instrument → preset (plugin instruments are added from the Browser)
      ...INSTRUMENT_CATEGORIES.filter(([cat]) => cat !== 'plugins').map(([cat, label]) => ({
        label,
        submenu: INSTRUMENT_KINDS.filter((k) => INSTRUMENTS[k].category === cat).map((k) => {
          const presets = Object.keys(INSTRUMENTS[k].presets);
          return { label: INSTRUMENTS[k].label, submenu: presets.map((pr) => ({ label: pr, onClick: () => addChannel(k, { preset: pr, name: presets.length > 1 && pr !== presets[0] ? pr : undefined }) })) };
        })
      }))
    ])}>
      <Icon name="plus" size={14} /> 通道
    </button>
  );
}

export function ChannelRack() {
  const project = useStore((s) => s.project);
  const patternId = useStore((s) => s.selectedPatternId);
  const selectedChannelId = useStore((s) => s.selectedChannelId);
  const mode = useStore((s) => s.mode);
  const st = useStore.getState();
  const playRef = useRef(null);
  const [dropOver, setDropOver] = useState(false);
  const pattern = project.patterns.find((p) => p.id === patternId) || project.patterns[0];
  const length = patternLength(project, pattern);
  const steps = Math.round(length / STEP);

  usePlayheadLine(playRef, (tick) => {
    if (useStore.getState().mode !== 'pattern') return null;
    const i = Math.floor(tick / STEP) % steps;
    return stepX(i);
  }, [steps]);

  const onDrop = (e) => {
    setDropOver(false);
    const inst = e.dataTransfer.getData(DND_INSTRUMENT);
    const smp = e.dataTransfer.getData(DND_SAMPLE);
    if (inst) { e.preventDefault(); const { kind, preset } = JSON.parse(inst); addChannel(kind, { preset }); }
    else if (smp) { e.preventDefault(); addSamplerChannel(JSON.parse(smp)); }
  };

  const toolbar = (
    <>
      <span className="rack-pattern" style={{ '--pat-color': pattern.color }}>{pattern.name}</span>
      <span className="label">摇摆</span>
      <Knob value={project.swing} min={0} max={1} def={0} size={22} title={`摇摆 ${Math.round(project.swing * 100)}%`}
        onChange={(v) => st.dispatch([{ type: 'project/update', patch: { swing: v } }], { coalesce: 'swing' })} />
      <span className="label">步数</span>
      <DragNumber value={steps} min={1} max={256} step={1} sensitivity={0.15} className="steps-num"
        onChange={(v) => setPatternSteps(pattern.id, v)} title="片段长度（步）（拖动／双击）" />
    </>
  );

  return (
    <Window name="channelRack" title="通道架" icon="rack" toolbar={toolbar} minW={420} minH={140}>
      <div className={`channel-rack ${dropOver ? 'drop' : ''}`}
        onDragOver={(e) => { if (isStudioDrag(e)) { e.preventDefault(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)} onDrop={onDrop}
        onPointerUp={() => { paint.active = false; }} onPointerLeave={() => { paint.active = false; }}>
        <div className="rack-rows">
          <div className="rack-playhead-wrap">
            <div ref={playRef} className="rack-playhead" style={{ width: STEP_W }} />
          </div>
          {project.channels.map((c, i) => (
            <ChannelRow key={c.id} channel={c} index={i} notes={pattern.notes[c.id]} steps={steps} length={length}
              patternId={pattern.id} selected={c.id === selectedChannelId} mixerCount={project.mixer.length} />
          ))}
          {!project.channels.length && <p className="empty-hint">还没有乐器：从左侧浏览器把乐器拖进来，或点下面的「＋ 通道」按钮添加。</p>}
        </div>
        <div className="rack-footer">
          <AddChannelButton />
          <span className="hint">{mode === 'song' ? '歌曲模式：切到「片段」可循环此片段' : '单击／拖动格子写入 · 右键擦除 · 滚轮＝力度 · 行尾 ⋯ 有填充／随机等'}</span>
        </div>
      </div>
    </Window>
  );
}
