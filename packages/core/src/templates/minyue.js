// 民乐合奏：C 宫五声（C D E G A）里的小合奏——古筝走句开场，二胡如歌的长句接进，笛子在合奏段
// 点亮高音，锣在每个乐段开头点一下；底鼓和踩镲只给一点点律动，课堂里学生容易跟着拍手。
import { melodyFromString } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '民乐合奏（88 BPM，C 宫五声：古筝、二胡、笛子、锣）',
  spec: () => ({
    name: '民乐合奏', bpm: 88, key: 'C', scale: 'majorPentatonic',
    channels: [
      { name: '古筝', kind: 'guzheng', preset: '古筝', volume: 0.85, pan: -0.2, fx: [{ type: 'eq', params: { hpf: 150 } }], sends: { 混响: 0.25, 延迟: 0.1 } },
      { name: '二胡', kind: 'erhu', volume: 0.8, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 混响: 0.3 } },
      { name: '笛子', kind: 'dizi', preset: '笛子', volume: 0.7, pan: 0.25, fx: [{ type: 'eq', params: { hpf: 250 } }], sends: { 混响: 0.25 } },
      { name: '锣', kind: 'gong', volume: 0.5, sends: { 混响: 0.35 } },
      { name: '底鼓', kind: 'kick', preset: '低保真', volume: 0.65 },
      { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.8 }
    ],
    buses: [
      { name: '混响', fx: [{ type: 'reverb', params: { decay: 2.8, size: 0.7, predelay: 0.03, mix: 1 } }] },
      { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.3, mix: 1 } }] }
    ],
    patterns: [
      {
        name: '古筝', bars: 4, color: '#d9774e',
        notes: () => ({
          古筝: melodyFromString('C4:2 D4:2 E4:2 G4:2 A4:2 G4:2 E4:2 D4:2  C4:2 E4:2 G4:2 A4:2 C5:2 A4:2 G4:4  A4:2 C5:2 D5:2 E5:2 D5:2 C5:2 A4:2 G4:2  E4:2 G4:2 A4:4 E4:2 D4:4 C4:2', { velocity: 0.75, gate: 1 })
        })
      },
      {
        name: '二胡', bars: 4, color: '#c0504d',
        notes: () => ({
          二胡: melodyFromString('A4:8 G4:8  E4:8 D4:8  C4:8 D4:8  E4:4 D4:4 C4:8', { velocity: 0.7, gate: 0.95 })
        })
      },
      {
        name: '笛子', bars: 4, color: '#e8c35a',
        notes: () => ({
          笛子: melodyFromString('C5:4 A4:4 G4:4 A4:4  C5:4 D5:4 C5:4 A4:4  G4:4 A4:4 C5:4 A4:4  G4:8 E4:4 D4:4', { velocity: 0.65, gate: 0.9 })
        })
      },
      {
        name: '节奏', bars: 1, color: '#e8665a',
        notes: () => ({
          底鼓: steps('x-------x-------'),
          踩镲: steps('x-x-x-x-x-x-x-x-', 55, { velocityScale: 0.75 })
        })
      },
      {
        name: '锣', bars: 1, color: '#c9a227',
        notes: () => ({ 锣: steps('x---------------') })
      }
    ],
    markers: [{ bar: 0, name: '古筝' }, { bar: 4, name: '节奏进' }, { bar: 8, name: '合奏' }],
    arrangement: [
      { pattern: '古筝', track: 0, bar: 0, bars: 16, trackName: '古筝' },
      { pattern: '节奏', track: 1, bar: 4, bars: 12, trackName: '节奏' },
      { pattern: '二胡', track: 2, bar: 8, bars: 8, trackName: '二胡' },
      { pattern: '笛子', track: 3, bar: 8, bars: 8, trackName: '笛子' },
      { pattern: '锣', track: 4, bar: 0, bars: 1, trackName: '锣' },
      { pattern: '锣', track: 4, bar: 8, bars: 1 }
    ]
  })
};
