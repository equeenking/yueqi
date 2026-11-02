// liquid drum & bass: a two-step break (kick on 1 and the "and" of 3, snare on 2 and 4) under a ride, a reese bass
// ducking under the kick, Rhodes and a pad holding each chord for two bars
import { chordProgressionNotes, bassLineFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Liquid Drum & Bass (174 BPM, F minor: reese bass, Rhodes)',
  spec: () => {
    const prog = ['Fm9', 'Dbmaj9', 'Bbm9', 'Eb9'];
    return {
      name: 'Liquid Drum & Bass', bpm: 174, key: 'F', scale: 'minor',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '劲道', volume: 0.8 },
        { name: '军鼓', kind: 'snare', preset: '肥厚', volume: 0.75, sends: { 混响: 0.15 } },
        { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 1 },
        { name: '叮叮镲', kind: 'cymbal', preset: '叮叮镲', volume: 0.24, pan: 0.25 },
        { name: '里斯贝斯', kind: 'synth', preset: '里斯贝斯', volume: 0.9, params: { gain: 1.2 }, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.4, shape: 0.2 } }, { type: 'stereo', params: { width: 1, monoBelow: 150 } }] },
        { name: '电钢琴', kind: 'epiano', preset: '手提电钢', volume: 0.6, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.3, 延迟: 0.15 } },
        { name: '铺底', kind: 'synth', preset: '柔和铺底', volume: 0.35, fx: [{ type: 'eq', params: { hpf: 250 } }, { type: 'pump', params: { source: '底鼓', depth: 0.5 } }], sends: { 混响: 0.4 } }
      ],
      buses: [
        { name: '混响', fx: [{ type: 'reverb', params: { decay: 3, size: 0.7, predelay: 0.02, mix: 1 } }] },
        { name: '延迟', fx: [{ type: 'delay', params: { time: '1/4t', feedback: 0.3, mix: 1 } }] }
      ],
      patterns: [
        {
          name: '鼓组', bars: 2, color: '#e8665a',
          notes: () => ({
            底鼓: steps('X---------x----- X-x-------x-----'),
            军鼓: steps('----X-------X--- ----X-------X--o'),
            踩镲: steps('x-o-x-o-x-o-x-ox x-o-x-o-x-o-x-o-', 60, { velocityScale: 0.8 }),
            叮叮镲: steps('--x---x---x---x- --x---x---x---x-')
          })
        },
        {
          name: '里斯贝斯', bars: 8, color: '#d98c5f',
          notes: (bar) => ({ 里斯贝斯: bassLineFromChords(prog, 'R:20 R:4 -:2 8:2~ R:4', { octave: 2, chordLength: 2 * bar, gate: 0.95 }) })
        },
        {
          name: '电钢琴', bars: 8, color: '#d9a35f',
          notes: (bar) => ({ 电钢琴: chordProgressionNotes(prog, { chordLength: 2 * bar, octave: 4, style: 'rhythm', rhythm: 'x-------------x- ------x---------', gate: 0.95, velocity: 0.6, voicing: 'rootless', center: 64 }) })
        },
        {
          name: '铺底', bars: 8, color: '#3fb5d6',
          notes: (bar) => ({ 铺底: chordProgressionNotes(prog, { chordLength: 2 * bar, octave: 4, gate: 1, velocity: 0.45, voicing: 'open', center: 67 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 8, name: '高潮' }],
      arrangement: [
        { pattern: '电钢琴', track: 0, bar: 0, bars: 24, trackName: '电钢琴' },
        { pattern: '铺底', track: 1, bar: 0, bars: 24, trackName: '铺底' },
        { pattern: '鼓组', track: 2, bar: 8, bars: 16, trackName: '鼓组' },
        { pattern: '里斯贝斯', track: 3, bar: 8, bars: 16, trackName: '里斯贝斯' }
      ]
    };
  }
};
