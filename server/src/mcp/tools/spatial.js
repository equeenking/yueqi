// Spatial (Atmos-style) mixing for Claude: turn the 3D mix on, place mixer inserts as objects in the room, move them
// over time (automation) and export binaural / 5.1 / 7.1 / 7.1.4 / object stems / ADM BWF.
import { uid, ticksPerBar, STEP, findPattern, MAX_TRACKS, POSITION_PRESETS, polarToPosition, normalizeInsertSpatial, isSpatialObject, spatialToNorm, SPATIAL_EXPORTS, SPATIAL_EXPORT_IDS, MAX_SPATIAL_OBJECTS, zhLegacyName } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A, pickTrack, barsOf } from '../util.js';
import { progressNotifier } from './mix.js';

const PRESET_NAMES = Object.keys(POSITION_PRESETS);
const r2 = (x) => Math.round(x * 100) / 100;
const fmtPos = (s) => `x ${r2(s.x)}, y ${r2(s.y)}, z ${r2(s.z)}${s.lfe ? `, lfe ${r2(s.lfe)}` : ''}`;

/** Mixer insert from an index, an insert name or a channel name (its insert). */
export function resolveInsert(p, ref) {
  const s = String(ref ?? '').trim();
  if (/^\d+$/.test(s)) {
    const i = Number(s);
    if (i < 1 || i >= p.mixer.length) throw new Error(`没有第 ${i} 个混音通道条（范围 1..${p.mixer.length - 1}；主输出不能做三维对象）`);
    return i;
  }
  const alias = zhLegacyName(s).toLowerCase(); // 旧版英文名也认
  const byInsert = p.mixer.findIndex((m, i) => i > 0 && [s.toLowerCase(), alias].includes(m.name.toLowerCase()));
  if (byInsert > 0) return byInsert;
  const ch = p.channels.find((c) => [s.toLowerCase(), alias].includes(c.name.toLowerCase()));
  if (ch) {
    if (ch.mixerTrack === 0) throw new Error(`通道「${ch.name}」直接进主输出；要先给它一个独立的混音通道条（update_channel 的 mixerTrack），才能做成三维对象`);
    return ch.mixerTrack;
  }
  throw new Error(`找不到名为「${ref}」的混音通道条或通道。现有通道条：${p.mixer.slice(1).map((m, i) => `${i + 1} ${m.name}`).join('、')}`);
}

/** A position from a preset name, polar (azimuth/elevation/distance) or x/y/z (any given axis overrides). */
function positionFrom(args, current) {
  let pos = { x: current.x, y: current.y, z: current.z };
  if (args.position) {
    const [x, y, zz] = POSITION_PRESETS[args.position];
    pos = { x, y, z: zz };
  }
  if (args.azimuth !== undefined || args.elevation !== undefined || args.distance !== undefined) {
    pos = polarToPosition({ azimuth: args.azimuth ?? 0, elevation: args.elevation ?? 0, distance: args.distance ?? 1 });
  }
  for (const k of ['x', 'y', 'z']) if (args[k] !== undefined) pos[k] = args[k];
  return pos;
}

function objectList(p) {
  const lines = [];
  p.mixer.forEach((m, i) => {
    if (i === 0 || !m.spatial?.enabled) return;
    const why = isSpatialObject(p, i) ? '' : m.output ? ` — 未生效：已路由到通道条 ${m.output}，只有直接进主输出的通道条才能做三维对象` : ' — 未生效：空间混音没开';
    lines.push(`- ${i} ${m.name}: ${fmtPos(m.spatial)}${why}`);
  });
  return lines.length ? lines.join('\n') : '（还没有三维对象——用 place_object 放一个）';
}

