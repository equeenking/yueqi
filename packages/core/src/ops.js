// Every edit to a project - from the browser UI or from Claude via MCP - is an "op".
// Ops are plain JSON, applied deterministically by applyOps() on both server and client.
import { produce, isDraft, original } from 'immer';
import { clamp, num, MIN_BPM, MAX_BPM, MAX_INSERTS, MAX_TRACKS, MAX_EFFECTS_PER_INSERT, MAX_VOLUME, STEP, COLORS, maxPatternLength } from './constants.js';
import { uid } from './ids.js';
import { INSTRUMENTS, makeInstrument, sanitizeParams } from './instruments.js';
import { EFFECTS, createEffect } from './effects.js';
import { createChannel, createPattern, createClip, createTrack, createMixerInsert, createAutomation, createMarker, normalizeProject, sanitizeNote, normalizeKey, audioClipFields, MAX_NUDGE_MS, MAX_MARKERS, isDefaultInsertName } from './model.js';
import { SCALES } from './music.js';
import { normalizeInsertSpatial, normalizeProjectSpatial, SPATIAL_PARAMS } from './spatial.js';

export const OP_TYPES = [
  'project/update', 'project/replace',
  'channel/add', 'channel/update', 'channel/remove', 'channel/move',
  'pattern/add', 'pattern/update', 'pattern/remove', 'pattern/move',
  'notes/add', 'notes/update', 'notes/remove', 'notes/set',
  'track/add', 'track/update', 'track/remove',
  'clip/add', 'clip/update', 'clip/remove',
  'mixer/add', 'mixer/update',
  'effect/add', 'effect/update', 'effect/remove', 'effect/move',
  'automation/add', 'automation/update', 'automation/remove',
  'marker/add', 'marker/update', 'marker/remove'
];

const str = (v, max = 64) => String(v ?? '').slice(0, max);
/** Per channel per pattern: generous for real music (a 64-bar 1/64 roll is 4096 notes), bounded for the server. */
export const MAX_NOTES_PER_CHANNEL = 8192;

const withId = (obj, prefix) => (obj && typeof obj === 'object' && !obj.id ? { ...obj, id: uid(prefix) } : obj);
const notesWithIds = (notes) => (Array.isArray(notes) ? notes.map((n) => withId(n, 'n')) : notes);

/**
 * Fill in everything applyOp would otherwise generate (ids, pattern colours), so the same ops produce
 * the same project wherever they are applied: the sender's optimistic copy, the server and other tabs.
 * Call it once on a batch before applying or sending it. Already-prepared ops are returned unchanged.
 */
export function prepareOps(ops) {
  if (!Array.isArray(ops)) return ops;
  return ops.map((op) => {
    if (!op || typeof op !== 'object') return op;
    switch (op.type) {
      case 'project/replace':
        // normalising here fixes every id the replacement lacks, so replicas don't each invent their own
        return op.project && typeof op.project === 'object' ? { ...op, project: normalizeProject(op.project) } : op;
      case 'channel/add':
        return { ...op, channel: withId(op.channel || {}, 'ch') };
      case 'pattern/add': {
        const p = withId(op.pattern || {}, 'pat');
        const notes = p.notes && typeof p.notes === 'object'
          ? Object.fromEntries(Object.entries(p.notes).map(([cid, list]) => [cid, notesWithIds(list)]))
          : p.notes;
        return { ...op, pattern: { ...p, color: p.color || COLORS[Math.floor(Math.random() * COLORS.length)], notes } };
      }
      case 'notes/add':
      case 'notes/set':
        return { ...op, notes: notesWithIds(op.notes || []) };
      case 'track/add': {
        const count = Math.max(1, Math.min(Math.round(num(op.count, 1)), MAX_TRACKS));
        return op.ids ? op : { ...op, ids: Array.from({ length: count }, () => uid('trk')) };
      }
      case 'clip/add':
        return { type: op.type, clips: (op.clips || [op.clip]).map((c) => withId(c, 'clip')) };
      case 'mixer/add': {
        const count = Math.max(1, Math.min(Math.round(num(op.count, 1)), MAX_INSERTS));
        return op.ids ? op : { ...op, ids: Array.from({ length: count }, () => uid('mx')) };
      }
      case 'effect/add':
        return { ...op, effect: withId(op.effect || {}, 'fx') };
      case 'automation/add':
        return { ...op, automation: withId(op.automation || {}, 'auto') };
      case 'marker/add':
        return { ...op, markers: (op.markers || [op.marker]).map((m) => withId(m || {}, 'mk')) };
      default:
        return op;
    }
  });
}

