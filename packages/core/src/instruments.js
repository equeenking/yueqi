import { validPluginId, sanitizeStoredPluginParams } from './plugins.js';

// Instrument catalog. Every channel in the Channel Rack has an instrument:
//   { kind: 'kick' | 'synth' | ..., preset: '有力', params: {...} }
// Param definitions drive both the UI (knobs) and MCP validation.

const n = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'number', min, max, default: def, ...extra });
const sel = (key, label, options, def, extra = {}) => ({ key, label, type: 'select', options, default: def, ...extra });
const bool = (key, label, def, extra = {}) => ({ key, label, type: 'bool', default: def, ...extra });

const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const WAVES_OFF = ['off', ...WAVES, 'noise'];

const ampEnv = (a = 0.005, d = 0.3, s = 0.7, r = 0.2) => [
  n('attack', '起音', 0.001, 4, a, { curve: 'log', unit: 's', group: '音量包络' }),
  n('decay', '衰减', 0.01, 6, d, { curve: 'log', unit: 's', group: '音量包络' }),
  n('sustain', '保持', 0, 1, s, { group: '音量包络' }),
  n('release', '释音', 0.005, 8, r, { curve: 'log', unit: 's', group: '音量包络' })
];

const osc = (i, wave, level, oct = 0, semi = 0, fine = 0) => [
  sel(`osc${i}Wave`, '波形', WAVES_OFF, wave, { group: `振荡器 ${i}` }),
  n(`osc${i}Level`, '音量', 0, 1, level, { group: `振荡器 ${i}` }),
  n(`osc${i}Oct`, '八度', -3, 3, oct, { step: 1, group: `振荡器 ${i}` }),
  n(`osc${i}Semi`, '半音', -12, 12, semi, { step: 1, group: `振荡器 ${i}` }),
  n(`osc${i}Fine`, '微调', -100, 100, fine, { step: 1, unit: '音分', group: `振荡器 ${i}` })
];

// Browser sections / add-channel menu, in display order: [category, label]
// section order = how often a primary-school music class reaches for them:
// folk instruments and classroom staples first, electronic/Niche collections last
export const INSTRUMENT_CATEGORIES = [
  ['eastasian', '中国与东亚民乐'], ['keys', '键盘'], ['flutes', '吹管'], ['guitar', '吉他'],
  ['orchestra', '西洋管弦'], ['drums', '鼓组'], ['strings', '弦乐'], ['bass', '贝斯'], ['synth', '合成器'],
  ['beatbox', '人声节奏'], ['indian', '印度乐器'], ['sampler', '采样器'],
  ['plugins', '插件']
];

const SA_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Mono/glide pair: overlapping notes slide (meend, slurs, bends). */
const legato = (mono, glide, max = 0.5) => [
  bool('mono', '单音', mono, { group: '声部' }),
  n('glide', '滑音', 0, max, glide, { unit: 's', group: '声部' })
];

/** Vibrato depth/rate (delayed: it fades in after the attack, like a player's). */
const vibratoParams = (depth, rate) => [
  n('vibrato', '深度', 0, 1, depth, { group: '颤音' }),
  n('vibratoRate', '速率', 3, 8, rate, { unit: 'Hz', group: '颤音' })
];

/**
 * The breath engine shared by every flute (concert, pan, recorder, whistle, ocarina, bansuri, shakuhachi, dizi):
 * the kind picks the instrument's harmonic recipe; these params shape the playing.
 */
const windParams = (d = {}) => [
  n('tone', '音色', 0, 1, d.tone ?? 0.45, { group: '音色' }),
  n('breath', '气声', 0, 1, d.breath ?? 0.3, { group: '音色' }),
  n('chiff', '气口', 0, 1, d.chiff ?? 0.4, { group: '音色' }),
  ...(d.buzz !== undefined ? [n('buzz', '笛膜', 0, 1, d.buzz, { group: '音色' })] : []),
  ...vibratoParams(d.vibrato ?? 0.3, d.vibratoRate ?? 5),
  n('attack', '起音', 0.005, 2, d.attack ?? 0.04, { unit: 's', curve: 'log', group: '声部' }),
  n('release', '释音', 0.02, 3, d.release ?? 0.15, { unit: 's', curve: 'log', group: '声部' }),
  ...legato(d.mono ?? false, d.glide ?? 0.08),
  n('gain', '增益', 0, 2, d.gain ?? 0.7, { group: '声部' })
];
const WIND_HELP = '力度越大、音色越亮越容易过吹；气声＝气噪，气口＝吐音起音；颤音在起音后渐入。';

/** Double reeds (shehnai, suona). */
const reedParams = (d = {}) => [
  n('tone', '音色', 0, 1, d.tone ?? 0.6, { group: '音色' }),
  n('nasal', '鼻音', 0, 1, d.nasal ?? 0.6, { group: '音色' }),
  n('breath', '气声', 0, 1, d.breath ?? 0.15, { group: '音色' }),
  ...vibratoParams(d.vibrato ?? 0.35, d.vibratoRate ?? 5.5),
  n('attack', '起音', 0.005, 2, d.attack ?? 0.03, { unit: 's', curve: 'log', group: '声部' }),
  n('release', '释音', 0.02, 3, d.release ?? 0.12, { unit: 's', curve: 'log', group: '声部' }),
  ...legato(d.mono ?? true, d.glide ?? 0.08),
  n('gain', '增益', 0, 2, d.gain ?? 0.6, { group: '声部' })
];

/** Physical-model plucked strings of the world collections (rendered per note like the guitar). */
const pluckParams = (d = {}) => [
  n('brightness', '明亮度', 0, 1, d.brightness ?? 0.65, { group: '音色' }),
  n('sustain', '保持', d.sustainMin ?? 0.3, d.sustainMax ?? 8, d.sustain ?? 2, { unit: 's', curve: 'log', group: '音色' }),
  ...(d.position !== undefined ? [n('position', '拨弦点', 0.05, 0.4, d.position, { group: '音色' })] : []),
  n('release', '释音', 0.02, 4, d.release ?? 0.2, { unit: 's', curve: 'log', group: '声部' }),
  ...(d.mono !== undefined ? legato(d.mono, d.glide ?? 0.12) : []),
  n('gain', '增益', 0, 2, d.gain ?? 0.8, { group: '声部' })
];

