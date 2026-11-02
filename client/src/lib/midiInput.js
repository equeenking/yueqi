// Web MIDI input: play (and record) the selected channel from a hardware MIDI keyboard.
import { useStore } from '../state/store.js';

let access = null;
const held = new Map(); // MIDI key -> channel it was started on

function onMessage(e) {
  const [status, key, vel] = e.data;
  const cmd = status & 0xf0;
  const st = useStore.getState();
  if (cmd === 0x90 && vel > 0) {
    const ch = st.selectedChannelId;
    if (!ch) return;
    held.set(key, ch);
    st.liveNoteOn(key, vel / 127, ch);
  } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
    const ch = held.get(key);
    held.delete(key);
    if (ch) st.liveNoteOff(key, ch);
  }
}

function bindInputs() {
  const names = [];
  for (const input of access.inputs.values()) {
    input.onmidimessage = onMessage;
    names.push(input.name);
  }
  useStore.setState({ midiStatus: names.length ? `MIDI: ${names.join(', ')}` : 'MIDI 已启用（没有设备）' });
}

export async function connectMidi() {
  const st = useStore.getState();
  if (!navigator.requestMIDIAccess) {
    st.toast('此浏览器不支持 Web MIDI（请用 Chrome 或 Edge）', 'warn');
    return;
  }
  try {
    st.unlockAudio();
    access = await navigator.requestMIDIAccess();
    access.onstatechange = bindInputs;
    bindInputs();
    st.toast(useStore.getState().midiStatus, 'success');
  } catch (e) {
    st.toast(`MIDI 设备被拒绝访问：${e.message}`, 'error');
  }
}
