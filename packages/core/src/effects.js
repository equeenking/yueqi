import { uid } from './ids.js';
import { sanitizeParams } from './instruments.js';
import { validPluginId, sanitizeStoredPluginParams } from './plugins.js';

const n = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'number', min, max, default: def, ...extra });
const sel = (key, label, options, def, extra = {}) => ({ key, label, type: 'select', options, default: def, ...extra });
const bool = (key, label, def) => ({ key, label, type: 'bool', default: def });
/** A channel reference (channel id, or null = none) — e.g. the trigger of a note-driven sidechain. */
const channelRef = (key, label) => ({ key, label, type: 'channel', default: null });

export const SYNC_DIVISIONS = ['1/32', '1/16', '1/16d', '1/8t', '1/8', '1/8d', '1/4t', '1/4', '1/4d', '1/2', '1/1'];

/** Length of a tempo-synced division in beats (quarter notes). */
export function divisionBeats(div) {
  const m = /^1\/(\d+)([dt]?)$/.exec(div);
  if (!m) return 0.5;
  let beats = 4 / parseInt(m[1], 10);
  if (m[2] === 'd') beats *= 1.5;
  if (m[2] === 't') beats *= 2 / 3;
  return beats;
}

// automatable: param is backed by a Web Audio AudioParam and can be automated.
export const EFFECTS = {
  eq: {
    label: '参数均衡', description: '三段均衡（低架、中峰、高架），外加高通与低通（12 dB/倍频程；高通 20 Hz／低通 20 kHz 即关闭）。',
    params: [
      n('hpf', 'High-pass', 20, 1000, 20, { unit: 'Hz', curve: 'log', automatable: true }),
      n('low', 'Low', -24, 24, 0, { unit: 'dB', automatable: true }),
      n('lowFreq', 'Low freq', 20, 1000, 180, { unit: 'Hz', curve: 'log', automatable: true }),
      n('mid', 'Mid', -24, 24, 0, { unit: 'dB', automatable: true }),
      n('midFreq', 'Mid freq', 150, 8000, 1000, { unit: 'Hz', curve: 'log', automatable: true }),
      n('midQ', 'Mid Q', 0.1, 10, 1, { curve: 'log' }),
      n('high', 'High', -24, 24, 0, { unit: 'dB', automatable: true }),
      n('highFreq', 'High freq', 1000, 20000, 6000, { unit: 'Hz', curve: 'log', automatable: true }),
      n('lpf', 'Low-pass', 1000, 20000, 20000, { unit: 'Hz', curve: 'log', automatable: true })
    ]
  },
  filter: {
    label: '滤波器', description: '带共振的滤波器。给截止频率画自动化就能做出扫频。',
    params: [
      sel('type', 'Type', ['lowpass', 'highpass', 'bandpass', 'notch'], 'lowpass'),
      n('cutoff', '截止', 20, 20000, 20000, { unit: 'Hz', curve: 'log', automatable: true }),
      n('resonance', 'Resonance', 0.1, 20, 0.8, { curve: 'log', automatable: true }),
      n('mix', 'Mix', 0, 1, 1, { automatable: true })
    ]
  },
  compressor: {
    label: '压缩器', description: '动态压缩；干湿比小于 1 就是并联（纽约）压缩。没有自动补偿增益：请手动调补偿，让响度与旁通时一致。',
    params: [
      n('threshold', 'Threshold', -60, 0, -18, { unit: 'dB', automatable: true }),
      n('ratio', 'Ratio', 1, 20, 4, { curve: 'log', automatable: true }),
      n('attack', 'Attack', 0.001, 0.5, 0.01, { unit: 's', curve: 'log' }),
      n('release', 'Release', 0.01, 1, 0.15, { unit: 's', curve: 'log' }),
      n('knee', 'Knee', 0, 40, 6, { unit: 'dB' }),
      n('makeup', 'Makeup', 0, 24, 0, { unit: 'dB', automatable: true }),
      n('mix', 'Mix', 0, 1, 1, { automatable: true })
    ]
  },
  delay: {
    label: '延迟', description: 'Tempo-synced (ping-pong) delay; the repeats are high-passed so they never muddy the low end.',
    params: [
      sel('time', 'Time', SYNC_DIVISIONS, '1/8d'),
      n('feedback', 'Feedback', 0, 0.95, 0.35, { automatable: true }),
      n('tone', 'Tone', 300, 20000, 6000, { unit: 'Hz', curve: 'log', automatable: true }),
      bool('pingPong', 'Ping-pong', true),
      n('mix', 'Mix', 0, 1, 0.25, { automatable: true })
    ]
  },
  reverb: {
    label: '混响', description: 'Convolution reverb with a generated room: early reflections (size), a decay whose highs die faster (damping), and a 120 Hz low cut.',
    params: [
      n('decay', 'Decay', 0.2, 10, 2.2, { unit: 's', curve: 'log' }),
      n('size', 'Size', 0, 1, 0.5),
      n('predelay', 'Pre-delay', 0, 0.2, 0.01, { unit: 's' }),
      n('damping', 'Damping', 1000, 20000, 7000, { unit: 'Hz', curve: 'log', automatable: true }),
      n('mix', 'Mix', 0, 1, 0.25, { automatable: true })
    ]
  },
  distortion: {
    label: '失真', description: '波形整形式的饱和与失真。',
    params: [
      n('drive', 'Drive', 0, 1, 0.35),
      sel('mode', 'Mode', ['soft', 'hard', 'fold'], 'soft'),
      n('tone', 'Tone', 500, 20000, 9000, { unit: 'Hz', curve: 'log', automatable: true }),
      n('mix', 'Mix', 0, 1, 1, { automatable: true }),
      n('output', 'Output', 0, 2, 0.8, { automatable: true })
    ]
  },
  chorus: {
    label: '合唱', description: '立体声调制延迟式合唱。',
    params: [
      n('rate', 'Rate', 0.05, 8, 0.8, { unit: 'Hz', curve: 'log', automatable: true }),
      n('depth', 'Depth', 0, 1, 0.4),
      n('delay', '延迟', 0.005, 0.04, 0.015, { unit: 's' }),
      n('mix', 'Mix', 0, 1, 0.5, { automatable: true })
    ]
  },
  phaser: {
    label: '移相器', description: '四级全通移相。',
    params: [
      n('rate', 'Rate', 0.05, 8, 0.5, { unit: 'Hz', curve: 'log', automatable: true }),
      n('depth', 'Depth', 0, 1, 0.6),
      n('frequency', 'Center', 200, 4000, 900, { unit: 'Hz', curve: 'log' }),
      n('feedback', 'Feedback', 0, 0.9, 0.4),
      n('mix', 'Mix', 0, 1, 0.5, { automatable: true })
    ]
  },
  bitcrusher: {
    label: '低保真压碎器', description: '降低位深，做出粗糙的低保真质感。',
    params: [
      n('bits', 'Bits', 1, 16, 8, { step: 1 }),
      n('mix', 'Mix', 0, 1, 0.6, { automatable: true })
    ]
  },
  stereo: {
    label: '立体声塑形', description: '立体声宽度（0 = 单声道，1 = 正常，2 = 超宽）；「以下转单声道」把该频率以下的成分保持单声道（0 = 关闭），这样铺得很宽的低频在俱乐部和手机上也不会出问题。',
    params: [
      n('width', 'Width', 0, 2, 1, { automatable: true }),
      n('monoBelow', 'Mono below', 0, 500, 0, { unit: 'Hz' })
    ]
  },
  pump: {
    label: '侧链压缩', description: '音量闪避。触发源选某个通道（例如底鼓）时，该通道每个音符都会压一下——是真正的侧链，能跟住切分的底鼓，即使该通道已静音也能当「幽灵触发」。不选触发源则按与速度同步的网格闪避（速率）。',
    params: [
      channelRef('source', 'Trigger channel'),
      sel('rate', 'Rate', ['1/16', '1/8', '1/4', '1/2', '1/1'], '1/4'),
      n('depth', 'Depth', 0, 1, 0.7),
      n('shape', 'Release', 0.05, 0.95, 0.45, { description: 'Recovery time as a fraction of the rate (grid mode) or of one beat (source mode)' })
    ]
  },
  limiter: {
    label: '限幅器', description: '主输出限幅：输入增益推它，天花板封顶输出（过采样削波级）。后面的主推子请留在 0 dB；用 render_mix 检查真峰值（流媒体平台要求 ≤ -1 dBTP）。',
    params: [
      n('gain', 'Input gain', 0, 24, 0, { unit: 'dB', automatable: true }),
      n('ceiling', 'Ceiling', -12, 0, -1, { unit: 'dB' }),
      n('release', 'Release', 0.01, 1, 0.1, { unit: 's', curve: 'log' })
    ]
  }
};