export const INSTRUMENTS = {
  kick: {
    label: '底鼓', category: 'drums', melodic: false, defaultKey: 60, gm: 36, color: '#e8665a',
    description: '合成的底鼓：正弦波配音高下扫做出「咚」的闷响，另加一层敲击声给出发音点，过载让它在小音箱上也听得见。音高＝鼓皮松紧，扫频起点与时间＝鼓槌压下去的力度感。',
    params: [
      n('tune', '音高', 30, 150, 50, { unit: 'Hz', curve: 'log' }),
      n('sweep', '扫频起点', 80, 800, 230, { unit: 'Hz', curve: 'log' }),
      n('sweepTime', '扫频时间', 0.005, 0.3, 0.05, { unit: 's', curve: 'log' }),
      n('decay', '衰减', 0.05, 2.5, 0.5, { unit: 's', curve: 'log' }),
      n('click', '敲击', 0, 1, 0.35),
      n('drive', '过载', 0, 1, 0.15)
    ],
    presets: {
      劲道: {},
      厚重: { tune: 42, sweep: 160, decay: 0.9, click: 0.15, drive: 0.1 },
      硬朗: { tune: 55, sweep: 400, sweepTime: 0.03, decay: 0.35, click: 0.7, drive: 0.55 },
      浩室重击: { tune: 50, sweep: 200, sweepTime: 0.06, decay: 0.45, click: 0.3, drive: 0.25 },
      低保真: { tune: 48, sweep: 140, decay: 0.3, click: 0.05, drive: 0.4 },
      // short (gone before the 808 sustains) and low (~45 Hz), clear of 808 lines around 50–80 Hz
      陷阱: { tune: 45, sweep: 300, sweepTime: 0.025, decay: 0.28, click: 0.55, drive: 0.35 }
    }
  },
  snare: {
    label: '军鼓', category: 'drums', melodic: false, defaultKey: 60, gm: 38, color: '#f2a03d',
    description: '合成的军鼓：一层定音的腔体共鸣（音高＝鼓皮松紧、衰减＝余响长短），加一层滤波噪声做响弦的沙沙声。响弦＝噪声比例与亮度，弹性＝噪声衰减，让它在密集节奏里仍能站住。',
    params: [
      n('tone', '琴体音高', 100, 400, 185, { unit: 'Hz', curve: 'log' }),
      n('toneDecay', '琴体衰减', 0.02, 0.6, 0.1, { unit: 's', curve: 'log' }),
      n('noiseDecay', '噪声衰减', 0.03, 1, 0.18, { unit: 's', curve: 'log' }),
      n('snappy', '响弦', 0, 1, 0.7),
      n('color', '噪声色彩', 800, 12000, 4500, { unit: 'Hz', curve: 'log' })
    ],
    presets: {
      紧实: {},
      肥厚: { tone: 160, toneDecay: 0.18, noiseDecay: 0.28, snappy: 0.6, color: 3500 },
      陷阱: { tone: 210, toneDecay: 0.08, noiseDecay: 0.22, snappy: 0.85, color: 6000 },
      边击感: { tone: 330, toneDecay: 0.05, noiseDecay: 0.09, snappy: 0.5, color: 7000 }
    }
  },
  clap: {
    label: '拍手', category: 'drums', melodic: false, defaultKey: 60, gm: 39, color: '#f5d547',
    description: '多层噪声爆发模拟一群人拍手：几层错开几毫秒的短噪声叠在一起，听感才像「一群人」而不是一个人。层数＝人数感，扩散＝错开的宽度，衰减＝拍完的余音。',
    params: [
      n('decay', '衰减', 0.05, 1.2, 0.22, { unit: 's', curve: 'log' }),
      n('color', '音色', 400, 6000, 1200, { unit: 'Hz', curve: 'log' }),
      n('spread', '展开', 0.004, 0.03, 0.011, { unit: 's' }),
      n('room', '房间', 0, 1, 0.3)
    ],
    presets: { 经典: {}, 紧实: { decay: 0.12, spread: 0.007, room: 0.1 }, 宏大: { decay: 0.45, color: 1000, spread: 0.016, room: 0.7 } }
  },
  hat: {
    label: '踩镲', category: 'drums', melodic: false, defaultKey: 60, gm: 42, color: '#8bd65b',
    description: '808 风格金属踩镲：一组不谐和的方波经高通滤波，做出金属的「嚓」。色度＝滤波截止（越小越闷），衰减短为闭镲、长为开镲；开镲与闭镲请放在同一互斥组，敲开镲时闭镲会自动收声。',
    params: [
      n('decay', '衰减', 0.01, 2, 0.06, { unit: 's', curve: 'log' }),
      n('color', '音色', 3000, 15000, 9000, { unit: 'Hz', curve: 'log' }),
      n('metallic', '金属感', 0, 1, 0.7)
    ],
    presets: { 闭镲: {}, 开镲: { decay: 0.45 }, 踏板: { decay: 0.03, color: 6500 }, 清脆: { decay: 0.04, color: 12000, metallic: 0.4 } }
  },
  tom: {
    label: '通鼓', category: 'drums', melodic: false, defaultKey: 60, gm: 45, color: '#46c79a',
    params: [
      n('pitch', '音高', 50, 400, 110, { unit: 'Hz', curve: 'log' }),
      n('sweep', '扫频', 0, 1, 0.4),
      n('decay', '衰减', 0.05, 1.5, 0.35, { unit: 's', curve: 'log' })
    ],
    presets: { 中位: {}, 低: { pitch: 80, decay: 0.5 }, 高: { pitch: 170, decay: 0.25 } }
  },
  rim: {
    label: '边击', category: 'drums', melodic: false, defaultKey: 60, gm: 37, color: '#3fb5d6',
    params: [
      n('pitch', '音高', 300, 2000, 800, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.01, 0.2, 0.04, { unit: 's', curve: 'log' })
    ],
    presets: { 经典: {} }
  },
  cowbell: {
    label: '牛铃', category: 'drums', melodic: false, defaultKey: 60, gm: 56, color: '#5a8ef0',
    params: [
      n('pitch', '音高', 300, 1200, 560, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.05, 1, 0.25, { unit: 's', curve: 'log' })
    ],
    presets: { 808: {} }
  },
  cymbal: {
    label: '吊镲', category: 'drums', melodic: false, defaultKey: 60, gm: 49, color: '#8f6cf0',
    params: [
      n('decay', '衰减', 0.3, 5, 1.8, { unit: 's', curve: 'log' }),
      n('color', '音色', 3000, 14000, 7000, { unit: 'Hz', curve: 'log' })
    ],
    presets: { 强击: {}, 叮叮镲: { decay: 2.5, color: 10000 }, 水镲: { decay: 0.6, color: 9000 } }
  },
  shaker: {
    label: '沙锤', category: 'drums', melodic: false, defaultKey: 60, gm: 70, color: '#c86be0',
    params: [
      n('decay', '衰减', 0.02, 0.4, 0.07, { unit: 's', curve: 'log' }),
      n('color', '音色', 2000, 14000, 7000, { unit: 'Hz', curve: 'log' })
    ],
    presets: { 经典: {}, 柔和: { decay: 0.12, color: 4500 } }
  },
  perc: {
    label: '打击乐', category: 'drums', melodic: false, defaultKey: 60, gm: 64, color: '#e664a7',
    description: '有音高的打击点缀：康加鼓、邦戈鼓、木鱼或电击音一类，会跟着弹的音高走，所以可以当旋律打击乐用。音高＝鼓皮大小，衰减＝手掌压弦的时间，音色＝敲击位置（边圈亮、中心闷）。',
    params: [
      sel('wave', '波形', WAVES, 'sine'),
      n('pitch', '音高', 100, 2000, 400, { unit: 'Hz', curve: 'log' }),
      n('sweep', '扫频', 0, 1, 0.3),
      n('decay', '衰减', 0.02, 1, 0.12, { unit: 's', curve: 'log' }),
      n('noise', '噪声', 0, 1, 0.1)
    ],
    presets: { 康加鼓: {}, 邦戈鼓: { pitch: 620, decay: 0.08 }, 电击: { wave: 'square', pitch: 1500, sweep: 1, decay: 0.15, noise: 0 }, 木鱼: { wave: 'triangle', pitch: 1100, decay: 0.05, sweep: 0.1 } }
  },
  triangle: {
    label: '三角铁', category: 'drums', melodic: false, defaultKey: 60, gm: 81, color: '#9aa7b8',
    description: '奥尔夫课堂三角铁：金属「叮——」的长余响，给歌曲和律动点缀重音。大小＝铁条粗细（越小越亮），余响＝尾音长短，敲击＝击棒落下的脆度。',
    params: [
      n('tone', '大小', 1500, 9000, 4200, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '余响', 0.5, 6, 2.8, { unit: 's', curve: 'log', group: '音色' }),
      n('strike', '敲击', 0, 1, 0.5, { group: '音色' })
    ],
    presets: { 高音: {}, 低音大: { tone: 2200, decay: 4.2 }, 点缀: { decay: 1.2, strike: 0.7 } }
  },
  bells: {
    label: '碰铃', category: 'drums', melodic: false, defaultKey: 60, gm: 84, color: '#c8b6d8',
    description: '碰铃（对铃）：两只小铜铃相互一碰，「叮」的一声清亮圆润，是中国课堂里数拍子、提示呼吸的常用信号音。铃音＝铃的大小，余响＝尾音。',
    params: [
      n('tone', '铃音', 1200, 4000, 2100, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '余响', 0.3, 4, 1.8, { unit: 's', curve: 'log', group: '音色' })
    ],
    presets: { 碰铃: {}, 小铃: { tone: 2800, decay: 1.2 }, 佛寺引磬: { tone: 3400, decay: 2.6 } }
  },
  tambourine: {
    label: '铃鼓', category: 'drums', melodic: false, defaultKey: 60, gm: 54, color: '#d8a45e',
    description: '铃鼓：一圈小铃片沙沙作响，鼓皮一拍「咚」地点睛。铃片＝铃声比例，鼓皮＝皮面比例，亮度＝铃片音色，衰减＝铃声尾音。摇奏可用长音符＋多次触发。',
    params: [
      n('jingles', '铃片', 0, 1, 0.8, { group: '音色' }),
      n('skin', '鼓皮', 0, 1, 0.25, { group: '音色' }),
      n('color', '亮度', 3000, 12000, 7000, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '衰减', 0.1, 1.5, 0.5, { unit: 's', curve: 'log', group: '音色' })
    ],
    presets: { 铃鼓: {}, 摇奏: { jingles: 1, skin: 0, decay: 0.8 }, 皮面拍: { jingles: 0.35, skin: 0.8, decay: 0.25 } }
  },
  castanets: {
    label: '响板', category: 'drums', melodic: false, defaultKey: 60, gm: 70, color: '#a8683f',
    description: '响板（西班牙击木）：两片硬木啪嗒一合，节奏密集时像马蹄声。木色＝木片厚薄，脆度＝合击的锐利，衰减＝余音（正常很短）。',
    params: [
      n('tone', '木色', 800, 3000, 1600, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '衰减', 0.02, 0.5, 0.09, { unit: 's', curve: 'log', group: '音色' }),
      n('click', '脆度', 0, 1, 0.6, { group: '音色' })
    ],
    presets: { 响板: {}, 马蹄: { decay: 0.05, click: 0.8 }, 木鱼感: { tone: 1100, click: 0.3 } }
  },
  twotone: {
    label: '双响筒', category: 'drums', melodic: true, defaultKey: 60, gm: 77, color: '#8f7a4e',
    description: '双响筒：竹筒两面高低两种音色——弹高音（C4 以上）是一头「嗒」，低音（低音区）是另一头「咚」，一高一低是它的经典玩法（「嗒-咚-嗒-咚」）。',
    params: [
      n('tone', '筒音', 600, 2400, 1150, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '衰减', 0.02, 0.4, 0.08, { unit: 's', curve: 'log', group: '音色' }),
      n('click', '脆度', 0, 1, 0.5, { group: '音色' })
    ],
    presets: { 双响筒: {}, 竹筒: { tone: 900, decay: 0.12 }, 紧凑: { decay: 0.045, click: 0.7 } }
  },
  sleighbells: {
    label: '串铃', category: 'drums', melodic: false, defaultKey: 60, gm: 83, color: '#b8c4d8',
    description: '串铃（手摇铃）：一串小铃片随摇动哗哗作响。摇动＝晃动的快慢，亮度＝铃片音色，余响＝收尾的长度。冬天、圣诞、雪橇场景必备。',
    params: [
      n('color', '亮度', 4000, 12000, 7000, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('shake', '摇动', 0.08, 0.5, 0.18, { unit: 's', group: '音色' }),
      n('decay', '余响', 0.1, 1, 0.45, { unit: 's', curve: 'log', group: '音色' })
    ],
    presets: { 串铃: {}, 雪橇: { shake: 0.24, decay: 0.6 }, 轻摇: { shake: 0.12, decay: 0.25 } }
  },
  claves: {
    label: '响棒', category: 'drums', melodic: false, defaultKey: 60, gm: 75, color: '#c49a5e',
    description: '响棒（claves）：两根硬木互击，发出「哒」的穿透声，是节奏训练里数 clave 与复合节奏的标准音色。筒音＝木棒密度，衰减＝余音。',
    params: [
      n('tone', '筒音', 600, 3000, 2300, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('decay', '衰减', 0.02, 0.4, 0.1, { unit: 's', curve: 'log', group: '音色' })
    ],
    presets: { 响棒: {}, 低音棒: { tone: 1500, decay: 0.14 }, 清脆: { tone: 2600, decay: 0.06 } }
  },
  guiro: {
    label: '蛙鸣筒', category: 'drums', melodic: false, defaultKey: 60, gm: 74, color: '#7d9a5e',
    description: '蛙鸣筒（刮瓜）：木棒沿齿纹刮出「呱呱」的连串声，长刮像蛙鸣、短刮数节奏。刮奏＝刮过的长度，齿距＝齿纹疏密，音色＝共鸣腔。',
    params: [
      n('tone', '音色', 1500, 6000, 3200, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('sweep', '刮奏', 0.1, 1, 0.35, { unit: 's', group: '音色' }),
      n('tooth', '齿距', 0.008, 0.05, 0.018, { unit: 's', group: '音色' })
    ],
    presets: { 蛙鸣筒: {}, 长刮蛙鸣: { sweep: 0.7, tooth: 0.022 }, 短刮: { sweep: 0.16, tooth: 0.014 } }
  },
  bass808: {
    label: '808 贝斯', category: 'bass', melodic: true, defaultKey: 36, color: '#d98c5f',
    description: '长音正弦 808 贝斯：正弦波做基音，起音时音高从高处「砸」下来，配过载与滑音。单音模式：重叠的音符会顺滑地滑过去，适合说唱里的连音低音线。衰减＝延音长度，冲击＝下坠幅度。',
    params: [
      n('decay', '衰减', 0.1, 4, 1.1, { unit: 's', curve: 'log' }),
      n('punch', '冲击', 0, 24, 7, { unit: 'st' }),
      n('punchTime', '冲击时间', 0.005, 2, 0.03, { unit: 's', curve: 'log' }),
      n('drive', '过载', 0, 1, 0.3),
      n('click', '敲击', 0, 1, 0.15),
      n('tone', '音色', 200, 8000, 2500, { unit: 'Hz', curve: 'log' }),
      n('glide', '滑音', 0, 0.4, 0.06, { unit: 's' }),
      bool('mono', '单音', true)
    ],
    presets: {
      经典: {},
      失真: { drive: 0.8, tone: 4000, decay: 1.4 },
      干净: { drive: 0.05, click: 0.05, punch: 3 },
      长: { decay: 2.6, glide: 0.1 },
      短: { decay: 0.35, punch: 10 },
      超低下坠: { punch: 24, punchTime: 1.4, decay: 3, drive: 0.2, click: 0, tone: 1200, mono: false }
    }
  },
  synth: {
    label: '减法合成器', category: 'synth', melodic: true, defaultKey: 60, color: '#3fb5d6',
    description: '减法合成器：3 个可叠加的振荡器（波形、八度、半音、微调各自可调），齐奏做出厚度，再经一个带包络的共振滤波器把高频削掉——这就是「减法」。低频振荡器可扫音高、滤波或音量；单音模式下重叠的音符会滑音。',
    params: [
      ...osc(1, 'sawtooth', 0.8),
      ...osc(2, 'sawtooth', 0.6, 0, 0, 8),
      ...osc(3, 'off', 0.5, -1),
      n('unison', '声部', 1, 7, 1, { step: 1, group: '齐奏' }),
      n('unisonDetune', '失谐', 0, 100, 18, { unit: 'ct', group: '齐奏' }),
      n('unisonSpread', '立体声', 0, 1, 0.6, { group: '齐奏' }),
      sel('filterType', '类型', ['lowpass', 'highpass', 'bandpass'], 'lowpass', { group: '滤波器' }),
      n('cutoff', '截止频率', 20, 20000, 4500, { unit: 'Hz', curve: 'log', group: '滤波器' }),
      n('resonance', '共振', 0.1, 20, 1, { curve: 'log', group: '滤波器' }),
      n('filterEnv', '包络量', -1, 1, 0.25, { group: '滤波器' }),
      n('keyTrack', '键位跟随', 0, 1, 0.3, { group: '滤波器' }),
      n('fAttack', '起音', 0.001, 4, 0.005, { curve: 'log', unit: 's', group: '滤波包络' }),
      n('fDecay', '衰减', 0.01, 6, 0.3, { curve: 'log', unit: 's', group: '滤波包络' }),
      n('fSustain', '保持', 0, 1, 0.3, { group: '滤波包络' }),
      n('fRelease', '释音', 0.005, 8, 0.3, { curve: 'log', unit: 's', group: '滤波包络' }),
      ...ampEnv(0.005, 0.3, 0.75, 0.2),
      n('lfoRate', '速率', 0.05, 20, 5, { unit: 'Hz', curve: 'log', group: '低频振荡' }),
      n('lfoDepth', '深度', 0, 1, 0, { group: '低频振荡' }),
      sel('lfoTarget', '目标', ['pitch', 'filter', 'amp'], 'pitch', { group: '低频振荡' }),
      bool('mono', '单音', false, { group: '声部' }),
      n('glide', '滑音', 0, 1, 0, { unit: 's', group: '声部' }),
      n('gain', '增益', 0, 2, 0.6, { group: '声部' })
    ],
    presets: {
      锯齿主音: {},
      超级锯齿: { osc2Wave: 'off', unison: 7, unisonDetune: 28, cutoff: 9000, filterEnv: 0.1, attack: 0.01, release: 0.35, gain: 0.45 },
      方波主音: { osc1Wave: 'square', osc2Wave: 'square', osc2Fine: -7, osc2Oct: 1, osc2Level: 0.3, cutoff: 3200, resonance: 2, release: 0.15 },
      柔和铺底: { osc1Wave: 'sawtooth', osc2Wave: 'triangle', osc2Oct: 1, unison: 3, unisonDetune: 14, cutoff: 1600, filterEnv: 0.15, fAttack: 0.8, attack: 0.7, decay: 1.5, sustain: 0.8, release: 1.6, lfoTarget: 'filter', lfoRate: 0.3, lfoDepth: 0.25, gain: 0.45 },
      拨奏: { osc1Wave: 'sawtooth', osc2Wave: 'square', osc2Oct: 1, osc2Level: 0.25, cutoff: 500, resonance: 2.5, filterEnv: 0.75, fDecay: 0.18, fSustain: 0, attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
      超低音: { osc1Wave: 'sine', osc1Level: 1, osc2Wave: 'triangle', osc2Level: 0.15, cutoff: 600, filterEnv: 0, attack: 0.004, decay: 0.2, sustain: 1, release: 0.1, mono: true, glide: 0.03, gain: 0.8 },
      里斯贝斯: { osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Fine: 14, osc1Fine: -14, unison: 2, unisonDetune: 20, cutoff: 900, resonance: 2, filterEnv: 0.1, lfoTarget: 'filter', lfoRate: 0.5, lfoDepth: 0.3, mono: true, glide: 0.05, release: 0.15 },
      酸性贝斯: { osc1Wave: 'sawtooth', osc2Wave: 'off', cutoff: 380, resonance: 14, filterEnv: 0.8, fDecay: 0.2, fSustain: 0.05, decay: 0.2, sustain: 0.6, release: 0.08, mono: true, glide: 0.06 },
      和弦断奏: { osc1Wave: 'sawtooth', osc2Wave: 'square', osc2Level: 0.3, unison: 3, unisonDetune: 16, cutoff: 2800, filterEnv: 0.4, fDecay: 0.15, fSustain: 0.1, decay: 0.25, sustain: 0.1, release: 0.18 },
      铜管: { osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Fine: 6, cutoff: 900, filterEnv: 0.55, fAttack: 0.08, fDecay: 0.6, fSustain: 0.5, attack: 0.04, sustain: 0.85, release: 0.25 },
      风琴: { osc1Wave: 'sine', osc1Level: 0.8, osc2Wave: 'sine', osc2Oct: 1, osc2Level: 0.5, osc3Wave: 'sine', osc3Oct: 1, osc3Semi: 7, osc3Level: 0.3, cutoff: 8000, filterEnv: 0, attack: 0.005, sustain: 1, release: 0.06, lfoTarget: 'amp', lfoRate: 6, lfoDepth: 0.1 },
      琶音点奏: { osc1Wave: 'square', osc2Wave: 'off', cutoff: 3500, filterEnv: 0.3, fDecay: 0.08, fSustain: 0, decay: 0.12, sustain: 0, release: 0.05 },
      温暖键盘: { osc1Wave: 'triangle', osc2Wave: 'sawtooth', osc2Level: 0.25, cutoff: 1800, filterEnv: 0.35, fDecay: 0.5, fSustain: 0.2, attack: 0.004, decay: 1.2, sustain: 0.35, release: 0.4 },
      低保真键盘: { osc1Wave: 'triangle', osc2Wave: 'sine', osc2Oct: 1, osc2Level: 0.35, cutoff: 1400, keyTrack: 0.5, filterEnv: 0.3, fDecay: 0.6, fSustain: 0.15, attack: 0.006, decay: 1.6, sustain: 0.25, release: 0.5, lfoTarget: 'pitch', lfoRate: 0.7, lfoDepth: 0.12, gain: 0.55 },
      弦乐: { osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Fine: -9, osc2Level: 0.7, unison: 5, unisonDetune: 12, unisonSpread: 0.8, cutoff: 2600, keyTrack: 0.4, filterEnv: 0.1, fAttack: 0.4, attack: 0.35, decay: 1, sustain: 0.9, release: 0.9, lfoTarget: 'pitch', lfoRate: 5.2, lfoDepth: 0.06, gain: 0.4 },
      // an open filter: risers are swept with the channel filter (automation), which needs the full spectrum
      上扬噪声: { osc1Wave: 'noise', osc1Level: 1, osc2Wave: 'sawtooth', osc2Level: 0.15, unison: 3, unisonDetune: 25, filterType: 'lowpass', cutoff: 14000, resonance: 1.5, keyTrack: 0, filterEnv: 0, attack: 0.05, decay: 1, sustain: 1, release: 0.4, gain: 0.45 },
      反向渐强: { osc1Wave: 'noise', osc1Level: 0.8, osc2Wave: 'sawtooth', osc2Level: 0.2, unison: 3, filterType: 'highpass', cutoff: 1200, keyTrack: 0, filterEnv: 0, attack: 1.5, decay: 0.1, sustain: 1, release: 0.03, gain: 0.45 }
    }
  },
  fm: {
    label: 'FM 合成器', category: 'synth', melodic: true, defaultKey: 60, color: '#8f6cf0',
    description: '双算子 FM 合成器：一个正弦波调制另一个正弦波，调制量随时间下降，就得到电钢、铃、琴棒、金属贝斯这一族音色。调制量＝明亮与金属感，调制衰减＝起音那一下的「叮」，比率＝泛音是否谐和。',
    params: [
      sel('carrierWave', '载波', WAVES, 'sine', { group: '算子' }),
      n('ratio', '调制比', 0.25, 16, 2, { step: 0.25, group: '算子' }),
      n('index', '调制指数', 0, 30, 4, { group: '算子' }),
      n('indexDecay', '调制衰减', 0.01, 4, 0.6, { unit: 's', curve: 'log', group: '算子' }),
      n('indexSustain', '调制保持', 0, 1, 0.2, { group: '算子' }),
      n('detune', '失谐', -50, 50, 0, { unit: 'ct', group: '算子' }),
      ...ampEnv(0.003, 1, 0.3, 0.4),
      n('gain', '增益', 0, 2, 0.6, { group: '声部' })
    ],
    presets: {
      电钢琴: { ratio: 1, index: 2.5, indexDecay: 1.2, indexSustain: 0.15, decay: 1.6, sustain: 0.3, release: 0.5 },
      铃音: { ratio: 3.5, index: 6, indexDecay: 2, indexSustain: 0.1, decay: 3, sustain: 0, release: 2 },
      'FM 贝斯': { ratio: 1, index: 4, indexDecay: 0.15, indexSustain: 0.2, decay: 0.3, sustain: 0.7, release: 0.1, gain: 0.7 },
      琴棒: { ratio: 4, index: 3, indexDecay: 0.08, indexSustain: 0, decay: 0.4, sustain: 0, release: 0.3 },
      玻璃感: { carrierWave: 'sine', ratio: 7, index: 2, indexDecay: 0.6, indexSustain: 0.3, attack: 0.01, decay: 2, sustain: 0.2, release: 1.5 },
      毡槌钢琴: { ratio: 1, index: 1.8, indexDecay: 0.4, indexSustain: 0.05, detune: -4, attack: 0.002, decay: 2.5, sustain: 0, release: 0.6, gain: 0.7 }
    }
  },
  // ---------------------------------------------------------------- band instruments (GarageBand-style)
  // piano, guitar, bass and pizzicato are physical models rendered per note (client/src/audio/models.js);
  // epiano, organ and legato/staccato strings are oscillator engines.
  piano: {
    label: '三角钢琴', category: 'keys', melodic: true, defaultKey: 60, color: '#e4d9b8',
    description: '建模声学钢琴：非谐和琴弦、琴槌硬度随力度变化、两段式衰减与齐奏拍频。音一直响到结束（长音＝踩踏板）；G6 以上没有制音器。立体声把低音偏左、高音偏右。',
    params: [
      n('brightness', '明亮度', 0, 1, 0.55, { group: '音色' }),
      n('hardness', '琴槌', 0, 1, 0.5, { group: '音色' }),
      n('decay', '衰减', 1, 20, 12, { unit: 's', curve: 'log', group: '音色' }),
      n('detune', '齐奏失谐', 0, 10, 1.2, { unit: 'ct', group: '音色' }),
      n('release', '制音', 0.02, 2, 0.25, { unit: 's', curve: 'log', group: '声部' }),
      n('stereo', '立体声', 0, 1, 0.5, { group: '声部' }),
      n('gain', '增益', 0, 2, 0.8, { group: '声部' })
    ],
    presets: {
      三角钢琴: {},
      明亮: { brightness: 0.8, hardness: 0.75 },
      立式钢琴: { brightness: 0.45, decay: 7, detune: 2.5, stereo: 0.25 },
      毡音: { brightness: 0.2, hardness: 0.15, decay: 8, release: 0.4 },
      酒吧钢琴: { brightness: 0.7, decay: 8, detune: 10, stereo: 0.3 }
    }
  },
  melodica: {
    label: '口风琴', category: 'keys', melodic: true, defaultKey: 60, color: '#4e7da8',
    description: '口风琴（键盘吹奏类）：像吹口琴一样吹、像弹琴一样按，人音版三年级「演奏」模块的课堂乐器。音色＝簧片亮暗，气声＝吹气噪声，气口＝吐音起音；键盘乐器，可同时按多个音。',
    params: windParams({ tone: 0.5, breath: 0.25, chiff: 0.35, vibrato: 0.2, vibratoRate: 5, attack: 0.05, release: 0.12, mono: false, gain: 0.75 }),
    presets: {
      口风琴: {},
      簧片亮: { tone: 0.78, breath: 0.15 },
      柔吹: { tone: 0.3, breath: 0.45, attack: 0.1, release: 0.25 }
    }
  },
  glockenspiel: {
    label: '铝板琴', category: 'keys', melodic: true, defaultKey: 72, gm: 9, color: '#7fa8b8',
    description: '铝板琴（音条琴）：敲铝片发出来清亮的固定音高，是课堂音阶教学、音名听辨的首选——C 大调音阶一条板一块板。衰减＝余音长短，琴槌＝槌的软硬。',
    params: [
      n('decay', '衰减', 0.3, 6, 2.5, { unit: 's', curve: 'log', group: '音色' }),
      n('hammer', '琴槌', 0, 1, 0.35, { group: '音色' }),
      n('release', '释音', 0.05, 3, 0.6, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: {
      铝板琴: {},
      音阶教学: { decay: 3.5, hammer: 0.2 },
      清脆: { decay: 1.2, hammer: 0.6 }
    }
  },
  epiano: {
    label: '电钢琴', category: 'keys', melodic: true, defaultKey: 60, color: '#d9a35f',
    description: '音叉式（电钢琴味）或簧片式（簧片琴味）的电钢琴：重音带咆哮，起音有一记铃响；音叉用电声震音、簧片用音量震音，跨音符保持同相位。',
    params: [
      sel('model', '型号', ['tine', 'reed'], 'tine', { group: '音色' }),
      n('bark', '咆哮', 0, 1, 0.45, { group: '音色' }),
      n('bell', '铃', 0, 1, 0.4, { group: '音色' }),
      n('decay', '衰减', 0.5, 10, 3.5, { unit: 's', curve: 'log', group: '音色' }),
      n('release', '释音', 0.02, 2, 0.18, { unit: 's', curve: 'log', group: '音色' }),
      n('tremoloRate', '速率', 0.5, 10, 4.5, { unit: 'Hz', curve: 'log', group: '震音' }),
      n('tremoloDepth', '深度', 0, 1, 0, { group: '震音' }),
      n('gain', '增益', 0, 2, 0.7, { group: '声部' })
    ],
    presets: {
      手提电钢: { tremoloDepth: 0.45 },
      柔和: { bark: 0.2, bell: 0.2, decay: 4.5 },
      明亮音叉: { bark: 0.7, bell: 0.7 },
      震音: { tremoloDepth: 0.8, tremoloRate: 5.5 },
      沃利策: { model: 'reed', bark: 0.55, bell: 0.15, decay: 2.5, tremoloDepth: 0.3, tremoloRate: 5.5 }
    }
  },
  organ: {
    label: '拉杆风琴', category: 'keys', melodic: true, defaultKey: 60, color: '#c4733f',
    description: '拉杆式音轮风琴，九根拉杆（16 尺到 1 尺）；「打击」给起音加一记短促泛音，「旋转」是旋转喇叭，「键噪」是按键时的咔哒声。',
    params: [
      n('db16', "16'", 0, 8, 8, { step: 1, group: '拉杆' }),
      n('db513', "5⅓'", 0, 8, 8, { step: 1, group: '拉杆' }),
      n('db8', "8'", 0, 8, 8, { step: 1, group: '拉杆' }),
      n('db4', "4'", 0, 8, 0, { step: 1, group: '拉杆' }),
      n('db223', "2⅔'", 0, 8, 0, { step: 1, group: '拉杆' }),
      n('db2', "2'", 0, 8, 0, { step: 1, group: '拉杆' }),
      n('db135', "1⅗'", 0, 8, 0, { step: 1, group: '拉杆' }),
      n('db113', "1⅓'", 0, 8, 0, { step: 1, group: '拉杆' }),
      n('db1', "1'", 0, 8, 0, { step: 1, group: '拉杆' }),
      bool('percussion', '开', false, { group: '打击' }),
      sel('percHarmonic', '泛音', ['second', 'third'], 'third', { group: '打击' }),
      n('percDecay', '衰减', 0.1, 1.5, 0.3, { unit: 's', curve: 'log', group: '打击' }),
      n('click', '键噪', 0, 1, 0.3, { group: '声部' }),
      sel('rotary', '旋转', ['off', 'slow', 'fast'], 'slow', { group: '声部' }),
      n('drive', '过载', 0, 1, 0.15, { group: '声部' }),
      n('gain', '增益', 0, 2, 0.6, { group: '声部' })
    ],
    presets: {
      爵士: { db513: 8, db8: 8, percussion: true, percHarmonic: 'third', click: 0.35 },
      福音: { db16: 8, db513: 8, db8: 8, db4: 8, db223: 0, db2: 0, db135: 0, db113: 0, db1: 8, rotary: 'fast', drive: 0.3 },
      摇滚: { db16: 8, db513: 8, db8: 8, db4: 8, db223: 6, db2: 4, db135: 0, db113: 0, db1: 0, drive: 0.7, rotary: 'fast', click: 0.5 },
      柔和: { db16: 0, db513: 0, db8: 6, db4: 4, db223: 0, db2: 0, click: 0.05, rotary: 'slow', drive: 0 },
      教堂: { db16: 8, db513: 6, db8: 8, db4: 8, db223: 5, db2: 6, db135: 4, db113: 4, db1: 6, click: 0, rotary: 'off', drive: 0 }
    }
  },
  guitar: {
    label: '吉他', category: 'guitar', melodic: true, defaultKey: 52, color: '#b8864b',
    description: '建模拨弦吉他（Karplus–Strong 算法），可选木吉他、尼龙弦琴体或电吉他拾音器；力度越大越亮。拨弦点 0.05 靠近琴桥＝尖锐，0.5＝圆润；闷音＝手掌压弦；过载＝音箱失真。',
    params: [
      sel('body', '琴体', ['acoustic', 'nylon', 'electric'], 'acoustic', { group: '音色' }),
      n('brightness', '明亮度', 0, 1, 0.6, { group: '音色' }),
      n('position', '拨弦点', 0.05, 0.5, 0.18, { group: '音色' }),
      n('sustain', '保持', 0.5, 10, 4, { unit: 's', curve: 'log', group: '音色' }),
      n('mute', '闷音', 0, 1, 0, { group: '音色' }),
      n('drive', '过载', 0, 1, 0, { group: '音量' }),
      n('release', '释音', 0.02, 1, 0.08, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.8, { group: '声部' })
    ],
    presets: {
      木吉他: {},
      尼龙弦: { body: 'nylon', brightness: 0.4, position: 0.25, sustain: 3 },
      清音电吉他: { body: 'electric', brightness: 0.55, position: 0.12, sustain: 5 },
      闷音: { body: 'electric', mute: 0.75, brightness: 0.5, position: 0.1, release: 0.04 },
      过载: { body: 'electric', brightness: 0.7, position: 0.1, sustain: 6, drive: 0.6, gain: 0.55 }
    }
  },
  ukulele: {
    label: '尤克里里', category: 'guitar', melodic: true, defaultKey: 64, color: '#c8a04e',
    description: '尤克里里：四弦尼龙小吉他，个子小、音域高、余音短，和弦伴奏与儿歌弹唱的好搭档（花城版器乐进课堂乐器）。同一套拨弦建模，琴体更小更亮、衰减更快。',
    params: [
      sel('body', '琴体', ['nylon', 'acoustic'], 'nylon', { group: '音色' }),
      n('brightness', '明亮度', 0, 1, 0.72, { group: '音色' }),
      n('position', '拨弦点', 0.05, 0.5, 0.22, { group: '音色' }),
      n('sustain', '保持', 0.3, 6, 1.8, { unit: 's', curve: 'log', group: '音色' }),
      n('mute', '闷音', 0, 1, 0, { group: '音色' }),
      n('release', '释音', 0.02, 1, 0.07, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.85, { group: '声部' })
    ],
    presets: {
      尤克里里: {},
      清脆: { brightness: 0.85, sustain: 1.3, position: 0.15 },
      闷音扫弦: { mute: 0.7, sustain: 0.8, release: 0.04 }
    }
  },
  bass: {
    label: '贝斯吉他', category: 'bass', melodic: true, defaultKey: 36, color: '#a8613f',
    description: '建模电贝斯或立式贝斯：指弹、拨片、击弦、立式四种风格；力度越大越亮。默认单音：重叠的音符会滑音。',
    params: [
      sel('style', '风格', ['finger', 'pick', 'slap', 'upright'], 'finger', { group: '音色' }),
      n('brightness', '明亮度', 0, 1, 0.4, { group: '音色' }),
      n('sustain', '保持', 0.3, 8, 3, { unit: 's', curve: 'log', group: '音色' }),
      n('mute', '闷音', 0, 1, 0, { group: '音色' }),
      n('drive', '过载', 0, 1, 0, { group: '音量' }),
      n('release', '释音', 0.02, 1, 0.06, { unit: 's', curve: 'log', group: '声部' }),
      bool('mono', '单音', true, { group: '声部' }),
      n('glide', '滑音', 0, 0.3, 0.05, { unit: 's', group: '声部' }),
      n('gain', '增益', 0, 2, 0.8, { group: '声部' })
    ],
    presets: {
      指弹: {},
      拨片: { style: 'pick', brightness: 0.55 },
      击弦: { style: 'slap', brightness: 0.6, sustain: 2 },
      闷音: { mute: 0.7, brightness: 0.3, sustain: 1.5 },
      立式钢琴: { style: 'upright', brightness: 0.3, sustain: 2, release: 0.12 }
    }
  },
  strings: {
    label: '弦乐合奏', category: 'strings', melodic: true, defaultKey: 60, color: '#b55e7a',
    description: '弓弦弦乐群或独奏：人数＝每个音几个人（1＝独奏），颤音渐入，奏法可选连奏（持续）、断奏（短弓）或拨奏。力度越大弓越亮、起音越快。',
    params: [
      sel('articulation', '奏法', ['legato', 'staccato', 'pizzicato'], 'legato', { group: '弓法' }),
      n('ensemble', '人数', 1, 8, 5, { step: 1, group: '弓法' }),
      n('attack', '起音', 0.01, 3, 0.25, { unit: 's', curve: 'log', group: '弓法' }),
      n('release', '释音', 0.05, 4, 0.6, { unit: 's', curve: 'log', group: '弓法' }),
      n('brightness', '明亮度', 0, 1, 0.5, { group: '音色' }),
      n('vibrato', '颤音', 0, 1, 0.35, { group: '音色' }),
      n('vibratoRate', '颤音速率', 3, 8, 5.2, { unit: 'Hz', group: '音色' }),
      n('gain', '增益', 0, 2, 0.7, { group: '声部' })
    ],
    presets: {
      合奏: {},
      慢弦乐: { attack: 1.2, release: 1.5, brightness: 0.35, vibrato: 0.25 },
      大提琴独奏: { ensemble: 1, attack: 0.12, brightness: 0.45, vibrato: 0.6, vibratoRate: 5, release: 0.35 },
      小提琴独奏: { ensemble: 1, attack: 0.08, brightness: 0.65, vibrato: 0.6, vibratoRate: 5.8, release: 0.3 },
      断奏: { articulation: 'staccato', ensemble: 6, attack: 0.02, brightness: 0.6, vibrato: 0 },
      拨奏: { articulation: 'pizzicato', brightness: 0.5, vibrato: 0 }
    }
  },
  // ---------------------------------------------------------------- flutes (one breath engine, a voicing per kind)
  flute: {
    label: '长笛', category: 'flutes', melodic: true, defaultKey: 72, color: '#7fc8e8',
    description: '长笛：纯净带气声（C4–C7）。中音长笛与短笛预设只改音色：分别低四度、高八度记谱。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。单音时重叠音符连奏。',
    params: windParams(),
    presets: {
      演奏会: {},
      气声: { breath: 0.6, tone: 0.3, chiff: 0.5 },
      低保真长笛: { breath: 0.5, tone: 0.25, vibrato: 0.45, vibratoRate: 4.5, release: 0.3 },
      'Trap 长笛': { tone: 0.55, breath: 0.35, chiff: 0.5, vibrato: 0.2, mono: true, glide: 0.05 },
      中音长笛: { tone: 0.3, breath: 0.45, vibrato: 0.35, attack: 0.06 },
      短笛: { tone: 0.6, breath: 0.15, chiff: 0.5, vibrato: 0.25, vibratoRate: 5.8 }
    }
  },
  panflute: {
    label: '排箫', category: 'flutes', melodic: true, defaultKey: 72, color: '#9fd6a0',
    description: '排箫：空灵带气声，每个音都有一口气，颤音很少。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.25, breath: 0.55, chiff: 0.75, vibrato: 0.15, attack: 0.02, release: 0.2 }),
    presets: {
      安第斯: {},
      柔和: { chiff: 0.4, breath: 0.4, attack: 0.05 },
      飘逸: { breath: 0.85, tone: 0.15 },
      桑波尼亚: { tone: 0.4, chiff: 0.9, breath: 0.6, vibrato: 0.05 }
    }
  },
  recorder: {
    label: '竖笛', category: 'flutes', melodic: true, defaultKey: 72, color: '#c9b27a',
    description: '木质竖笛：清亮略带簧味，吐音干脆，气声少、颤音轻。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.35, breath: 0.12, chiff: 0.55, vibrato: 0.12, attack: 0.015, release: 0.08 }),
    presets: { 高音: {}, 中音竖笛: { tone: 0.25, breath: 0.18, chiff: 0.45 }, 巴洛克: { vibrato: 0.25, chiff: 0.4, release: 0.12 } }
  },
  whistle: {
    label: '锡笛', category: 'flutes', melodic: true, defaultKey: 74, color: '#bfe3f0',
    description: '爱尔兰锡笛／低音锡笛：明亮纯净，吐音干脆。单音配短滑音：重叠音符连奏（断音与滑音）。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.55, breath: 0.25, chiff: 0.6, vibrato: 0.1, attack: 0.012, release: 0.06, mono: true, glide: 0.03 }),
    presets: { 爱尔兰: {}, 低音锡笛: { tone: 0.3, breath: 0.45, vibrato: 0.25, attack: 0.03, release: 0.12 } }
  },
  ocarina: {
    label: '陶笛', category: 'flutes', melodic: true, defaultKey: 72, color: '#d9b38c',
    description: '陶土埙笛：近乎纯音，圆润，气声柔和、起音温和。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.15, breath: 0.18, chiff: 0.2, vibrato: 0.2, attack: 0.03, release: 0.12 }),
    presets: { 陶土: {}, 幽魂: { breath: 0.5, vibrato: 0.4, vibratoRate: 4, attack: 0.12, release: 0.6 }, 明亮: { tone: 0.4, chiff: 0.35 } }
  },
  // ---------------------------------------------------------------- beatbox (mouth percussion and bass)
  bbkick: {
    label: '人声底鼓', category: 'beatbox', melodic: false, defaultKey: 60, gm: 36, color: '#e07a5f',
    description: '口技底鼓（「B」）：唇爆破的闷响加一口气，略带近讲饱和。音高＝闷响，冲击＝下坠幅度，空气感＝唇爆破噪声。',
    params: [
      n('pitch', '音高', 40, 120, 62, { unit: 'Hz', curve: 'log' }),
      n('punch', '冲击', 0, 1, 0.5),
      n('decay', '衰减', 0.05, 0.8, 0.2, { unit: 's', curve: 'log' }),
      n('air', '空气感', 0, 1, 0.5),
      n('drive', '过载', 0, 1, 0.3)
    ],
    presets: {
      '经典 B': {},
      劲道: { punch: 0.8, decay: 0.16, air: 0.6, drive: 0.4 },
      '低厚 808 口技': { pitch: 48, decay: 0.55, punch: 0.35, air: 0.3, drive: 0.25 },
      喉音底鼓: { pitch: 70, decay: 0.12, drive: 0.8, air: 0.2 },
      唇爆破: { pitch: 85, decay: 0.08, air: 0.9, punch: 0.3, drive: 0.15 }
    }
  },
  bbsnare: {
    label: '人声军鼓', category: 'beatbox', melodic: false, defaultKey: 60, gm: 38, color: '#f2b84b',
    description: '口技军鼓：Pf（经典）、Psh（喷气）、内吸 K（喉音）、Kch（边击／拍手）。音色＝嘶声色彩，弹响＝爆破冲击，琴体＝口腔共鸣。',
    params: [
      sel('style', '风格', ['pf', 'psh', 'k', 'kch'], 'pf'),
      n('tone', '音色', 1500, 9000, 4500, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.03, 0.5, 0.14, { unit: 's', curve: 'log' }),
      n('snap', '弹响', 0, 1, 0.6),
      n('body', '琴体', 0, 1, 0.3)
    ],
    presets: {
      'P F 军鼓': {},
      喷气军鼓: { style: 'psh', tone: 3800, decay: 0.2 },
      内吸军鼓: { style: 'k', tone: 3500, decay: 0.12, body: 0.15 },
      'Kch 边击': { style: 'kch', tone: 5000, decay: 0.09, snap: 0.85 }
    }
  },
  bbhat: {
    label: '人声踩镲', category: 'beatbox', melodic: false, defaultKey: 60, gm: 42, color: '#a6d36a',
    description: '口技踩镲：t（闭）、ts（开）、内吸、tch。敲击＝舌尖轻点。闭镲与开镲请放在同一互斥组。',
    params: [
      sel('style', '风格', ['t', 'ts', 'inward', 'tch'], 't'),
      n('color', '音色', 4000, 12000, 7500, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.01, 0.6, 0.05, { unit: 's', curve: 'log' }),
      n('click', '敲击', 0, 1, 0.6)
    ],
    presets: { 'T 踩镲': {}, 'Ts 开镲': { style: 'ts', decay: 0.3 }, 内吸踩镲: { style: 'inward', decay: 0.08, click: 0.3 }, 'Tch 踩镲': { style: 'tch', decay: 0.09, color: 6000 } }
  },
  bbbass: {
    label: '人声贝斯', category: 'beatbox', melodic: true, defaultKey: 36, color: '#c96a8c',
    description: '口技贝斯：唇／喉振动经元音塑形（oo、oh、ah 或闭口 mm 哼鸣）。嘶吼加喉部低八度与颗粒，摆动扫过元音（哇音）。默认单音带滑音。',
    params: [
      sel('vowel', '元音', ['oo', 'oh', 'ah', 'mm'], 'oo', { group: '音色' }),
      n('growl', '嘶吼', 0, 1, 0.2, { group: '音色' }),
      n('wobble', '摆动', 0, 1, 0, { group: '摆动' }),
      n('wobbleRate', '速率', 0.5, 12, 4, { unit: 'Hz', curve: 'log', group: '摆动' }),
      n('attack', '起音', 0.003, 1, 0.01, { unit: 's', curve: 'log', group: '声部' }),
      n('release', '释音', 0.02, 2, 0.08, { unit: 's', curve: 'log', group: '声部' }),
      ...legato(true, 0.05, 0.4),
      n('gain', '增益', 0, 2, 0.8, { group: '声部' })
    ],
    presets: {
      唇音贝斯: {},
      哼鸣: { vowel: 'mm', growl: 0 },
      喉音贝斯: { vowel: 'oh', growl: 0.7 },
      哇音: { vowel: 'ah', wobble: 0.7, wobbleRate: 4, growl: 0.3 }
    }
  },
  bbfx: {
    label: '人声特效', category: 'beatbox', melodic: false, defaultKey: 60, gm: 69, color: '#8e7cc3',
    description: '口技特效：舌头滚奏、人声搓碟（wicka）、激光、警笛。衰减＝持续时间；速率＝每秒敲击数（滚奏）、搓碟速度或警笛速率。',
    params: [
      sel('style', '风格', ['clickroll', 'scratch', 'zap', 'siren'], 'clickroll'),
      n('pitch', '音高', 80, 2000, 400, { unit: 'Hz', curve: 'log' }),
      n('rate', '速率', 4, 40, 22, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.1, 2, 0.4, { unit: 's', curve: 'log' })
    ],
    presets: {
      滚奏齿音: {},
      搓碟: { style: 'scratch', pitch: 260, rate: 8, decay: 0.35 },
      激光音: { style: 'zap', pitch: 500, decay: 0.25 },
      警笛: { style: 'siren', pitch: 450, rate: 6, decay: 1.2 }
    }
  },
  // ---------------------------------------------------------------- Indian
  sitar: {
    label: '西塔琴', category: 'indian', melodic: true, defaultKey: 60, color: '#d98b3a',
    description: '建模西塔琴：拨弦经过会响的桥鸣（明亮渐变的金属感），并带按主音大调调音的共鸣弦——同音会跟着响。默认单音带滑音：重叠音符沿品被拉过去（meend）。',
    params: [
      n('jawari', '桥鸣', 0, 1, 0.6, { group: '音色' }),
      ...pluckParams({ brightness: 0.6, sustain: 3.5, sustainMin: 0.5, release: 0.15, mono: true, glide: 0.12 }).filter((x) => x.key !== 'gain'),
      n('sympathetic', '共鸣弦', 0, 1, 0.5, { group: '共鸣弦' }),
      sel('sa', '主音', SA_NOTES, 'C', { group: '共鸣弦' }),
      n('gain', '增益', 0, 2, 0.8, { group: '声部' })
    ],
    presets: {
      西塔琴: {},
      明亮桥鸣: { jawari: 0.85, brightness: 0.75 },
      柔和: { jawari: 0.35, brightness: 0.4, sympathetic: 0.3 },
      流行西塔: { mono: false, sympathetic: 0.2, sustain: 2.5 }
    }
  },
  tanpura: {
    label: '坦布拉琴', category: 'indian', melodic: true, defaultKey: 48, color: '#a0785a',
    description: '持续低音鲁特琴：长而带桥鸣的弦，余响会绽放、泛光数秒。在拉格下用主音与五度（如 C3 配 G2 或 C2）作长音反复；松开后仍让音继续响。',
    params: [
      n('jawari', '桥鸣', 0, 1, 0.8, { group: '音色' }),
      ...pluckParams({ brightness: 0.45, sustain: 8, sustainMin: 2, sustainMax: 12, release: 1.5 })
    ],
    presets: { 坦布拉: {}, 明亮: { jawari: 0.95, brightness: 0.65 }, 柔和: { jawari: 0.6, brightness: 0.3 } }
  },
  tabla: {
    label: '塔布拉鼓', category: 'indian', melodic: false, tunedToKey: true, defaultKey: 60, gm: 60, color: '#b5651d',
    description: '塔布拉鼓语：na（边缘、清脆）、tin／tun（开口高音）、te（闭口拍）、ge（开口低音，弯音＝掌滑）、ke（闭口低音）、dha＝na+ge、dhin＝tin+ge。音高＝高音鼓（达扬）定在 C4，巴扬＝低音鼓。每种鼓语一个通道。',
    params: [
      sel('stroke', '鼓语', ['na', 'tin', 'tun', 'te', 'ge', 'ke', 'dha', 'dhin'], 'na'),
      n('tune', '达扬鼓', 180, 520, 261.6, { unit: 'Hz', curve: 'log' }),
      n('bayanTune', '巴扬鼓', 60, 160, 95, { unit: 'Hz', curve: 'log' }),
      n('bend', '弯音', 0, 1, 0.3),
      n('decay', '衰减', 0.3, 2, 1)
    ],
    presets: {
      'Na 音': {}, 锡: { stroke: 'tin' }, 通: { stroke: 'tun' }, 特: { stroke: 'te' },
      'Ge 音': { stroke: 'ge' }, 克: { stroke: 'ke' }, 哒: { stroke: 'dha' }, 丁: { stroke: 'dhin' },
      'Ge 滑音': { stroke: 'ge', bend: 0.85, decay: 1.4 }
    }
  },
  bansuri: {
    label: '班苏里笛', category: 'indian', melodic: true, defaultKey: 67, color: '#e0a458',
    description: '印度竹笛：低沉、带气声、温暖，颤音慢而富表情。默认单音带滑音：重叠音符滑过去（meend）。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.3, breath: 0.5, chiff: 0.3, vibrato: 0.35, vibratoRate: 4.8, attack: 0.06, release: 0.25, mono: true, glide: 0.12 }),
    presets: { 班苏里笛: {}, 慢滑音: { glide: 0.3 }, 气声: { breath: 0.75, tone: 0.2 }, 明亮: { tone: 0.5, breath: 0.35 } }
  },
  shehnai: {
    label: '谢奈管', category: 'indian', melodic: true, defaultKey: 67, color: '#d8724a',
    description: '北印度双簧管：明亮、鼻音、穿透，带装饰性颤音。默认单音带滑音（meend）。音色＝亮度，鼻音＝簧片味。',
    params: reedParams(),
    presets: { 谢奈管: {}, 婚礼: { tone: 0.8, nasal: 0.75, vibrato: 0.45 }, 柔和: { tone: 0.35, nasal: 0.4, breath: 0.25 } }
  },
  santoor: {
    label: '桑图尔琴', category: 'indian', melodic: true, defaultKey: 72, color: '#d4a03c',
    description: '克什米尔击弦扬琴：金属弦组用轻槌击打——起音明亮如铃，余响长而泛光（同组弦略微拍频）。硬度＝槌，泛光＝弦组失谐；松开后仍让音继续响。',
    params: [
      n('hardness', '琴棒', 0, 1, 0.6, { group: '音色' }),
      n('shimmer', '泛光', 0, 1, 0.4, { group: '音色' }),
      ...pluckParams({ brightness: 0.6, sustain: 4, sustainMin: 1, sustainMax: 10, release: 2.5 })
    ],
    presets: { 桑图尔: {}, 软槌: { hardness: 0.25, brightness: 0.45 }, 明亮: { hardness: 0.85, brightness: 0.8 }, 干声: { sustain: 1.5, release: 0.4, shimmer: 0.2 } }
  },
  harmonium: {
    label: '印度风琴', category: 'indian', melodic: true, defaultKey: 60, color: '#b5835a',
    description: '印度手压风琴：低音、男声、女声三组簧片（相隔八度，彼此轻微拍频），起音有簧片起振，所有音符共用风箱脉动。按住即持续；对力度几乎不敏感。',
    params: [
      n('bassReed', '低音', 0, 1, 0, { group: '簧片' }),
      n('maleReed', '男声', 0, 1, 1, { group: '簧片' }),
      n('femaleReed', '女声', 0, 1, 0.6, { group: '簧片' }),
      n('tone', '音色', 0, 1, 0.5, { group: '音色' }),
      n('bellows', '风箱', 0, 1, 0.3, { group: '音色' }),
      n('bellowsRate', '风箱速率', 0.1, 3, 0.6, { unit: 'Hz', curve: 'log', group: '音色' }),
      n('attack', '起音', 0.01, 1, 0.06, { unit: 's', curve: 'log', group: '声部' }),
      n('release', '释音', 0.02, 2, 0.1, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.6, { group: '声部' })
    ],
    presets: {
      男女声: {},
      男声: { femaleReed: 0 },
      三簧: { bassReed: 0.8 },
      柔和: { tone: 0.3, femaleReed: 0.3, bellows: 0.2 },
      卡瓦利: { bassReed: 0.6, tone: 0.7, bellows: 0.45, bellowsRate: 1.2 }
    }
  },
  // ---------------------------------------------------------------- East Asian
  koto: {
    label: '日本筝', category: 'eastasian', melodic: true, defaultKey: 62, color: '#c49a6c',
    description: '日本十三弦筝，用义甲弹拨：起音明亮带鼻音，余响木质。适合五声音阶（平调子：D E F A 降B）。单音时滑入音符，像按弦（押手）。',
    params: pluckParams({ brightness: 0.7, sustain: 2.2, sustainMin: 0.5, sustainMax: 6, position: 0.1, release: 0.25, mono: false, glide: 0.15 }),
    presets: { 日本筝: {}, 指弹: { brightness: 0.4, position: 0.25 }, 押手: { mono: true, glide: 0.2 } }
  },
  guzheng: {
    label: '古筝', category: 'eastasian', melodic: true, defaultKey: 67, color: '#d9774e',
    description: '中国二十一弦筝：明亮、余响悠长的弦，用义甲弹拨；五声音阶（C D E G A）走句、刮奏与按滑音是它的招牌。已接入真实录音采样。',
    params: pluckParams({ brightness: 0.7, sustain: 3.5, sustainMin: 1, sustainMax: 8, position: 0.12, release: 0.35, mono: false, glide: 0.12 }),
    presets: { 古筝: {}, 明亮: { brightness: 0.9, position: 0.08 }, 柔和: { brightness: 0.45, position: 0.22 }, 推弦: { mono: true, glide: 0.18 } }
  },
  pipa: {
    label: '琵琶', category: 'eastasian', melodic: true, defaultKey: 64, color: '#b3563c',
    description: '中国梨形琵琶，用指甲弹拨：起音硬、亮、有打击感，余响短而带鼻音。快速重复（三十二分音符）即轮指。',
    params: pluckParams({ brightness: 0.8, sustain: 1.4, sustainMin: 0.3, sustainMax: 4, position: 0.08, release: 0.12 }),
    presets: { 琵琶: {}, 柔和: { brightness: 0.5, position: 0.18 }, 干声: { sustain: 0.6, release: 0.06 } }
  },
  shamisen: {
    label: '三味线', category: 'eastasian', melodic: true, defaultKey: 57, color: '#7a4b8c',
    description: '日本三弦，用大拨子弹奏：清脆的皮面「啪」、萨瓦里杂音，余响短而干。津轻风格更用力。',
    params: [
      n('thwack', '击打', 0, 1, 0.5, { group: '音色' }),
      n('sawari', '萨瓦里', 0, 1, 0.5, { group: '音色' }),
      ...pluckParams({ brightness: 0.65, sustain: 1.2, sustainMin: 0.3, sustainMax: 4, release: 0.1 })
    ],
    presets: { 三味线: {}, 津轻: { thwack: 0.85, brightness: 0.8, sawari: 0.6 }, 长呗: { thwack: 0.3, brightness: 0.5, sawari: 0.4 } }
  },
  erhu: {
    label: '二胡', category: 'eastasian', melodic: true, defaultKey: 67, color: '#c0504d',
    description: '中国二胡：如人声的鼻音弓弦音色，蛇皮共鸣箱，深颤音与滑音。默认单音带滑音；力度越大弓越亮。已接入真实录音采样。',
    params: [
      n('brightness', '明亮度', 0, 1, 0.55, { group: '音色' }),
      n('body', '蛇皮', 0, 1, 0.6, { group: '音色' }),
      n('bowNoise', '弓噪', 0, 1, 0.25, { group: '音色' }),
      ...vibratoParams(0.45, 5.5),
      n('attack', '起音', 0.01, 2, 0.08, { unit: 's', curve: 'log', group: '声部' }),
      n('release', '释音', 0.02, 3, 0.2, { unit: 's', curve: 'log', group: '声部' }),
      ...legato(true, 0.12),
      n('gain', '增益', 0, 2, 0.7, { group: '声部' })
    ],
    presets: {
      二胡: {},
      哀诉: { vibrato: 0.7, vibratoRate: 4.8, attack: 0.18, glide: 0.25 },
      明亮: { brightness: 0.8, bowNoise: 0.35 },
      中胡: { brightness: 0.35, body: 0.8 }
    }
  },
  shakuhachi: {
    label: '尺八', category: 'eastasian', melodic: true, defaultKey: 62, color: '#a3b86c',
    description: '日本尺八：气声很重、粗粝；音符从略低处涌上来，重吹时有强烈气爆（村息）。默认单音带滑音。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.4, breath: 0.65, chiff: 0.55, vibrato: 0.25, vibratoRate: 4.5, attack: 0.1, release: 0.3, mono: true, glide: 0.1 }),
    presets: { 尺八: {}, 强吹气爆: { breath: 0.9, chiff: 0.85, tone: 0.5 }, 禅: { breath: 0.5, tone: 0.25, attack: 0.25, vibrato: 0.15, release: 0.6 } }
  },
  dizi: {
    label: '笛子', category: 'eastasian', melodic: true, defaultKey: 74, color: '#e8c35a',
    description: '中国竹笛，带笛膜振动：明亮、鼻音、如歌，颤音快；单音带滑音便于滑奏。笛膜＝膜音强度。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.6, breath: 0.3, chiff: 0.5, buzz: 0.6, vibrato: 0.3, vibratoRate: 6, attack: 0.03, release: 0.12, mono: true, glide: 0.06 }),
    presets: { 笛子: {}, 明亮: { buzz: 0.85, tone: 0.75 }, 箫: { buzz: 0, tone: 0.3, breath: 0.5, vibrato: 0.2, attack: 0.06 } }
  },
  xiao: {
    label: '箫', category: 'eastasian', melodic: true, defaultKey: 65, color: '#8fa87b',
    description: '中国洞箫：竖吹、低沉温润，气声柔和，适合慢句与悠长的旋律。默认单音带滑音。已接入真实录音采样（持续音，带颤音）。气声＝气噪，气口＝吐音起音；颤音在起音后渐入。',
    params: windParams({ tone: 0.35, breath: 0.55, chiff: 0.45, vibrato: 0.3, vibratoRate: 5, attack: 0.09, release: 0.25, mono: true, glide: 0.08 }),
    presets: { 箫: {}, 悠远: { breath: 0.75, vibrato: 0.45, attack: 0.2, release: 0.5 }, 清亮: { tone: 0.65, breath: 0.3, chiff: 0.6 } }
  },
  suona: {
    label: '唢呐', category: 'eastasian', melodic: true, defaultKey: 69, color: '#e3a33c',
    description: '中国双簧唢呐：响亮、铜管味、明亮，为喜庆与行进而生；单音带滑音便于按滑。音色＝亮度，鼻音＝簧片味。已接入真实录音采样（持续音，带颤音）。',
    params: reedParams({ tone: 0.75, nasal: 0.55, breath: 0.1, vibrato: 0.3, vibratoRate: 6, glide: 0.06 }),
    presets: { 唢呐: {}, 喜庆: { tone: 0.9, vibrato: 0.4 }, 遥远: { tone: 0.45, nasal: 0.35, breath: 0.25 } }
  },
  taiko: {
    label: '太鼓', category: 'eastasian', melodic: false, defaultKey: 60, gm: 41, color: '#8c3b2e',
    description: '日本太鼓：大太鼓（巨大轰响）、中太鼓（经典祭典鼓）、缔太鼓（小而紧）或 kara（鼓棒敲木框）。鼓棒＝棒击声，琴体＝皮面。',
    params: [
      n('pitch', '音高', 35, 450, 95, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.05, 3, 0.9, { unit: 's', curve: 'log' }),
      n('stick', '鼓棒', 0, 1, 0.5),
      n('body', '琴体', 0, 1, 0.5)
    ],
    presets: {
      中太鼓: {},
      大太鼓: { pitch: 52, decay: 2.2, stick: 0.35, body: 0.6 },
      缔太鼓: { pitch: 330, decay: 0.18, stick: 0.75, body: 0.3 },
      卡拉: { pitch: 420, decay: 0.06, stick: 1, body: 0.05 }
    }
  },
  gong: {
    label: '锣', category: 'eastasian', melodic: false, defaultKey: 60, gm: 52, color: '#c9a227',
    description: '锣与钟：大锣（击后渐渐铺开的金属浪）、中国京剧锣（弯音小于 0 音高下落，大于 0 上升）与寺钟（类型选钟）。已接入真实录音采样（两件锣、五种力度；类型选钟时仍是合成钟声）。琴棒＝硬度，泛光＝绽放。跟随音高。',
    params: [
      sel('type', '类型', ['gong', 'bell'], 'gong'),
      n('pitch', '音高', 50, 700, 70, { unit: 'Hz', curve: 'log' }),
      n('decay', '衰减', 0.5, 12, 7, { unit: 's', curve: 'log' }),
      n('bend', '弯音', -1, 1, 0),
      n('mallet', '琴棒', 0, 1, 0.5),
      n('shimmer', '泛光', 0, 1, 0.8)
    ],
    presets: {
      大锣: {},
      京剧锣: { pitch: 180, decay: 2.5, bend: -0.6, shimmer: 0.2, mallet: 0.6 },
      京剧高音锣: { pitch: 420, decay: 1.5, bend: 0.7, shimmer: 0.1, mallet: 0.7 },
      寺钟: { type: 'bell', pitch: 130, decay: 9, shimmer: 0.1, mallet: 0.2 },
      小锣: { pitch: 300, decay: 3, shimmer: 0.4 }
    }
  },
  xun: {
    label: '埙', category: 'eastasian', melodic: true, defaultKey: 69, color: '#b5744a',
    description: `中国埙：陶土闭口吹奏乐器，音色低回苍凉、气声重，适合独白式的慢句与古风旋律。默认单音带滑音。已接入真实录音采样（陶土奥卡里那，同为陶土气鸣乐器）。${WIND_HELP}`,
    params: windParams({ tone: 0.3, breath: 0.6, chiff: 0.4, vibrato: 0.35, vibratoRate: 4.8, attack: 0.12, release: 0.35, mono: true, glide: 0.1 }),
    presets: {
      埙: {},
      苍凉: { tone: 0.25, breath: 0.7, vibrato: 0.55, vibratoRate: 4.2, attack: 0.2, release: 0.6 },
      清幽: { tone: 0.5, breath: 0.4, chiff: 0.3, vibrato: 0.2 }
    }
  },
  muyu: {
    label: '木鱼', category: 'eastasian', melodic: true, defaultKey: 51, gm: 76, color: '#7a5230',
    description: '木鱼：笃、笃的木质敲击声，诵经与戏曲节奏的骨架。已接入真实录音采样（开槽木鼓，两种音高×三种力度）：弹 D#3 附近是高音木鱼，A2 附近是低音木鱼，其他音高在两者之间变调。音色＝木质感明暗，腔体＝木质共鸣。',
    params: [
      n('brightness', '音色', 0, 1, 0.5, { group: '音色' }),
      n('body', '腔体', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 2, 0.12, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: { 木鱼: {}, 诵经: { body: 0.75, brightness: 0.35, release: 0.2 }, 清脆: { brightness: 0.8, body: 0.4, release: 0.06 } }
  },
  timpani: {
    label: '定音鼓', category: 'drums', melodic: true, defaultKey: 48, gm: 47, color: '#b0703c',
    description: '定音鼓：管弦乐团的低音鼓，真实录音采样（D2–A3，两种力度）。音色＝槌头软硬，鼓腔＝共鸣感；释音控制松键后收多快，长释音让滚奏余音连成一片。',
    params: [
      n('brightness', '音色', 0, 1, 0.5, { group: '音色' }),
      n('body', '鼓腔', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 4, 0.6, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: { 定音鼓: {}, 浑厚: { body: 0.8, brightness: 0.3 }, 清亮: { brightness: 0.8, body: 0.45 } }
  },
  hang: {
    label: '手碟', category: 'drums', melodic: true, defaultKey: 62, color: '#8a9aa5',
    description: '手碟：两个钢制半球合成的"飞碟"，音色温暖悠远。真实录音采样，D 小调九个音（A3–D5），随手组合都和谐，特别适合课堂即兴与放松音乐。音色＝明暗，腔体＝共鸣。',
    params: [
      n('brightness', '音色', 0, 1, 0.5, { group: '音色' }),
      n('body', '腔体', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 4, 0.8, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: { 手碟: {}, 冥想: { brightness: 0.35, body: 0.75, release: 1.2 }, 清脆: { brightness: 0.8, body: 0.4 } }
  },
  eguitar: {
    label: '电吉他', category: 'guitar', melodic: true, defaultKey: 64, gm: 27, color: '#c25b4e',
    description: '电吉他（清音）：单线圈拾音器的清亮琴声，真实录音采样（两种力度）。清音适合分解和弦与旋律线；想要失真请用「吉他」的过载旋钮。明亮度＝音色旋钮。',
    params: [
      n('brightness', '明亮度', 0, 1, 0.6, { group: '音色' }),
      n('body', '拾音器', 0, 1, 0.5, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.15, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.85, { group: '声部' })
    ],
    presets: { 清音: {}, 拨片亮音: { brightness: 0.85 }, 暗音色: { brightness: 0.35, body: 0.7 } }
  },
  // ---------------------------------------------------------------- orchestra (real recordings, Peter-and-the-Wolf cast)
  violin: {
    label: '小提琴', category: 'orchestra', melodic: true, defaultKey: 64, gm: 40, color: '#bf5a4a',
    description: '小提琴（独奏）：弓弦在真实琴上拉出的长音，真实录音采样。歌唱性的高音弦适合旋律与《彼得与狼》里的彼得主题；明亮度＝弓压，琴体＝木共鸣。',
    params: [
      n('brightness', '弓压', 0, 1, 0.55, { group: '音色' }),
      n('body', '琴体', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.35, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: { 独奏: {}, 明亮: { brightness: 0.8, body: 0.45 }, 温暖: { brightness: 0.35, body: 0.8, release: 0.5 } }
  },
  oboe: {
    label: '双簧管', category: 'orchestra', melodic: true, defaultKey: 62, gm: 68, color: '#c98f45',
    description: '双簧管：双簧片带一点鼻音的田园音色，真实录音采样——《彼得与狼》里鸭子的声音。音色＝明暗，腔体＝簧片共鸣。',
    params: [
      n('brightness', '音色', 0, 1, 0.55, { group: '音色' }),
      n('body', '簧片', 0, 1, 0.55, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.2, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.85, { group: '声部' })
    ],
    presets: { 双簧管: {}, 牧歌: { brightness: 0.4, body: 0.7 }, 鸭子: { brightness: 0.7, body: 0.35 } }
  },
  clarinet: {
    label: '单簧管', category: 'orchestra', melodic: true, defaultKey: 60, gm: 71, color: '#5b7fa8',
    description: '单簧管：圆润木管，低音区（音调旋低或写低音）是《彼得与狼》里猫的敏捷脚步。音色＝明暗，腔体＝木管共鸣。',
    params: [
      n('brightness', '音色', 0, 1, 0.5, { group: '音色' }),
      n('body', '腔体', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.25, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.85, { group: '声部' })
    ],
    presets: { 单簧管: {}, 低音区: { brightness: 0.32, body: 0.75 }, 猫: { brightness: 0.6, body: 0.45, release: 0.12 } }
  },
  bassoon: {
    label: '巴松', category: 'orchestra', melodic: true, defaultKey: 48, gm: 70, color: '#8a6a45',
    description: '巴松（大管）：管弦乐团的低音木管，苍老而诙谐——爷爷的声音。真实录音采样；写低音区和弦时要留出空隙。',
    params: [
      n('brightness', '音色', 0, 1, 0.45, { group: '音色' }),
      n('body', '腔体', 0, 1, 0.65, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.25, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.9, { group: '声部' })
    ],
    presets: { 巴松: {}, 爷爷: { brightness: 0.3, body: 0.8 }, 诙谐: { brightness: 0.65, body: 0.45, release: 0.12 } }
  },
  horn: {
    label: '圆号', category: 'orchestra', melodic: true, defaultKey: 55, gm: 60, color: '#b8a05a',
    description: '圆号（法国号）：铜管里最柔和的一支，强奏时又亮又宽——三支圆号就是《彼得与狼》里的狼。真实录音采样。',
    params: [
      n('brightness', '音色', 0, 1, 0.5, { group: '音色' }),
      n('body', '铜管', 0, 1, 0.6, { group: '音色' }),
      n('release', '释音', 0.02, 3, 0.3, { unit: 's', curve: 'log', group: '声部' }),
      n('gain', '增益', 0, 2, 0.85, { group: '声部' })
    ],
    presets: { 圆号: {}, 柔和: { brightness: 0.35, body: 0.5 }, 狼: { brightness: 0.8, body: 0.75 } }
  },
  // a user plugin (see plugins.js): instrument.plugin holds its id; its params come from the plugin's manifest
  plugin: {
    label: '插件乐器', category: 'plugins', melodic: true, defaultKey: 60, color: '#7c8a99', dynamic: true,
    description: '来自用户上传插件的乐器。',
    params: [],
    presets: { 默认: {} }
  },
  sampler: {
    label: '采样器', category: 'sampler', melodic: true, defaultKey: 60, color: '#9aa5b1',
    description: '播放上传的音频采样。按音高变调（原调＝采样的原始音高）。开始／结束裁切采样（按长度比例）；循环在按住时重复循环区间（关闭单次触发）；截止频率是随力度打开的低通。',
    params: [
      { key: 'sampleId', label: 'Sample', type: 'sample', default: null },
      n('rootKey', '原调', 0, 127, 60, { step: 1 }),
      bool('pitched', '跟随音高', true),
      bool('oneShot', '单次触发', true),
      bool('reverse', '反向', false),
      n('start', '开始', 0, 0.99, 0),
      n('end', '结束', 0.01, 1, 1),
      bool('loop', '循环', false),
      n('loopStart', '循环起点', 0, 0.99, 0),
      n('loopEnd', '循环终点', 0.01, 1, 1),
      n('cutoff', '截止频率', 100, 20000, 20000, { unit: 'Hz', curve: 'log' }),
      n('gain', '增益', 0, 2, 1),
      ...ampEnv(0.001, 0.5, 1, 0.05)
    ],
    presets: { 默认: {} }
  }
};

export const INSTRUMENT_KINDS = Object.keys(INSTRUMENTS);

export function getInstrumentDef(kind) {
  const def = INSTRUMENTS[kind];
  if (!def) throw new Error(`不认识的乐器「${kind}」。可用：${INSTRUMENT_KINDS.join('、')}`);
  return def;
}

export function paramDef(kind, key) {
  return INSTRUMENTS[kind]?.params.find((p) => p.key === key) || null;
}

export function instrumentDefaults(kind) {
  const def = getInstrumentDef(kind);
  const params = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
}

/** Clamp/validate a params object against a param definition list. Unknown keys are dropped. */
export function sanitizeParams(defs, params = {}, { strict = false } = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    const p = defs.find((d) => d.key === key);
    if (!p) {
      if (strict) throw new Error(`不认识的参数「${key}」。合法参数：${defs.map((d) => d.key).join('、')}`);
      continue;
    }
    out[key] = sanitizeValue(p, value, strict);
  }
  return out;
}

export function sanitizeValue(p, value, strict = false) {
  if (p.type === 'number') {
    const v = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(v)) {
      if (strict) throw new Error(`参数「${p.key}」必须是数字`);
      return p.default;
    }
    if (strict && (v < p.min || v > p.max)) {
      throw new Error(`参数「${p.key}」须在 ${p.min} 到 ${p.max} 之间${p.unit ? `（${p.unit}）` : ''}，当前 ${v}`);
    }
    let c = Math.min(p.max, Math.max(p.min, v));
    if (p.step && p.step >= 1) c = Math.round(c);
    return c;
  }
  if (p.type === 'select') {
    if (!p.options.includes(value)) {
      if (strict) throw new Error(`参数「${p.key}」只能是：${p.options.join('、')}`);
      return p.default;
    }
    return value;
  }
  if (p.type === 'bool') return value === true || value === 'true' || value === 1;
  if (p.type === 'sample' || p.type === 'channel') return value == null || value === '' ? null : String(value).slice(0, 64);
  return value;
}

/** 旧版（英文）预设名到现名的映射：让历史工程与旧存档仍能还原音色。 */
const PRESET_ALIAS = {
  // 旧版英文预设名 → 现在的中文名：老工程、旧笔记、以及 Claude 凭记忆写的英文名仍然能用
  'Acid Bass': '酸性贝斯',
  'Acoustic': '木吉他',
  'Airy': '飘逸',
  'Alto Flute': '中音长笛',
  'Alto Recorder': '中音竖笛',
  'Andes': '安第斯',
  'Arp Blip': '琶音点奏',
  'Bansuri': '班苏里笛',
  'Baroque': '巴洛克',
  'Bell': '铃音',
  'Bend': '推弦',
  'Big': '宏大',
  'Bongo': '邦戈鼓',
  'Brass': '铜管',
  'Breathy': '气声',
  'Bright': '明亮',
  'Bright Jawari': '明亮桥鸣',
  'Bright Tines': '明亮音叉',
  'Chord Stab': '和弦断奏',
  'Chudaiko': '中太鼓',
  'Church': '教堂',
  'Classic': '经典',
  'Classic B': '经典 B',
  'Clay': '陶土',
  'Clean': '干净',
  'Clean Electric': '清音电吉他',
  'Click Roll': '滚奏齿音',
  'Closed': '闭镲',
  'Concert': '演奏会',
  'Conga': '康加鼓',
  'Crash': '强击',
  'Crisp': '清脆',
  'Deep': '厚重',
  'Deep 808 Mouth': '低厚 808 口技',
  'Default': '默认',
  'Dha': '哒',
  'Dhin': '丁',
  'Distant': '遥远',
  'Distorted': '失真',
  'Dizi': '笛子',
  'Dry': '干声',
  'E-Piano': '电钢琴',
  'Ensemble': '合奏',
  'Erhu': '二胡',
  'Fat': '肥厚',
  'Felt': '毡音',
  'Felt Piano': '毡槌钢琴',
  'Festive': '喜庆',
  'Finger': '指弹',
  'Finger Pluck': '指弹',
  'FM Bass': 'FM 贝斯',
  'Ge': 'Ge 音',
  'Ge Slide': 'Ge 滑音',
  'Ghostly': '幽魂',
  'Glass': '玻璃感',
  'Gospel': '福音',
  'Grand': '三角钢琴',
  'Guzheng': '古筝',
  'Hard': '硬朗',
  'High': '高',
  'Honky Tonk': '酒吧钢琴',
  'House Thump': '浩室重击',
  'Hum': '哼鸣',
  'Inward Hat': '内吸踩镲',
  'Inward K Snare': '内吸军鼓',
  'Irish': '爱尔兰',
  'Jazz': '爵士',
  'Kara': '卡拉',
  'Kch Rimshot': 'Kch 边击',
  'Ke': '克',
  'Koto': '日本筝',
  'Lament': '哀诉',
  'Laser Zap': '激光音',
  'Lip Bass': '唇音贝斯',
  'Lip Pop': '唇爆破',
  'Lo-fi': '低保真',
  'Lo-fi Flute': '低保真长笛',
  'Lo-fi Keys': '低保真键盘',
  'Long': '长',
  'Low': '低',
  'Low Whistle': '低音锡笛',
  'Male': '男声',
  'Male + Female': '男女声',
  'Mallet': '琴棒',
  'Mellow': '柔和',
  'Mid': '中位',
  'Muraiki': '强吹气爆',
  'Muted': '闷音',
  'Na': 'Na 音',
  'Nagauta': '长呗',
  'Nylon': '尼龙弦',
  'Odaiko': '大太鼓',
  'Open': '开镲',
  'Opera Gong': '京剧锣',
  'Opera Gong High': '京剧高音锣',
  'Organ': '风琴',
  'Oshide': '押手',
  'Overdrive': '过载',
  'Pedal': '踏板',
  'Pf Snare': 'P F 军鼓',
  'Piccolo': '短笛',
  'Pick': '拨片',
  'Pipa': '琵琶',
  'Pizzicato': '拨奏',
  'Pluck': '拨奏',
  'Pop Sitar': '流行西塔',
  'Psh Spit Snare': '喷气军鼓',
  'Punchy': '劲道',
  'Qawwali': '卡瓦利',
  'Reese Bass': '里斯贝斯',
  'Reverse Swell': '反向渐强',
  'Ride': '叮叮镲',
  'Rimmy': '边击感',
  'Riser Noise': '上扬噪声',
  'Rock': '摇滚',
  'Santoor': '桑图尔',
  'Saw Lead': '锯齿主音',
  'Scratch': '搓碟',
  'Shakuhachi': '尺八',
  'Shamisen': '三味线',
  'Shehnai': '谢奈管',
  'Shime': '缔太鼓',
  'Short': '短',
  'Siren': '警笛',
  'Sitar': '西塔琴',
  'Slap': '击弦',
  'Slow Meend': '慢滑音',
  'Slow Strings': '慢弦乐',
  'Small Gong': '小锣',
  'Soft': '柔和',
  'Soft Mallets': '软槌',
  'Soft Pad': '柔和铺底',
  'Solo Cello': '大提琴独奏',
  'Solo Violin': '小提琴独奏',
  'Soprano': '高音',
  'Splash': '水镲',
  'Square Lead': '方波主音',
  'Staccato': '断奏',
  'Strings': '弦乐',
  'Sub Bass': '超低音',
  'Sub Drop': '超低下坠',
  'Suitcase': '手提电钢',
  'Suona': '唢呐',
  'Supersaw': '超级锯齿',
  'T Hat': 'T 踩镲',
  'Tam-tam': '大锣',
  'Tanpura': '坦布拉',
  'Tch Hat': 'Tch 踩镲',
  'Te': '特',
  'Temple Bell': '寺钟',
  'Three Reeds': '三簧',
  'Throat Bass': '喉音贝斯',
  'Throat Kick': '喉音底鼓',
  'Tight': '紧实',
  'Tin': '锡',
  'Trap': '陷阱',
  'Trap Flute': 'Trap 长笛',
  'Tremolo': '震音',
  'Ts Open Hat': 'Ts 开镲',
  'Tsugaru': '津轻',
  'Tun': '通',
  'Upright': '立式钢琴',
  'Warm Keys': '温暖键盘',
  'Wedding': '婚礼',
  'Woodblock': '木鱼',
  'Wub': '哇音',
  'Wurli': '沃利策',
  'Xiao': '箫',
  'Zampoña': '桑波尼亚',
  'Zap': '电击',
  'Zen': '禅',
  'Zhonghu (alto)': '中胡'
};

function resolvePreset(def, preset) {
  if (preset && Object.hasOwn(def.presets, preset)) return preset;
  if (typeof preset !== 'string' || !preset) return null;
  const alias = PRESET_ALIAS[preset];
  if (alias && Object.hasOwn(def.presets, alias)) return alias;
  // 大小写不敏感：老师或 Claude 手写 "pluck" / "riser noise" 也能认
  const lower = preset.toLowerCase();
  const ci = Object.keys(def.presets).find((n) => n.toLowerCase() === lower);
  if (ci) return ci;
  const ciAlias = Object.keys(PRESET_ALIAS).find((n) => n.toLowerCase() === lower);
  const target = ciAlias && PRESET_ALIAS[ciAlias];
  return target && Object.hasOwn(def.presets, target) ? target : null;
}

/** 供外部（MCP 工具等）把旧版英文预设名解析成现名；不认识则返回 null。 */
export function resolvePresetName(kind, preset) {
  const def = INSTRUMENTS[kind];
  return def ? resolvePreset(def, preset) : null;
}

export function makeInstrument(kind, preset, overrides = {}, { strict = false, plugin = null } = {}) {
  const def = getInstrumentDef(kind);
  if (kind === 'plugin') {
    // the manifest isn't known here: values are cleaned loosely (the server validates them against the manifest)
    return { kind, plugin: validPluginId(plugin), preset: typeof preset === 'string' && preset ? preset.slice(0, 32) : 'Default', params: sanitizeStoredPluginParams(overrides) };
  }
  const wanted = resolvePreset(def, preset);
  const presetName = wanted || Object.keys(def.presets)[0];
  if (strict && preset && !wanted) {
    throw new Error(`未知预设「${preset}」（乐器 ${kind}）。可用预设：${Object.keys(def.presets).join('、')}`);
  }
  const params = {
    ...instrumentDefaults(kind),
    ...def.presets[presetName],
    ...sanitizeParams(def.params, overrides, { strict })
  };
  return { kind, preset: presetName, params };
}

/** 下拉选项的显示名：值仍是英文标识（存档与预设依赖它），只在界面显示中文。 */
const OPTION_LABELS = {
  lowpass: '低通',
  highpass: '高通',
  bandpass: '带通',
  pitch: '音高',
  filter: '滤波',
  amp: '音量',
  tine: '音叉',
  reed: '簧片',
  second: '二次泛音',
  third: '三次泛音',
  off: '关',
  slow: '慢',
  fast: '快',
  acoustic: '木吉他',
  nylon: '尼龙弦',
  electric: '电吉他拾音',
  finger: '指弹',
  pick: '拨片',
  slap: '击弦',
  upright: '立式贝斯',
  legato: '连奏',
  staccato: '断奏',
  pizzicato: '拨奏',
  pf: '喷唇',
  psh: '喷气',
  k: '内吸 K',
  kch: '边击',
  t: '闭',
  ts: '开',
  inward: '内吸',
  tch: '擦',
  oo: '呜',
  oh: '哦',
  ah: '啊',
  mm: '嗯',
  clickroll: '舌滚',
  scratch: '搓碟',
  zap: '激光',
  siren: '警笛',
  na: '纳',
  tin: '丁',
  tun: '通',
  te: '特',
  ge: '格',
  ke: '克',
  dha: '达哈',
  dhin: '丁哈',
  gong: '锣',
  bell: '铃'
};

for (const def of Object.values(INSTRUMENTS)) {
  for (const p of def.params || []) {
    if (p.type === 'select' && Array.isArray(p.options)) {
      p.optionLabels = p.options.map((o) => OPTION_LABELS[o] || o);
    }
  }
}

/** Human readable catalog (used by MCP list_instruments). */
export function describeInstruments() {
  return INSTRUMENT_KINDS.map((kind) => {
    const d = INSTRUMENTS[kind];
    return {
      kind,
      label: d.label,
      category: d.category,
      melodic: d.melodic,
      defaultKey: d.defaultKey,
      description: d.description || '',
      presets: Object.keys(d.presets),
      params: d.params.map((p) => ({
        key: p.key,
        type: p.type,
        ...(p.type === 'number' ? { min: p.min, max: p.max } : {}),
        ...(p.options ? { options: p.options } : {}),
        default: p.default,
        ...(p.unit ? { unit: p.unit } : {})
      }))
    };
  });
}
