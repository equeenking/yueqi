import { chordProgressionNotes, bassFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Boom Bap (90 BPM, swing)',
  spec: () => ({
    name: 'Boom Bap', bpm: 90, key: 'D', scale: 'dorian', swing: 0.45,
    channels: [
      { name: '底鼓', kind: 'kick', preset: '劲道', volume: 0.85, params: { drive: 0.35 } },
      { name: '军鼓', kind: 'snare', preset: '肥厚', volume: 0.75, nudge: 14, sends: { 房间: 0.18 } },
      { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.45, nudge: 4 },
      { name: '键盘', kind: 'fm', preset: '电钢琴', volume: 0.55, fx: [{ type: 'eq', params: { hpf: 150 } }, { type: 'chorus', params: { mix: 0.35 } }], sends: { 房间: 0.2 } },
      { name: '贝斯', kind: 'synth', preset: '超低音', volume: 0.7 }
    ],
    buses: [{ name: '房间', fx: [{ type: 'reverb', params: { decay: 1.4, size: 0.35, mix: 1 } }] }],
    patterns: [
      {
        name: '鼓组', bars: 1, color: '#f2a03d',
        notes: () => ({
          底鼓: steps('x------x--x-----'),
          军鼓: steps('----X--o-o--X--o'),
          踩镲: steps('x-o-x-o-x-o-x-ox')
        })
      },
      {
        name: '键盘', bars: 4, color: '#8f6cf0',
        notes: (bar) => ({ 键盘: chordProgressionNotes(['Dm9', 'G9', 'Cmaj9', 'A7'], { chordLength: bar, octave: 4, style: 'rhythm', rhythm: 'x-------x--x----', gate: 0.95, velocity: 0.65, voicing: 'rootless' }) })
      },
      {
        name: '贝斯', bars: 4, color: '#d98c5f',
        notes: (bar) => ({ 贝斯: bassFromChords(['Dm9', 'G9', 'Cmaj9', 'A7'], { octave: 2, chordLength: bar, rhythm: 'x------x--x-----', gate: 0.9 }) })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }],
    arrangement: [
      { pattern: '键盘', track: 0, bar: 0, bars: 12, trackName: '键盘' },
      { pattern: '鼓组', track: 1, bar: 0, bars: 12, trackName: '鼓组' },
      { pattern: '贝斯', track: 2, bar: 4, bars: 8, trackName: '贝斯' }
    ]
  })
};
