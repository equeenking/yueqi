// Playlist arrangement, tracks, automation, transport and MIDI export.
import { STEP, ticksPerBar, uid, findChannel, findPattern, findAutomation, patternLength, songLength, MAX_TRACKS } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A, pickTrack, findEffect, barsOf } from '../util.js';
import { requirePlugin } from './plugins.js';

export function registerArrangeTools({ tool, backend, load, resolveProjectId }) {
  tool('place_pattern', {
    title: '把片段放进播放列表',
    description: '把一个片段块放进播放列表（编曲）。这个片段块会按 bars 指定的小节数循环播放片段。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      startBar: z.number().min(1).describe('片段块起始小节，从 1 开始数（可以带小数，例如 4.5）'),
      bars: z.number().positive().optional().describe('片段块长度，单位小节（默认等于片段长度）'),
      track: z.number().int().min(1).max(MAX_TRACKS).optional().describe('播放列表轨道号，从 1 开始（默认：这个片段已经在用的轨道，否则第一条空轨道）'),
      repeat: z.number().int().min(1).max(64).optional().describe('连着放这么多份（默认 1）')
    },
    annotations: A.edit
  }, async ({ projectId, pattern, startBar, bars, track, repeat = 1 }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const bar = ticksPerBar(p);
    const t = track ? track - 1 : pickTrack(p, pt.id);
    const length = bars ? Math.round(bars * bar) : patternLength(p, pt);
    const start = Math.round((startBar - 1) * bar);
    const clips = Array.from({ length: repeat }, (_, i) => ({ id: uid('clip'), kind: 'pattern', refId: pt.id, track: t, start: start + i * length, length }));
    await backend.applyOps(p.id, [{ type: 'clip/add', clips }]);
    return ok(`Placed "${pt.name}" on track ${t + 1} at bar ${startBar}${repeat > 1 ? ` ×${repeat}` : ''} (${barsOf(p, length)} bars each) [${clips.map((c) => c.id).join(', ')}].`);
  });

  tool('arrange_song', {
    title: '编排整首',
    description: '按一段段连续的段落搭出播放列表，例如 [{"name":"前奏","bars":4,"patterns":["和弦"]},{"name":"副歌","bars":8,"patterns":["鼓组","808","和弦","旋律"]}]。每个片段各占一条轨道（轨道名跟着片段走），并在该段落内循环。起了名字的段落会在播放列表上方变成标记（之后可以在 get_project 里看到）。默认会替换已有的片段块和标记（音频块与自动化块保留）。',
    inputSchema: {
      projectId: projectIdArg,
      sections: z.array(z.object({
        name: z.string().optional(),
        bars: z.number().positive(),
        patterns: z.array(z.string()).describe('这一段里在响的片段名／id')
      })).min(1).max(64),
      clear: z.boolean().optional().describe('先清掉已有的片段块（默认是）'),
      startBar: z.number().min(1).optional().describe('第一段从哪一小节开始（默认 1）')
    },
    annotations: A.edit
  }, async ({ projectId, sections, clear = true, startBar = 1 }) => {
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    const ops = [];
    if (clear) {
      const ids = p.playlist.clips.filter((c) => c.kind === 'pattern').map((c) => c.id);
      if (ids.length) ops.push({ type: 'clip/remove', ids });
      if (p.markers?.length) ops.push({ type: 'marker/remove', ids: p.markers.map((m) => m.id) });
    }
    const markers = [];
    const trackOf = new Map();
    const remaining = clear ? p.playlist.clips.filter((c) => c.kind !== 'pattern') : p.playlist.clips;
    const usedTracks = new Set(remaining.map((c) => c.track));
    if (!clear) for (const c of p.playlist.clips) if (c.kind === 'pattern' && !trackOf.has(c.refId)) trackOf.set(c.refId, c.track);
    let nextTrack = 0;
    const clips = [];
    let pos = Math.round((startBar - 1) * bar);
    const lines = [];
    for (const s of sections) {
      const len = Math.round(s.bars * bar);
      for (const ref of s.patterns) {
        const pt = findPattern(p, ref);
        if (!trackOf.has(pt.id)) {
          while (usedTracks.has(nextTrack)) nextTrack++;
          trackOf.set(pt.id, nextTrack);
          usedTracks.add(nextTrack);
        }
        clips.push({ id: uid('clip'), kind: 'pattern', refId: pt.id, track: trackOf.get(pt.id), start: pos, length: len });
      }
      const whole = pos % bar === 0 && len % bar === 0;
      const where = whole ? `bars ${pos / bar + 1}–${(pos + len) / bar}` : `bar ${barsOf(p, pos) + 1} (+${barsOf(p, len)} bars)`;
      lines.push(`${where}: ${s.name ? `${s.name} — ` : ''}${s.patterns.join(', ') || '(silence)'}`);
      if (s.name) markers.push({ id: uid('mk'), tick: pos, name: s.name.slice(0, 64) });
      pos += len;
    }
    if (clips.length) ops.push({ type: 'clip/add', clips });
    if (markers.length) ops.push({ type: 'marker/add', markers });
    for (const [pid, t] of trackOf) {
      const name = p.patterns.find((x) => x.id === pid)?.name;
      // clip/add (applied first) creates any missing tracks, so tracks past the current count can be named too
      if (name) ops.push({ type: 'track/update', index: t, patch: { name } });
    }
    await backend.applyOps(p.id, ops);
    const ids = clips.length <= 40 ? `\nClip ids: ${clips.map((c) => c.id).join(', ')}` : '\n(Clip ids: see get_project.)';
    return ok(`Arranged ${sections.length} sections, ${clips.length} clips, ${Math.round(pos / bar)} bars total:\n${lines.join('\n')}${ids}`);
  });

  tool('update_clips', {
    title: '移动／改长度',
    description: '按 id 编辑播放列表里的片段块（id 由 get_project 给出）：移动（startBar、track）、改长度（bars）、裁掉开头（offsetBars）、静音；音频块还能设 gainDb、fadeInSteps／fadeOutSteps 和 rate（1＝原速；用 工程 bpm ÷ 循环 bpm 可以把循环变调对齐工程速度）。',
    inputSchema: {
      projectId: projectIdArg,
      clips: z.array(z.object({
        clipId: z.string(),
        startBar: z.number().min(1).optional(),
        bars: z.number().positive().optional(),
        track: z.number().int().min(1).max(MAX_TRACKS).optional(),
        offsetBars: z.number().min(0).optional().describe('从哪里开始播：从片段／音频内部偏移这么多小节'),
        mute: z.boolean().optional(),
        gainDb: z.number().min(-60).max(12).optional().describe('音频块：这一段本身的增益，单位 dB'),
        fadeInSteps: z.number().min(0).optional().describe('音频块：淡入长度，单位步'),
        fadeOutSteps: z.number().min(0).optional().describe('音频块：淡出长度，单位步'),
        rate: z.number().min(0.25).max(4).optional().describe('音频块：播放速度（音高也会跟着变，像唱机变速）')
      })).min(1).max(500)
    },
    annotations: A.edit
  }, async ({ projectId, clips }) => {
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    const ids = new Set(p.playlist.clips.map((c) => c.id));
    const missing = clips.filter((c) => !ids.has(c.clipId)).map((c) => c.clipId);
    if (missing.length) throw new Error(`Unknown clip id(s): ${missing.slice(0, 5).join(', ')}`);
    const audioOnly = clips.filter((c) => ['gainDb', 'fadeInSteps', 'fadeOutSteps', 'rate'].some((k) => c[k] !== undefined) && p.playlist.clips.find((x) => x.id === c.clipId)?.kind !== 'audio');
    if (audioOnly.length) throw new Error(`gainDb, fades and rate only apply to audio clips (not ${audioOnly.map((c) => c.clipId).slice(0, 3).join(', ')})`);
    const upd = clips.map((c) => ({
      id: c.clipId,
      ...(c.startBar !== undefined && { start: Math.round((c.startBar - 1) * bar) }),
      ...(c.bars !== undefined && { length: Math.max(1, Math.round(c.bars * bar)) }),
      ...(c.track !== undefined && { track: c.track - 1 }),
      ...(c.offsetBars !== undefined && { offset: Math.round(c.offsetBars * bar) }),
      ...(c.mute !== undefined && { mute: c.mute }),
      ...(c.gainDb !== undefined && { gain: Math.pow(10, c.gainDb / 20) }),
      ...(c.fadeInSteps !== undefined && { fadeIn: Math.round(c.fadeInSteps * STEP) }),
      ...(c.fadeOutSteps !== undefined && { fadeOut: Math.round(c.fadeOutSteps * STEP) }),
      ...(c.rate !== undefined && { rate: c.rate })
    }));
    const maxTrack = Math.max(...upd.map((u) => u.track ?? 0));
    const ops = [];
    if (maxTrack >= p.playlist.tracks.length) ops.push({ type: 'track/add', count: maxTrack - p.playlist.tracks.length + 1 });
    ops.push({ type: 'clip/update', clips: upd });
    await backend.applyOps(p.id, ops);
    return ok(`Updated ${upd.length} clip(s).`);
  });

  tool('set_markers', {
    title: '添加／改名／删除标记',
    description: '标记给曲子里的位置起名字（比如「主歌 1」「副歌」「drop」这样的段落起点），显示在播放列表上方；get_project 会列出它们。arrange_song 会为起了名字的段落自动生成标记。add：要加的标记；remove：要删的标记 id 或名字；clear=true 先把全部标记清掉。',
    inputSchema: {
      projectId: projectIdArg,
      add: z.array(z.object({ bar: z.number().min(1).describe('小节号，从 1 开始（可以带小数）'), name: z.string().min(1).max(64) })).max(64).optional(),
      remove: z.array(z.string()).optional().describe('标记的 id 或名字'),
      clear: z.boolean().optional()
    },
    annotations: A.edit
  }, async ({ projectId, add = [], remove = [], clear = false }) => {
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    const existing = p.markers || [];
    const ops = [];
    let gone = [];
    if (clear) gone = existing;
    else if (remove.length) {
      gone = remove.map((ref) => {
        const m = existing.find((x) => x.id === ref) || existing.find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
        if (!m) throw new Error(`找不到标记「${ref}」。现有标记：${existing.map((x) => `${x.name} [${x.id}]`).join('、') || '无'}`);
        return m;
      });
    }
    if (gone.length) ops.push({ type: 'marker/remove', ids: gone.map((m) => m.id) });
    const kept = existing.filter((m) => !gone.includes(m));
    // adding a marker that already exists (same name at the same position) is a no-op
    const added = add.map((m) => ({ id: uid('mk'), tick: Math.round((m.bar - 1) * bar), name: m.name }))
      .filter((m, i, all) => !kept.some((k) => k.tick === m.tick && k.name.toLowerCase() === m.name.toLowerCase())
        && all.findIndex((x) => x.tick === m.tick && x.name.toLowerCase() === m.name.toLowerCase()) === i);
    if (added.length) ops.push({ type: 'marker/add', markers: added });
    if (!ops.length && !add.length) throw new Error('Nothing to do: pass add, remove or clear');
    if (!ops.length) return ok(`Markers unchanged: ${existing.map((m) => `${m.name} @ bar ${barsOf(p, m.tick) + 1} [${m.id}]`).join(' · ')}.`);
    const after = await backend.applyOps(p.id, ops);
    return ok(`标记：${(after.markers || []).map((m) => `${m.name} @ 第 ${barsOf(after, m.tick) + 1} 小节 [${m.id}]`).join(' · ') || '无'}。`);
  });

  tool('remove_clips', {
    title: '删除播放列表片段块',
    description: '从播放列表里删片段块。几个条件是「与」的关系：clipIds、pattern、track，以及小节范围（只算起点落在 fromBar..toBar 内的片段块，两端都算）。all=true 会全部删掉，不能再配其它条件。',
    inputSchema: {
      projectId: projectIdArg,
      clipIds: z.array(z.string()).optional(),
      pattern: z.string().optional(),
      track: z.number().int().min(1).max(MAX_TRACKS).optional(),
      fromBar: z.number().int().min(1).optional().describe('范围起始小节（含）'),
      toBar: z.number().int().min(1).optional().describe('范围结束小节（含）'),
      all: z.boolean().optional()
    },
    annotations: A.destructive
  }, async ({ projectId, clipIds, pattern, track, fromBar, toBar, all }) => {
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    let list = p.playlist.clips;
    const filtered = clipIds || pattern || track || fromBar !== undefined || toBar !== undefined;
    if (fromBar !== undefined && toBar !== undefined && toBar < fromBar) throw new Error('toBar must not be before fromBar');
    if (all && filtered) throw new Error('all=true removes every clip — leave out the other filters, or drop all to remove only the matching clips');
    if (!all) {
      if (!filtered) throw new Error('Say which clips: clipIds, pattern, track, a bar range, or all=true');
      if (clipIds) { const s = new Set(clipIds); list = list.filter((c) => s.has(c.id)); }
      if (pattern) { const pt = findPattern(p, pattern); list = list.filter((c) => c.kind === 'pattern' && c.refId === pt.id); }
      if (track) list = list.filter((c) => c.track === track - 1);
      if (fromBar !== undefined) list = list.filter((c) => c.start >= (fromBar - 1) * bar);
      if (toBar !== undefined) list = list.filter((c) => c.start < toBar * bar);
    }
    if (!list.length) return ok('No clips matched.');
    await backend.applyOps(p.id, [{ type: 'clip/remove', ids: list.map((c) => c.id) }]);
    return ok(`Removed ${list.length} clip(s).`);
  });

  tool('copy_bars', {
    title: '复制一段编曲',
    description: '把编曲里 fromBar..toBar（两端都算）这一整段在响的东西复制到别的位置，例如把副歌（第 9–16 小节）复制到第 33 小节。片段块会按范围裁切，所以长片段块只复制落在范围内的那部分。轨道保持不变。',
    inputSchema: {
      projectId: projectIdArg,
      fromBar: z.number().int().min(1).describe('要复制的起始小节'),
      toBar: z.number().int().min(1).describe('要复制的结束小节（含）'),
      toPosition: z.number().int().min(1).describe('复制件从第几小节开始放'),
      times: z.number().int().min(1).max(32).optional().describe('前后相接放几份（默认 1）')
    },
    annotations: A.edit
  }, async ({ projectId, fromBar, toBar, toPosition, times = 1 }) => {
    if (toBar < fromBar) throw new Error('toBar must not be before fromBar');
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    const lo = (fromBar - 1) * bar;
    const hi = toBar * bar;
    const src = p.playlist.clips.filter((c) => c.start < hi && c.start + c.length > lo);
    if (!src.length) throw new Error(`Nothing plays in bars ${fromBar}–${toBar}`);
    const span = hi - lo;
    const target = (toPosition - 1) * bar;
    if (target < hi && target + span * times > lo) throw new Error('The copy would overlap the bars being copied — choose a position after them');
    const clips = [];
    for (let k = 0; k < times; k++) {
      const delta = target - lo + k * span;
      for (const c of src) {
        const s = Math.max(c.start, lo);
        const e = Math.min(c.start + c.length, hi);
        clips.push({ ...c, id: uid('clip'), start: s + delta, length: e - s, offset: c.offset + (s - c.start) });
      }
    }
    await backend.applyOps(p.id, [{ type: 'clip/add', clips }]);
    return ok(`Copied bars ${fromBar}–${toBar} (${src.length} clip(s)) to bar ${toPosition}${times > 1 ? ` ×${times}` : ''}. New clip ids: ${clips.map((c) => c.id).join(', ')}`);
  });

  tool('update_track', {
    title: '修改播放列表轨道',
    description: '给播放列表轨道改名、改颜色或静音（轨道号从 1 开始）。',
    inputSchema: {
      projectId: projectIdArg,
      track: z.number().int().min(1).max(MAX_TRACKS),
      name: z.string().min(1).max(64).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      mute: z.boolean().optional()
    },
    annotations: A.edit
  }, async ({ projectId, track, name, color, mute }) => {
    if (name === undefined && color === undefined && mute === undefined) throw new Error('Nothing to update: pass name, color and/or mute.');
    const p = await load(projectId);
    const ops = [];
    if (track > p.playlist.tracks.length) ops.push({ type: 'track/add', count: track - p.playlist.tracks.length });
    const patch = {};
    if (name) patch.name = name;
    if (color) patch.color = color;
    if (mute !== undefined) patch.mute = mute;
    ops.push({ type: 'track/update', index: track - 1, patch });
    await backend.applyOps(p.id, ops);
    return ok(`Track ${track} updated.`);
  });

  // ---------------------------------------------------------------- automation
  tool('add_automation', {
    title: '添加自动化曲线',
    description: '用播放列表里的自动化曲线让某个参数随时间变化（歌曲模式）。可针对：通道（volume｜pan｜pitch｜filterCutoff｜filterRes）、混音台通道条（volume｜pan）、效果器（能自动化的参数，例如滤波截止、混响干湿、延迟反馈量）、主输出（volume｜pan）。关键帧的取值是 0..1，对应参数整个范围（filterCutoff 按对数分布：0＝20 Hz，0.5≈630 Hz，1＝20 kHz；pan 0.5＝居中；pitch 0.5＝不移调；volume：0.8＝单位增益 0 dB，0.64＝通道条默认推子，0.62≈通道默认音量，1＝+1.9 dB）。',
    inputSchema: {
      projectId: projectIdArg,
      name: z.string().max(64).optional(),
      target: z.object({
        type: z.enum(['channel', 'mixer', 'effect', 'master']),
        channel: z.string().optional().describe('type=channel 时用：通道 id 或名字'),
        insert: z.number().int().min(0).optional().describe('type=mixer／effect 时用：通道条号'),
        effectId: z.string().optional().describe('type=effect 时用：效果器 id（或类型名）'),
        param: z.string()
      }),
      points: z.array(z.object({ bar: z.number().min(0).describe('从自动化曲线开头算起的位置（0 起算，可带小数）'), value: z.number().min(0).max(1) })).min(1).max(512),
      startBar: z.number().min(1).describe('自动化曲线起始小节（从 1 开始）'),
      bars: z.number().positive().optional().describe('曲线长度，单位小节（默认到最后一个关键帧为止）'),
      track: z.number().int().min(1).max(MAX_TRACKS).optional()
    },
    annotations: A.edit
  }, async ({ projectId, name, target, points, startBar, bars, track }) => {
    const p = await load(projectId);
    const bar = ticksPerBar(p);
    let t;
    if (target.type === 'channel') t = { type: 'channel', id: findChannel(p, target.channel).id, param: target.param };
    else if (target.type === 'mixer') t = { type: 'mixer', index: target.insert, param: target.param };
    else if (target.type === 'effect') {
      const fx = findEffect(p, target.insert, target.effectId);
      if (fx.type === 'plugin') {
        // only a plugin's automatable number params are AudioParams the engine can move
        const m = await requirePlugin(backend, fx.plugin, 'effect');
        const auto = m.params.filter((d) => d.type === 'number' && d.automatable).map((d) => d.key);
        if (!auto.includes(target.param)) throw new Error(`"${target.param}" of ${m.name} can't be automated. Automatable: ${auto.join(', ') || 'none'}`);
      }
      t = { type: 'effect', index: target.insert, effectId: fx.id, param: target.param };
    }
    else t = { type: 'master', param: target.param };
    const pts = points.map((pt) => ({ t: Math.round(pt.bar * bar), v: pt.value })).sort((a, b) => a.t - b.t);
    const length = Math.max(STEP, bars ? Math.round(bars * bar) : pts[pts.length - 1].t || bar);
    if (pts[pts.length - 1].t > length) throw new Error(`A point at bar ${pts[pts.length - 1].t / bar} lies beyond the clip length (${bars} bars) — lengthen bars or move the point`);
    const id = uid('auto');
    const clipId = uid('clip');
    const autoName = name || `${target.type} ${target.param}`;
    const trk = track ? track - 1 : pickTrack(p, id);
    const ops = [];
    if (trk >= p.playlist.tracks.length) ops.push({ type: 'track/add', count: trk - p.playlist.tracks.length + 1 });
    ops.push(
      { type: 'automation/add', automation: { id, name: autoName, target: t, length, points: pts } },
      { type: 'clip/add', clips: [{ id: clipId, kind: 'automation', refId: id, track: trk, start: Math.round((startBar - 1) * bar), length }] }
    );
    await backend.applyOps(p.id, ops);
    return ok(`Added automation "${autoName}" [${id}] as clip [${clipId}] on track ${trk + 1} from bar ${startBar} (${barsOf(p, length)} bars).`);
  });

  tool('update_automation', {
    title: '修改自动化',
    description: '改一条自动化曲线（新的关键帧会替换旧的）、它的长度或名字。改 bars 时，播放列表里那些「整条自动化」长度的块也会跟着改长度。',
    inputSchema: {
      projectId: projectIdArg,
      automation: z.string().describe('自动化 id 或名字'),
      name: z.string().max(64).optional(),
      points: z.array(z.object({ bar: z.number().min(0), value: z.number().min(0).max(1) })).min(1).max(512).optional(),
      bars: z.number().positive().optional()
    },
    annotations: A.edit
  }, async ({ projectId, automation, name, points, bars }) => {
    const p = await load(projectId);
    const a = findAutomation(p, automation);
    const bar = ticksPerBar(p);
    const patch = {};
    if (name) patch.name = name;
    if (bars) patch.length = Math.round(bars * bar);
    if (points) patch.points = points.map((pt) => ({ t: Math.round(pt.bar * bar), v: pt.value }));
    if (!Object.keys(patch).length) throw new Error('Nothing to change');
    const newLen = patch.length ?? a.length;
    const last = patch.points ? Math.max(...patch.points.map((x) => x.t)) : Math.max(...a.points.map((x) => x.t));
    if (last > newLen) throw new Error(`A point at bar ${last / bar} lies beyond the automation length (${newLen / bar} bars)`);
    const ops = [{ type: 'automation/update', id: a.id, patch }];
    if (patch.length) {
      const resize = p.playlist.clips.filter((c) => c.kind === 'automation' && c.refId === a.id && c.length === a.length);
      if (resize.length) ops.push({ type: 'clip/update', clips: resize.map((c) => ({ id: c.id, length: patch.length })) });
    }
    await backend.applyOps(p.id, ops);
    return ok(`Updated automation "${name || a.name}".`);
  });

  tool('remove_automation', {
    title: '删除自动化',
    description: '删掉一条自动化以及它在播放列表里的块。',
    inputSchema: { projectId: projectIdArg, automation: z.string() },
    annotations: A.destructive
  }, async ({ projectId, automation }) => {
    const p = await load(projectId);
    const a = findAutomation(p, automation);
    await backend.applyOps(p.id, [{ type: 'automation/remove', id: a.id }]);
    return ok(`Removed automation "${a.name}".`);
  });

  // ---------------------------------------------------------------- transport / export
  tool('play', {
    title: '播放',
    description: '在用户的浏览器里开始播放。mode 用 "pattern" 循环某一个片段；用 "song" 播放播放列表的编曲。',
    inputSchema: {
      projectId: projectIdArg,
      mode: z.enum(['pattern', 'song']).optional().describe('默认：播放列表里有片段就整首，否则单片段'),
      pattern: z.string().optional().describe('单片段模式下要循环的片段（默认第一个）'),
      fromBar: z.number().min(1).optional()
    },
    annotations: A.edit
  }, async ({ projectId, mode, pattern, fromBar = 1 }) => {
    const p = await load(projectId);
    const m = mode || (p.playlist.clips.length ? 'song' : 'pattern');
    const pt = pattern ? findPattern(p, pattern) : p.patterns[0];
    const n = await backend.transport(p.id, { action: 'play', mode: m, patternId: pt?.id, position: Math.round((fromBar - 1) * ticksPerBar(p)) });
    if (!n) return ok('No browser has this project open, so nothing is playing. Ask the user to open GreanTeaDawy in their browser (and click once to enable audio).');
    return ok(`Playing ${m === 'song' ? `song (${Math.round(songLength(p) / ticksPerBar(p))} bars)` : `pattern "${pt.name}" (looping)`} in ${n} browser tab(s). Note: browsers need one user click before audio can start.`);
  });

  tool('stop', {
    title: '停止',
    description: '在浏览器里停止播放。',
    inputSchema: { projectId: projectIdArg },
    annotations: A.edit
  }, async ({ projectId }) => {
    const id = await resolveProjectId(projectId);
    await backend.transport(id, { action: 'stop' });
    return ok('Stopped.');
  });

  tool('export_midi', {
    title: '导出 MIDI',
    description: '把整首（或某一个片段）导出成 .mid 文件，存进用户的导出目录，返回下载链接。要出音频请用 render_mix 并设 save=true。',
    inputSchema: { projectId: projectIdArg, mode: z.enum(['song', 'pattern']).optional(), pattern: z.string().optional() },
    annotations: { ...A.edit, idempotentHint: true }
  }, async ({ projectId, mode = 'song', pattern }) => {
    const p = await load(projectId);
    const patternId = pattern ? findPattern(p, pattern).id : undefined;
    const res = await backend.exportMidi(p.id, { mode, patternId });
    return ok(`Exported MIDI "${res.name}" (${res.bytes} bytes).${res.url ? `\nDownload: ${res.url}` : ''}`);
  });

}