function req(cond, msg) {
  if (!cond) throw new Error(msg);
}

function chan(d, id) {
  const c = d.channels.find((x) => x.id === id);
  req(c, `找不到通道 ${id}`);
  return c;
}
function pat(d, id) {
  const p = d.patterns.find((x) => x.id === id);
  req(p, `找不到片段 ${id}`);
  return p;
}
function insert(d, index) {
  const m = Number.isInteger(index) ? d.mixer[index] : undefined;
  req(m, `找不到混音台通道条 ${index ?? '（没给序号）'}（通道条 0..${d.mixer.length - 1}）`);
  return m;
}

/** Would routing `from` -> `to` create a feedback loop? */
export function createsCycle(mixer, from, to) {
  if (from === to) return true;
  if (to === 0) return false;
  const seen = new Set();
  const stack = [to];
  while (stack.length) {
    const i = stack.pop();
    if (i === from) return true;
    if (seen.has(i) || i === 0) continue;
    seen.add(i);
    const m = mixer[i];
    if (!m) continue;
    stack.push(m.output ?? 0);
    for (const s of m.sends || []) stack.push(s.to);
  }
  return false;
}

function patchChannel(d, c, patch) {
  if ('name' in patch) c.name = str(patch.name) || c.name;
  if ('color' in patch) c.color = str(patch.color, 16);
  if ('volume' in patch) c.volume = num(patch.volume, c.volume, 0, MAX_VOLUME);
  if ('pan' in patch) c.pan = num(patch.pan, c.pan, -1, 1);
  if ('pitch' in patch) c.pitch = num(patch.pitch, c.pitch, -24, 24);
  if ('mute' in patch) c.mute = !!patch.mute;
  if ('solo' in patch) c.solo = !!patch.solo;
  if ('chokeGroup' in patch) c.chokeGroup = Math.round(num(patch.chokeGroup, 0, 0, 8));
  if ('rootKey' in patch) c.rootKey = Math.round(num(patch.rootKey, c.rootKey, 0, 127));
  if ('filterCutoff' in patch) c.filterCutoff = num(patch.filterCutoff, c.filterCutoff, 20, 20000);
  if ('filterRes' in patch) c.filterRes = num(patch.filterRes, c.filterRes, 0.1, 20);
  if ('nudge' in patch) c.nudge = num(patch.nudge, c.nudge ?? 0, -MAX_NUDGE_MS, MAX_NUDGE_MS);
  if ('swingMix' in patch) c.swingMix = num(patch.swingMix, c.swingMix ?? 1, 0, 1);
  if ('mixerTrack' in patch) {
    const t = Math.round(num(patch.mixerTrack, 0));
    req(t >= 0 && t < d.mixer.length, `混音台通道条 ${t} 不存在（0..${d.mixer.length - 1}）`);
    c.mixerTrack = t;
  }
  if (patch.instrument) {
    const ins = patch.instrument;
    const kind = ins.kind || c.instrument.kind;
    req(INSTRUMENTS[kind], `不认识的乐器「${kind}」`);
    const kindChanged = kind !== c.instrument.kind;
    if (kind === 'plugin') {
      // values were checked against the plugin's manifest by the caller (MCP/UI); stored loosely here
      const plugin = ins.plugin ?? c.instrument.plugin;
      const pluginChanged = kindChanged || plugin !== c.instrument.plugin;
      if (pluginChanged || ins.preset) c.instrument = makeInstrument('plugin', ins.preset, ins.params || {}, { plugin });
      else if (ins.params) Object.assign(c.instrument.params, makeInstrument('plugin', null, ins.params).params);
      // the caller passes the manifest's defaultKey as rootKey; without it fall back to C4
      if (pluginChanged && !('rootKey' in patch)) c.rootKey = INSTRUMENTS.plugin.defaultKey;
    } else if (kindChanged || ins.preset) {
      const keep = !kindChanged && kind === 'sampler' ? { sampleId: c.instrument.params.sampleId } : {};
      c.instrument = makeInstrument(kind, ins.preset, { ...keep, ...(ins.params || {}) });
      if (kindChanged && !('rootKey' in patch)) c.rootKey = INSTRUMENTS[kind].defaultKey;
    } else if (ins.params) {
      Object.assign(c.instrument.params, sanitizeParams(INSTRUMENTS[kind].params, ins.params));
    }
  }
}

