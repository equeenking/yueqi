// cinematic: a felt-piano ostinato over low strings, a solo cello takes the theme, then a reverse swell and a tam-tam
// open the big half where staccato strings and taiko drive (i–VI–III–VII)
import { STEP } from '../constants.js';
import { chordProgressionNotes, melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'Cinematic (90 BPM, D minor: strings, solo cello, taiko)',
  spec: () => {
    const prog = ['Dm', 'Bb', 'F', 'C'];
    return {
      name: 'Cinematic', bpm: 90, key: 'D', scale: 'minor',
      channels: [
        { name: '大太鼓', kind: 'taiko', preset: '大太鼓', volume: 0.64, sends: { 大厅: 0.25 } },
        { name: '中太鼓', kind: 'taiko', preset: '中太鼓', volume: 0.7, pan: -0.2, sends: { 大厅: 0.2 } },
        { name: '大锣', kind: 'gong', preset: '大锣', volume: 0.5, sends: { 大厅: 0.3 } },
        { name: '钢琴', kind: 'piano', preset: '毡音', volume: 1, fx: [{ type: 'eq', params: { hpf: 80 } }], sends: { 大厅: 0.3 } },
        { name: '弦乐', kind: 'strings', preset: '合奏', volume: 0.75, fx: [{ type: 'eq', params: { hpf: 60 } }], sends: { 大厅: 0.35 } },
        { name: '断奏', kind: 'strings', preset: '断奏', volume: 0.55, pan: 0.2, fx: [{ type: 'eq', params: { hpf: 100 } }], sends: { 大厅: 0.2 } },
        { name: '大提琴', kind: 'strings', preset: '大提琴独奏', volume: 1.25, pan: -0.15, sends: { 大厅: 0.3 } },
        { name: '渐强', kind: 'synth', preset: '反向渐强', volume: 1, params: { gain: 1 }, sends: { 大厅: 0.3 } }
      ],
      buses: [{ name: '大厅', fx: [{ type: 'reverb', params: { decay: 4.5, size: 0.9, predelay: 0.04, mix: 1 } }] }],
      patterns: [
        {
          name: '太鼓', bars: 2, color: '#8c3b2e',
          notes: () => ({
            大太鼓: steps('X-------x-x----- X-------x---x-x-'),
            中太鼓: steps('x--x--x-x--x--x- x--x--x-x-x-xxxx', 60, { velocityScale: 0.8 })
          })
        },
        {
          name: '大锣', bars: 1, color: '#c9a227',
          notes: () => ({ '大锣': steps('X') })
        },
        {
          // the swell's 1.5 s attack peaks right on the next downbeat
          name: '渐强', bars: 1, color: '#9aa5b1',
          notes: () => ({ 渐强: melodyFromString('-:7 D4:9', { velocity: 0.8, gate: 1 }) })
        },
        {
          name: '钢琴', bars: 4, color: '#e4d9b8',
          notes: (bar) => ({ 钢琴: chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'arp-updown', rate: STEP * 2, gate: 0.9, velocity: 0.55 }) })
        },
        {
          name: '弦乐', bars: 4, color: '#b55e7a',
          notes: (bar) => ({ 弦乐: chordProgressionNotes(prog, { chordLength: bar, octave: 3, gate: 1, velocity: 0.6, voicing: 'spread', center: 57 }) })
        },
        {
          name: '断奏', bars: 4, color: '#d9774e',
          notes: (bar) => ({ 断奏: chordProgressionNotes(prog, { chordLength: bar, octave: 3, style: 'rhythm', rhythm: 'x-xxx-xxx-xxx-xx', gate: 0.5, velocity: 0.7, voicing: 'close', center: 55 }) })
        },
        {
          name: '大提琴', bars: 4, color: '#a0785a',
          notes: () => ({ 大提琴: melodyFromString('A3:6 D4:2 F4:4 E4:4  D4:6 F4:2 Bb3:8  C4:6 A3:2 F3:4 A3:4  G3:6 E3:2 C4:8', { velocity: 0.75, gate: 0.95 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主题' }, { bar: 8, name: 'Epic' }],
      arrangement: [
        { pattern: '钢琴', track: 0, bar: 0, bars: 16, trackName: '钢琴' },
        { pattern: '弦乐', track: 1, bar: 0, bars: 16, trackName: '弦乐' },
        { pattern: '大提琴', track: 2, bar: 4, bars: 12, trackName: '大提琴' },
        { pattern: '断奏', track: 3, bar: 8, bars: 8, trackName: '断奏' },
        { pattern: '太鼓', track: 4, bar: 8, bars: 8, trackName: '太鼓' },
        { pattern: '渐强', track: 5, bar: 7, bars: 1, trackName: 'FX' },
        { pattern: '大锣', track: 5, bar: 8, bars: 1 }
      ]
    };
  }
};
