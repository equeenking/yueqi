import { STEP } from '../constants.js';
import { melodyFromString, repeatNotes } from '../builders.js';
import { steps } from './steps.js';

export default {
  label: '酸性铁克诺（132 BPM）',
  spec: () => ({
    name: '酸性铁克诺', bpm: 132, key: 'A', scale: 'minor',
    channels: [
      { name: '底鼓', kind: 'kick', preset: '硬朗', volume: 0.85 },
      { name: '拍手', kind: 'clap', preset: '紧实', volume: 0.55, sends: { 混响: 0.2 } },
      { name: '踩镲', kind: 'hat', preset: '闭镲', volume: 0.4 },
      { name: '开镲', kind: 'hat', preset: '开镲', volume: 0.4, params: { decay: 0.2 } },
      { name: '酸性', kind: 'synth', preset: '酸性贝斯', volume: 0.6, fx: [{ type: 'distortion', params: { drive: 0.3, mix: 0.5 } }, { type: 'pump', params: { source: '底鼓', depth: 0.35, shape: 0.3 } }], sends: { 延迟: 0.18 } }
    ],
    buses: [
      { name: '混响', fx: [{ type: 'reverb', params: { decay: 1.8, size: 0.6, mix: 1 } }] },
      { name: '延迟', fx: [{ type: 'delay', params: { time: '1/8d', feedback: 0.4, mix: 1 } }] }
    ],
    patterns: [
      {
        name: '鼓组', bars: 1, color: '#9aa5b1',
        notes: () => ({
          底鼓: steps('x---x---x---x---'),
          拍手: steps('----x-------x---'),
          踩镲: steps('oxoxoxoxoxoxoxox'),
          '开镲': steps('--x---x---x---x-')
        })
      },
      {
        name: '酸性旋律线', bars: 2, color: '#f5d547',
        notes: () => ({ 酸性: repeatNotes(melodyFromString('A2:1 A2:1! A3:1 A2:1 C3:1! A2:1 E3:1 A2:1 -:1 G3:1! A2:1 A3:1 C3:1 A2:1 G2:1! A2:1', { gate: 0.6 }), 16 * STEP, 2) })
      }
    ],
    markers: [{ bar: 0, name: '前奏' }, { bar: 4, name: '酸性' }],
    arrangement: [
      { pattern: '鼓组', track: 0, bar: 0, bars: 16, trackName: '鼓组' },
      { pattern: '酸性旋律线', track: 1, bar: 4, bars: 12, trackName: '酸性' }
    ]
  })
};
