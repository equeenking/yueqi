// the beatbox collection on its own: mouth kick, spit snare, t-hats with an open "ts" on the last off-beat, a lip
// bass on the roots, a hummed hook and a scratch closing every 4-bar phrase
import { bassLineFromChords, melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Beatbox Jam (92 BPM, E minor: mouth drums, lip bass, hummed hook)',
  spec: () => {
    const prog = ['Em', 'C', 'G', 'D'];
    return {
      name: 'Beatbox Jam', bpm: 92, key: 'E', scale: 'minor', swing: 0.25,
      channels: [
        { name: '底鼓', kind: 'bbkick', preset: '经典 B', volume: 1.25 },
        { name: '军鼓', kind: 'bbsnare', preset: '喷气军鼓', volume: 0.95, sends: { 房间: 0.12 } },
        { name: '边击', kind: 'bbsnare', preset: 'Kch 边击', volume: 0.45, pan: 0.2 },
        { name: '踩镲', kind: 'bbhat', preset: 'T 踩镲', volume: 1, chokeGroup: 1, pan: -0.1 },
        { name: '开镲', kind: 'bbhat', preset: 'Ts 开镲', volume: 0.4, chokeGroup: 1 },
        { name: '贝斯', kind: 'bbbass', preset: '唇音贝斯', volume: 1, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.25, shape: 0.2 } }] },
        { name: '哼鸣', kind: 'bbbass', preset: '哼鸣', volume: 0.38, pan: 0.1, sends: { 房间: 0.25 } },
        { name: '搓碟', kind: 'bbfx', preset: '搓碟', volume: 0.45, pan: -0.2 }
      ],
      buses: [{ name: '房间', fx: [{ type: 'reverb', params: { decay: 1.1, size: 0.3, mix: 1 } }] }],
      patterns: [
        {
          name: '节奏', bars: 2, color: '#e8665a',
          notes: () => ({
            底鼓: steps('x-----x---x----- x-----x---x---x-'),
            军鼓: steps('----x-------x--- ----x-------x---'),
            边击: steps('-------x-------- ---------x------'),
            踩镲: steps('x-x-x-x-x-x-x--- x-x-x-x-x-x-x---', 60, { velocityScale: 0.85 }),
            '开镲': steps('--------------x- --------------x-')
          })
        },
        {
          name: '贝斯', bars: 4, color: '#d98c5f',
          notes: (bar) => ({ 贝斯: bassLineFromChords(prog, 'R:3 R:3 -:2 5:2 R:2 -:2 8:2', { octave: 2, chordLength: bar, gate: 0.8 }) })
        },
        {
          name: '哼鸣', bars: 4, color: '#c86be0',
          notes: () => ({ 哼鸣: melodyFromString('B3:4 G3:2 E3:2 -:2 G3:2 A3:4  G3:4 E3:2 C3:2 -:2 E3:2 G3:4  B3:4 D4:2 B3:2 -:2 A3:2 G3:4  F#3:4 A3:2 D4:2 -:2 E4:2 F#4:4', { velocity: 0.75, gate: 0.9 }) })
        },
        {
          name: '搓碟', bars: 1, color: '#9aa5b1',
          notes: () => ({ 搓碟: steps('--------x---x-x-') })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }, { bar: 8, name: '副歌' }],
      arrangement: [
        { pattern: '节奏', track: 0, bar: 0, bars: 16, trackName: '节奏' },
        { pattern: '贝斯', track: 1, bar: 4, bars: 12, trackName: '贝斯' },
        { pattern: '哼鸣', track: 2, bar: 8, bars: 8, trackName: '哼鸣' },
        { pattern: '搓碟', track: 3, bar: 3, bars: 1, trackName: '搓碟' },
        { pattern: '搓碟', track: 3, bar: 7, bars: 1 },
        { pattern: '搓碟', track: 3, bar: 11, bars: 1 }
      ]
    };
  }
};
