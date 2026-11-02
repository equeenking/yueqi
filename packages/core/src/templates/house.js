import { chordProgressionNotes, bassFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Deep House (124 BPM, A minor)',
  spec: () => ({
    name: 'Deep House', bpm: 124, key: 'A', scale: 'minor',
    channels: [
      { name: '底鼓', kind: 'kick', preset: '浩室重击', volume: 0.85 },
      { name: '拍手', kind: 'clap', preset: '宏大', volume: 0.6, nudge: 4, sends: { 混响: 0.12 } },
      { name: '开镲', kind: 'hat', preset: '开镲', volume: 0.45, params: { decay: 0.25 } },
      { name: '沙锤', kind: 'shaker', preset: '经典', volume: 0.35 },
      { name: '贝斯', kind: 'synth', preset: '超低音', volume: 0.75, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.6 } }] },
      { name: '和弦', kind: 'synth', preset: '和弦断奏', volume: 0.55, fx: [{ type: 'eq', params: { hpf: 200 } }, { type: 'pump', params: { source: '底鼓', depth: 0.75 } }], sends: { 混响: 0.3 } }
    ],
    buses: [{ name: '混响', fx: [{ type: 'reverb', params: { decay: 2.8, size: 0.7, mix: 1 } }, { type: 'pump', params: { source: '底鼓', depth: 0.5 } }] }],
    patterns: [
      {
        name: '鼓组', bars: 1, color: '#e8665a',
        notes: () => ({
          底鼓: steps('x---x---x---x---'),
          拍手: steps('----x-------x---'),
          '开镲': steps('--x---x---x---x-'),
          沙锤: steps('oxoxoxoxoxoxoxox')
        })
      },
      {
        name: '贝斯', bars: 4, color: '#d98c5f',
        notes: (bar) => ({ 贝斯: bassFromChords(['Am7', 'Dm7', 'Fmaj7', 'Em7'], { octave: 2, chordLength: bar, rhythm: '--x---x---x--xx-', gate: 0.8 }) })
      },
      {
        name: '和弦', bars: 4, color: '#3fb5d6',
        notes: (bar) => ({ 和弦: chordProgressionNotes(['Am7', 'Dm7', 'Fmaj7', 'Em7'], { chordLength: bar, octave: 4, style: 'rhythm', rhythm: '--x--x----x--x--', gate: 0.6, velocity: 0.7 }) })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '律动' }],
    arrangement: [
      { pattern: '鼓组', track: 0, bar: 0, bars: 16, trackName: '鼓组' },
      { pattern: '和弦', track: 1, bar: 0, bars: 16, trackName: '和弦' },
      { pattern: '贝斯', track: 2, bar: 4, bars: 12, trackName: '贝斯' }
    ]
  })
};
