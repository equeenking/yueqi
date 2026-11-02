// Patterns and notes: step sequencing, piano-roll notes, chords, basslines, melodies, rolls, editing.
import {
  STEP, ticksPerBar, uid, parseNote, noteName, findChannel, findPattern, patternLength, parseStepString, toTicks,
  chordProgressionNotes, bassFromChords, bassLineFromChords, VOICINGS, melodyFromString, melodyLength, quantizeNotes, humanizeNotes, legatoNotes, rollNotes,
  toStepString, isStepLike, CHORD_TYPES, COLORS, maxPatternLength, MAX_PATTERN_BARS, stepsPerBeat
} from '@greanteadawy/core';
import { z, ok, projectIdArg, unitArg, annotations as A, normVelocity, growPatternOp, assertFitsPattern, resolveChords, steps, barsOf, uniqueName, assertNameFree } from '../util.js';

const RATE_TICKS = { '1/8': 48, '1/12': 32, '1/16': 24, '1/24': 16, '1/32': 12, '1/48': 8, '1/64': 6 };
const velocityArg = z.number().min(0).max(127).optional().describe('0..1（1＝最响），或 MIDI 的 2..127');
const replaceArg = z.boolean().optional().describe('默认是：先把这个通道在要写入范围内的音符清掉（范围外的保留）。false＝直接往上叠。');

/** Notes of a channel outside [lo, hi) — kept when a range is rewritten. */
const outside = (pt, channelId, lo, hi) => (pt.notes[channelId] || []).filter((n) => n.start < lo || n.start >= hi);

