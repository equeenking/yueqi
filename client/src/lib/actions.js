// Higher-level editing actions shared by menus, toolbars and keyboard shortcuts.
import {
  uid, INSTRUMENTS, patternLength, STEP, PPQ, projectToMidi, parseMidi,
  ticksPerBar, COLORS, pluginParamValues, scaleNotes, cleanGeneratedNotes
} from '@greanteadawy/core';
import { runInSandbox } from './sandbox.js';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { getEngine } from '../audio/index.js';
import { renderProject } from '../audio/render.js';
import { analyzeSampleInBrowser, exportStems } from './jobs.js';
import { exportSpatial } from './spatialExport.js';

const S = () => useStore.getState();

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

const safe = (s) => String(s).replace(/[^\w\- ]+/g, '').trim() || 'greanteadawy';

// ------------------------------------------------------------ channels

export function addChannel(kind, opts = {}) {
  const s = S();
  const p = s.project;
  const def = INSTRUMENTS[kind];
  const id = uid('ch');
  const baseName = opts.name || def.label;
  let name = baseName;
  let n = 2;
  while (p.channels.some((c) => c.name === name)) name = `${baseName} ${n++}`;
  s.dispatch([{ type: 'channel/add', nameInsert: true, channel: { id, name, kind, preset: opts.preset, params: opts.params, mixerTrack: 'auto' } }]);
  s.selectChannel(id);
  return id;
}

/** Add a channel playing one of the user's instrument plugins. */
export function addPluginChannel(entry, preset) {
  const s = S();
  const m = entry.manifest;
  const id = uid('ch');
  let name = m.name;
  let n = 2;
  while (s.project.channels.some((c) => c.name === name)) name = `${m.name} ${n++}`;
  const pr = preset && Object.hasOwn(m.presets, preset) ? preset : Object.keys(m.presets)[0];
  s.dispatch([{ type: 'channel/add', nameInsert: true, channel: { id, name, kind: 'plugin', plugin: m.id, preset: pr, params: pluginParamValues(m, pr), rootKey: m.defaultKey, color: m.color, mixerTrack: 'auto' } }]);
  s.selectChannel(id);
  return id;
}

/** Melodic or drum-like: built-ins say so in the catalog, plugin instruments in their manifest. */
function channelMelodic(ch) {
  if (ch.instrument.kind === 'plugin') return S().plugins.plugins.find((x) => x.id === ch.instrument.plugin)?.manifest.melodic !== false;
  return INSTRUMENTS[ch.instrument.kind]?.melodic !== false;
}

/**
 * Run a generator plugin in the sandbox and write its notes into a pattern/channel (replacing the channel's notes in
 * the generated range). Mirrors the MCP tool run_generator.
 */
export async function generateNotes({ entry, patternId, channelId, params, bars, seed = Math.floor(Math.random() * 2 ** 31) }) {
  const s = S();
  const p = s.project;
  const m = entry.manifest;
  const pat = p.patterns.find((x) => x.id === patternId);
  const ch = p.channels.find((c) => c.id === channelId);
  if (!pat || !ch) throw new Error('请先选一个片段和一个通道');
  const bar = ticksPerBar(p);
  const stepsPerBar = Math.round(bar / STEP);
  const len = Math.max(1, Math.round((bars ? bars * bar : patternLength(p, pat)) / STEP));
  const input = {
    params, key: p.key, scale: p.scale, scaleNotes: [...new Set(scaleNotes(p.key, p.scale).map((x) => x % 12))],
    bpm: p.bpm, timeSig: p.timeSig, bars: len / stepsPerBar, stepsPerBar, steps: len, seed,
    channel: { name: ch.name, kind: ch.instrument.kind, melodic: channelMelodic(ch), rootKey: ch.rootKey }
  };
  if (m.permissions.includes('project-read')) {
    input.notes = [];
    for (const c of p.channels) for (const n of pat.notes[c.id] || []) if (n.start / STEP < len) input.notes.push({ channel: c.name, step: n.start / STEP, length: n.length / STEP, key: n.key, velocity: n.velocity });
  }
  const r = await runInSandbox(await api.pluginCode(m.id), input, { timeoutMs: 2000 });
  if (!r.ok) throw new Error(r.error || '生成器执行失败');
  const notes = cleanGeneratedNotes(r.notes, len);
  // the project may have changed while the generator ran (Claude, another tab): write into the current state
  const now = S().project;
  const nowPat = now?.id === p.id ? now.patterns.find((x) => x.id === pat.id) : null;
  if (!nowPat || !now.channels.some((c) => c.id === ch.id)) throw new Error('片段或通道已经不存在了');
  const keep = (nowPat.notes[ch.id] || []).filter((n) => n.start >= len * STEP);
  const ops = [];
  if (len * STEP > nowPat.length) ops.push({ type: 'pattern/update', id: pat.id, patch: { length: Math.ceil((len * STEP) / bar) * bar } });
  ops.push({ type: 'notes/set', patternId: pat.id, channelId: ch.id, notes: [...keep, ...notes.map((n) => ({ id: uid('n'), key: n.key, start: n.step * STEP, length: Math.max(1, Math.round(n.length * STEP)), velocity: n.velocity }))] });
  S().dispatch(ops);
  return notes.length;
}

