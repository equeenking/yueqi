// The user's sample library: metadata (bitrate, sample rate...), analysis and placement.
import { PPQ, STEP, ticksPerBar, uid, MAX_TRACKS, EDIT_OPS, SCALES, parsePitchClass } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A, pickTrack } from '../util.js';
import { describeUsage, cleanName, nameKey } from '../../samples.js';

function line(s) {
  const m = s.metadata || {};
  const a = s.analysis;
  const bits = [
    s.duration ? `${s.duration}s` : null,
    m.sampleRate ? `${m.sampleRate / 1000} kHz` : null,
    m.bitsPerSample ? `${m.bitsPerSample}-bit` : null,
    m.bitrateKbps ? `${m.bitrateKbps} kbps` : null,
    m.channels ? (m.channels === 1 ? 'mono' : 'stereo') : null,
    m.codec || m.container || null
  ].filter(Boolean).join(', ');
  const ana = a
    ? [a.character, a.pitch && a.kind === 'one-shot' ? `pitch ${a.pitch.note}` : null, a.tempo && a.tempo.confidence >= 0.35 ? `${a.tempo.bpm} BPM` : null, a.key && a.key.confidence > 0.5 ? `${a.key.key} ${a.key.scale}` : null, Number.isFinite(a.lufs) ? `${a.lufs} LUFS` : null].filter(Boolean).join(', ')
    : 'not analysed yet';
  return `${s.name} [${s.id}] — ${bits} — ${ana}`;
}

/** Everything a search can match: name, folder, tags and the analysis words (character, pitch, key, tempo). */
function haystack(s, folder) {
  const a = s.analysis || {};
  const tags = Object.values(s.metadata?.tags || {}).join(' ');
  return [s.name, folder, tags, a.character, a.kind, a.pitch?.note, a.key ? `${a.key.key} ${a.key.scale}` : '', a.tempo ? `${a.tempo.bpm} bpm` : ''].join(' ').toLowerCase();
}

const UNFILED = /^(unfiled|none|no folder|-)$/i;
// what a folder id looks like: a reference like this that matches no folder is a stale id, never a new folder's name
const FOLDER_ID = /^fld_[0-9a-z]{10}$/;

/**
 * Resolve a folder reference (id or name) to a folder, null for "unfiled"; throws with the folder list otherwise. A
 * real folder wins over the "unfiled" aliases (a user may well have a folder called "None").
 */
function resolveFolder(folders, ref) {
  if (ref === null || ref === undefined) return null;
  // compared the way names are stored (NFC, single spaces, no invisible characters) and told apart (case, joiners)
  const r = nameKey(cleanName(String(ref), Infinity));
  const f = folders.find((x) => x.id === ref) || (r ? folders.find((x) => nameKey(x.name) === r) : undefined);
  if (f) return f;
  if (UNFILED.test(r)) return null;
  throw new Error(`No folder "${ref}". Folders: ${folders.length ? folders.map((x) => `${x.name} [${x.id}]`).join(', ') : 'none yet'} (or "unfiled").`);
}