function patchMixer(d, index, m, patch) {
  if ('name' in patch) m.name = str(patch.name) || m.name;
  if ('color' in patch) m.color = patch.color ? str(patch.color, 16) : null;
  if ('volume' in patch) m.volume = num(patch.volume, m.volume, 0, MAX_VOLUME);
  if ('pan' in patch) m.pan = num(patch.pan, m.pan, -1, 1);
  if ('mute' in patch) m.mute = !!patch.mute;
  if ('solo' in patch) m.solo = !!patch.solo;
  if ('output' in patch && index !== 0) {
    const to = Math.round(num(patch.output, 0));
    req(to >= 0 && to < d.mixer.length, `混音台通道条 ${to} 不存在`);
    req(!createsCycle(d.mixer, index, to), `把通道条 ${index} 路由到 ${to} 会形成回路（声音绕一圈回自己）`);
    m.output = to;
  }
  if ('sends' in patch && index !== 0) {
    const sends = [];
    for (const s of patch.sends || []) {
      const to = Math.round(num(s.to, -1));
      req(to >= 0 && to < d.mixer.length && to !== index, `发送目标 ${s.to} 不对`);
      const probe = d.mixer.map((x, i) => (i === index ? { ...x, sends } : x));
      req(!createsCycle(probe, index, to), `从 ${index} 发送到 ${to} 会形成回路`);
      sends.push({ to, amount: num(s.amount, 0.5, 0, 1) });
    }
    m.sends = sends;
  }
  if ('spatial' in patch && index !== 0) {
    req(patch.spatial && typeof patch.spatial === 'object', '空间设置必须是一个对象 { enabled, x, y, z, lfe }');
    m.spatial = normalizeInsertSpatial({ ...normalizeInsertSpatial(m.spatial, m.pan), ...patch.spatial }, m.pan);
  }
}

function sanitizeTarget(d, t) {
  req(t && typeof t === 'object', '必须指定自动化目标');
  const type = t.type;
  if (type === 'channel') {
    chan(d, t.id);
    req(['volume', 'pan', 'filterCutoff', 'filterRes', 'pitch'].includes(t.param), '通道自动化参数只能是 volume、pan、pitch、filterCutoff 或 filterRes');
    return { type, id: t.id, param: t.param };
  }
  if (type === 'mixer') {
    insert(d, t.index);
    req(['volume', 'pan'].includes(t.param) || (t.index > 0 && SPATIAL_PARAMS[t.param]), `混音台自动化参数只能是 volume、pan${t.index > 0 ? '、spatialX、spatialY 或 spatialZ' : ''}`);
    return { type, index: t.index, param: t.param };
  }
  if (type === 'effect') {
    const m = insert(d, t.index);
    const fx = m.effects.find((e) => e.id === t.effectId);
    req(fx, `通道条 ${t.index} 上没有效果器 ${t.effectId}`);
    if (fx.type === 'plugin') req(typeof fx.params[t.param] === 'number', `插件效果器的参数「${t.param}」不是数字`);
    else {
      const p = EFFECTS[fx.type].params.find((x) => x.key === t.param);
      req(p && p.automatable, `${fx.type} 的参数「${t.param}」不能画自动化`);
    }
    return { type, index: t.index, effectId: t.effectId, param: t.param };
  }
  if (type === 'master') {
    req(['volume', 'pan'].includes(t.param), '主输出自动化参数只能是 volume 或 pan');
    return { type, param: t.param };
  }
  throw new Error(`自动化目标类型不对：「${type}」`);
}

function sanitizePoints(points, length) {
  return (points || [])
    .map((p) => ({ t: clamp(Math.round(num(p.t, 0)), 0, length), v: num(p.v, 0.5, 0, 1) }))
    .sort((a, b) => a.t - b.t);
}