export function cloneChannel(channelId) {
  const s = S();
  const c = s.project.channels.find((x) => x.id === channelId);
  if (!c) return;
  const id = uid('ch');
  const idx = s.project.channels.indexOf(c) + 1;
  s.dispatch([{ type: 'channel/add', index: idx, channel: { ...JSON.parse(JSON.stringify(c)), id, name: `${c.name} #2`, mixerTrack: c.mixerTrack } }]);
  s.selectChannel(id);
}

export async function renameChannel(channelId) {
  const s = S();
  const c = s.project.channels.find((x) => x.id === channelId);
  const name = await s.prompt({ title: '重命名通道', value: c.name });
  if (name && name.trim()) s.dispatch([{ type: 'channel/update', id: channelId, patch: { name: name.trim() } }]);
}

export async function deleteChannel(channelId) {
  const s = S();
  const c = s.project.channels.find((x) => x.id === channelId);
  if (!c) return;
  const hasNotes = s.project.patterns.some((p) => p.notes[c.id]?.length);
  if (hasNotes && !(await s.confirm({ title: `Delete "${c.name}"?`, message: '它在所有片段里的音符都会一并删除。', danger: true, okLabel: '删除' }))) return;
  s.dispatch([{ type: 'channel/remove', id: channelId }]);
}

// ------------------------------------------------------------ patterns

export function newPattern(name) {
  const s = S();
  const p = s.project;
  let i = p.patterns.length + 1;
  while (p.patterns.some((x) => x.name === `片段 ${i}`)) i++;
  const id = uid('pat');
  s.dispatch([{ type: 'pattern/add', pattern: { id, name: name || `片段 ${i}`, color: COLORS[(p.patterns.length * 5) % COLORS.length], length: ticksPerBar(p) } }]);
  s.selectPattern(id);
  return id;
}

export function clonePattern(patternId) {
  const s = S();
  const src = s.project.patterns.find((x) => x.id === patternId);
  if (!src) return null;
  const id = uid('pat');
  const notes = {};
  for (const [cid, list] of Object.entries(src.notes)) notes[cid] = list.map((n) => ({ ...n, id: uid('n') }));
  s.dispatch([{ type: 'pattern/add', index: s.project.patterns.indexOf(src) + 1, pattern: { id, name: `${src.name} #2`, color: src.color, length: src.length, notes } }]);
  s.selectPattern(id);
  return id;
}

export async function renamePattern(patternId) {
  const s = S();
  const pt = s.project.patterns.find((x) => x.id === patternId);
  const name = await s.prompt({ title: '重命名片段', value: pt.name });
  if (name && name.trim()) s.dispatch([{ type: 'pattern/update', id: patternId, patch: { name: name.trim() } }]);
}

export async function deletePattern(patternId) {
  const s = S();
  if (s.project.patterns.length <= 1) { s.toast('一个工程至少要有一个片段', 'warn'); return; }
  const pt = s.project.patterns.find((x) => x.id === patternId);
  if (!(await s.confirm({ title: `Delete pattern "${pt.name}"?`, message: '它在播放列表里的片段也会一并移除。', danger: true, okLabel: '删除' }))) return;
  s.dispatch([{ type: 'pattern/remove', id: patternId }]);
}

/** Set the step-sequencer length of a pattern (in steps). */
export function setPatternSteps(patternId, steps) {
  const s = S();
  s.dispatch([{ type: 'pattern/update', id: patternId, patch: { length: Math.max(1, Math.round(steps)) * STEP } }], { coalesce: `plen:${patternId}` });
}

// ------------------------------------------------------------ step sequencer helpers

