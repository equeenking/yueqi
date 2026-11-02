// the Indian collection: a tanpura drone and a sitar alap, then the tabla's keherwa (Dha Ge Na Tin | Na Ke Dhin Na,
// ending on a TiRaKiTa) with a harmonium on Sa–Pa; the bansuri answers. Dha = Na + Ge and Dhin = Tin + Ge, so four
// bol channels (plus Te for the fill) play the whole theka.
import { melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '印度融合（92 BPM，C 调 Bhairav 音阶：西塔琴、塔布拉、坦布拉、班苏里笛、风琴）',
  spec: () => ({
    name: '印度融合', bpm: 92, key: 'C', scale: 'bhairav',
    channels: [
      { name: '坦布拉', kind: 'tanpura', preset: '坦布拉', volume: 0.95, sends: { 混响: 0.25 } },
      { name: 'Na', kind: 'tabla', preset: 'Na 音', volume: 0.7, pan: 0.15, sends: { 混响: 0.12 } },
      { name: 'Tin', kind: 'tabla', preset: '锡', volume: 0.85, pan: 0.15, sends: { 混响: 0.12 } },
      { name: 'Te', kind: 'tabla', preset: '特', volume: 1, pan: 0.15 },
      { name: 'Ge', kind: 'tabla', preset: 'Ge 滑音', volume: 0.55, pan: -0.15, sends: { 混响: 0.1 } },
      { name: 'Ke', kind: 'tabla', preset: '克', volume: 0.95, pan: -0.15 },
      { name: '西塔琴', kind: 'sitar', preset: '西塔琴', volume: 0.85, pan: -0.2, fx: [{ type: 'eq', params: { hpf: 100 } }], sends: { 混响: 0.3 } },
      { name: '风琴', kind: 'harmonium', preset: '柔和', volume: 0.45, pan: 0.25, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.2 } },
      { name: '班苏里笛', kind: 'bansuri', preset: '班苏里笛', volume: 0.8, pan: 0.1, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 混响: 0.35, 延迟: 0.18 } }
    ],
    buses: [
      { name: '混响', fx: [{ type: 'reverb', params: { decay: 3, size: 0.7, predelay: 0.03, mix: 1 } }] },
      { name: '延迟', fx: [{ type: 'delay', params: { time: '1/4d', feedback: 0.3, mix: 1 } }] }
    ],
    patterns: [
      {
        // Pa, Sa, Sa, low Sa: the tanpura's cycle, each string left to ring
        name: '坦布拉', bars: 2, color: '#a0785a',
        notes: () => ({ 坦布拉: melodyFromString('G2:8 C3:8 C3:8 C2:8', { velocity: 0.7, gate: 1 }) })
      },
      {
        name: '塔拉循环', bars: 2, color: '#b5651d',
        notes: () => ({
          Na: steps('X---x---x-----x- X---x---x------x'),
          Ge: steps('X-x---------x--- X-x-------------'),
          Tin: steps('------x-----x--- ------x---------'),
          Ke: steps('----------x----- ----------x---x-'),
          Te: steps('---------------- ------------xo--')
        })
      },
      {
        name: '西塔琴', bars: 4, color: '#d98b3a',
        notes: () => ({
          // "~" = meend: the note runs into the next one and the mono sitar slides there
          西塔琴: melodyFromString('C4:4 Db4:2~ C4:2 B3:4 C4:4  E4:4 F4:2 E4:2~ Db4:4 C4:4  G4:6 Ab4:2~ G4:4 F4:4  E4:2 F4:2 E4:2~ Db4:2 C4:8', { velocity: 0.8, gate: 0.92 })
        })
      },
      {
        name: '风琴', bars: 1, color: '#b5835a',
        notes: () => ({ 风琴: [...melodyFromString('C4:16', { velocity: 0.6, gate: 1 }), ...melodyFromString('G3:16', { velocity: 0.55, gate: 1 })] })
      },
      {
        name: '班苏里笛', bars: 4, color: '#e0a458',
        notes: () => ({
          班苏里笛: melodyFromString('G4:8 Ab4:4~ G4:4  F4:4 E4:4~ F4:8  E4:4 Db4:4 E4:4~ F4:4  E4:4~ Db4:4 C4:8', { velocity: 0.75, gate: 0.9 })
        })
      }
    ],
    markers: [{ bar: 0, name: '阿拉普（散板）' }, { bar: 4, name: '塔拉循环' }, { bar: 12, name: '班苏里笛' }],
    arrangement: [
      { pattern: '坦布拉', track: 0, bar: 0, bars: 20, trackName: '坦布拉' },
      { pattern: '西塔琴', track: 1, bar: 0, bars: 12, trackName: '西塔琴' },
      { pattern: '塔拉循环', track: 2, bar: 4, bars: 16, trackName: '塔布拉' },
      { pattern: '风琴', track: 3, bar: 4, bars: 16, trackName: '风琴' },
      { pattern: '班苏里笛', track: 4, bar: 12, bars: 8, trackName: '班苏里笛' }
    ]
  })
};
