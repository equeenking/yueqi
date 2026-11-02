// the East Asian collection over a lo-fi beat: koto arpeggios in D hirajoshi (D E F A Bb), a temple bell opens each
// section, the shakuhachi sings long notes, taiko (odaiko + shime) lift the second half
import { melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: 'East Asian Lo-fi (82 BPM, D hirajoshi: koto, shakuhachi, taiko)',
  spec: () => ({
    name: 'East Asian Lo-fi', bpm: 82, key: 'D', scale: 'hirajoshi', swing: 0.3,
    channels: [
      { name: '底鼓', kind: 'kick', preset: '低保真', volume: 0.7 },
      { name: '军鼓', kind: 'snare', preset: '边击感', volume: 1.1, sends: { 混响: 0.15 } },
      { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 1, nudge: 6 },
      // tuned above the kick's 50 Hz so the two don't mask each other
      { name: '大太鼓', kind: 'taiko', preset: '大太鼓', params: { pitch: 66 }, volume: 0.75, sends: { 混响: 0.25 } },
      { name: '缔太鼓', kind: 'taiko', preset: '缔太鼓', volume: 0.85, pan: 0.3, sends: { 混响: 0.1 } },
      { name: '日本筝', kind: 'koto', preset: '日本筝', volume: 0.85, pan: -0.25, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.25, 延迟: 0.15 } },
      { name: '尺八', kind: 'shakuhachi', preset: '禅', volume: 0.75, pan: 0.15, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 混响: 0.4 } },
      { name: '铃音', kind: 'gong', preset: '寺钟', volume: 0.5, sends: { 混响: 0.3 } }
    ],
    buses: [
      { name: '混响', fx: [{ type: 'reverb', params: { decay: 3.2, size: 0.75, predelay: 0.03, mix: 1 } }] },
      { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.35, mix: 1 } }] }
    ],
    patterns: [
      {
        name: '节奏', bars: 1, color: '#e8665a',
        notes: () => ({
          底鼓: steps('x-------x-x-----'),
          军鼓: steps('----x-------x--o'),
          踩镲: steps('x-x-x-x-x-x-x-xo', 60, { velocityScale: 0.75 })
        })
      },
      {
        name: '太鼓', bars: 2, color: '#8c3b2e',
        notes: () => ({
          大太鼓: steps('X--------------- x-------x-------'),
          缔太鼓: steps('x-o-x-o-x-o-x-o- x-o-x-o-x-o-xxxx', 60, { velocityScale: 0.85 })
        })
      },
      {
        name: '日本筝', bars: 4, color: '#c49a6c',
        notes: () => ({
          日本筝: melodyFromString('D4:2 A4:2 Bb4:2 A4:2 F4:2 E4:2 D4:4  D4:2 A4:2 Bb4:2 D5:2 E5:2 D5:2 A4:4  Bb3:2 F4:2 A4:2 Bb4:2 D5:2 A4:2 F4:4  A3:2 E4:2 F4:2 A4:2 E4:4 D4:4', { velocity: 0.75, gate: 1 })
        })
      },
      {
        name: '尺八', bars: 4, color: '#a3b86c',
        notes: () => ({ 尺八: melodyFromString('A4:12 Bb4:4~  A4:8 F4:4 E4:4~  D4:16  -:16', { velocity: 0.7, gate: 0.9 }) })
      },
      {
        name: '铃音', bars: 1, color: '#c9a227',
        notes: () => ({ 铃音: steps('x---------------') })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }, { bar: 8, name: '太鼓' }],
    arrangement: [
      { pattern: '日本筝', track: 0, bar: 0, bars: 16, trackName: '日本筝' },
      { pattern: '尺八', track: 1, bar: 4, bars: 12, trackName: '尺八' },
      { pattern: '节奏', track: 2, bar: 4, bars: 12, trackName: '节奏' },
      { pattern: '太鼓', track: 3, bar: 8, bars: 8, trackName: '太鼓' },
      { pattern: '铃音', track: 4, bar: 0, bars: 1, trackName: '铃音' },
      { pattern: '铃音', track: 4, bar: 8, bars: 1 }
    ]
  })
};