export function fillSteps(patternId, channelId, every, offset = 0) {
  const s = S();
  const p = s.project;
  const pt = p.patterns.find((x) => x.id === patternId);
  const ch = p.channels.find((c) => c.id === channelId);
  const steps = Math.round(patternLength(p, pt) / STEP);
  const notes = [];
  for (let i = offset; i < steps; i += every) notes.push({ id: uid('n'), key: ch.rootKey, start: i * STEP, length: STEP, velocity: 0.8 });
  s.dispatch([{ type: 'notes/set', patternId, channelId, notes }]);
}

export function shiftSteps(patternId, channelId, dir) {
  const s = S();
  const p = s.project;
  const pt = p.patterns.find((x) => x.id === patternId);
  const len = patternLength(p, pt);
  const notes = (pt.notes[channelId] || []).map((n) => ({ ...n, start: (((n.start + dir * STEP) % len) + len) % len }));
  s.dispatch([{ type: 'notes/set', patternId, channelId, notes }]);
}

export function randomizeSteps(patternId, channelId, density = 0.35) {
  const s = S();
  const p = s.project;
  const pt = p.patterns.find((x) => x.id === patternId);
  const ch = p.channels.find((c) => c.id === channelId);
  const steps = Math.round(patternLength(p, pt) / STEP);
  const notes = [];
  for (let i = 0; i < steps; i++) {
    const strong = i % 4 === 0 ? 1.6 : i % 2 === 0 ? 1 : 0.6;
    if (Math.random() < density * strong) notes.push({ id: uid('n'), key: ch.rootKey, start: i * STEP, length: STEP, velocity: 0.55 + Math.random() * 0.45 });
  }
  s.dispatch([{ type: 'notes/set', patternId, channelId, notes }]);
}

// ------------------------------------------------------------ project files

export async function exportWav(mode = 'song', { bitDepth = 16 } = {}) {
  const s = S();
  const p = s.project;
  s.toast(`正在渲染${mode === 'song' ? '整首' : '片段'}…`, 'info', 2000);
  useStore.setState({ busy: '正在渲染音频…' });
  try {
    const eng = getEngine();
    const { blob, seconds } = await renderProject(p, { mode, patternId: s.selectedPatternId, loops: 4, bitDepth, samples: eng?.samples || new Map() });
    download(blob, `${safe(p.name)}${mode === 'pattern' ? ' - 片段' : ''}${bitDepth === 24 ? ' (24-bit)' : ''}.wav`);
    s.toast(`已导出 ${seconds.toFixed(1)} 秒 ${bitDepth} 位 WAV`, 'success');
  } catch (e) {
    console.error(e);
    s.toast(`导出失败：${e.message}`, 'error');
  } finally {
    useStore.setState({ busy: null });
  }
}

/**
 * Export the song in another format: render a 24-bit WAV here, store it in Exports, convert it with ffmpeg on the
 * server (MP3, AAC, Ogg, Opus, FLAC, ALAC, AIFF), drop the intermediate WAV and download the result.
 */
export async function exportAs(format, { mode = 'song', bitrate } = {}) {
  const s = S();
  const p = s.project;
  const f = s.exportFormats?.formats.find((x) => x.id === format);
  if (!f?.available) {
    s.toast(`导出 ${f?.label || format} 需要服务器上装有 ffmpeg（设置 → 音频导出）`, 'warn');
    return;
  }
  useStore.setState({ busy: `Rendering for ${f.label}…` });
  let wavName = null;
  try {
    const eng = getEngine();
    const { blob, seconds } = await renderProject(p, { mode, patternId: s.selectedPatternId, loops: 4, bitDepth: 24, samples: eng?.samples || new Map() });
    useStore.setState({ busy: `Converting to ${f.label}…` });
    const form = new FormData();
    form.append('name', `${safe(p.name)}${mode === 'pattern' ? '-pattern' : ''}`);
    form.append('file', blob, 'render.wav');
    wavName = (await api.uploadExport(form)).export.name;
    const { export: out } = await api.convertExport(wavName, { format, ...(bitrate ? { bitrate } : {}), metadata: { title: p.name } });
    const a = document.createElement('a');
    a.href = out.url;
    a.download = out.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    const quality = out.bitrate ? `${out.bitrate} kbps` : out.bitDepth ? `${out.bitDepth}-bit` : '';
    s.toast(`已导出 ${seconds.toFixed(1)} 秒 ${f.label}${quality ? `（${quality}）` : ''}——也存进了「工程 → 导出」`, 'success');
  } catch (e) {
    console.error(e);
    s.toast(`导出失败：${e.message}`, 'error');
  } finally {
    if (wavName) await api.deleteExport(wavName).catch(() => {});
    useStore.setState((x) => ({ busy: null, exportsRev: x.exportsRev + 1 }));
  }
}

