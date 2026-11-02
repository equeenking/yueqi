import { STEP } from '../constants.js';
import { chordProgressionNotes, bassLineFromChords, melodyFromString, rollNotes } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '陷阱说唱（140 BPM，C 小调）',
  spec: () => ({
    name: '陷阱节奏', bpm: 140, key: 'C', scale: 'minor',
    channels: [
      { name: '底鼓', kind: 'kick', preset: '陷阱', volume: 0.85 },
      { name: '拍手', kind: 'clap', preset: '经典', volume: 0.7, sends: { 混响: 0.15 } },
      { name: '踩镲', kind: 'hat', preset: '清脆', chokeGroup: 1, volume: 0.55, nudge: -3 },
      { name: '开镲', kind: 'hat', preset: '开镲', chokeGroup: 1, volume: 0.45 },
      { name: '808', kind: 'bass808', preset: '经典', volume: 0.8, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.45, shape: 0.25 } }] },
      { name: '铺底', kind: 'synth', preset: '柔和铺底', volume: 0.5, fx: [{ type: 'eq', params: { hpf: 180 } }], sends: { 混响: 0.35 } },
      { name: '铃音', kind: 'fm', preset: '铃音', volume: 0.45, fx: [{ type: 'eq', params: { hpf: 300 } }], sends: { 延迟: 0.25, 混响: 0.25 } }
    ],
    buses: [
      { name: '混响', fx: [{ type: 'reverb', params: { decay: 2.6, size: 0.6, predelay: 0.02, mix: 1 } }] },
      { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.35, mix: 1 } }] }
    ],
    patterns: [
      {
        name: '鼓组', bars: 2, color: '#e8665a',
        notes: () => ({
          底鼓: steps('x-----x---x----- x-----x-x-----x-'),
          拍手: steps('--------X------- --------X-------'),
          踩镲: [
            ...steps('X-x-X-x-X-x-Xxx- X-x-X-x-X-x-----', 60, { velocityScale: 0.9 }),
            ...rollNotes({ start: 28 * STEP, span: 4 * STEP, count: 8, from: 0.4, to: 0.9 })
          ],
          '开镲': steps('---------------- ----------x-----')
        })
      },
      {
        name: '808', bars: 4, color: '#d98c5f',
        notes: (bar) => ({
          808: bassLineFromChords(['Cm', 'Ab', 'Eb', 'Bb'], 'R:6 R:4~ 8:2 -:2 5:2', { octave: 2, chordLength: bar, gate: 0.95 })
        })
      },
      {
        name: '和弦', bars: 4, color: '#3fb5d6',
        notes: (bar) => ({ 铺底: chordProgressionNotes(['Cm', 'Ab', 'Eb', 'Bb'], { chordLength: bar, octave: 4, gate: 1, velocity: 0.6 }) })
      },
      {
        name: '旋律', bars: 4, color: '#8f6cf0',
        notes: () => ({ 铃音: melodyFromString('G5:3 Eb5:3 C5:2 D5:4 Eb5:4  C5:3 Ab4:3 C5:2 Eb5:8  G5:3 Bb5:3 G5:2 F5:4 Eb5:4  D5:3 Bb4:3 D5:2 C5:8', { velocity: 0.75 }) })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '副歌' }],
    arrangement: [
      { pattern: '旋律', track: 0, bar: 0, bars: 16, trackName: '旋律' },
      { pattern: '和弦', track: 1, bar: 0, bars: 16, trackName: '和弦' },
      { pattern: '鼓组', track: 2, bar: 4, bars: 12, trackName: '鼓组' },
      { pattern: '808', track: 3, bar: 4, bars: 12, trackName: '808' }
    ]
  })
};