export function registerNoteTools({ tool, backend, load }) {
  // ---------------------------------------------------------------- patterns
  tool('create_pattern', {
    title: '新建片段',
    description: '新建一个空片段（一段可复用的音符，任何通道都能用）。',
    inputSchema: {
      projectId: projectIdArg,
      name: z.string().min(1).max(64),
      bars: z.number().min(0.25).max(64).optional().describe('长度，单位小节（默认 1）'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
    },
    annotations: A.edit
  }, async ({ projectId, name, bars = 1, color }) => {
    const p = await load(projectId);
    const length = Math.min(Math.round(bars * ticksPerBar(p)), maxPatternLength(p));
    if (p.patterns.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`已有同名的片段「${name}」`);
    // reuse the untouched default "Pattern 1" of a fresh project instead of leaving an empty pattern behind
    const blank = p.patterns.length === 1 && p.patterns[0].name === 'Pattern 1' && !Object.values(p.patterns[0].notes).some((l) => l.length)
      && !p.playlist.clips.some((c) => c.refId === p.patterns[0].id) ? p.patterns[0] : null;
    if (blank) {
      await backend.applyOps(p.id, [{ type: 'pattern/update', id: blank.id, patch: { name, length, ...(color && { color }) } }]);
      return ok(`Created pattern "${name}" [${blank.id}], ${bars} bar(s) = ${Math.round(length / STEP)} steps.`);
    }
    const id = uid('pat');
    await backend.applyOps(p.id, [{ type: 'pattern/add', pattern: { id, name, length, color: color || COLORS[(p.patterns.length * 5) % COLORS.length] } }]);
    return ok(`Created pattern "${name}" [${id}], ${bars} bar(s) = ${Math.round(length / STEP)} steps.`);
  });

  tool('update_pattern', {
    title: '修改片段',
    description: '给片段改名、改颜色或改长度。缩短到已有音符之外时需要 trimNotes=true（那些音符会被删掉）。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string().describe('片段 id 或名字'),
      name: z.string().min(1).max(64).optional(),
      bars: z.number().min(0.25).max(64).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      trimNotes: z.boolean().optional().describe('缩短时：删掉起点超出新结尾的音符')
    },
    annotations: A.edit
  }, async ({ projectId, pattern, name, bars, color, trimNotes = false }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const patch = {};
    const ops = [];
    if (name) {
      assertNameFree(p.patterns, name, '片段', pt);
      patch.name = name;
    }
    if (color) patch.color = color;
    if (bars) {
      patch.length = Math.round(bars * ticksPerBar(p));
      const beyond = Object.entries(pt.notes).map(([cid, list]) => [cid, list.filter((n) => n.start >= patch.length)]).filter(([, l]) => l.length);
      const count = beyond.reduce((s, [, l]) => s + l.length, 0);
      if (count && !trimNotes) throw new Error(`${count} note(s) start in bar ${Math.floor(bars) + 1} or later, so the pattern would stay longer. Pass trimNotes=true to delete them, or move them first.`);
      for (const [cid, list] of beyond) ops.push({ type: 'notes/remove', patternId: pt.id, channelId: cid, ids: list.map((n) => n.id) });
    }
    if (!Object.keys(patch).length) throw new Error('Nothing to change');
    ops.push({ type: 'pattern/update', id: pt.id, patch });
    await backend.applyOps(p.id, ops);
    const trimmed = ops.length > 1 ? ` Deleted ${ops.slice(0, -1).reduce((s, o) => s + o.ids.length, 0)} note(s) past the new end.` : '';
    return ok(`Updated pattern "${name || pt.name}"${bars ? ` (${bars} bar${bars === 1 ? '' : 's'})` : ''}.${trimmed}`);
  });

  tool('duplicate_pattern', {
    title: '复制片段',
    description: '把一个片段（所有通道的音符）复制成一个新片段——用来做变体（比如带过门的「鼓组 B」）。',
    inputSchema: { projectId: projectIdArg, pattern: z.string(), name: z.string().min(1).max(64).optional() },
    annotations: A.edit
  }, async ({ projectId, pattern, name }) => {
    const p = await load(projectId);
    const src = findPattern(p, pattern);
    const id = uid('pat');
    const notes = {};
    for (const [cid, list] of Object.entries(src.notes)) notes[cid] = list.map((n) => ({ ...n, id: uid('n') }));
    if (name) assertNameFree(p.patterns, name, '片段');
    const newName = name || uniqueName(p.patterns, `${src.name} 2`);
    await backend.applyOps(p.id, [{ type: 'pattern/add', index: p.patterns.indexOf(src) + 1, pattern: { id, name: newName, color: src.color, length: src.length, notes } }]);
    return ok(`Duplicated "${src.name}" as "${newName}" [${id}].`);
  });

  tool('delete_pattern', {
    title: '删除片段',
    description: '删掉一个片段以及它在播放列表里的片段块。',
    inputSchema: { projectId: projectIdArg, pattern: z.string() },
    annotations: A.destructive
  }, async ({ projectId, pattern }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    await backend.applyOps(p.id, [{ type: 'pattern/remove', id: pt.id }]);
    return ok(`Deleted pattern "${pt.name}".`);
  });

  tool('get_pattern', {
    title: '查看片段',
    description: '看一个片段的细节：每个通道给出步进格（鼓组）和完整音符列表（带音符 id、音名、起点／长度（步）与力度）——这些 id 可以直接给 update_notes / delete_notes 用。',
    inputSchema: { projectId: projectIdArg, pattern: z.string(), channel: z.string().optional().describe('只看这一个通道') },
    annotations: A.readOnly
  }, async ({ projectId, pattern, channel }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const len = patternLength(p, pt);
    const chans = channel ? [findChannel(p, channel)] : p.channels.filter((c) => pt.notes[c.id]?.length);
    const lines = [`Pattern "${pt.name}" [${pt.id}] — ${steps(len)} steps (${Math.round((len / ticksPerBar(p)) * 100) / 100} bars)`];
    for (const c of chans) {
      const list = pt.notes[c.id] || [];
      lines.push(`\n${c.name} [${c.id}] — ${list.length} notes`);
      if (list.length && isStepLike(list)) lines.push(`  steps: ${toStepString(list, Math.round(len / STEP), { barSteps: Math.round(ticksPerBar(p) / STEP), group: stepsPerBeat(p) })}`);
      for (const n of list) lines.push(`  ${n.id}  ${noteName(n.key).padEnd(4)} start ${steps(n.start)}  len ${steps(n.length)}  vel ${Math.round(n.velocity * 100) / 100}${n.pan ? `  pan ${n.pan}` : ''}`);
    }
    return ok(lines.join('\n'));
  });

  // ---------------------------------------------------------------- writing notes
  tool('write_drums', {
    title: '写步进鼓点',
    description: '用步进串（如 "x---x---x---x---"）给片段里一个或多个通道编程。一个字符＝一个十六分音符步：x 敲击，X 重音，o 弱击，1-9 力度，- 或 . 休止；空格和 | 会被忽略。默认替换这些通道在该片段里的音符（mode 用 "merge" 則是叠加）。每小节步数跟着拍号走（4/4 是 16，3/4 或 6/8 是 12）；串更长就把片段拉长。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string().describe('片段 id 或名字'),
      tracks: z.record(z.string(), z.string().max(8192)).describe('通道名／id → 步进串 的对照表，例如 {"底鼓":"x---x---x---x---","军鼓":"----x-------x---"}'),
      mode: z.enum(['replace', 'merge']).optional(),
      note: z.union([z.string(), z.number()]).optional().describe('要触发的音符（默认用各通道自己的步进音符）。给别的音可以让鼓组变调。')
    },
    annotations: A.edit
  }, async ({ projectId, pattern, tracks, mode = 'replace', note }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    if (!Object.keys(tracks).length) throw new Error('tracks is empty — pass e.g. {"Kick":"x---x---x---x---","Hat":"x-x-x-x-x-x-x-x-"}');
    const ops = [];
    let maxSteps = 0;
    const report = [];
    const seen = new Map();
    for (const [ref, str] of Object.entries(tracks)) {
      const ch = findChannel(p, ref);
      if (seen.has(ch.id)) throw new Error(`"${ref}" and "${seen.get(ch.id)}" are the same channel — give each channel once`);
      seen.set(ch.id, ref);
      const { hits, steps: count } = parseStepString(str);
      maxSteps = Math.max(maxSteps, count);
      const key = note !== undefined ? parseNote(note) : ch.rootKey;
      const notes = hits.map((h) => ({ id: uid('n'), key, start: h.step * STEP, length: STEP, velocity: h.velocity }));
      ops.push({ type: mode === 'merge' ? 'notes/add' : 'notes/set', patternId: pt.id, channelId: ch.id, notes });
      report.push(`${ch.name}: ${hits.length} hits`);
    }
    const grow = growPatternOp(p, pt, maxSteps * STEP);
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Pattern "${pt.name}": ${report.join(', ')}.`);
  });

  const noteSchema = z.object({
    note: z.union([z.string(), z.number()]).describe('音名（C4、F#3）或 MIDI 音高数字'),
    start: z.number().min(0).describe('起点位置（默认单位：从片段开头算起的步数）'),
    length: z.number().positive().optional().describe('长度（默认 1 步）'),
    velocity: velocityArg,
    pan: z.number().min(-1).max(1).optional().describe('单个音符的声像')
  });

  tool('add_notes', {
    title: '添加音符（钢琴卷帘）',
    description: '往片段里某个通道写音符（钢琴卷帘）。位置与长度默认按十六分音符步算。replace=true 会先清掉该通道在这个片段里的音符。音符超出片段结尾会把片段拉长。',
    inputSchema: { projectId: projectIdArg, pattern: z.string(), channel: z.string(), notes: z.array(noteSchema).min(1).max(2000), unit: unitArg, replace: z.boolean().optional() },
    annotations: A.edit
  }, async ({ projectId, pattern, channel, notes, unit = 'steps', replace = false }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const ch = findChannel(p, channel);
    const defLen = { steps: 1, beats: 0.25, bars: 1 / 16, ticks: STEP }[unit];
    const list = notes.map((n) => ({
      id: uid('n'),
      key: parseNote(n.note),
      start: toTicks(n.start, unit, p),
      length: Math.max(1, toTicks(n.length ?? defLen, unit, p)),
      velocity: normVelocity(n.velocity),
      ...(n.pan ? { pan: n.pan } : {})
    }));
    const ops = [{ type: replace ? 'notes/set' : 'notes/add', patternId: pt.id, channelId: ch.id, notes: list }];
    const grow = growPatternOp(p, pt, Math.max(...list.map((n) => n.start + n.length)));
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`${replace ? 'Wrote' : 'Added'} ${list.length} notes to "${ch.name}" in "${pt.name}" (${list.slice(0, 8).map((n) => noteName(n.key)).join(' ')}${list.length > 8 ? ' …' : ''}).`);
  });

  tool('write_melody', {
    title: '写旋律',
    description: '用一串紧凑记号写单声部旋律："C5:2 D5:2 Eb5:4 -:2 G5:6"——每个记号是 音名:步数（"-" 休止；后缀 "!" 重音，"~" 滑音：这个音会滑进下一个音，所以带滑音的单音乐器（808、贝斯、西塔琴、印度竹笛、二胡、尺八…）会滑过去，例如 "C4:4~ Db4:2"）。音符从 start 起一个接一个排。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      melody: z.string().min(1).max(20000),
      start: z.number().min(0).optional().describe('起始步（默认 0）'),
      velocity: velocityArg,
      gate: z.number().min(0.1).max(1).optional().describe('音符长度占时值的比例（默认 0.95；越小越短促）'),
      replace: replaceArg
    },
    annotations: A.edit
  }, async ({ projectId, pattern, channel, melody, start = 0, velocity, gate = 0.95, replace = true }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const ch = findChannel(p, channel);
    const lo = Math.round(start * STEP);
    const span = melodyLength(melody);
    assertFitsPattern(p, pt, lo + span);
    const notes = melodyFromString(melody, { start: lo, velocity: normVelocity(velocity), gate });
    const end = notes.reduce((m, n) => Math.max(m, n.start + n.length), lo);
    const ops = [replace
      ? { type: 'notes/set', patternId: pt.id, channelId: ch.id, notes: [...outside(pt, ch.id, lo, lo + span), ...notes] }
      : { type: 'notes/add', patternId: pt.id, channelId: ch.id, notes }];
    const grow = growPatternOp(p, pt, end);
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Wrote ${notes.length} notes to "${ch.name}" in "${pt.name}" (ends at step ${Math.round(end / STEP)}).`);
  });

  tool('add_chords', {
    title: '写和弦进行',
    description: `往一个通道里写和弦进行。可以用和弦记号（Am、F、Cmaj7、G7、Dm9、Esus4、Bdim、C/E），也可以用工程调内的级数（i、VI、bVII、V7、ii°）；"-" 表示休止。可用性质：${Object.keys(CHORD_TYPES).filter(Boolean).join(' ')}。和弦会围绕一个音区做平滑的声部连接。风格：block（持续）、rhythm（按步进串里的每个 x 敲一下）、arp-up、arp-down、arp-updown、broken。排列法：close（默认）、open（更宽的铺底）、drop2（爵士／新灵魂键盘）、drop3、spread（电影感：根音放低，其余音张开）、shell（根音-三音-七音：lo-fi／爵士的伴奏）、rootless（不要根音、加九音：贝斯之上现代的键盘写法）。`,
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      chords: z.array(z.string()).min(1).max(256),
      stepsPerChord: z.number().min(1).max(1024).optional().describe('默认 16（一个和弦占一小节）'),
      octave: z.number().int().min(0).max(8).optional().describe('第一个和弦根音所在的八度（默认 4）'),
      style: z.enum(['block', 'rhythm', 'arp-up', 'arp-down', 'arp-updown', 'broken']).optional(),
      voicing: z.enum(VOICINGS).optional().describe('和弦音怎么铺开（默认 close）'),
      inversion: z.number().int().min(0).max(4).optional().describe('第一个和弦的转位（其余和弦从它出发做声部连接）；默认 0'),
      register: z.union([z.string(), z.number()]).optional().describe('排列围绕的中心音高，例如中音区键盘用 "E4"、通透的铺底用 "C5"（默认用第一个和弦在 octave 上的位置）'),
      rhythm: z.string().max(4096).optional().describe('style=rhythm 时用：每个和弦都从头重放的步进串，例如 "x--x--x-"'),
      arpRate: z.number().min(0.25).optional().describe('琶音风格用：每个琶音音符占几步（默认 2＝八分音符）'),
      velocity: velocityArg,
      gate: z.number().min(0.1).max(1).optional(),
      start: z.number().min(0).optional().describe('起始步（默认 0）'),
      replace: replaceArg
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    const pt = findPattern(p, a.pattern);
    const ch = findChannel(p, a.channel);
    const spc = a.stepsPerChord ?? 16;
    const chords = resolveChords(a.chords, p);
    const lo = Math.round((a.start || 0) * STEP);
    const hi = lo + Math.round(chords.length * spc * STEP);
    assertFitsPattern(p, pt, hi);
    // a rhythm or arp rate implies its style when no style is given
    const style = a.style || (a.rhythm ? 'rhythm' : a.arpRate ? 'arp-up' : 'block');
    const ignored = [a.rhythm && style !== 'rhythm' && 'rhythm', a.arpRate && !style.startsWith('arp') && 'arpRate'].filter(Boolean);
    const notes = chordProgressionNotes(chords, {
      start: lo, chordLength: spc * STEP, octave: a.octave ?? 4, style,
      rhythm: a.rhythm, rate: (a.arpRate ?? 2) * STEP, velocity: normVelocity(a.velocity, 0.75), gate: a.gate ?? (style === 'block' ? 1 : 0.9),
      voicing: a.voicing || 'close', inversion: a.inversion || 0, center: a.register !== undefined ? parseNote(a.register) : null
    });
    const ops = [a.replace === false
      ? { type: 'notes/add', patternId: pt.id, channelId: ch.id, notes }
      : { type: 'notes/set', patternId: pt.id, channelId: ch.id, notes: [...outside(pt, ch.id, lo, hi), ...notes] }];
    const grow = growPatternOp(p, pt, hi);
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Wrote ${chords.join(' – ')} (${notes.length} notes, ${style}${a.voicing && a.voicing !== 'close' ? `, ${a.voicing} voicing` : ''}) to "${ch.name}" in "${pt.name}".${ignored.length ? ` Note: ${ignored.join(' and ')} ignored with style "${style}".` : ''}`);
  });

  tool('add_bassline', {
    title: '按和弦写贝斯',
    description: '按和弦生成贝斯声部。可以给一个节奏（根音敲击的步进串，每个和弦重放一次），也可以给一串音级记号（每个和弦重放一次）：记号是 "音级:步数"——R（根音／斜杠贝斯）、3 5 7（和弦本身的音）、8（八度）、b7、9、-5（下方五度）、-8（低八度根音）；"-" 休止，"~:2" 延音；后缀 ! 重音、? 弱击、~ 滑进下一个音（808 的滑音）。例如 trap 808 "R:6 R:2~ 8:2 -:2 5:4"，house "-:2 R:2 -:2 R:2 -:2 8:2 -:2 R:2"，boom bap "R:3 R:3 -:2 5:2 -:2 b7:4"。根音会保持在同一个音区。和 add_chords 一样也接受级数记号。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      chords: z.array(z.string()).min(1).max(256),
      stepsPerChord: z.number().min(1).max(1024).optional().describe('默认 16'),
      octave: z.number().int().min(0).max(6).optional().describe('默认 2（808 通常在 C1–C2 最好听）'),
      rhythm: z.string().max(4096).optional().describe('根音的节奏（步进串），默认 "x-------x-------"'),
      line: z.string().max(4096).optional().describe('用音级串代替节奏，例如 "R:3 R:1 -:2 5:2 R:2~ 8:4 b7:2"（写法见说明）'),
      gate: z.number().min(0.1).max(1).optional(),
      velocity: velocityArg,
      start: z.number().min(0).optional().describe('起始步（默认 0）'),
      replace: replaceArg
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    const pt = findPattern(p, a.pattern);
    const ch = findChannel(p, a.channel);
    const spc = a.stepsPerChord ?? 16;
    const chords = resolveChords(a.chords, p);
    const lo = Math.round((a.start || 0) * STEP);
    const hi = lo + Math.round(chords.length * spc * STEP);
    if (a.line && a.rhythm) throw new Error('Give either rhythm or line, not both');
    assertFitsPattern(p, pt, hi);
    const opts = { start: lo, chordLength: spc * STEP, octave: a.octave ?? 2, gate: a.gate ?? 0.9, velocity: normVelocity(a.velocity, 0.85) };
    const notes = a.line ? bassLineFromChords(chords, a.line, opts) : bassFromChords(chords, { ...opts, rhythm: a.rhythm || 'x-------x-------' });
    if (!notes.length) throw new Error(`That ${a.line ? 'line has no notes' : 'rhythm has no hits ("x")'}, so the bassline would be empty`);
    const ops = [a.replace === false
      ? { type: 'notes/add', patternId: pt.id, channelId: ch.id, notes }
      : { type: 'notes/set', patternId: pt.id, channelId: ch.id, notes: [...outside(pt, ch.id, lo, hi), ...notes] }];
    const grow = growPatternOp(p, pt, hi);
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Wrote a ${notes.length}-note bassline for ${chords.join(' – ')} to "${ch.name}" in "${pt.name}".`);
  });

  tool('add_roll', {
    title: '加连击／碎拍',
    description: '加一串快速的重复音符（trap 踩镲连击、军鼓推进、碎拍），力度可以做渐变。是叠加在已有音符之上的。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      start: z.number().min(0).describe('起始步'),
      length: z.number().positive().max(2048).describe('长度，单位步'),
      rate: z.enum(Object.keys(RATE_TICKS)).optional().describe('音符间隔：1/32（默认）、1/24（十六分三连音）、1/48、1/64、1/16、1/12…'),
      note: z.union([z.string(), z.number()]).optional().describe('默认用该通道的步进音符'),
      velocityFrom: z.number().min(0).max(1).optional().describe('默认 0.45'),
      velocityTo: z.number().min(0).max(1).optional().describe('默认 0.9'),
      pitchRamp: z.number().int().min(-24).max(24).optional().describe('整段连击里滑多少个半音（例如 12 就是军鼓渐强上行）')
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    const pt = findPattern(p, a.pattern);
    const ch = findChannel(p, a.channel);
    const span = Math.round(a.length * STEP);
    assertFitsPattern(p, pt, Math.round(a.start * STEP) + span);
    const dt = RATE_TICKS[a.rate || '1/32'];
    const count = Math.max(1, Math.round(span / dt));
    const key = a.note !== undefined ? parseNote(a.note) : ch.rootKey;
    let notes = rollNotes({ start: Math.round(a.start * STEP), span, count, key, from: a.velocityFrom ?? 0.45, to: a.velocityTo ?? 0.9 });
    if (a.pitchRamp) notes = notes.map((n, i) => ({ ...n, key: Math.max(0, Math.min(127, key + Math.round((a.pitchRamp * i) / Math.max(1, count - 1)))) }));
    const ops = [{ type: 'notes/add', patternId: pt.id, channelId: ch.id, notes }];
    const grow = growPatternOp(p, pt, Math.round(a.start * STEP) + span);
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Added a ${count}-hit ${a.rate || '1/32'} roll to "${ch.name}" at step ${a.start} in "${pt.name}".`);
  });

  tool('copy_notes', {
    title: '复制音符',
    description: '把一个通道在某个片段里的音符复制到另一个片段和／或另一个通道（可以顺便移调或平移）——比如把旋律在第二个合成器上叠一遍，或者在新段落里复用一段贝斯。',
    inputSchema: {
      projectId: projectIdArg,
      fromPattern: z.string(),
      fromChannel: z.string(),
      toPattern: z.string().optional().describe('默认：同一个片段'),
      toChannel: z.string().optional().describe('默认：同一个通道'),
      transpose: z.number().int().min(-48).max(48).optional(),
      offsetSteps: z.number().optional(),
      replace: z.boolean().optional().describe('先清空目标（默认不清）')
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    const src = findPattern(p, a.fromPattern);
    const sch = findChannel(p, a.fromChannel);
    const dst = a.toPattern ? findPattern(p, a.toPattern) : src;
    const dch = a.toChannel ? findChannel(p, a.toChannel) : sch;
    if (dst.id === src.id && dch.id === sch.id && !a.transpose && !a.offsetSteps) throw new Error('Source and destination are identical');
    const off = Math.round((a.offsetSteps || 0) * STEP);
    const notes = (src.notes[sch.id] || [])
      .map((n) => ({ ...n, id: uid('n'), key: n.key + (a.transpose || 0), start: n.start + off }))
      .filter((n) => n.start >= 0 && n.key >= 0 && n.key <= 127);
    if (!notes.length) throw new Error(`"${sch.name}" has no notes in "${src.name}"`);
    const ops = [{ type: a.replace ? 'notes/set' : 'notes/add', patternId: dst.id, channelId: dch.id, notes }];
    const grow = growPatternOp(p, dst, Math.max(...notes.map((n) => n.start + n.length)));
    if (grow) ops.unshift(grow);
    await backend.applyOps(p.id, ops);
    return ok(`Copied ${notes.length} notes from ${sch.name}/${src.name} to ${dch.name}/${dst.name}.`);
  });

  // ---------------------------------------------------------------- editing notes
  tool('update_notes', {
    title: '修改音符',
    description: '按 id 改单个音符（id 来自 get_pattern）：改音高、位置、长度、力度或声像。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      notes: z.array(z.object({
        id: z.string(),
        note: z.union([z.string(), z.number()]).optional(),
        start: z.number().min(0).optional(),
        length: z.number().positive().optional(),
        velocity: z.number().min(0).max(127).optional(),
        pan: z.number().min(-1).max(1).optional()
      })).min(1).max(2000),
      unit: unitArg
    },
    annotations: A.edit
  }, async ({ projectId, pattern, channel, notes, unit = 'steps' }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const ch = findChannel(p, channel);
    const existing = new Map((pt.notes[ch.id] || []).map((n) => [n.id, n]));
    const missing = notes.filter((n) => !existing.has(n.id)).map((n) => n.id);
    if (missing.length) throw new Error(`Unknown note id(s): ${missing.slice(0, 5).join(', ')} (use get_pattern for ids)`);
    const upd = notes.map((n) => ({
      id: n.id,
      ...(n.note !== undefined && { key: parseNote(n.note) }),
      ...(n.start !== undefined && { start: toTicks(n.start, unit, p) }),
      ...(n.length !== undefined && { length: Math.max(1, toTicks(n.length, unit, p)) }),
      ...(n.velocity !== undefined && { velocity: normVelocity(n.velocity) }),
      ...(n.pan !== undefined && { pan: n.pan })
    }));
    await backend.applyOps(p.id, [{ type: 'notes/update', patternId: pt.id, channelId: ch.id, notes: upd }]);
    return ok(`Updated ${upd.length} note(s) of "${ch.name}" in "${pt.name}".`);
  });

  tool('delete_notes', {
    title: '删除音符',
    description: '按 id 删除片段里某通道的音符，也可以按步范围和／或音高删。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      ids: z.array(z.string()).optional(),
      fromStep: z.number().min(0).optional(),
      toStep: z.number().min(0).optional().describe('结束步（不含该步本身）'),
      note: z.union([z.string(), z.number()]).optional()
    },
    annotations: A.destructive
  }, async ({ projectId, pattern, channel, ids, fromStep, toStep, note }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const ch = findChannel(p, channel);
    const list = pt.notes[ch.id] || [];
    const key = note !== undefined ? parseNote(note) : null;
    const filtered = !ids && fromStep === undefined && toStep === undefined && key === null;
    if (filtered) throw new Error('Give ids, a step range or a note (use clear_notes to remove everything)');
    const idSet = ids ? new Set(ids) : null;
    const lo = fromStep !== undefined ? fromStep * STEP : -Infinity;
    const hi = toStep !== undefined ? toStep * STEP : Infinity;
    const del = list.filter((n) => (!idSet || idSet.has(n.id)) && n.start >= lo && n.start < hi && (key === null || n.key === key)).map((n) => n.id);
    if (!del.length) return ok('No notes matched.');
    await backend.applyOps(p.id, [{ type: 'notes/remove', patternId: pt.id, channelId: ch.id, ids: del }]);
    return ok(`Deleted ${del.length} note(s) from "${ch.name}" in "${pt.name}".`);
  });

  tool('clear_notes', {
    title: '清空音符',
    description: '清掉片段里某一个通道（或所有通道）的全部音符。',
    inputSchema: { projectId: projectIdArg, pattern: z.string(), channel: z.string().optional().describe('不写就清空整个片段') },
    annotations: A.destructive
  }, async ({ projectId, pattern, channel }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const chans = channel ? [findChannel(p, channel)] : p.channels.filter((c) => pt.notes[c.id]?.length);
    if (!chans.length) return ok('Nothing to clear.');
    await backend.applyOps(p.id, chans.map((c) => ({ type: 'notes/remove', patternId: pt.id, channelId: c.id })));
    return ok(`Cleared ${chans.map((c) => c.name).join(', ')} in "${pt.name}".`);
  });

  tool('transform_notes', {
    title: '变换音符',
    description: '对片段里某个通道做钢琴卷帘式的批量处理：transpose 移调（amount＝半音数，必填）、shift 平移（amount＝步数，负数往前；会绕回片段内）、quantize 量化（amount＝网格步数，默认 1）、humanize 人性化（amount 0..1）、legato 连奏、velocity 统一力度（全部设为 amount：0..1 或 MIDI 2..127，必填）、randomize_velocity 随机力度（amount＝0..1 的离散程度）、double 加倍（把整个片段变成两倍长——每个通道都重复一遍，所以不会突然静音）、reverse 倒转、stretch 伸缩（amount＝时间倍率，例如 2＝慢一半，0.5＝快一倍；需要时会把片段拉长，其它通道不变）、strum 琶开（amount＝和弦各音之间隔几步）。',
    inputSchema: {
      projectId: projectIdArg,
      pattern: z.string(),
      channel: z.string(),
      action: z.enum(['transpose', 'shift', 'quantize', 'humanize', 'legato', 'velocity', 'randomize_velocity', 'double', 'reverse', 'stretch', 'strum']),
      amount: z.number().optional()
    },
    annotations: A.edit
  }, async ({ projectId, pattern, channel, action, amount }) => {
    const p = await load(projectId);
    const pt = findPattern(p, pattern);
    const ch = findChannel(p, channel);
    let notes = (pt.notes[ch.id] || []).map((n) => ({ ...n }));
    if (!notes.length) throw new Error(`"${ch.name}" has no notes in "${pt.name}"`);
    const len = patternLength(p, pt);
    const ops = [];
    if ((action === 'transpose' || action === 'velocity') && amount === undefined) throw new Error(`${action} needs an amount`);
    switch (action) {
      case 'transpose': {
        const d = Math.round(amount);
        const keys = notes.map((n) => n.key + d);
        if (Math.min(...keys) < 0 || Math.max(...keys) > 127) throw new Error(`Transposing by ${d} would push notes outside the MIDI range (C-1..G9)`);
        notes = notes.map((n, i) => ({ ...n, key: keys[i] }));
        break;
      }
      case 'shift': {
        const d = Math.round((amount ?? 1) * STEP);
        notes = notes.map((n) => ({ ...n, start: (((n.start + d) % len) + len) % len }));
        break;
      }
      case 'quantize': notes = quantizeNotes(notes, Math.max(1, Math.round((amount ?? 1) * STEP))); break;
      case 'humanize': notes = humanizeNotes(notes, { timing: 6 * (amount ?? 0.5), velocity: 0.2 * (amount ?? 0.5) }); break;
      case 'legato': notes = legatoNotes(notes); break;
      case 'velocity': notes = notes.map((n) => ({ ...n, velocity: normVelocity(amount, 0.8) })); break;
      case 'randomize_velocity': notes = notes.map((n) => ({ ...n, velocity: Math.max(0.05, Math.min(1, n.velocity + (Math.random() * 2 - 1) * (amount ?? 0.15))) })); break;
      case 'double': {
        if (len * 2 > maxPatternLength(p)) throw new Error(`The pattern can't be longer than ${MAX_PATTERN_BARS} bars`);
        ops.push({ type: 'pattern/update', id: pt.id, patch: { length: len * 2 } });
        for (const [cid, list] of Object.entries(pt.notes)) {
          if (cid === ch.id || !list.length) continue;
          ops.push({ type: 'notes/add', patternId: pt.id, channelId: cid, notes: list.map((n) => ({ ...n, id: uid('n'), start: n.start + len })) });
        }
        notes = [...notes, ...notes.map((n) => ({ ...n, id: uid('n'), start: n.start + len }))];
        break;
      }
      case 'reverse': notes = notes.map((n) => ({ ...n, start: Math.max(0, len - n.start - n.length) })); break;
      case 'stretch': {
        const f = amount ?? 2;
        if (!(f > 0.05 && f <= 16)) throw new Error('stretch amount must be between 0.05 and 16');
        notes = notes.map((n) => ({ ...n, start: Math.round(n.start * f), length: Math.max(1, Math.round(n.length * f)) }));
        const grow = growPatternOp(p, pt, Math.max(...notes.map((n) => n.start + n.length)));
        if (grow) ops.push(grow);
        break;
      }
      case 'strum': {
        const gap = Math.round((amount ?? 0.25) * STEP);
        const byStart = new Map();
        for (const n of notes) { if (!byStart.has(n.start)) byStart.set(n.start, []); byStart.get(n.start).push(n); }
        notes = [...byStart.values()].flatMap((group) => group.sort((x, y) => x.key - y.key).map((n, i) => ({ ...n, start: n.start + i * gap, length: Math.max(1, n.length - i * gap) })));
        break;
      }
      default:
    }
    // timing edits stay inside the loop: wrap starts, trim overhangs (a 1-tick overhang would add a silent bar)
    if (['shift', 'quantize', 'humanize', 'legato', 'strum'].includes(action)) {
      notes = notes.map((n) => {
        const start = ((n.start % len) + len) % len;
        return { ...n, start, length: Math.max(1, Math.min(n.length, len - start)) };
      });
    }
    ops.push({ type: 'notes/set', patternId: pt.id, channelId: ch.id, notes });
    await backend.applyOps(p.id, ops);
    const extra = action === 'double' ? ` The pattern is now ${barsOf(p, len * 2)} bars (every channel repeated).` : '';
    return ok(`Applied ${action}${amount !== undefined ? ` (${amount})` : ''} to ${notes.length} notes of "${ch.name}" in "${pt.name}".${extra}`);
  });
}
