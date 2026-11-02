// the band instruments: piano carries the intro, bass guitar and drums join for the verse, strummed acoustic
// guitar and a string section lift the chorus (I–V–vi–IV)
import { chordProgressionNotes, bassFromChords, bassLineFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Pop Band (96 BPM, G major: piano, guitar, bass, strings)',
  spec: () => {
    const prog = ['G', 'D', 'Em', 'C'];
    return {
      name: 'Pop Band', bpm: 96, key: 'G', scale: 'major',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '劲道', volume: 0.6, params: { decay: 0.35, click: 0.3 } },
        { name: '军鼓', kind: 'snare', preset: '肥厚', volume: 1.2, sends: { 混响: 0.18 } },
        { name: '踩镲', kind: 'hat', preset: '清脆', volume: 1, nudge: 4 },
        { name: '钢琴', kind: 'piano', preset: '三角钢琴', volume: 0.8, fx: [{ type: 'eq', params: { hpf: 70 } }], sends: { 混响: 0.22 } },
        { name: '贝斯', kind: 'bass', preset: '指弹', volume: 1, fx: [{ type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.015, makeup: 7 } }, { type: 'pump', params: { source: '底鼓', depth: 0.25, shape: 0.2 } }] },
        { name: '吉他', kind: 'guitar', preset: '木吉他', volume: 0.6, pan: -0.35, fx: [{ type: 'eq', params: { hpf: 120 } }], sends: { 混响: 0.15 } },
        { name: '弦乐', kind: 'strings', preset: '慢弦乐', volume: 0.7, pan: 0.25, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.4 } }
      ],
      buses: [{ name: '混响', fx: [{ type: 'reverb', params: { decay: 2.4, size: 0.65, predelay: 0.02, mix: 1 } }] }],
      patterns: [
        {
          name: '鼓组', bars: 1, color: '#e8665a',
          notes: () => ({
            底鼓: steps('x-------x-x-----'),
            军鼓: steps('----x-------x--o'),
            踩镲: steps('x-o-x-o-x-o-x-ox', 60, { velocityScale: 0.85 })
          })
        },
        {
          name: '钢琴', bars: 4, color: '#e4d9b8',
          notes: (bar) => ({
            钢琴: [
              ...chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'rhythm', rhythm: 'x-----x---x-----', gate: 1, velocity: 0.62, voicing: 'close', center: 64 }),
              ...bassFromChords(prog, { octave: 2, chordLength: bar, rhythm: 'x---------------', gate: 1, velocity: 0.55 })
            ]
          })
        },
        {
          name: '贝斯', bars: 4, color: '#a8613f',
          notes: (bar) => ({ 贝斯: bassLineFromChords(prog, 'R:6 R:2 5:4 8:2 5:2', { octave: 2, chordLength: bar, gate: 0.9, velocity: 0.8 }) })
        },
        {
          name: '吉他', bars: 4, color: '#b8864b',
          notes: (bar) => ({ 吉他: chordProgressionNotes(prog, { chordLength: bar, octave: 3, style: 'rhythm', rhythm: 'x--x--x---x-x-x-', gate: 0.9, velocity: 0.7, voicing: 'spread' }) })
        },
        {
          name: '弦乐', bars: 4, color: '#b55e7a',
          notes: (bar) => ({ 弦乐: chordProgressionNotes(prog, { chordLength: bar, octave: 4, gate: 1, velocity: 0.6, voicing: 'open', center: 67 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }, { bar: 12, name: '副歌' }],
      arrangement: [
        { pattern: '钢琴', track: 0, bar: 0, bars: 20, trackName: '钢琴' },
        { pattern: '鼓组', track: 1, bar: 4, bars: 16, trackName: '鼓组' },
        { pattern: '贝斯', track: 2, bar: 4, bars: 16, trackName: '贝斯' },
        { pattern: '吉他', track: 3, bar: 12, bars: 8, trackName: '吉他' },
        { pattern: '弦乐', track: 4, bar: 12, bars: 8, trackName: '弦乐' }
      ]
    };
  }
};