/** Apply one op to an immer draft. */
export function applyOp(d, op) {
  req(op && typeof op.type === 'string', '操作必须带一个 type');
  switch (op.type) {
    case 'project/update': {
      const p = op.patch || {};
      if ('name' in p) d.name = str(p.name, 100) || d.name;
      if ('bpm' in p) d.bpm = Math.round(num(p.bpm, d.bpm, MIN_BPM, MAX_BPM) * 100) / 100;
      if ('swing' in p) d.swing = num(p.swing, d.swing, 0, 1);
      if ('key' in p) {
        const k = normalizeKey(p.key);
        req(k, `调号不对：「${p.key}」。写成 C、F#、Bb 这样的主音（大小调由 scale 决定）`);
        d.key = k;
      }
      if ('scale' in p) {
        req(SCALES[p.scale], `不认识的音阶「${p.scale}」。已知：${Object.keys(SCALES).join('、')}`);
        d.scale = p.scale;
      }
      if ('spatial' in p) {
        req(p.spatial && typeof p.spatial === 'object', '空间设置必须是一个对象 { enabled, monitor }');
        d.spatial = normalizeProjectSpatial({ ...normalizeProjectSpatial(d.spatial), ...p.spatial });
      }
      if ('timeSig' in p && Array.isArray(p.timeSig)) {
        const [a, b] = p.timeSig.map((x) => Math.round(num(x, 4)));
        req(a >= 1 && a <= 32 && [2, 4, 8, 16].includes(b), '拍号不对');
        d.timeSig = [a, b];
      }
      return;
    }
    case 'channel/add': {
      if (op.channel?.id && d.channels.some((x) => x.id === op.channel.id)) return; // idempotent (re-sent op)
      const auto = op.channel?.mixerTrack === 'auto';
      const c = createChannel({ ...(op.channel || {}), mixerTrack: auto ? 0 : op.channel?.mixerTrack });
      if (auto) {
        // first free insert (resolved here so parallel adds never collide): no channel on it, and not a bus —
        // an insert with effects or one that receives sends/routing (e.g. a shared reverb) is taken
        const used = new Set(d.channels.map((x) => x.mixerTrack));
        for (const m of d.mixer) {
          if (m.output) used.add(m.output);
          for (const s of m.sends || []) used.add(s.to);
        }
        c.mixerTrack = 0;
        for (let i = 1; i < d.mixer.length; i++) if (!used.has(i) && !d.mixer[i].effects.length) { c.mixerTrack = i; break; }
      }
      if (c.mixerTrack >= d.mixer.length) c.mixerTrack = 0;
      if (op.nameInsert && c.mixerTrack > 0 && isDefaultInsertName(d.mixer[c.mixerTrack].name)) d.mixer[c.mixerTrack].name = c.name;
      const idx = op.index ?? d.channels.length;
      d.channels.splice(clamp(idx, 0, d.channels.length), 0, c);
      return;
    }
    case 'channel/update': {
      patchChannel(d, chan(d, op.id), op.patch || {});
      return;
    }
    case 'channel/remove': {
      const i = d.channels.findIndex((c) => c.id === op.id);
      req(i >= 0, `找不到通道 ${op.id}`);
      d.channels.splice(i, 1);
      for (const p of d.patterns) delete p.notes[op.id];
      // effects that pointed at it (a sidechain's trigger channel) fall back to "none"
      for (const m of d.mixer) {
        for (const fx of m.effects) {
          for (const def of EFFECTS[fx.type]?.params || []) if (def.type === 'channel' && fx.params[def.key] === op.id) fx.params[def.key] = null;
        }
      }
      const autoIds = d.automations.filter((a) => a.target.type === 'channel' && a.target.id === op.id).map((a) => a.id);
      d.automations = d.automations.filter((a) => !autoIds.includes(a.id));
      d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'automation' && autoIds.includes(c.refId)));
      return;
    }
    case 'channel/move': {
      const i = d.channels.findIndex((c) => c.id === op.id);
      req(i >= 0, `找不到通道 ${op.id}`);
      const [c] = d.channels.splice(i, 1);
      d.channels.splice(clamp(op.index, 0, d.channels.length), 0, c);
      return;
    }
    case 'pattern/add': {
      if (op.pattern?.id && d.patterns.some((x) => x.id === op.pattern.id)) return; // idempotent
      const p = createPattern(op.pattern || {});
      p.length = Math.min(p.length, maxPatternLength(d));
      const notes = {};
      for (const [cid, list] of Object.entries(p.notes || {})) {
        if (d.channels.some((c) => c.id === cid)) notes[cid] = list.map(sanitizeNote);
      }
      p.notes = notes;
      d.patterns.splice(clamp(op.index ?? d.patterns.length, 0, d.patterns.length), 0, p);
      return;
    }
    case 'pattern/update': {
      const p = pat(d, op.id);
      const patch = op.patch || {};
      if ('name' in patch) p.name = str(patch.name) || p.name;
      if ('color' in patch) p.color = str(patch.color, 16);
      if ('length' in patch) p.length = Math.max(STEP, Math.round(num(patch.length, p.length, STEP, maxPatternLength(d))));
      return;
    }
    case 'pattern/remove': {
      req(d.patterns.length > 1, '一个工程至少要有一个片段');
      const i = d.patterns.findIndex((p) => p.id === op.id);
      req(i >= 0, `找不到片段 ${op.id}`);
      d.patterns.splice(i, 1);
      d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'pattern' && c.refId === op.id));
      return;
    }
    case 'pattern/move': {
      const i = d.patterns.findIndex((p) => p.id === op.id);
      req(i >= 0, `找不到片段 ${op.id}`);
      const [p] = d.patterns.splice(i, 1);
      d.patterns.splice(clamp(op.index, 0, d.patterns.length), 0, p);
      return;
    }
    case 'notes/add': {
      const p = pat(d, op.patternId);
      chan(d, op.channelId);
      const list = p.notes[op.channelId] || (p.notes[op.channelId] = []);
      const cap = `一个片段里每个通道最多 ${MAX_NOTES_PER_CHANNEL} 个音符`;
      req((op.notes?.length || 0) <= MAX_NOTES_PER_CHANNEL, cap);
      // replace an identical note (same key + start) instead of stacking duplicates — via an index, since a scan per
      // note would be quadratic on big patterns
      const base = isDraft(list) ? original(list) : list;
      const at = new Map(base.map((x, i) => [`${x.key}:${x.start}`, i]));
      for (const n of op.notes || []) {
        const sn = sanitizeNote(n);
        const k = `${sn.key}:${sn.start}`;
        if (at.has(k)) list[at.get(k)] = sn;
        else {
          at.set(k, list.length);
          list.push(sn);
        }
      }
      // checked after merging: re-adding existing notes (same key + start) doesn't grow the list
      req(list.length <= MAX_NOTES_PER_CHANNEL, cap);
      list.sort((a, b) => a.start - b.start || a.key - b.key);
      return;
    }
    case 'notes/update': {
      const p = pat(d, op.patternId);
      const list = p.notes[op.channelId] || [];
      for (const upd of op.notes || []) {
        const i = list.findIndex((x) => x.id === upd.id);
        if (i >= 0) list[i] = sanitizeNote({ ...list[i], ...upd, id: list[i].id });
      }
      list.sort((a, b) => a.start - b.start || a.key - b.key);
      return;
    }
    case 'notes/remove': {
      const p = pat(d, op.patternId);
      if (!op.ids) { delete p.notes[op.channelId]; return; }
      const ids = new Set(op.ids);
      if (p.notes[op.channelId]) p.notes[op.channelId] = p.notes[op.channelId].filter((n) => !ids.has(n.id));
      return;
    }
    case 'notes/set': {
      const p = pat(d, op.patternId);
      chan(d, op.channelId);
      req((op.notes?.length || 0) <= MAX_NOTES_PER_CHANNEL, `一个片段里每个通道最多 ${MAX_NOTES_PER_CHANNEL} 个音符`);
      p.notes[op.channelId] = (op.notes || []).map(sanitizeNote).sort((a, b) => a.start - b.start || a.key - b.key);
      return;
    }
    case 'track/add': {
      req(d.playlist.tracks.length < MAX_TRACKS, `播放列表最多 ${MAX_TRACKS} 条轨道`);
      const count = Math.max(1, Math.min(op.ids?.length || op.count || 1, MAX_TRACKS - d.playlist.tracks.length));
      for (let i = 0; i < count; i++) d.playlist.tracks.push(createTrack(d.playlist.tracks.length, { ...(op.track || {}), id: op.ids?.[i] }));
      return;
    }
    case 'track/update': {
      const t = Number.isInteger(op.index) ? d.playlist.tracks[op.index] : undefined;
      req(t, `播放列表没有第 ${Number(op.index) + 1} 条轨道（现有 ${d.playlist.tracks.length} 条，最多 ${MAX_TRACKS} 条）`);
      const patch = op.patch || {};
      if ('name' in patch) t.name = str(patch.name) || t.name;
      if ('color' in patch) t.color = patch.color ? str(patch.color, 16) : null;
      if ('mute' in patch) t.mute = !!patch.mute;
      return;
    }
    case 'track/remove': {
      const index = op.index;
      req(Number.isInteger(index) && d.playlist.tracks[index], `播放列表没有第 ${Number(index) + 1} 条轨道`);
      req(d.playlist.tracks.length > 1, '至少要保留一条轨道');
      d.playlist.tracks.splice(index, 1);
      // clips on the track go with it; the ones below move up a row
      d.playlist.clips = d.playlist.clips
        .filter((c) => c.track !== index)
        .map((c) => (c.track > index ? { ...c, track: c.track - 1 } : c));
      return;
    }
    case 'clip/add': {
      for (const c of op.clips || [op.clip]) {
        if (c?.id && d.playlist.clips.some((x) => x.id === c.id)) continue; // idempotent
        const clip = createClip(c);
        validateClipRef(d, clip);
        while (clip.track >= d.playlist.tracks.length && d.playlist.tracks.length < MAX_TRACKS) {
          // id derived from the clip so every replica creates the same track
          d.playlist.tracks.push(createTrack(d.playlist.tracks.length, { id: `${clip.id}-t${d.playlist.tracks.length}` }));
        }
        req(clip.track < d.playlist.tracks.length, `轨道 ${clip.track + 1} 超出范围（最多 ${MAX_TRACKS} 条轨道）`);
        d.playlist.clips.push(clip);
      }
      return;
    }
    case 'clip/update': {
      const updates = op.clips || [{ id: op.id, ...op.patch }];
      for (const u of updates) {
        const c = d.playlist.clips.find((x) => x.id === u.id);
        req(c, `播放列表里找不到片段块 ${u.id}`);
        if ('start' in u) c.start = Math.max(0, Math.round(num(u.start, c.start)));
        if ('length' in u) c.length = Math.max(1, Math.round(num(u.length, c.length)));
        if ('offset' in u) c.offset = Math.max(0, Math.round(num(u.offset, c.offset)));
        if ('mute' in u) c.mute = !!u.mute;
        if (c.kind === 'audio' && ['gain', 'fadeIn', 'fadeOut', 'rate'].some((k) => k in u)) Object.assign(c, audioClipFields(u, audioClipFields(c)));
        if ('track' in u) {
          const t = Math.round(num(u.track, c.track));
          req(t >= 0 && t < d.playlist.tracks.length, `轨道 ${t + 1} 超出范围（共 ${d.playlist.tracks.length} 条轨道）`);
          c.track = t;
        }
        if ('refId' in u) {
          const probe = { ...c, refId: String(u.refId) };
          validateClipRef(d, probe);
          c.refId = probe.refId;
        }
      }
      return;
    }
    case 'clip/remove': {
      const ids = new Set(op.ids || [op.id]);
      d.playlist.clips = d.playlist.clips.filter((c) => !ids.has(c.id));
      return;
    }
    case 'mixer/add': {
      const count = Math.max(1, op.ids?.length || op.count || 1);
      for (let i = 0; i < count; i++) {
        req(d.mixer.length <= MAX_INSERTS, `混音台最多 ${MAX_INSERTS} 条通道条`);
        d.mixer.push(createMixerInsert(d.mixer.length, { ...(op.insert || {}), id: op.ids?.[i] }));
      }
      return;
    }
    case 'mixer/update': {
      patchMixer(d, op.index, insert(d, op.index), op.patch || {});
      return;
    }
    case 'effect/add': {
      const m = insert(d, op.index);
      if (op.effect?.id && m.effects.some((e) => e.id === op.effect.id)) return; // idempotent
      req(m.effects.length < MAX_EFFECTS_PER_INSERT, `每条通道条最多 ${MAX_EFFECTS_PER_INSERT} 个效果器`);
      const fx = createEffect(op.effect.type, op.effect.params, { id: op.effect.id, enabled: op.effect.enabled, plugin: op.effect.plugin });
      m.effects.splice(clamp(op.position ?? m.effects.length, 0, m.effects.length), 0, fx);
      return;
    }
    case 'effect/update': {
      const m = insert(d, op.index);
      const fx = m.effects.find((e) => e.id === op.effectId);
      req(fx, `找不到效果器 ${op.effectId}`);
      const patch = op.patch || {};
      if ('enabled' in patch) fx.enabled = !!patch.enabled;
      if (patch.params) Object.assign(fx.params, fx.type === 'plugin' ? createEffect('plugin', patch.params).params : sanitizeParams(EFFECTS[fx.type].params, patch.params));
      return;
    }
    case 'effect/remove': {
      const m = insert(d, op.index);
      m.effects = m.effects.filter((e) => e.id !== op.effectId);
      const autoIds = d.automations.filter((a) => a.target.type === 'effect' && a.target.effectId === op.effectId).map((a) => a.id);
      d.automations = d.automations.filter((a) => !autoIds.includes(a.id));
      d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'automation' && autoIds.includes(c.refId)));
      return;
    }
    case 'effect/move': {
      const m = insert(d, op.index);
      const i = m.effects.findIndex((e) => e.id === op.effectId);
      req(i >= 0, `找不到效果器 ${op.effectId}`);
      const [fx] = m.effects.splice(i, 1);
      m.effects.splice(clamp(op.position, 0, m.effects.length), 0, fx);
      return;
    }
    case 'automation/add': {
      if (op.automation?.id && d.automations.some((x) => x.id === op.automation.id)) return; // idempotent
      const a = createAutomation(op.automation || {});
      a.target = sanitizeTarget(d, a.target);
      d.automations.push(a);
      return;
    }
    case 'automation/update': {
      const a = d.automations.find((x) => x.id === op.id);
      req(a, `找不到自动化 ${op.id}`);
      const patch = op.patch || {};
      if ('name' in patch) a.name = str(patch.name) || a.name;
      if ('color' in patch) a.color = str(patch.color, 16);
      if ('length' in patch) a.length = Math.max(STEP, Math.round(num(patch.length, a.length)));
      if ('target' in patch) a.target = sanitizeTarget(d, patch.target);
      if ('points' in patch) a.points = sanitizePoints(patch.points, a.length);
      else a.points = sanitizePoints(a.points, a.length);
      return;
    }
    case 'automation/remove': {
      d.automations = d.automations.filter((a) => a.id !== op.id);
      d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'automation' && c.refId === op.id));
      return;
    }
    case 'marker/add': {
      d.markers ||= [];
      for (const m of op.markers || [op.marker]) {
        if (m?.id && d.markers.some((x) => x.id === m.id)) continue; // idempotent
        req(d.markers.length < MAX_MARKERS, `最多 ${MAX_MARKERS} 个标记`);
        d.markers.push(createMarker(m || {}));
      }
      d.markers.sort((a, b) => a.tick - b.tick);
      return;
    }
    case 'marker/update': {
      const m = (d.markers || []).find((x) => x.id === op.id);
      req(m, `找不到标记 ${op.id}`);
      const patch = op.patch || {};
      if ('name' in patch) m.name = str(patch.name) || m.name;
      if ('tick' in patch) m.tick = Math.max(0, Math.round(num(patch.tick, m.tick)));
      d.markers.sort((a, b) => a.tick - b.tick);
      return;
    }
    case 'marker/remove': {
      const ids = new Set(op.ids || [op.id]);
      d.markers = (d.markers || []).filter((m) => !ids.has(m.id));
      return;
    }
    default:
      throw new Error(`不认识的操作类型「${op.type}」`);
  }
}

