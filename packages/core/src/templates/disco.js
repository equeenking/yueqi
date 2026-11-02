// disco funk: four on the floor with open hats on the off-beats, a slap bass jumping octaves, muted 16th guitar,
// brass stabs, and a string section for the last eight bars (i9–IV9–bIIImaj7–ii7: the dorian IV is major)
import { chordProgressionNotes, bassLineFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Disco Funk (118 BPM, E dorian: slap bass, muted guitar, brass)',
  spec: () => {
    const prog = ['Em9', 'A9', 'Gmaj7', 'F#m7'];
    return {
      name: 'Disco Funk', bpm: 118, key: 'E', scale: 'dorian',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '浩室重击', volume: 0.85 },
        { name: '拍手', kind: 'clap', preset: '经典', volume: 1.2, sends: { 混响: 0.15 } },
        { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.62, chokeGroup: 1, nudge: 3 },
        { name: '开镲', kind: 'hat', preset: '开镲', volume: 0.4, chokeGroup: 1 },
        { name: '贝斯', kind: 'bass', preset: '击弦', volume: 1, fx: [{ type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.01, makeup: 11 } }, { type: 'pump', params: { source: '底鼓', depth: 0.2, shape: 0.2 } }] },
        { name: '吉他', kind: 'guitar', preset: '闷音', volume: 0.31, pan: 0.35, fx: [{ type: 'eq', params: { hpf: 250 } }] },
        { name: '铜管', kind: 'synth', preset: '铜管', volume: 0.32, pan: -0.2, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 混响: 0.2 } },
        { name: '弦乐', kind: 'strings', preset: '合奏', volume: 0.57, pan: -0.1, fx: [{ type: 'eq', params: { hpf: 300 } }], sends: { 混响: 0.35 } }
      ],
      buses: [{ name: '混响', fx: [{ type: 'reverb', params: { decay: 2, size: 0.55, predelay: 0.02, mix: 1 } }] }],
      patterns: [
        {
          name: '鼓组', bars: 1, color: '#e8665a',
          notes: () => ({
            底鼓: steps('x---x---x---x---'),
            拍手: steps('----x-------x---'),
            // closed hats rest under the open ones: they share a choke group
            踩镲: steps('xo-oxo-oxo-oxo-o'),
            '开镲': steps('--x---x---x---x-')
          })
        },
        {
          name: '贝斯', bars: 4, color: '#a8613f',
          notes: (bar) => ({ 贝斯: bassLineFromChords(prog, 'R:2 8:1 -:1 R:1 R:1 8:2 -:2 R:1 8:1 5:2 7:2', { octave: 2, chordLength: bar, gate: 0.8, velocity: 0.85 }) })
        },
        {
          name: '吉他', bars: 4, color: '#b8864b',
          notes: (bar) => ({ 吉他: chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'rhythm', rhythm: 'x-xxx-x-x-xxx-x-', gate: 0.35, velocity: 0.7, voicing: 'close', center: 64 }) })
        },
        {
          name: '铜管', bars: 4, color: '#f2a03d',
          notes: (bar) => ({ 铜管: chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'rhythm', rhythm: '------x---x-----', gate: 0.5, velocity: 0.75, voicing: 'close', center: 67 }) })
        },
        {
          name: '弦乐', bars: 4, color: '#b55e7a',
          notes: (bar) => ({ 弦乐: chordProgressionNotes(prog, { chordLength: bar, octave: 5, gate: 1, velocity: 0.55, voicing: 'open', center: 72 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '律动' }, { bar: 12, name: '弦乐' }],
      arrangement: [
        { pattern: '鼓组', track: 0, bar: 0, bars: 20, trackName: '鼓组' },
        { pattern: '吉他', track: 1, bar: 0, bars: 20, trackName: '吉他' },
        { pattern: '贝斯', track: 2, bar: 4, bars: 16, trackName: '贝斯' },
        { pattern: '铜管', track: 3, bar: 4, bars: 16, trackName: '铜管' },
        { pattern: '弦乐', track: 4, bar: 12, bars: 8, trackName: '弦乐' }
      ]
    };
  }
};
