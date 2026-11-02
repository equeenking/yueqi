// neo-soul: a lazy swung beat (snare and hats sit late), Rhodes in rootless voicings, a legato finger bass and a
// soft organ underneath (IVmaj9–vi9–ii9–V13: every rootless voicing's added 9th stays in the key)
import { chordProgressionNotes, bassLineFromChords } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '新灵魂乐（84 BPM，降 E 大调：电钢琴、指弹贝斯、风琴）',
  spec: () => {
    const prog = ['Abmaj9', 'Cm9', 'Fm9', 'Bb13'];
    return {
      name: '新灵魂乐', bpm: 84, key: 'Eb', scale: 'major', swing: 0.35,
      channels: [
        { name: '底鼓', kind: 'kick', preset: '低保真', volume: 0.8 },
        { name: '军鼓', kind: 'snare', preset: '边击感', volume: 1, nudge: 18, sends: { 房间: 0.15 } },
        { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.7, nudge: 8, params: { color: 8000 } },
        { name: '电钢琴', kind: 'epiano', preset: '手提电钢', volume: 0.55, fx: [{ type: 'eq', params: { hpf: 120 } }], sends: { 房间: 0.2 } },
        { name: '贝斯', kind: 'bass', preset: '指弹', volume: 1, fx: [{ type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.015, makeup: 12 } }] },
        { name: '风琴', kind: 'organ', preset: '柔和', volume: 0.42, pan: 0.2, fx: [{ type: 'eq', params: { hpf: 200 } }], sends: { 房间: 0.2 } }
      ],
      buses: [{ name: '房间', fx: [{ type: 'reverb', params: { decay: 1.8, size: 0.45, predelay: 0.01, mix: 1 } }] }],
      patterns: [
        {
          name: '鼓组', bars: 2, color: '#46c79a',
          notes: () => ({
            底鼓: steps('x------x-x------ x-----x---x-----'),
            军鼓: steps('----X-------X--- ----X--o----X--o'),
            踩镲: steps('x-xox-x-x-xox-xo x-xox-x-x-xox-x-', 60, { velocityScale: 0.85 })
          })
        },
        {
          name: '电钢琴', bars: 4, color: '#d9a35f',
          notes: (bar) => ({ 电钢琴: chordProgressionNotes(prog, { chordLength: bar, octave: 4, style: 'rhythm', rhythm: 'x------x--x-----', gate: 0.95, velocity: 0.62, voicing: 'rootless', center: 64 }) })
        },
        {
          name: '贝斯', bars: 4, color: '#a8613f',
          notes: (bar) => ({ 贝斯: bassLineFromChords(prog, 'R:6 -:1 R:1 5:4 7:2 8:2', { octave: 2, chordLength: bar, gate: 1, velocity: 0.8 }) })
        },
        {
          name: '风琴', bars: 4, color: '#c4733f',
          notes: (bar) => ({ 风琴: chordProgressionNotes(prog, { chordLength: bar, octave: 4, gate: 1, velocity: 0.5, voicing: 'shell', center: 60 }) })
        }
      ],
      markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '主歌' }],
      arrangement: [
        { pattern: '电钢琴', track: 0, bar: 0, bars: 16, trackName: '电钢琴' },
        { pattern: '鼓组', track: 1, bar: 4, bars: 12, trackName: '鼓组' },
        { pattern: '贝斯', track: 2, bar: 4, bars: 12, trackName: '贝斯' },
        { pattern: '风琴', track: 3, bar: 4, bars: 12, trackName: '风琴' }
      ]
    };
  }
};
