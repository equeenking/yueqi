// synthwave: a big-room snare, a tom run and a crash framing every 4 bars, 8th-note FM bass, a 16th square arp, a
// chorused pad and a saw lead through a dotted-8th delay (i–VI–III–VII)
import { STEP } from '../constants.js';
import { chordProgressionNotes, bassFromChords, melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '合成器浪潮（100 BPM，A 小调：FM 贝斯、琶音、锯齿主音）',
  spec: () => {
    const prog = ['Am', 'F', 'C', 'G'];
    return {
      name: '合成器浪潮', bpm: 100, key: 'A', scale: 'minor',
      channels: [
        { name: '底鼓', kind: 'kick', preset: '劲道', volume: 1 },
        { name: '军鼓', kind: 'snare', preset: '肥厚', volume: 1.25, sends: { 房间: 0.35 } },
        { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.88 },
        { name: '嗵鼓', kind: 'tom', preset: '中位', volume: 0.6, sends: { 房间: 0.25 } },
        { name: '吊镲', kind: 'cymbal', preset: '吊镲', volume: 0.35, sends: { 混响: 0.15 } },
        { name: '贝斯', kind: 'fm', preset: 'FM 贝斯', volume: 0.82, params: { gain: 1.4 }, fx: [{ type: 'pump', params: { source: '底鼓', depth: 0.35, shape: 0.25 } }] },
        { name: '琶音', kind: 'synth', preset: '琶音点奏', volume: 0.88, pan: -0.2, fx: [{ type: 'eq', params: { hpf: 300 } }], sends: { 延迟: 0.3 } },
        { name: '铺底', kind: 'synth', preset: '柔和铺底', volume: 0.67, fx: [{ type: 'eq', params: { hpf: 200 } }, { type: 'chorus', params: { mix: 0.4 } }], sends: { 混响: 0.35 } },
        { name: '主音', kind: 'synth', preset: '锯齿主音', volume: 0.8, pan: 0.1, fx: [{ type: 'eq', params: { hpf: 250 } }], sends: { 延迟: 0.3, 混响: 0.25 } }
      ],
      // a short, dense room for the snare and toms (the 80s gated sound) and a long hall for the synths
      buses: [
        { name: '房间', fx: [{ type: 'reverb', params: { decay: 0.8, size: 0.9, damping: 7000, mix: 1 } }] },
        { name: '混响', fx: [{ type: 'reverb', params: { decay: 3.5, size: 0.8, predelay: 0.03, mix: 1 } }] },
        { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.4, mix: 1 } }] }
      ],
      patterns: [
        {
          name: '鼓组', bars: 4, color: '#e8665a',
          notes: (bar) => ({
            底鼓: steps('x-------x------- x-------x------- x-------x------- x-------x-------'),
            军鼓: steps('----x-------x--- ----x-------x--- ----x-------x--- ----x-----------'),
            踩镲: steps('x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x- x-x-x-x-x-x-----', 60, { velocityScale: 0.7 }),
            // drum notes are pitched: a run down from high to floor tom
            嗵鼓: [
              ...steps('xx', 67, { offset: 3 * bar + 10 * STEP }),
              ...steps('xx', 62, { offset: 3 * bar + 12 * STEP }),
              ...steps('Xx', 57, { offset: 3 * bar + 14 * STEP })
            ],
            吊镲: steps('X')
          })
        },
        {
          name: '贝斯', bars: 4, color: '#d98c5f',
          notes: (bar) => ({ 贝斯: bassFromChords(prog, { octave: 2, chordLength: bar, rhythm: 'x-x-x-x-x-x-x-x-', gate: 0.6, velocity: 0.8 }) })
        },
        {
          name: '琶音', bars: 4, color: '#f5d547',
          notes: (bar) => ({ 琶音: chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'arp-up', rate: STEP, gate: 0.8, velocity: 0.6 }) })
        },
        {
          name: '铺底', bars: 4, color: '#3fb5d6',
          notes: (bar) => ({ 铺底: chordProgressionNotes(prog, { chordLength: bar, octave: 4, gate: 1, velocity: 0.55, voicing: 'open', center: 64 }) })
        },
        {
          name: '主音', bars: 4, color: '#8f6cf0',
          notes: () => ({ 主音: melodyFromString('E5:4 A5:4 G5:2 E5:2 C5:4  C5:4 F5:4 E5:2 C5:2 A4:4  E5:4 G5:4 C6:4 B5:2 G5:2  D5:6 B4:2 G4:4 -:4', { velocity: 0.75, gate: 0.9 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }, { bar: 12, name: '主音' }],
      arrangement: [
        { pattern: '铺底', track: 0, bar: 0, bars: 20, trackName: '铺底' },
        { pattern: '琶音', track: 1, bar: 0, bars: 20, trackName: '琶音' },
        { pattern: '鼓组', track: 2, bar: 4, bars: 16, trackName: '鼓组' },
        { pattern: '贝斯', track: 3, bar: 4, bars: 16, trackName: '贝斯' },
        { pattern: '主音', track: 4, bar: 12, bars: 8, trackName: '主音' }
      ]
    };
  }
};
