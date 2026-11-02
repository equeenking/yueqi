// afrobeats: a 3-3-2 kick, rim backbeat, accented 16th shakers and two-tone congas answering in the gaps; a highlife
// guitar picks the chord tones over a syncopated finger bass (I–V–vi–IV)
import { chordProgressionNotes, bassLineFromChords, melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Afrobeats (104 BPM, Bb major: congas, highlife guitar)',
  spec: () => {
    const prog = ['Bbmaj7', 'F', 'Gm7', 'Ebmaj7'];
    return {
      name: 'Afrobeats', bpm: 104, key: 'Bb', scale: 'major', swing: 0.15,
      channels: [
        { name: '底鼓', kind: 'kick', preset: '厚重', volume: 1 },
        { name: '边击', kind: 'rim', preset: '经典', volume: 1.1, sends: { 混响: 0.12 } },
        { name: '沙锤', kind: 'shaker', preset: '经典', volume: 0.4, pan: 0.2 },
        { name: '康加鼓', kind: 'perc', preset: '康加鼓', volume: 0.7, pan: -0.3, sends: { 混响: 0.1 } },
        { name: '贝斯', kind: 'bass', preset: '指弹', volume: 1, fx: [{ type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.015, makeup: 11 } }, { type: 'pump', params: { source: '底鼓', depth: 0.25, shape: 0.2 } }] },
        { name: '吉他', kind: 'guitar', preset: '清音电吉他', volume: 0.85, pan: 0.3, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 延迟: 0.2, 混响: 0.15 } },
        { name: '铺底', kind: 'synth', preset: '柔和铺底', volume: 0.45, fx: [{ type: 'eq', params: { hpf: 250 } }, { type: 'pump', params: { source: '底鼓', depth: 0.5 } }], sends: { 混响: 0.3 } }
      ],
      buses: [
        { name: '混响', fx: [{ type: 'reverb', params: { decay: 2.2, size: 0.55, predelay: 0.02, mix: 1 } }] },
        { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.3, mix: 1 } }] }
      ],
      patterns: [
        {
          name: '鼓组', bars: 2, color: '#e8665a',
          notes: () => ({
            底鼓: steps('x--x--x---x----- x-----x-x-------'),
            边击: steps('----x-------x--- ----x-------x--x'),
            沙锤: steps('7373737373737373 7373737373737373'),
            // open tones up a fifth, slaps on the base pitch
            康加鼓: [...steps('--x--x----x--x-- --x--x----x-----', 67), ...steps('-------x-------x -------x----x-x-', 60)]
          })
        },
        {
          name: '贝斯', bars: 4, color: '#a8613f',
          notes: (bar) => ({ 贝斯: bassLineFromChords(prog, 'R:3 R:3 5:2 R:3 8:3 5:2', { octave: 2, chordLength: bar, gate: 0.85, velocity: 0.85 }) })
        },
        {
          name: '吉他', bars: 4, color: '#b8864b',
          notes: () => ({
            吉他: melodyFromString('F4 Bb4 D5:2 F5 D5 A4:2 Bb4 D5 F5:2 D5:2 A4:2  C4 F4 A4:2 C5 A4 F4:2 C4 F4 A4:2 C5:2 A4:2  D4 G4 Bb4:2 D5 Bb4 F4:2 G4 Bb4 D5:2 Bb4:2 F4:2  Eb4 G4 Bb4:2 D5 Bb4 G4:2 Eb4 G4 Bb4:2 G4:2 D4:2', { velocity: 0.7, gate: 0.55 })
          })
        },
        {
          name: '铺底', bars: 4, color: '#3fb5d6',
          notes: (bar) => ({ 铺底: chordProgressionNotes(prog, { chordLength: bar, octave: 4, gate: 1, velocity: 0.5, voicing: 'open', center: 64 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '律动' }],
      arrangement: [
        { pattern: '吉他', track: 0, bar: 0, bars: 16, trackName: '吉他' },
        { pattern: '铺底', track: 1, bar: 0, bars: 16, trackName: '铺底' },
        { pattern: '鼓组', track: 2, bar: 4, bars: 12, trackName: '鼓组' },
        { pattern: '贝斯', track: 3, bar: 4, bars: 12, trackName: '贝斯' }
      ]
    };
  }
};
