// Instruments, channels, sound preview and music theory helpers.
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_CATEGORIES, makeInstrument, describeInstruments, describeEffects, uid, noteName, findChannel, parseNote, SCALES, scaleNotes, chordNotes, diatonicChords, romanToChord, isRomanNumeral, CHORD_TYPES, scaleSpelling, spelledNoteName, sanitizeParams, MAX_NUDGE_MS, sanitizePluginValues, resolvePresetName } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A, uniqueName, assertNameFree, normVelocity } from '../util.js';
import { requirePlugin, pluginValues } from './plugins.js';

export function registerSoundTools({ tool, backend, load }) {
  tool('list_instruments', {
    title: '列出乐器',
    description: '列出全部乐器种类，按分组归好（鼓组、贝斯、键盘、吉他、弦乐、合成器、吹管、人声节奏、印度乐器、中国与东亚民乐、采样器、插件），并给出预设与参数（范围／默认值）。要做具体音色设计时，在 add_channel / update_channel 之前先调它。',
    inputSchema: {
      kind: z.enum(INSTRUMENT_KINDS).optional().describe('只看这一种乐器（列出完整参数）'),
      category: z.enum(INSTRUMENT_CATEGORIES.map(([c]) => c)).optional().describe('只看某一个分组，例如 "中国与东亚民乐"（给了 kind 就忽略它）')
    },
    annotations: A.readOnly
  }, async ({ kind, category }) => {
    // a kind is one instrument whatever its collection: category only narrows the full listing
    if (kind) return ok(`乐器 ${kind}`, describeInstruments().find((i) => i.kind === kind));
    const all = describeInstruments().filter((i) => !category || i.category === category);
    const sections = INSTRUMENT_CATEGORIES
      .map(([cat, label]) => [label, all.filter((i) => i.category === cat)])
      .filter(([, list]) => list.length)
      .map(([label, list]) => `## ${label}\n${list.map((i) => `${i.kind}（${i.label}，${i.melodic ? '旋律' : '打击'}）：预设 ${i.presets.join('、')}。${i.description}`).join('\n')}`);
    return ok(sections.join('\n\n') + '\n\n想看某个乐器的完整参数，用 list_instruments 指定 kind。');
  });

  tool('list_effects', {
    title: '列出效果器',
    description: '列出混音台全部效果器类型及其参数（范围／默认值，哪些能画自动化）。',
    inputSchema: {},
    annotations: A.readOnly
  }, async () => ok('Effects', describeEffects()));

  tool('add_channel', {
    title: '添加通道',
    description: '往通道架里加一条乐器通道。默认会自带一条混音台通道条（名字跟着通道走）。instrument=sampler 时要传 sampleId（见 list_samples）；采样器的根音键默认用采样测出来的音高，除非你自己给 params.rootKey。',
    inputSchema: {
      projectId: projectIdArg,
      name: z.string().min(1).max(64).describe('通道名，例如「底鼓」「808」「键盘」'),
      instrument: z.enum(INSTRUMENT_KINDS).describe('乐器种类'),
      preset: z.string().optional().describe('预设名（见 list_instruments）'),
      params: z.record(z.string(), z.any()).optional().describe('要覆盖的乐器参数，例如 {"decay":0.8}'),
      volume: z.number().min(0).max(1.25).optional().describe('0..1.25，默认 0.78'),
      pan: z.number().min(-1).max(1).optional(),
      pitch: z.number().min(-24).max(24).optional().describe('通道整体移调，单位是半音'),
      chokeGroup: z.number().int().min(0).max(8).optional().describe('同一组（1-8）里的通道会互相掐断（开镲／闭镲就是这么做的）'),
      mixerTrack: z.number().int().min(0).optional().describe('要路由到的混音台通道条；默认找下一个空位'),
      sampleId: z.string().optional().describe('instrument 为「采样器」时用：来自 list_samples 的采样 id'),
      plugin: z.string().optional().describe('instrument 为「插件」时用：插件 id（见 list_plugins）'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    let params = { ...(a.params || {}) };
    let note = '';
    let pluginId = null;
    let rootKey;
    if (a.instrument === 'plugin') {
      const m = await requirePlugin(backend, a.plugin, 'instrument');
      params = pluginValues(m, a.preset, params);
      pluginId = m.id;
      rootKey = m.defaultKey;
      a.preset = a.preset || Object.keys(m.presets)[0]; // the first preset is the plugin's default
      a.color = a.color || m.color;
    } else if (a.plugin) {
      throw new Error('plugin only works with instrument "plugin"');
    }
    if (a.sampleId) {
      if (a.instrument !== 'sampler') throw new Error('sampleId only works with instrument "sampler"');
      const s = await backend.getSample(a.sampleId);
      params.sampleId = s.id;
      const pitch = s.analysis?.pitch;
      if (params.rootKey === undefined && pitch?.midi !== undefined && s.analysis?.kind === 'one-shot') {
        params.rootKey = pitch.midi;
        note = ` Root key set to the detected pitch ${pitch.note}.`;
      }
    }
    if (!pluginId) makeInstrument(a.instrument, a.preset, params, { strict: true }); // validate with helpful errors
    if (a.mixerTrack !== undefined && a.mixerTrack >= p.mixer.length) {
      throw new Error(`混音台通道条 ${a.mixerTrack} 不存在（0..${p.mixer.length - 1}）。先用 set_mixer 建一条，或者不写 mixerTrack，让它自己找空位。`);
    }
    const id = uid('ch');
    const name = uniqueName(p.channels, a.name); // names are how tools find channels: keep them unique
    if (name !== a.name) note += ` 已经有一个叫「${a.name}」的通道，所以这个叫「${name}」。`;
    const after = await backend.applyOps(p.id, [{
      type: 'channel/add',
      nameInsert: true,
      channel: { id, name, kind: a.instrument, preset: a.preset, params, plugin: pluginId, rootKey, volume: a.volume, pan: a.pan, pitch: a.pitch, chokeGroup: a.chokeGroup, mixerTrack: a.mixerTrack ?? 'auto', color: a.color }
    }]);
    const ch = after.channels.find((c) => c.id === id);
    return ok(`已添加通道「${ch.name}」[${ch.id}]（${ch.instrument.kind}${pluginId ? ` ${pluginId}` : ''}/${ch.instrument.preset}）→ 混音台通道条 ${ch.mixerTrack}。步进器音符：${noteName(ch.rootKey)}。${note}`);
  });

  tool('update_channel', {
    title: '修改通道',
    description: '改一条通道：名字、颜色、音量、声像、移调、静音／独奏、路由、掐音组、通道滤波（截止／共振）、律动（提前量、摇摆比例）、步进音符、乐器种类／预设，或某个具体乐器参数。',
    inputSchema: {
      projectId: projectIdArg,
      channel: z.string().describe('通道 id 或名字'),
      name: z.string().min(1).max(64).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      volume: z.number().min(0).max(1.25).optional(),
      pan: z.number().min(-1).max(1).optional(),
      pitch: z.number().min(-24).max(24).optional(),
      mute: z.boolean().optional(),
      solo: z.boolean().optional(),
      mixerTrack: z.number().int().min(0).optional(),
      chokeGroup: z.number().int().min(0).max(8).optional(),
      filterCutoff: z.number().min(20).max(20000).optional().describe('通道低通截止频率，单位 Hz（20000＝全开）'),
      filterRes: z.number().min(0.1).max(20).optional(),
      nudge: z.number().min(-MAX_NUDGE_MS).max(MAX_NUDGE_MS).optional().describe('让这个通道提前（-）或推后（+）多少毫秒：军鼓／拍手 +8..+20 会有慵懒的后拍感，踩镲 -3..-6 会更往前顶'),
      swingMix: z.number().min(0).max(1).optional().describe('这个通道吃到多少工程摇摆量（1＝全吃，0＝不走摇摆），例如踩镲摇摆而底鼓保持方正'),
      stepNote: z.union([z.string(), z.number()]).optional().describe('步进器为这个通道写入的音符'),
      instrument: z.enum(INSTRUMENT_KINDS).optional().describe('换成别的乐器种类（参数会重置）'),
      plugin: z.string().optional().describe('instrument 为「插件」时用：换成这个插件（见 list_plugins）'),
      preset: z.string().optional().describe('载入某个预设（先把参数重置成预设，再套用 params）'),
      params: z.record(z.string(), z.any()).optional().describe('要改的乐器参数，例如 {"cutoff":1200,"release":0.5}')
    },
    annotations: A.edit
  }, async (a) => {
    const p = await load(a.projectId);
    const ch = findChannel(p, a.channel);
    if (a.name) assertNameFree(p.channels, a.name, '通道', ch);
    if (a.mixerTrack !== undefined && a.mixerTrack >= p.mixer.length) throw new Error(`混音台通道条 ${a.mixerTrack} 不存在（0..${p.mixer.length - 1}）；先用 set_mixer 建一条`);
    const patch = {};
    for (const k of ['name', 'color', 'volume', 'pan', 'pitch', 'mute', 'solo', 'mixerTrack', 'chokeGroup', 'filterCutoff', 'filterRes', 'nudge', 'swingMix']) if (a[k] !== undefined) patch[k] = a[k];
    if (a.stepNote !== undefined) patch.rootKey = parseNote(a.stepNote);
    if (a.instrument || a.preset || a.params || a.plugin) {
      const kind = a.instrument || ch.instrument.kind;
      if (kind === 'plugin') {
        const m = await requirePlugin(backend, a.plugin || ch.instrument.plugin, 'instrument');
        const reset = a.preset || a.plugin || a.instrument;
        // strict validation first (clear errors), then the values as the plugin will see them (stepped values rounded)
        const params = reset ? pluginValues(m, a.preset, a.params) : (pluginValues(m, null, a.params), a.params && sanitizePluginValues(m.params, a.params));
        patch.instrument = { kind: 'plugin', plugin: m.id, ...(reset && { preset: a.preset || Object.keys(m.presets)[0] }), ...(params && { params }) };
        // switching to another plugin: its own step note (unless one was given)
        if ((ch.instrument.kind !== 'plugin' || ch.instrument.plugin !== m.id) && patch.rootKey === undefined) patch.rootKey = m.defaultKey;
      } else {
        if (a.plugin) throw new Error('plugin only works with instrument "plugin"');
        if (a.preset && !resolvePresetName(kind, a.preset)) throw new Error(`未知预设「${a.preset}」（乐器 ${kind}）。可用预设：${Object.keys(INSTRUMENTS[kind].presets).join('、')}`);
        if (a.params) sanitizeParams(INSTRUMENTS[kind].params, a.params, { strict: true }); // unknown keys, out-of-range values
        patch.instrument = { ...(a.instrument && { kind: a.instrument }), ...(a.preset && { preset: a.preset }), ...(a.params && { params: a.params }) };
      }
    }
    if (!Object.keys(patch).length) throw new Error('Nothing to change');
    const after = await backend.applyOps(p.id, [{ type: 'channel/update', id: ch.id, patch }]);
    const c = after.channels.find((x) => x.id === ch.id);
    return ok(`Updated "${c.name}": ${c.instrument.kind}/${c.instrument.preset}, vol ${c.volume}, pan ${c.pan}, insert ${c.mixerTrack}${c.nudge ? `, nudge ${c.nudge > 0 ? '+' : ''}${c.nudge} ms` : ''}${c.swingMix !== 1 ? `, swing ×${c.swingMix}` : ''}${c.mute ? ', muted' : ''}${c.solo ? ', solo' : ''}.`);
  });

  tool('remove_channel', {
    title: '删除通道',
    description: '删掉一条通道和它所有的音符。',
    inputSchema: { projectId: projectIdArg, channel: z.string() },
    annotations: A.destructive
  }, async ({ projectId, channel }) => {
    const p = await load(projectId);
    const ch = findChannel(p, channel);
    const triggers = p.mixer.flatMap((m, i) => m.effects.filter((e) => e.params.source === ch.id).map(() => i));
    await backend.applyOps(p.id, [{ type: 'channel/remove', id: ch.id }]);
    return ok(`Removed channel "${ch.name}".${triggers.length ? ` It triggered the sidechain pump on insert ${triggers.join(', ')}: that pump now has no source (set a new one with update_effect, or it pumps on the grid).` : ''}`);
  });

  tool('clone_channel', {
    title: '复制通道',
    description: '复制一条通道（乐器设置一样）——比如叠第二层拍手，或者做一个变体。也可以把各片段里的音符一起复制。',
    inputSchema: {
      projectId: projectIdArg,
      channel: z.string(),
      name: z.string().min(1).max(64).optional(),
      withNotes: z.boolean().optional().describe('把所有片段里的音符也一起复制（默认不复制）'),
      ownInsert: z.boolean().optional().describe('把复制出来的通道接到一条新的空通道条上（默认是）')
    },
    annotations: A.edit
  }, async ({ projectId, channel, name, withNotes = false, ownInsert = true }) => {
    const p = await load(projectId);
    const src = findChannel(p, channel);
    if (name) assertNameFree(p.channels, name, '通道');
    const id = uid('ch');
    const ops = [{
      type: 'channel/add',
      index: p.channels.indexOf(src) + 1,
      nameInsert: ownInsert,
      channel: { ...JSON.parse(JSON.stringify(src)), id, name: name || uniqueName(p.channels, `${src.name} 2`), mixerTrack: ownInsert ? 'auto' : src.mixerTrack }
    }];
    if (withNotes) {
      for (const pt of p.patterns) {
        const list = pt.notes[src.id];
        if (list?.length) ops.push({ type: 'notes/set', patternId: pt.id, channelId: id, notes: list.map((n) => ({ ...n, id: uid('n') })) });
      }
    }
    const after = await backend.applyOps(p.id, ops);
    const c = after.channels.find((x) => x.id === id);
    return ok(`Cloned "${src.name}" as "${c.name}" [${c.id}] → insert ${c.mixerTrack}${withNotes ? ', with notes' : ''}.`);
  });

  tool('move_channel', {
    title: '移动通道',
    description: '调整通道在通道架里的顺序（0＝最上面）。',
    inputSchema: { projectId: projectIdArg, channel: z.string(), position: z.number().int().min(0) },
    annotations: A.edit
  }, async ({ projectId, channel, position }) => {
    const p = await load(projectId);
    const ch = findChannel(p, channel);
    await backend.applyOps(p.id, [{ type: 'channel/move', id: ch.id, index: position }]);
    return ok(`Moved "${ch.name}" to position ${position}.`);
  });

  tool('preview_sound', {
    title: '试听通道音色',
    description: '在用户的浏览器里弹一下这条通道的单音（设计音色时边调边听）。',
    inputSchema: {
      projectId: projectIdArg,
      channel: z.string(),
      note: z.union([z.string(), z.number()]).optional().describe('默认用这条通道的步进音符'),
      velocity: z.number().min(0).max(127).optional().describe('0..1（1＝最响），或 MIDI 的 2..127（默认 0.85）'),
      seconds: z.number().min(0.05).max(8).optional()
    },
    annotations: A.readOnly
  }, async ({ projectId, channel, note, velocity, seconds = 0.6 }) => {
    const p = await load(projectId);
    const ch = findChannel(p, channel);
    const key = note !== undefined ? parseNote(note) : ch.rootKey;
    const v = normVelocity(velocity, 0.85);
    if (v <= 0) throw new Error('Velocity 0 is silent: use 0.05–1 (or MIDI 2–127) to hear the sound');
    const n = await backend.transport(p.id, { action: 'audition', channelId: ch.id, key, velocity: v, duration: seconds });
    return ok(n ? `Played ${noteName(key)} on "${ch.name}" in the browser.` : 'No browser has this project open, so nothing was played.');
  });

  tool('analyze_sound', {
    title: '分析通道音色',
    description: '在用户的浏览器里离线渲染这条通道的一个音并测量它，就像把声音单独送到表上看：测出音高（带音分）、最强的低频（808 或底鼓真正听起来是哪个音）、响度、峰值、频谱、亮度与包络（起音、衰减到 -20/-40/-60 dB 的时间）。用它把 808 和底鼓调到调上、让两者的基频错开、检查尾音有没有拖到下一击，混音前也能拿来比较音色。需要在浏览器里打开本工作室。',
    inputSchema: {
      projectId: projectIdArg,
      channel: z.string(),
      note: z.union([z.string(), z.number()]).optional().describe('默认用这条通道的步进音符（鼓组是 C4）'),
      velocity: z.number().min(0).max(127).optional().describe('0..1 或 MIDI 的 2..127（默认 0.8）'),
      lengthSteps: z.number().min(0.25).max(64).optional().describe('音符长度，单位是步（鼓组默认 1，旋律乐器默认 8）'),
      through: z.enum(['channel', 'insert']).optional().describe('channel＝乐器＋通道条（默认）；insert＝连它所在混音通道条上的效果器一起算'),
      seconds: z.number().min(0.5).max(10).optional().describe('渲染多长时间（默认 3 秒）')
    },
    annotations: A.readOnly
  }, async (a) => {
    const p = await load(a.projectId);
    const ch = findChannel(p, a.channel);
    const key = a.note !== undefined ? parseNote(a.note) : undefined;
    const v = a.velocity === undefined ? undefined : a.velocity > 1 ? a.velocity / 127 : a.velocity;
    const r = await backend.requestJob(
      { kind: 'sound', projectId: p.id, channelId: ch.id, key, velocity: v, lengthSteps: a.lengthSteps, through: a.through, seconds: a.seconds },
      { projectId: p.id, timeoutMs: 60000 }
    );
    return ok(formatSoundReport(r), r);
  });

  tool('music_theory', {
    title: '乐理助手',
    description: '给出音阶与和弦的准确音符、某个调内的自然音级和弦，或把级数进行转成和弦记号（例如 A 小调的「i VI III VII」→ Am F C G）。默认用工程当前的调与音阶。',
    inputSchema: {
      projectId: projectIdArg,
      action: z.enum(['scale', 'chord', 'diatonic_chords', 'progression']),
      key: z.string().optional().describe('主音，例如「A」「F#」（默认用工程调号）'),
      scale: z.enum(Object.keys(SCALES)).optional().describe('默认用工程音阶'),
      chord: z.string().optional().describe('action=chord 时用，例如「Cmaj9」「F#m7b5」'),
      progression: z.string().optional().describe('action=progression 时用：用空格或短横线隔开的级数，例如「i-VI-III-VII」或「I V vi IV」'),
      octave: z.number().int().min(0).max(8).optional(),
      sevenths: z.boolean().optional().describe('diatonic_chords 时用：出七和弦而不是三和弦')
    },
    annotations: A.readOnly
  }, async (a) => {
    let key = a.key;
    let scale = a.scale;
    if (!key || !scale) {
      try {
        const p = await load(a.projectId);
        key = key || p.key || 'C';
        scale = scale || p.scale || 'minor';
      } catch {
        key = key || 'C';
        scale = scale || 'major';
      }
    }
    const octave = a.octave ?? 4;
    const spell = scaleSpelling(key, scale);
    const names = (notes) => notes.map((n) => spelledNoteName(n, spell)).join(' ');
    switch (a.action) {
      case 'scale': {
        const notes = scaleNotes(key, scale, octave, 1);
        return ok(`${key} ${scale}: ${names(notes)} (MIDI ${notes.join(' ')})`);
      }
      case 'chord': {
        if (!a.chord) throw new Error('chord is required');
        const notes = chordNotes(a.chord, octave);
        return ok(`${a.chord}: ${names(notes)} (MIDI ${notes.join(' ')})`);
      }
      case 'diatonic_chords': {
        const list = diatonicChords(key, scale, { sevenths: !!a.sevenths });
        return ok(`Diatonic ${a.sevenths ? 'seventh chords' : 'triads'} of ${key} ${scale}:\n${list.map((c) => `${c.numeral.padEnd(5)} ${c.chord.padEnd(7)} ${c.notes.join(' ')}`).join('\n')}`);
      }
      case 'progression': {
        if (!a.progression) throw new Error('progression is required');
        const tokens = a.progression.split(/[\s,–-]+/).filter(Boolean);
        const chords = tokens.map((t) => {
          if (!isRomanNumeral(t)) throw new Error(`"${t}" is not a roman numeral`);
          return romanToChord(t, key, scale);
        });
        return ok(`${a.progression} in ${key} ${scale} = ${chords.join(' – ')}\nChord qualities you can use: ${Object.keys(CHORD_TYPES).filter(Boolean).join(' ')}`);
      }
      default:
        throw new Error('Unknown action');
    }
  });
}

/** Plain-text report of an analyze_sound job. */
export function formatSoundReport(r) {
  const a = r.analysis || {};
  const e = r.envelope || {};
  const lines = [`SOUND — "${r.channel}" note ${noteName(r.key)} velocity ${Math.round((r.velocity ?? 0.8) * 100) / 100}, ${r.noteSeconds}s note, through the ${r.through}`];
  lines.push(`Level: ${a.lufs} LUFS, peak ${a.peakDb} dBFS${a.truePeakDb !== null && a.truePeakDb !== undefined ? ` (true peak ${a.truePeakDb} dBTP)` : ''}, crest ${a.crestDb} dB`);
  if (a.pitch) lines.push(`Pitch: ${a.pitch.note} (${a.pitch.hz} Hz, ${a.pitch.cents > 0 ? '+' : ''}${a.pitch.cents} cents, confidence ${a.pitch.confidence})`);
  else lines.push('Pitch: no clear single pitch (noisy, chordal or very short)');
  if (a.lowPeakHz) lines.push(`Low end: strongest frequency ${a.lowPeakHz} Hz ≈ ${a.lowPeakNote}`);
  const b = a.bandsPercent || {};
  lines.push(`Spectrum: ${a.brightness}, ${a.tonality} (centroid ${a.centroidHz} Hz); sub ${b.sub}% · low ${b.low}% · low-mid ${b.lowMid}% · mid ${b.mid}% · high-mid ${b.highMid}% · high ${b.high}%`);
  const t = (x) => (x === null || x === undefined ? 'longer than the render' : `${x} ms`);
  lines.push(`Envelope: attack ${t(e.attackMs)}, -20 dB after ${t(e.decay20Ms)}, -40 dB after ${t(e.decay40Ms)}, -60 dB after ${t(e.decay60Ms)}`);
  if (a.character) lines.push(`Sounds like: ${a.character}`);
  return lines.join('\n');
}
