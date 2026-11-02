// reggaeton: the dembow (kick on every beat, snare on the 3-3-2 off-beats), an 808 hitting with it, nylon-guitar
// arpeggios and a plucked hook an octave above them (i–VI–III–VII)
import { STEP } from '../constants.js';
import { chordProgressionNotes, bassLineFromChords, melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '雷鬼顿（94 BPM，B 小调：dembow 节奏、尼龙弦吉他）',
  spec: () => {
    const prog = ['Bm', 'G', 'D', 'A'];
    return {
      name: '雷鬼顿', bpm: 94, key: 'B', scale: 'minor',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '劲道', volume: 0.8 },
        { name: '军鼓', kind: 'snare', preset: '紧实', volume: 1.15, sends: { 混响: 0.12 } },
        { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.7, nudge: 3 },
        { name: '邦戈鼓', kind: 'perc', preset: '邦戈鼓', volume: 0.56, pan: 0.3 },
        { name: '808', kind: 'bass808', preset: '干净', volume: 1, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.35, shape: 0.2 } }] },
        { name: '吉他', kind: 'guitar', preset: '尼龙弦', volume: 1, pan: -0.25, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.2 } },
        { name: '拨奏', kind: 'synth', preset: '拨奏', volume: 0.8, pan: 0.15, params: { gain: 1.2 }, fx: [{ type: 'eq', params: { hpf: 250 } }], sends: { 延迟: 0.25, 混响: 0.2 } }
      ],
      buses: [
        { name: '混响', fx: [{ type: 'reverb', params: { decay: 2, size: 0.55, predelay: 0.02, mix: 1 } }] },
        { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.3, mix: 1 } }] }
      ],
      patterns: [
        {
          name: 'Dembow 节奏', bars: 2, color: '#e8665a',
          notes: () => ({
            底鼓: steps('x---x---x---x--- x---x---x---x---'),
            军鼓: steps('---x--x----x--x- ---x--x----x--x-'),
            踩镲: steps('x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-', 60, { velocityScale: 0.7 }),
            邦戈鼓: [...steps('--x-------x----- --x-------x-xx--', 69, { velocityScale: 0.8 }), ...steps('-------x-------- -------x------xx', 62)]
          })
        },
        {
          name: '808', bars: 4, color: '#d98c5f',
          notes: (bar) => ({ 808: bassLineFromChords(prog, 'R:3 R:3 R:2 -:3 R:3 5:2', { octave: 2, chordLength: bar, gate: 0.9 }) })
        },
        {
          name: '吉他', bars: 4, color: '#b8864b',
          notes: (bar) => ({ 吉他: chordProgressionNotes(prog, { chordLength: bar, octave: 3, style: 'arp-updown', rate: STEP * 2, gate: 0.9, velocity: 0.65 }) })
        },
        {
          name: '副歌', bars: 4, color: '#8f6cf0',
          notes: () => ({ 拨奏: melodyFromString('F#5:3 D5:3 B4:2 C#5:2 D5:2 F#5:4  G5:3 F#5:3 D5:2 B4:4 -:4  A5:3 F#5:3 D5:2 E5:2 F#5:2 A5:4  G5:3 F#5:3 E5:2 C#5:4 -:4', { velocity: 0.75, gate: 0.8 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }, { bar: 8, name: '副歌' }],
      arrangement: [
        { pattern: '吉他', track: 0, bar: 0, bars: 16, trackName: '吉他' },
        { pattern: 'Dembow 节奏', track: 1, bar: 4, bars: 12, trackName: 'Dembow 节奏' },
        { pattern: '808', track: 2, bar: 4, bars: 12, trackName: '808' },
        { pattern: '副歌', track: 3, bar: 8, bars: 8, trackName: '副歌' }
      ]
    };
  }
};