const posSchema = {
  position: z.enum(PRESET_NAMES).optional().describe(`预设位置：${PRESET_NAMES.join('、')}`),
  x: z.number().min(-1).max(1).optional().describe('-1 左墙 … 0 正中 … 1 右墙'),
  y: z.number().min(-1).max(1).optional().describe('-1 后墙 … 0 听者位置 … 1 前墙（屏幕那侧）'),
  z: z.number().min(0).max(1).optional().describe('0 耳朵高度 … 1 天花板'),
  azimuth: z.number().min(-180).max(180).optional().describe('极坐标写法：从正前方顺时针的度数（90＝正右，-90＝正左，180＝正后）'),
  elevation: z.number().min(0).max(90).optional().describe('极坐标：0 耳朵高度 … 90 正上方'),
  distance: z.number().min(0).max(1).optional().describe('极坐标：0 在听者身上 … 1 在墙上（默认 1）')
};

const PATHS = ['circle', 'left-right', 'right-left', 'front-back', 'back-front', 'rise', 'fall', 'fly-over', 'points'];

export function registerSpatialTools({ tool, backend, load }) {
  tool('set_spatial', {
    title: '空间混音开关与监听方式',
    description: '打开或关闭空间混音（杜比全景声那样的三维声场），并选择工作室怎么监听："binaural" 用头部相关传输函数把每个三维对象渲染成耳机声，"stereo" 则按对象的左右位置折进普通立体声。混音台通道条可以用 place_object 变成三维对象；其它声音留在立体声床里。会列出当前的对象。',
    inputSchema: {
      projectId: projectIdArg,
      enabled: z.boolean().optional(),
      monitor: z.enum(['stereo', 'binaural']).optional().describe('用户在工作室里听到的方式（导出时各自挑自己的格式）')
    },
    annotations: A.edit
  }, async ({ projectId, enabled, monitor }) => {
    const p = await load(projectId);
    const spatial = { ...p.spatial, ...(enabled !== undefined ? { enabled } : {}), ...(monitor ? { monitor } : {}) };
    const next = await backend.applyOps(p.id, [{ type: 'project/update', patch: { spatial } }]);
    const sp = next.spatial;
    return ok(`空间混音已${sp.enabled ? '开启' : '关闭'}，监听方式：${sp.monitor === 'binaural' ? '双耳（耳机）' : '立体声'}。\n三维对象：\n${objectList(next)}`);
  });

  tool('place_object', {
    title: '放置三维对象',
    description: '把一条混音台通道条（按通道条号／名字，或按通道名——取它所在的通道条）变成三维对象，并放到房间里的某个位置：可以是预设位置（"front-left"、"rear-right"、"overhead"…）、x/y/z（Atmos 的直角坐标：x -1 左…1 右，y -1 后…1 前，z 0 耳朵高度…1 天花板），也可以用方位角／仰角／距离。lfe 会把一部分送到音箱渲染里的低音炮声道。调用它会打开空间混音。该通道条必须直接进主输出（不能先进总线）。enabled=false 会让它回到立体声床。常见摆法：主唱／主音合成器放正前方，铺底放宽或放头顶，打击乐与音效绕在四周或身后，贝斯和底鼓留在床声里。',
    inputSchema: {
      projectId: projectIdArg,
      insert: z.union([z.string(), z.number().int()]).describe('混音台通道条号或名字，也可以是通道名'),
      enabled: z.boolean().optional().describe('默认 true'),
      ...posSchema,
      lfe: z.number().min(0).max(1).optional().describe('音箱渲染时送到低音炮（LFE）的量，0..1（默认 0）')
    },
    annotations: A.edit
  }, async (args) => {
    const p = await load(args.projectId);
    const i = resolveInsert(p, args.insert);
    const m = p.mixer[i];
    const enabled = args.enabled !== false;
    if (enabled && m.output) throw new Error(`通道条 ${i}「${m.name}」已经路由到通道条 ${m.output}「${p.mixer[m.output].name}」。只有直接进主输出的通道条才能做三维对象——把它改回主输出（set_mixer output 0），或者直接放那个总线通道条。`);
    const current = normalizeInsertSpatial(m.spatial, m.pan);
    const pos = positionFrom(args, current);
    const spatial = { ...current, ...pos, enabled, ...(args.lfe !== undefined ? { lfe: args.lfe } : {}) };
    const ops = [{ type: 'mixer/update', index: i, patch: { spatial } }];
    const turnOn = enabled && !p.spatial?.enabled;
    if (turnOn) ops.unshift({ type: 'project/update', patch: { spatial: { ...p.spatial, enabled: true } } });
    const next = await backend.applyOps(p.id, ops);
    const s = next.mixer[i].spatial;
    return ok(`${enabled ? `已放置通道条 ${i}「${m.name}」于 ${fmtPos(s)}` : `通道条 ${i}「${m.name}」已回到立体声总线`}。${turnOn ? ' 空间混音已开启（当前按立体声监听——戴耳机可设 set_spatial monitor=binaural）。' : ''}\n三维对象：\n${objectList(next)}`);
  });

  tool('move_object', {
    title: '让三维对象动起来',
    description: `用播放列表里的位置自动化曲线（该通道条的 spatialX／spatialY／spatialZ）让三维对象动起来："circle"（绕着听者转圈；可设圈数、半径、方向）、"left-right"／"right-left"（在前方左右移动）、"front-back"／"back-front"（穿过房间）、"rise"／"fall"（升降高度）、"fly-over"（从前方越过头顶到后方），或 "points"（你自己给关键帧）。只在歌曲模式下生效。对象静止时的位置会成为路径起点；曲线结束后它会停在路径终点。可用路径：${PATHS.join('、')}。`,
    inputSchema: {
      projectId: projectIdArg,
      insert: z.union([z.string(), z.number().int()]).describe('混音台通道条号或名字，也可以是通道名'),
      path: z.enum(PATHS),
      startBar: z.number().min(1).describe('移动开始的小节（从 1 数起）'),
      bars: z.number().min(0.25).max(256).describe('持续多少小节'),
      turns: z.number().min(0.25).max(64).optional().describe('circle：绕几圈（默认 1）'),
      radius: z.number().min(0.1).max(1).optional().describe('circle：离听者多远（默认 1＝贴墙）'),
      height: z.number().min(0).max(1).optional().describe('circle／left-right／front-back：移动过程中的 z（默认用它现在的高度）'),
      clockwise: z.boolean().optional().describe('circle：从上往下看的方向（默认顺时针）'),
      points: z.array(z.object({
        bar: z.number().min(0).describe('从移动起点算起的小节数（从 0 起算）'),
        position: z.enum(PRESET_NAMES).optional(),
        x: z.number().min(-1).max(1).optional(),
        y: z.number().min(-1).max(1).optional(),
        z: z.number().min(0).max(1).optional()
      })).min(2).max(256).optional().describe('path=points：关键帧（中间的位置线性滑过去）')
    },
    annotations: A.edit
  }, async ({ projectId, insert, path, startBar, bars, turns = 1, radius = 1, height, clockwise = true, points }) => {
    const p = await load(projectId);
    const i = resolveInsert(p, insert);
    const m = p.mixer[i];
    if (m.output) throw new Error(`通道条 ${i}「${m.name}」已经路由到总线（通道条 ${m.output}）；只有直接进主输出的通道条才能做三维对象`);
    const bar = ticksPerBar(p);
    const length = Math.max(STEP, Math.round(bars * bar));
    const cur = normalizeInsertSpatial(m.spatial, m.pan);
    const zz = height ?? cur.z;
    // keyframes as [fraction 0..1, {x,y,z}]
    let keys;
    if (path === 'circle') {
      const steps = Math.max(8, Math.round(16 * turns));
      const a0 = Math.atan2(cur.x, cur.y); // start where the object is (azimuth, clockwise from the front)
      keys = Array.from({ length: steps + 1 }, (_, k) => {
        const a = a0 + (clockwise ? 1 : -1) * 2 * Math.PI * turns * (k / steps);
        return [k / steps, { x: Math.sin(a) * radius, y: Math.cos(a) * radius, z: zz }];
      });
    } else if (path === 'points') {
      if (!points) throw new Error('path=points 需要 points：[{ bar, x, y, z } 或 { bar, position }]');
      let last = cur;
      keys = [...points].sort((a, b) => a.bar - b.bar).map((pt) => {
        if (pt.bar > bars) throw new Error(`第 ${pt.bar} 小节的关键帧超出了移动范围（整段 ${bars} 小节）`);
        const base = pt.position ? Object.fromEntries(['x', 'y', 'z'].map((k, j) => [k, POSITION_PRESETS[pt.position][j]])) : last;
        last = { x: pt.x ?? base.x, y: pt.y ?? base.y, z: pt.z ?? base.z };
        return [pt.bar / bars, last];
      });
    } else {
      const lines = {
        'left-right': [{ x: -1, y: cur.y, z: zz }, { x: 1, y: cur.y, z: zz }],
        'right-left': [{ x: 1, y: cur.y, z: zz }, { x: -1, y: cur.y, z: zz }],
        'front-back': [{ x: cur.x, y: 1, z: zz }, { x: cur.x, y: -1, z: zz }],
        'back-front': [{ x: cur.x, y: -1, z: zz }, { x: cur.x, y: 1, z: zz }],
        rise: [{ ...cur, z: 0 }, { ...cur, z: 1 }],
        fall: [{ ...cur, z: 1 }, { ...cur, z: 0 }]
      };
      if (path === 'fly-over') {
        keys = Array.from({ length: 9 }, (_, k) => [k / 8, { x: cur.x, y: 1 - (2 * k) / 8, z: Math.sin((Math.PI * k) / 8) }]);
      } else {
        keys = [[0, lines[path][0]], [1, lines[path][1]]];
      }
    }
    const axes = [['spatialX', 'x'], ['spatialY', 'y'], ['spatialZ', 'z']].filter(([, a]) => new Set(keys.map(([, pos]) => Math.round(pos[a] * 1000))).size > 1);
    if (!axes.length) throw new Error('这条路径其实没让对象动起来（每个关键帧的位置都一样）');
    const start = keys[0][1];
    const ops = [];
    if (!p.spatial?.enabled) ops.push({ type: 'project/update', patch: { spatial: { ...p.spatial, enabled: true } } });
    ops.push({ type: 'mixer/update', index: i, patch: { spatial: { ...cur, ...start, enabled: true } } });
    const used = new Set(p.playlist.clips.map((c) => c.track));
    const created = [];
    for (const [param, axis] of axes) {
      const id = uid('auto');
      let trk = pickTrack(p, id);
      while (used.has(trk) && trk < MAX_TRACKS - 1) trk++;
      used.add(trk);
      if (trk >= p.playlist.tracks.length) ops.push({ type: 'track/add', count: trk - p.playlist.tracks.length + 1 });
      const pts = keys.map(([f, pos]) => ({ t: Math.round(f * length), v: Math.round(spatialToNorm(param, pos[axis]) * 10000) / 10000 }));
      const name = `${m.name} 3D ${axis.toUpperCase()}`;
      ops.push(
        { type: 'automation/add', automation: { id, name, target: { type: 'mixer', index: i, param }, length, points: pts } },
        { type: 'clip/add', clips: [{ id: uid('clip'), kind: 'automation', refId: id, track: trk, start: Math.round((startBar - 1) * bar), length }] }
      );
      created.push(`${name} [${id}] 在轨道 ${trk + 1}`);
    }
    await backend.applyOps(p.id, ops);
    const end = keys[keys.length - 1][1];
    return ok(`通道条 ${i}「${m.name}」按${path === 'circle' ? '圆形' : path === 'line' ? '直线' : '关键帧'}路径移动：第 ${startBar} 小节起 ${barsOf(p, length)} 小节，从 ${fmtPos(start)} 到 ${fmtPos(end)}。自动化：${created.join('；')}。它只在歌曲模式发声（记得把片段放进播放列表）。`);
  });

  tool('export_spatial', {
    title: '导出空间混音',
    description: `在用户的浏览器里把三维混音渲染成 48 kHz／24 位，存进用户的导出目录：${SPATIAL_EXPORT_IDS.map((k) => `"${k}" = ${SPATIAL_EXPORTS[k].description}`).join('；')}。即使工作室用立体声监听，对象仍按三维渲染。至少需要一个三维对象（先用 place_object）；对象分轨／ADM 最多支持 ${MAX_SPATIAL_OBJECTS} 个对象。主输出上的效果会作用在床声（以及双耳混音）上，但不作用于音箱／对象渲染里的对象——这和 Atmos 渲染器一致，报告里记得看峰值。需要在浏览器里打开本工作室。`,
    inputSchema: {
      projectId: projectIdArg,
      format: z.enum(SPATIAL_EXPORT_IDS),
      mode: z.enum(['song', 'pattern']).optional().describe('默认：播放列表里有片段就整首，否则单片段'),
      pattern: z.string().optional(),
      loops: z.number().int().min(1).max(16).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ projectId, format, mode, pattern, loops = 2 }, extra) => {
    const p = await load(projectId);
    const objects = p.mixer.map((m, i) => i).filter((i) => i > 0 && p.mixer[i].spatial?.enabled && !p.mixer[i].output);
    if (!objects.length) throw new Error('还没有三维对象：先用 place_object 放一个（例如主音放正前方，铺底放头顶）');
    const m = mode || (p.playlist.clips.length ? 'song' : 'pattern');
    const patternId = pattern ? findPattern(p, pattern).id : p.patterns[0]?.id;
    const r = await backend.requestJob(
      { kind: 'spatial', projectId: p.id, format, mode: m, patternId, loops, name: p.name },
      { projectId: p.id, timeoutMs: 900000, onProgress: progressNotifier(extra, `正在浏览器里渲染 ${SPATIAL_EXPORTS[format].label}`) }
    );
    const files = [...(r.files || []), ...(r.positionsFile ? [r.positionsFile] : [])];
    const lines = [`已导出 ${SPATIAL_EXPORTS[format].label}（${r.seconds} 秒，${r.sampleRate / 1000} kHz／${r.bitDepth} 位）到用户的导出目录（工程 → 导出）：`];
    for (const f of files) lines.push(`- ${f.name} (${Math.round(f.bytes / 1024)} KB): ${f.url}`);
    if (r.lufs !== undefined) lines.push(`双耳响度 ${r.lufs} LUFS${r.truePeakDb !== null && r.truePeakDb !== undefined ? `，真峰值 ${r.truePeakDb} dBTP` : ''}。`);
    if (r.channels?.length) {
      const hot = r.channels.filter((c) => c.peakDb > -0.3);
      lines.push(`各声道峰值：${r.channels.map((c) => `${c.id} ${c.peakDb} dBFS`).join('、')}。${hot.length ? `${hot.map((c) => c.id).join('、')} 已经顶到 0 dBFS——把那几个对象的推子拉低一点（对象不经过主输出限幅器）。` : ''}`);
    }
    lines.push(`三维对象：${(r.objects || []).map((o) => `${o.name}${o.moves ? '（移动中）' : ''}`).join('、')}。`);
    if (format === 'adm') lines.push('ADM BWF 还是实验性的（ITU-R BS.2076 元数据，没有杜比认证）：导入 Atmos 工具后可能要检查一下对象与床声道的分配。');
    return ok(lines.join('\n'), { files, objects: r.objects, channels: r.channels || null });
  });
}