export function registerSampleTools({ tool, backend, load }) {
  tool('list_samples', {
    title: '列出采样',
    description: '列出用户上传的音频采样，按文件夹归好，并给出关键数据：时长、采样率、位深、码率、声道数、编码，以及分析结果（听感、音高、速度、调、响度）。可以按关键词搜索和／或只看某一个文件夹。要看完整细节用 get_sample_info。',
    inputSchema: {
      query: z.string().max(200).optional().describe('搜索词，全部都要命中名字、文件夹、标签或分析结果（例如「底鼓」「人声 140 bpm」「暗色铺底 A 小调」）'),
      folder: z.string().max(400).optional().describe('只看这个文件夹（名字或 id）；写 "unfiled" 表示还没归档的采样')
    },
    annotations: A.readOnly
  }, async ({ query, folder }) => {
    const [all, folders] = await Promise.all([backend.listSamples(), backend.listSampleFolders()]);
    if (!all.length) return ok('No samples uploaded yet. The user can upload or record audio in the Browser panel (Samples tab).');
    const byId = new Map(folders.map((f) => [f.id, f]));
    const nameOf = (s) => byId.get(s.folderId)?.name || '';
    let list = all;
    let where = '';
    if (folder !== undefined) {
      const f = resolveFolder(folders, folder);
      where = f ? `"${f.name}"` : 'Unfiled';
      list = list.filter((s) => (f ? s.folderId === f.id : !byId.has(s.folderId)));
    }
    const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) list = list.filter((s) => { const h = haystack(s, nameOf(s)); return words.every((w) => h.includes(w)); });
    const unfiled = all.filter((s) => !byId.has(s.folderId)).length;
    const summary = `Folders: ${[...folders.map((f) => `${f.name} (${f.count})`), `Unfiled (${unfiled})`].join(', ')}`;
    if (!list.length) return ok(`No samples match${query ? ` "${query}"` : ''}${where ? ` in ${where}` : ''}.\n${summary}`);
    const groups = [...folders.map((f) => [`${f.name} [${f.id}]`, list.filter((s) => s.folderId === f.id)]), ['Unfiled', list.filter((s) => !byId.has(s.folderId))]]
      .filter(([, items]) => items.length);
    const body = groups.map(([title, items]) => `## ${title}\n${items.map(line).join('\n')}`).join('\n\n');
    return ok(`${summary}\n${list.length < all.length ? `Showing ${list.length} of ${all.length} samples.\n` : ''}\n${body}`);
  });

  tool('get_sample_info', {
    title: '采样信息与分析',
    description: '一个上传采样的完整技术信息（文件夹、封装格式、编码、是否无损、采样率、位深、声道数、码率、时长、大小，以及标题／作者／速度／调等内嵌标签），以及它的音频分析结果（LUFS、峰值、RMS、波峰因数、是否削波、静音段、立体声宽度、频谱平衡、起音点、速度、调、音高、是一次性音色还是循环、音色特征）。',
    inputSchema: { sampleId: z.string() },
    annotations: A.readOnly
  }, async ({ sampleId }) => {
    const s = await backend.getSample(sampleId);
    const folder = s.folderId ? (await backend.listSampleFolders()).find((f) => f.id === s.folderId)?.name || null : null;
    const info = backend.describeSample(s, folder);
    return ok(`${line(s)}\nFolder: ${folder || 'Unfiled'}${s.analysis?.summary ? `\n${s.analysis.summary}` : ''}`, info);
  });

  tool('analyze_sample', {
    title: '分析采样',
    description: '在用户的浏览器里（重新）分析一个采样（服务端解不了的格式如 MP3/M4A/OGG 必须这么做，也可以用来刷新结果）。返回分析结果。',
    inputSchema: { sampleId: z.string() },
    annotations: A.edit
  }, async ({ sampleId }) => {
    const s = await backend.getSample(sampleId);
    await backend.requestJob({ kind: 'analyze-sample', sampleId: s.id }, { timeoutMs: 90000 });
    const fresh = await backend.getSample(sampleId);
    const folder = fresh.folderId ? (await backend.listSampleFolders()).find((f) => f.id === fresh.folderId)?.name || null : null;
    return ok(`${line(fresh)}${fresh.analysis?.summary ? `\n${fresh.analysis.summary}` : ''}`, backend.describeSample(fresh, folder));
  });

  tool('rename_sample', {
    title: '重命名采样',
    description: '给上传的采样改名。',
    inputSchema: { sampleId: z.string(), name: z.string().min(1).max(800).describe('不超过 80 个字符') },
    annotations: A.edit
  }, async ({ sampleId, name }) => {
    const s = await backend.updateSample(sampleId, { name });
    return ok(`Renamed to "${s.name}".`);
  });

  tool('sample_folders', {
    title: '采样文件夹',
    description: '列出、新建、重命名或删除用来整理采样的文件夹（每个采样只在一个文件夹里，或者处于「未归档」）。删掉文件夹不会删里面的采样——它们会变成未归档。要把采样归档请用 move_samples。',
    inputSchema: {
      action: z.enum(['list', 'create', 'rename', 'delete']).optional().describe('默认 list'),
      folder: z.string().max(400).optional().describe('create：新文件夹的名字（不超过 40 个字符，不能叫「未归档」）；rename/delete：目标文件夹（名字或 id）'),
      newName: z.string().max(400).optional().describe('rename：新名字（不超过 40 个字符）')
    },
    annotations: A.edit
  }, async ({ action = 'list', folder, newName }) => {
    const folders = await backend.listSampleFolders();
    if (action === 'list') {
      const unfiled = (await backend.listSamples()).filter((s) => !folders.some((f) => f.id === s.folderId)).length;
      return ok(folders.length ? `${folders.map((f) => `${f.name} [${f.id}] — ${f.count} sample${f.count === 1 ? '' : 's'}`).join('\n')}\nUnfiled — ${unfiled}` : `No folders yet (${unfiled} unfiled samples). Create one with action "create".`);
    }
    if (!folder) throw new Error(`${action} needs "folder"`);
    if (action === 'create') {
      const f = await backend.createSampleFolder(folder);
      return ok(`Created folder "${f.name}" [${f.id}].`);
    }
    const f = resolveFolder(folders, folder);
    if (!f) throw new Error('"Unfiled" is not a folder: it is where samples without a folder are listed');
    if (action === 'rename') {
      if (!newName) throw new Error('rename needs "newName"');
      const r = await backend.renameSampleFolder(f.id, newName);
      return ok(`Renamed folder "${f.name}" to "${r.name}" [${f.id}].`);
    }
    const n = await backend.deleteSampleFolder(f.id);
    return ok(`Deleted folder "${f.name}"${n ? `; its ${n} sample${n === 1 ? ' is' : 's are'} now unfiled` : ''}.`);
  });

  tool('move_samples', {
    title: '把采样移到文件夹',
    description: '把采样归档到某个文件夹（按名字或 id；给一个新名字就会新建文件夹）。写 "unfiled" 会把它们从文件夹里取出来。一个采样一次只能在一个文件夹里。',
    inputSchema: {
      sampleIds: z.array(z.string()).min(1).max(500),
      folder: z.string().min(1).max(400).describe('文件夹名字或 id（不超过 40 个字符），或者写 "unfiled"')
    },
    annotations: A.edit
  }, async ({ sampleIds, folder }) => {
    // every sample first: a typo in one id must not leave a new, empty folder behind
    await Promise.all([...new Set(sampleIds)].map((id) => backend.getSample(id)));
    const folders = await backend.listSampleFolders();
    let f;
    let created = false;
    try {
      f = resolveFolder(folders, folder);
    } catch (e) {
      if (FOLDER_ID.test(folder.trim())) throw e; // a folder id that no longer exists: don't create a folder named after it
      f = await backend.createSampleFolder(folder);
      created = true;
    }
    const n = await backend.moveSamples(sampleIds, f ? f.id : null);
    return ok(`Moved ${n} sample${n === 1 ? '' : 's'} to ${f ? `"${f.name}" [${f.id}]${created ? ' (new folder)' : ''}` : 'Unfiled'}.`);
  });

  tool('delete_sample', {
    title: '删除采样',
    description: '永久删除上传的采样。只有用户明确要求时才这么做。用到它的采样器通道与音频块会变成静音——回复里会说哪些工程受到了影响。',
    inputSchema: {
      sampleId: z.string().optional(),
      sampleIds: z.array(z.string()).min(1).max(500).optional().describe('一次删多个（代替 sampleId）')
    },
    annotations: A.destructive
  }, async ({ sampleId, sampleIds }) => {
    const ids = [...new Set([...(sampleIds || []), ...(sampleId ? [sampleId] : [])])];
    if (!ids.length) throw new Error('Pass sampleId or sampleIds');
    const named = await Promise.all(ids.map((id) => backend.getSample(id)));
    const usage = await backend.sampleUsage(ids);
    if (ids.length === 1) await backend.deleteSample(ids[0]);
    else await backend.deleteSamples(ids);
    const used = named.map((s) => [s, describeUsage(usage[s.id])]).filter(([, u]) => u);
    return ok(`Deleted ${named.map((s) => `"${s.name}" [${s.id}]`).join(', ')}.${used.length ? ` Now silent: ${used.map(([s, u]) => `"${s.name}" was ${u}`).join('; ')}.` : ''}`);
  });

  tool('edit_sample', {
    title: '编辑采样（波形编辑器）',
    description: `像工作室里的波形编辑器那样编辑一个上传的采样（在用户的浏览器里跑），结果存成一个新采样（默认，原件保留）或覆盖原件。操作按顺序执行；start/end 单位是秒（两个都不写就是整段）：${Object.entries(EDIT_OPS).map(([k, v]) => `${k}: ${v}`).join('；')}。pitch_correct 是给独唱人声或独奏乐器做自动修音：key + scale（默认 C chromatic）、amount 0-1（1）、speed 毫秒（50；0＝机械感）、flatten 0-1（0）。saveAs 用 "replace" 会改动所有用到该采样的工程：只有用户要求时才这么做。`,
    inputSchema: {
      sampleId: z.string(),
      ops: z.array(z.object({
        op: z.enum(Object.keys(EDIT_OPS)),
        start: z.number().min(0).optional().describe('秒'),
        end: z.number().min(0).optional().describe('秒'),
        db: z.number().min(-48).max(48).optional().describe('gain 增益'),
        peakDb: z.number().min(-60).max(0).optional().describe('normalize 归一化目标峰值'),
        curve: z.enum(['linear', 'exp', 'log', 'scurve']).optional().describe('fade_in／fade_out 淡入淡出曲线'),
        rate: z.number().min(0.25).max(4).optional().describe('speed／stretch 变速与伸缩'),
        semitones: z.number().min(-24).max(24).optional().describe('pitch_shift 移调'),
        thresholdDb: z.number().min(-90).max(-10).optional().describe('trim_silence 静音裁剪的阈值（相对峰值）'),
        key: z.string().max(3).optional().describe('pitch_correct 音高修正：例如「A」「F#」「Bb」'),
        scale: z.string().max(20).optional().describe('pitch_correct 音高修正用的音阶：chromatic、major、minor、dorian…（见 music_theory）'),
        amount: z.number().min(0).max(1).optional(),
        speed: z.number().min(0).max(500).optional().describe('pitch_correct 音高修正：滑到目标音高要多少毫秒'),
        flatten: z.number().min(0).max(1).optional()
      })).min(1).max(20),
      saveAs: z.enum(['new', 'replace']).optional().describe('new（默认，另存为新采样）或 replace（覆盖原件）'),
      name: z.string().min(1).max(800).optional().describe('新采样的名字，不超过 80 个字符（默认「<原件> 编辑」）'),
      folder: z.string().max(400).optional().describe('新采样放到哪个文件夹：名字或 id，或写 "unfiled"（默认用原件所在的文件夹）')
    },
    annotations: A.edit
  }, async ({ sampleId, ops, saveAs = 'new', name, folder }) => {
    const s = await backend.getSample(sampleId);
    ops.forEach((o, i) => {
      if (o.op === 'pitch_correct') {
        if (o.scale !== undefined && o.scale !== 'chromatic' && !Object.hasOwn(SCALES, o.scale)) throw new Error(`Unknown scale "${o.scale}". Use chromatic or one of: ${Object.keys(SCALES).join(', ')}`);
        if (o.key !== undefined && parsePitchClass(o.key) === null) throw new Error(`Invalid key "${o.key}" (use e.g. C, F#, Bb)`);
      }
      if ((o.op === 'speed' || o.op === 'stretch') && o.rate === undefined) throw new Error(`${o.op} needs rate`);
      if (o.op === 'pitch_shift' && !o.semitones) throw new Error('pitch_shift needs semitones');
      if (o.op === 'gain' && o.db === undefined) throw new Error('gain needs db');
      if (Number.isFinite(o.start) && Number.isFinite(o.end) && o.end <= o.start) throw new Error(`${o.op}: end must be after start`);
      // only the first operation sees the sample's own length (a speed or trim changes it for the next ones)
      if (i === 0 && s.duration && Number.isFinite(o.start) && o.start >= s.duration) throw new Error(`${o.op}: start ${o.start}s is past the end of the sample (${s.duration}s)`);
      if (o.op === 'delete' && !Number.isFinite(o.start) && !Number.isFinite(o.end)) throw new Error('delete needs start and/or end (deleting everything would leave the sample empty)');
    });
    let folderId;
    if (saveAs === 'new' && folder !== undefined) folderId = resolveFolder(await backend.listSampleFolders(), folder)?.id ?? null;
    if (name !== undefined && !cleanName(name, 80)) throw new Error('name needs visible characters');
    if (saveAs === 'replace' && (name || folder !== undefined)) throw new Error('name and folder are for saveAs "new" (replace keeps the sample\'s name and folder)');
    const usage = saveAs === 'replace' ? (await backend.sampleUsage([s.id]))[s.id] : null;
    const r = await backend.requestJob({ kind: 'sample-edit', sampleId: s.id, ops, saveAs, name: cleanName(name || '', 80) || `${cleanName(s.name, 75)} edit`, folderId }, { timeoutMs: 240000 });
    const out = await backend.getSample(String(r?.sampleId || ''));
    const notes = Array.isArray(r?.notes) && r.notes.length ? ` ${r.notes.map(String).join('; ')}.` : '';
    const facts = `${out.duration ?? '?'} s${out.metadata?.channels ? `, ${out.metadata.channels === 1 ? 'mono' : 'stereo'}` : ''}`;
    if (saveAs === 'replace') {
      const used = describeUsage(usage);
      return ok(`Replaced the audio of "${out.name}" [${out.id}] (${facts}).${notes}${used ? ` It is ${used}: they all play the edited audio now.` : ''}`);
    }
    return ok(`Saved "${out.name}" [${out.id}] (${facts}) — the original "${s.name}" is unchanged.${notes}`);
  });

  tool('add_audio_clip', {
    title: '添加音频块',
    description: '把上传的采样（循环、人声、音效、整段录音）直接作为音频块放进播放列表，可以顺带设增益与淡入淡出。fit="repitch" 会通过改变速度（音高也跟着变，像唱机变速——boom bap／lo-fi 的经典做法）让循环对齐工程速度；否则音频不做时间伸缩，所以要把工程 BPM 调成跟循环一致（get_sample_info 会给出它的速度）。',
    inputSchema: {
      projectId: projectIdArg,
      sampleId: z.string(),
      startBar: z.number().min(1),
      track: z.number().int().min(1).max(MAX_TRACKS).optional(),
      bars: z.number().positive().optional().describe('音频块长度，单位小节（默认：按工程速度换算的采样时长）'),
      repeat: z.number().int().min(1).max(64).optional().describe('连着放几份（默认 1）'),
      gainDb: z.number().min(-60).max(12).optional().describe('音频块增益，单位 dB（默认 0）'),
      fadeInSteps: z.number().min(0).optional().describe('淡入长度，单位步（十六分音符）'),
      fadeOutSteps: z.number().min(0).optional().describe('淡出长度，单位步'),
      fit: z.enum(['none', 'repitch']).optional().describe('repitch＝把循环变速到工程速度（需要能测出或你给定 sampleBpm）'),
      sampleBpm: z.number().min(40).max(300).optional().describe('fit=repitch 时循环本身的速度（默认用测出来的）')
    },
    annotations: A.edit
  }, async ({ projectId, sampleId, startBar, track, bars, repeat = 1, gainDb, fadeInSteps, fadeOutSteps, fit = 'none', sampleBpm }) => {
    const p = await load(projectId);
    const sample = await backend.getSample(sampleId);
    const bar = ticksPerBar(p);
    const tempo = sample.analysis?.tempo;
    let rate = 1;
    let fitNote = '';
    if (fit === 'repitch') {
      let src = sampleBpm ?? (tempo && tempo.confidence >= 0.2 ? tempo.bpm : null);
      if (!src) throw new Error('fit=repitch needs the loop tempo: no tempo was detected, so pass sampleBpm');
      // a half/double-time detection would make a silly speed change: pick the octave of the tempo nearest the project's
      while (src * 1.5 < p.bpm) src *= 2;
      while (src / 1.5 > p.bpm) src /= 2;
      rate = Math.round((p.bpm / src) * 10000) / 10000;
      if (rate < 0.25 || rate > 4) throw new Error(`The loop (${src} BPM) is too far from ${p.bpm} BPM to repitch`);
      const semis = Math.round(12 * Math.log2(rate) * 10) / 10;
      fitNote = ` Repitched ${src} → ${p.bpm} BPM (speed ×${rate}, ${semis > 0 ? '+' : ''}${semis} semitones).`;
    }
    const length = bars ? Math.round(bars * bar) : sample.duration ? Math.max(1, Math.round((sample.duration / rate) * (p.bpm / 60) * PPQ)) : bar;
    const audio = {
      ...(gainDb !== undefined && { gain: Math.pow(10, gainDb / 20) }),
      ...(fadeInSteps !== undefined && { fadeIn: Math.round(fadeInSteps * STEP) }),
      ...(fadeOutSteps !== undefined && { fadeOut: Math.round(fadeOutSteps * STEP) }),
      ...(rate !== 1 && { rate })
    };
    const t = track ? track - 1 : pickTrack(p, sampleId);
    const start = Math.round((startBar - 1) * bar);
    const ops = [];
    if (t >= p.playlist.tracks.length) ops.push({ type: 'track/add', count: t - p.playlist.tracks.length + 1 });
    const clips = Array.from({ length: repeat }, (_, i) => ({ id: uid('clip'), kind: 'audio', refId: sample.id, track: t, start: start + i * length, length, ...audio }));
    ops.push({ type: 'clip/add', clips });
    await backend.applyOps(p.id, ops);
    const warn = fit !== 'repitch' && tempo && tempo.confidence >= 0.35 && Math.abs(tempo.bpm - p.bpm) / p.bpm > 0.03 && Math.abs(tempo.bpm * 2 - p.bpm) / p.bpm > 0.03 && Math.abs(tempo.bpm / 2 - p.bpm) / p.bpm > 0.03
      ? ` Note: the sample is ~${tempo.bpm} BPM but the project is ${p.bpm} BPM, so it will drift (no time-stretch) — use fit="repitch" or change the project tempo.`
      : '';
    return ok(`Placed sample "${sample.name}" on track ${t + 1} at bar ${startBar}${repeat > 1 ? ` ×${repeat}` : ''} [${clips.map((c) => c.id).join(', ')}].${fitNote}${warn}`);
  });
}