/** Render a spatial deliverable (binaural, 5.1, 7.1, 7.1.4, object stems, ADM BWF) into Projects → Exports. */
export async function exportSpatialFromUi(format) {
  const s = S();
  useStore.setState({ busy: `Rendering the spatial mix (${format})…` });
  try {
    const r = await exportSpatial({ projectId: s.project.id, format, mode: s.project.playlist.clips.length ? 'song' : 'pattern', patternId: s.selectedPatternId, loops: 4 });
    const hot = (r.channels || []).filter((c) => c.peakDb > -0.3).map((c) => c.id);
    s.toast(`已导出 ${r.files.length} 个文件到「工程 → 导出」${hot.length ? `——${hot.join('、')} 已经顶到 0 dBFS（三维对象不经过主输出限幅器）` : ''}`, hot.length ? 'warn' : 'success');
    if (r.positions && r.files.length > 1) {
      download(new Blob([JSON.stringify(r.positions, null, 1)], { type: 'application/json' }), `${safe(s.project.name)}-positions.json`);
    }
  } catch (e) {
    console.error(e);
    s.toast(`空间导出失败：${e.message}`, 'error');
  } finally {
    useStore.setState({ busy: null });
  }
}

/** Render every channel on its own into Projects → Exports (24-bit, no master bus effects). */
export async function exportStemsFromUi() {
  const s = S();
  useStore.setState({ busy: '正在导出分轨…' });
  try {
    await exportStems({ projectId: s.project.id, mode: s.project.playlist.clips.length ? 'song' : 'pattern', patternId: s.selectedPatternId, loops: 4, bitDepth: 24, fromUi: true });
  } catch (e) {
    console.error(e);
    s.toast(`分轨导出失败：${e.message}`, 'error');
  } finally {
    useStore.setState({ busy: null });
  }
}

export function exportMidi(mode = 'song') {
  const s = S();
  const bytes = projectToMidi(s.project, { mode, patternId: s.selectedPatternId });
  download(new Blob([bytes], { type: 'audio/midi' }), `${safe(s.project.name)}.mid`);
}

export function exportProjectJson() {
  const p = S().project;
  download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `${safe(p.name)}.gtd.json`);
}

export async function importProjectJson() {
  const s = S();
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const project = JSON.parse(await file.text());
    await s.createProject({ project, name: project.name ? `${project.name} (imported)` : '导入的工程' });
    s.toast('工程已导入', 'success');
  } catch (e) {
    s.toast(`导入失败：${e.message}`, 'error');
  }
}

/** Import a MIDI file into the selected pattern: one new channel per MIDI track. */
export async function importMidi() {
  const s = S();
  const file = await pickFile('.mid,.midi,audio/midi');
  if (!file) return;
  try {
    const midi = parseMidi(new Uint8Array(await file.arrayBuffer()));
    if (!midi.tracks.length) throw new Error('MIDI 文件里没有音符');
    const p = s.project;
    const patternId = s.selectedPatternId;
    const ops = [];
    let maxEnd = 0;
    const used = new Set(p.channels.map((c) => c.mixerTrack));
    let nextIns = 1;
    for (const tr of midi.tracks) {
      const id = uid('ch');
      while (used.has(nextIns) && nextIns < p.mixer.length) nextIns++;
      const ins = nextIns < p.mixer.length ? nextIns : 0;
      used.add(ins);
      const avg = tr.notes.reduce((a, n) => a + n.key, 0) / tr.notes.length;
      const preset = tr.isDrum ? null : avg < 48 ? '超低音' : avg < 60 ? '温暖键盘' : '拨奏';
      ops.push({ type: 'channel/add', nameInsert: true, channel: { id, name: tr.name.slice(0, 32), kind: tr.isDrum ? 'perc' : 'synth', preset: preset || undefined, mixerTrack: ins } });
      ops.push({ type: 'notes/set', patternId, channelId: id, notes: tr.notes.map((n) => ({ id: uid('n'), key: n.key, start: n.start, length: n.length, velocity: n.velocity })) });
      for (const n of tr.notes) maxEnd = Math.max(maxEnd, n.start + n.length);
    }
    const bar = ticksPerBar(p);
    ops.push({ type: 'pattern/update', id: patternId, patch: { length: Math.max(bar, Math.ceil(maxEnd / bar) * bar) } });
    if (midi.bpm && (await s.confirm({ title: '使用 MIDI 的速度？', message: `The file is ${midi.bpm} BPM (project is ${p.bpm}).`, okLabel: '使用 MIDI 速度' }))) {
      ops.push({ type: 'project/update', patch: { bpm: midi.bpm } });
    }
    s.dispatch(ops);
    s.toast(`已把 ${midi.tracks.length} 条 MIDI 轨道导入片段`, 'success');
  } catch (e) {
    s.toast(`MIDI 导入失败：${e.message}`, 'error');
  }
}