function validateClipRef(d, clip) {
  if (clip.kind === 'pattern') req(d.patterns.some((p) => p.id === clip.refId), `找不到片段 ${clip.refId}`);
  if (clip.kind === 'automation') req(d.automations.some((a) => a.id === clip.refId), `找不到自动化 ${clip.refId}`);
  // audio clips reference the global sample library; not validated here
}

/** Apply a list of ops, returning a new (structurally shared) project. Throws on invalid ops. */
export function applyOps(project, ops) {
  let current = project;
  for (const op of ops) {
    if (op?.type === 'project/replace') {
      current = normalizeProject({ ...op.project, id: project.id, rev: project.rev, createdAt: project.createdAt });
    } else {
      current = produce(current, (d) => { applyOp(d, op); });
    }
  }
  return current;
}

/** Short human-readable description of an op batch (activity log). */
export function describeOps(ops, project) {
  const name = (list, id) => list?.find((x) => x.id === id)?.name || id;
  return ops.map((op) => {
    switch (op.type) {
      case 'project/update': return `Updated project ${Object.keys(op.patch || {}).join(', ')}`;
      case 'project/replace': return 'Replaced project state';
      case 'channel/add': return `Added channel ${op.channel?.name || op.channel?.kind || ''}`;
      case 'channel/update': return `Edited channel ${name(project?.channels, op.id)}`;
      case 'channel/remove': return `Removed channel ${name(project?.channels, op.id)}`;
      case 'pattern/add': return `Added pattern ${op.pattern?.name || ''}`;
      case 'pattern/update': return `Edited pattern ${name(project?.patterns, op.id)}`;
      case 'pattern/remove': return `Removed pattern ${name(project?.patterns, op.id)}`;
      case 'notes/add': return `Added ${op.notes?.length || 0} notes to ${name(project?.channels, op.channelId)} (${name(project?.patterns, op.patternId)})`;
      case 'notes/set': return `Wrote ${op.notes?.length || 0} notes for ${name(project?.channels, op.channelId)} (${name(project?.patterns, op.patternId)})`;
      case 'notes/remove': return `Removed notes from ${name(project?.channels, op.channelId)}`;
      case 'notes/update': return `Edited ${op.notes?.length || 0} notes`;
      case 'clip/add': return `Placed ${(op.clips || [op.clip]).length} clip(s) in playlist`;
      case 'clip/update': return 'Moved/edited playlist clips';
      case 'clip/remove': return `Removed ${(op.ids || [op.id]).length} clip(s)`;
      case 'mixer/update': return `Edited mixer insert ${op.index}`;
      case 'effect/add': return `Added ${op.effect?.type === 'plugin' ? `plugin ${op.effect.plugin}` : op.effect?.type} to insert ${op.index}`;
      case 'effect/update': return `Tweaked effect on insert ${op.index}`;
      case 'effect/remove': return `Removed effect from insert ${op.index}`;
      case 'effect/move': return `Reordered effects on insert ${op.index}`;
      case 'channel/move': return `Moved channel ${name(project?.channels, op.id)}`;
      case 'pattern/move': return `Moved pattern ${name(project?.patterns, op.id)}`;
      case 'track/add': return `Added ${op.ids?.length || op.count || 1} playlist track(s)`;
      case 'track/update': return `Edited playlist track ${op.index + 1}${op.patch?.name ? ` "${op.patch.name}"` : ''}`;
      case 'track/remove': return `Deleted playlist track ${op.index + 1}`;
      case 'mixer/add': return `Added ${op.ids?.length || op.count || 1} mixer insert(s)`;
      case 'automation/add': return `Added automation ${op.automation?.name || ''}`;
      case 'automation/update': return `Edited automation ${name(project?.automations, op.id)}`;
      case 'automation/remove': return `Removed automation ${name(project?.automations, op.id)}`;
      case 'marker/add': return `Added marker ${(op.markers || [op.marker]).map((m) => m?.name).filter(Boolean).join(', ')}`;
      case 'marker/update': return `Edited marker ${name(project?.markers, op.id)}`;
      case 'marker/remove': return `Removed ${(op.ids || [op.id]).length} marker(s)`;
      default: return op.type;
    }
  });
}
