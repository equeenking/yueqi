import { chordProgressionNotes, bassFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Lo-fi 嘻哈（80 BPM）',
  spec: () => ({
    name: 'Lo-fi 放松', bpm: 80, key: 'F', scale: 'major', swing: 0.3,
    channels: [
      { name: '底鼓', kind: 'kick', preset: '低保真', volume: 0.8 },
      { name: '军鼓', kind: 'snare', preset: '边击感', volume: 0.6, nudge: 16, sends: { 混响: 0.15 } },
      { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.35, params: { color: 7000 }, nudge: 5 },
      { name: '键盘', kind: 'synth', preset: '低保真键盘', volume: 0.6, fx: [{ type: 'eq', params: { hpf: 160, lpf: 5000 } }, { type: 'bitcrusher', params: { bits: 10, mix: 0.4 } }, { type: 'chorus', params: { mix: 0.4, rate: 0.4 } }], sends: { 混响: 0.3 } },
      { name: '贝斯', kind: 'synth', preset: '超低音', volume: 0.65, nudge: 8 }
    ],
    buses: [{ name: '混响', fx: [{ type: 'reverb', params: { decay: 2.5, size: 0.5, damping: 4500, mix: 1 } }] }],
    master: [{ type: 'filter', params: { type: 'lowpass', cutoff: 9000 } }],
    patterns: [
      {
        name: '鼓组', bars: 1, color: '#46c79a',
        notes: () => ({
          底鼓: steps('x-----x-x-------'),
          军鼓: steps('----x-------x---'),
          踩镲: steps('x-o-x-o-x-o-x-o-')
        })
      },
      {
        name: '键盘', bars: 4, color: '#c86be0',
        notes: (bar) => ({ 键盘: chordProgressionNotes(['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], { chordLength: bar, octave: 4, style: 'broken', gate: 0.95, velocity: 0.6, voicing: 'drop2' }) })
      },
      {
        name: '贝斯', bars: 4, color: '#d98c5f',
        notes: (bar) => ({ 贝斯: bassFromChords(['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], { octave: 2, chordLength: bar, rhythm: 'x-------x-----x-', gate: 0.9 }) })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '循环' }],
    arrangement: [
      { pattern: '键盘', track: 0, bar: 0, bars: 16, trackName: '键盘' },
      { pattern: '鼓组', track: 1, bar: 4, bars: 12, trackName: '鼓组' },
      { pattern: '贝斯', track: 2, bar: 4, bars: 12, trackName: '贝斯' }
    ]
  })
};