export async function uploadSamples(files, { folderId = null } = {}) {
  const s = S();
  const out = [];
  for (const f of files) {
    try {
      const item = await api.uploadSample(f, { folderId });
      out.push(item);
      // the server analyses WAV itself; other formats are decoded + analysed here with the browser's codecs
      if (!item.analysis) analyzeSampleInBrowser(item.id).then(() => s.refreshSamples()).catch((e) => console.warn('采样分析失败', e));
    } catch (e) {
      s.toast(`「${f.name}」：${e.message}`, 'error');
    }
  }
  if (out.length) s.toast(`已上传 ${out.length} 个采样`, 'success');
  s.refreshSamples();
  return out;
}

/** Open a sample in the wave editor (tab 'wave' or 'pitch'); asks first when unsaved edits of another would be lost. */
export async function openSampleEditor(sampleId, { tab } = {}) {
  const s = S();
  if (s.editorSaving && s.editSampleId !== sampleId && s.windows.waveEditor?.open) {
    s.toast('波形编辑器还在保存 — 等保存完再打开另一个采样', 'warn');
    return false;
  }
  if (s.editorDirty && s.editSampleId !== sampleId && s.windows.waveEditor?.open) {
    const name = s.samples.find((x) => x.id === s.editSampleId)?.name || '当前打开的采样';
    const ok = await s.confirm({ title: '丢弃未保存的修改？', message: `Your changes to "${name}" have not been saved.`, danger: true, okLabel: '丢弃' });
    if (!ok) return false;
  }
  // a sample opens on its waveform unless asked otherwise (the pitch analysis only runs when it is wanted)
  useStore.setState({ editSampleId: sampleId, editTab: tab || (s.editSampleId === sampleId ? s.editTab : 'wave'), ...(s.editSampleId !== sampleId ? { editorDirty: false } : {}) });
  S().openWindow('waveEditor');
  return true;
}

/** One-shots play at their detected pitch: set the sampler's root key from the analysis (as Claude's add_channel does). */
export function addSamplerChannel(sample) {
  const pitch = sample.analysis?.kind === 'one-shot' ? sample.analysis.pitch?.midi : undefined;
  return addChannel('sampler', { name: sample.name.slice(0, 32), params: { sampleId: sample.id, ...(Number.isFinite(pitch) ? { rootKey: pitch } : {}) } });
}

let gestureSeq = 0;
/** A coalesce key for one pointer gesture: edits within it are one undo step, separate clicks are separate steps. */
export const gesture = (prefix) => `${prefix}:${++gestureSeq}`;

export function placeAudioClip(sample, track, startTick) {
  const s = S();
  const p = s.project;
  const length = sample.duration ? Math.max(STEP, Math.round(sample.duration * (p.bpm / 60) * PPQ)) : ticksPerBar(p);
  s.dispatch([{ type: 'clip/add', clips: [{ kind: 'audio', refId: sample.id, track, start: startTick, length }] }]);
}

export const SNAP_OPTIONS = [
  { value: 'none', label: '不吸附', ticks: 1 },
  { value: '1/64', label: '1/64 步', ticks: 6 },
  { value: '1/32', label: '1/32（半步）', ticks: 12 },
  { value: 'step', label: '步（1/16）', ticks: 24 },
  { value: '1/8t', label: '1/8 三连音', ticks: 32 },
  { value: '1/8', label: '1/8', ticks: 48 },
  { value: 'beat', label: '拍', ticks: 96 },
  { value: 'bar', label: '小节', ticks: 384 }
];

export function snapTicks(snap, project) {
  if (snap === 'bar') return ticksPerBar(project);
  return SNAP_OPTIONS.find((o) => o.value === snap)?.ticks || STEP;
}
