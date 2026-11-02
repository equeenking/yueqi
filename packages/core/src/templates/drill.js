// UK drill: half-time snare on beat 3 with a late hit, hats in 3-3-2 groups ending in a triplet roll, an 808 that
// slides up an octave, a dark piano line over strings (i–VI–iv–V, the D chord's F# from harmonic minor)
import { STEP } from '../constants.js';
import { chordProgressionNotes, bassLineFromChords, melodyFromString, rollNotes } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'UK Drill (142 BPM, G harmonic minor: sliding 808, dark piano)',
  spec: () => {
    const prog = ['Gm', 'Eb', 'Cm', 'D'];
    return {
      name: 'UK Drill', bpm: 142, key: 'G', scale: 'harmonicMinor',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '陷阱', volume: 0.8 },
        { name: '军鼓', kind: 'snare', preset: '陷阱', volume: 0.6, sends: { 混响: 0.12 } },
        { name: '踩镲', kind: 'hat', preset: '清脆', volume: 0.63, nudge: -2 },
        { name: '边击', kind: 'rim', preset: '经典', volume: 0.4, pan: 0.25, sends: { 混响: 0.1 } },
        { name: '808', kind: 'bass808', preset: '长', volume: 0.64, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.35, shape: 0.25 } }] },
        { name: '钢琴', kind: 'piano', preset: '三角钢琴', volume: 0.7, params: { gain: 1.3 }, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.3, 延迟: 0.15 } },
        { name: '弦乐', kind: 'strings', preset: '合奏', volume: 0.72, fx: [{ type: 'eq', params: { hpf: 180 } }], sends: { 混响: 0.4 } }
      ],
      buses: [
        { name: '混响', fx: [{ type: 'reverb', params: { decay: 2.4, size: 0.6, predelay: 0.02, mix: 1 } }] },
        { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.3, mix: 1 } }] }
      ],
      patterns: [
        {
          name: '鼓组', bars: 2, color: '#e8665a',
          notes: () => ({
            底鼓: steps('X---------x----- X---------x-----'),
            军鼓: steps('--------X-----x- --------X--x----'),
            踩镲: [
              ...steps('X--x--x-x--x--x- x--x--x-x--x----', 60, { velocityScale: 0.85 }),
              ...rollNotes({ start: 28 * STEP, span: 4 * STEP, count: 6, from: 0.45, to: 0.85 })
            ],
            边击: steps('------x--------x ----x-------x---')
          })
        },
        {
          name: '808', bars: 4, color: '#d98c5f',
          notes: (bar) => ({ 808: bassLineFromChords(prog, 'R:6 -:4 R:2~ 8:2 -:2', { octave: 2, chordLength: bar, gate: 0.95 }) })
        },
        {
          name: '钢琴', bars: 4, color: '#e4d9b8',
          notes: () => ({ 钢琴: melodyFromString('G4:2 Bb4:2 D5:2 F#5:2 G5:4 D5:4  Eb5:2 D5:2 Bb4:2 G4:2 Eb4:8  C5:2 Eb5:2 G5:2 Eb5:2 C5:4 Bb4:4  A4:2 C5:2 D5:2 F#5:2 A5:4 F#5:4', { velocity: 0.7, gate: 0.9 }) })
        },
        {
          name: '弦乐', bars: 4, color: '#b55e7a',
          notes: (bar) => ({ 弦乐: chordProgressionNotes(prog, { chordLength: bar, octave: 4, gate: 1, velocity: 0.55, voicing: 'open', center: 62 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }],
      arrangement: [
        { pattern: '钢琴', track: 0, bar: 0, bars: 16, trackName: '钢琴' },
        { pattern: '弦乐', track: 1, bar: 0, bars: 16, trackName: '弦乐' },
        { pattern: '鼓组', track: 2, bar: 4, bars: 12, trackName: '鼓组' },
        { pattern: '808', track: 3, bar: 4, bars: 12, trackName: '808' }
      ]
    };
  }
};
