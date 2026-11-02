// Global keyboard: transport/window shortcuts and the "typing keyboard to piano".
import { useStore } from '../state/store.js';
import { newPattern } from './actions.js';

// Two rows: Z-row = lower octave, Q-row = upper octave
const PIANO = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
  Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31
};

// physical key -> { key, channelId } captured at key-down, so key-up releases the same note even if
// the octave or selected channel changed while the key was held
const heldKeys = new Map();

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function installKeyboard() {
  const down = (e) => {
    if (isTyping(e)) return;
    const st = useStore.getState();
    if (!st.project) return;
    const mod = e.ctrlKey || e.metaKey;
    if (st.modal) return;

    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); st.redo(); return; }
    if (mod && e.code === 'KeyS') { e.preventDefault(); st.toast('工程会自动保存', 'info', 1800); return; }
    if (mod) return; // leave other ctrl shortcuts to focused editors / browser

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        st.unlockAudio();
        st.togglePlay();
        return;
      case 'F5': e.preventDefault(); st.toggleWindow('playlist'); return;
      case 'F6': e.preventDefault(); st.toggleWindow('channelRack'); return;
      case 'F7': e.preventDefault(); st.toggleWindow('pianoRoll'); return;
      case 'F8':
        e.preventDefault();
        if (e.altKey) st.setPref('browserOpen', !st.browserOpen);
        else st.toggleWindow('channelSettings');
        return;
      case 'F9': e.preventDefault(); st.toggleWindow('mixer'); return;
      case 'F4': e.preventDefault(); newPattern(); return;
      case 'Escape': st.hideContextMenu(); return;
      default:
    }
    if (e.altKey) return;
    if (e.code === 'KeyL' && e.shiftKey) { st.setMode(st.mode === 'song' ? 'pattern' : 'song'); return; }
    if (e.code === 'NumpadAdd' || (e.code === 'ArrowUp' && e.shiftKey && !e.target.closest?.('.piano-roll'))) {
      const i = st.project.patterns.findIndex((p) => p.id === st.selectedPatternId);
      if (i < st.project.patterns.length - 1) st.selectPattern(st.project.patterns[i + 1].id);
      return;
    }
    if (e.code === 'NumpadSubtract') {
      const i = st.project.patterns.findIndex((p) => p.id === st.selectedPatternId);
      if (i > 0) st.selectPattern(st.project.patterns[i - 1].id);
      return;
    }
    if (e.target.closest?.('.piano-roll-grid, .playlist-grid') && ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
    if (e.code === 'ArrowDown' && e.shiftKey) return;
    if (e.code === 'Minus' && !e.repeat) { const o = Math.max(0, st.kbOctave - 1); st.setPref('kbOctave', o); st.toast(`电脑键盘八度 C${o}`, 'info', 1000); return; }
    if (e.code === 'Equal' && e.shiftKey && !e.repeat) { const o = Math.min(8, st.kbOctave + 1); st.setPref('kbOctave', o); st.toast(`电脑键盘八度 C${o}`, 'info', 1000); return; }
    if (e.shiftKey) return;
    const semi = PIANO[e.code];
    if (semi !== undefined) {
      e.preventDefault();
      if (e.repeat || heldKeys.has(e.code)) return;
      const key = (st.kbOctave + 1) * 12 + semi;
      if (key <= 127 && st.selectedChannelId) {
        heldKeys.set(e.code, { key, channelId: st.selectedChannelId });
        st.liveNoteOn(key, 0.8, st.selectedChannelId);
      }
    }
  };
  const up = (e) => {
    const h = heldKeys.get(e.code);
    if (!h) return;
    heldKeys.delete(e.code);
    useStore.getState().liveNoteOff(h.key, h.channelId);
  };
  const blur = () => {
    heldKeys.clear();
    useStore.getState().finishRecordingNotes();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}

export const SHORTCUTS = [
  ['空格', '播放／停止'],
  ['Shift+L', '切换 片段模式／歌曲模式'],
  ['F4', '新建片段'],
  ['F5 / F6 / F7 / F8 / F9', '播放列表／通道架／钢琴卷帘／通道设置／混音台'],
  ['Alt+F8', '显示／隐藏浏览器'],
  ['Ctrl+Z / Ctrl+Y', '撤销／重做（Claude 的改动也能撤）'],
  ['Z S X D C V … / Q 2 W 3 E …', '用电脑键盘弹所选通道（两个八度）'],
  ['- / Shift+=', '电脑键盘八度下移／上移'],
  ['Numpad + / -', '下一个／上一个片段'],
  ['通道架：Ctrl+单击通道灯', '独奏该通道'],
  ['钢琴卷帘：单击／拖动', '画音符，拖动移动，拖右边缘改长度，右键删除'],
  ['钢琴卷帘：Shift+单击／Ctrl+拖动', '加入选区／框选'],
  ['钢琴卷帘：Alt+拖动', '复制正在拖动的音符'],
  ['钢琴卷帘：Ctrl+A、Ctrl+C、Ctrl+X、Ctrl+V、Ctrl+D、Del', '全选、复制、剪切、粘贴、复制一份、删除'],
  ['钢琴卷帘：Ctrl+Q', '量化（选区或全部）'],
  ['钢琴卷帘：↑ ↓（Shift＝移八度）、← →', '所选音符移调／微调'],
  ['播放列表：单击／拖动', '画出所选片段，拖动片段，拖边缘改变长度／裁切，右键打开选项'],
  ['播放列表：Shift+拖动、Ctrl+A、Ctrl+D、Del', '复制片段、全选、复制选区、删除'],
  ['波形编辑器：拖动／Shift+单击／双击', '选择区间／扩展选区／全选'],
  ['波形编辑器：空格、Ctrl+Z、Ctrl+Shift+Z', '播放选区；撤销／重做（编辑器自己的历史）'],
  ['波形编辑器：Ctrl+X、Ctrl+C、Ctrl+V、Ctrl+A、Del、+ / −', '剪切、复制、粘贴、全选、删除、缩放'],
  ['音高修正：拖动音符（Alt＝微调）、↑ ↓、0、B、[ ]、Esc', '移动音符、微调、回到音阶、旁通、上一个／下一个音符、取消选择'],
  ['旋钮与推子', '上下拖动（Shift＝微调）、滚轮、双击复位；Tab 聚焦后可用方向键、Home／End、Delete']
];