// a user plugin effect (see plugins.js): effect.plugin holds its id, params come from the plugin's manifest
EFFECTS.plugin = {
  label: '插件效果', dynamic: true,
  description: 'An effect from one of the user\'s installed plugins (list_plugins): add_effect with type "plugin" and plugin "<id>"; params come from the plugin.',
  params: []
};

export const EFFECT_TYPES = Object.keys(EFFECTS);

export function getEffectDef(type) {
  const def = EFFECTS[type];
  if (!def) throw new Error(`不认识的效果器「${type}」。可用：${EFFECT_TYPES.join('、')}`);
  return def;
}

export function effectDefaults(type) {
  const params = {};
  for (const p of getEffectDef(type).params) params[p.key] = p.default;
  return params;
}

export function createEffect(type, params = {}, extra = {}) {
  const def = getEffectDef(type);
  if (type === 'plugin') {
    return { id: extra.id || uid('fx'), type, plugin: validPluginId(extra.plugin), enabled: extra.enabled !== false, params: sanitizeStoredPluginParams(params) };
  }
  return {
    id: extra.id || uid('fx'),
    type,
    enabled: extra.enabled !== false,
    params: { ...effectDefaults(type), ...sanitizeParams(def.params, params) }
  };
}

export function describeEffects() {
  return EFFECT_TYPES.map((type) => ({
    type,
    label: EFFECTS[type].label,
    description: EFFECTS[type].description,
    params: EFFECTS[type].params.map((p) => ({
      key: p.key,
      type: p.type,
      ...(p.type === 'number' ? { min: p.min, max: p.max } : {}),
      ...(p.options ? { options: p.options } : {}),
      default: p.default,
      ...(p.unit ? { unit: p.unit } : {}),
      ...(p.automatable ? { automatable: true } : {}),
      ...(p.type === 'channel' ? { note: 'channel id or name' } : {}),
      ...(p.description ? { description: p.description } : {})
    }))
  }));
}
