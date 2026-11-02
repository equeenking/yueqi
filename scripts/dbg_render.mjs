import { INSTRUMENTS, makeInstrument } from '../packages/core/src/instruments.js';
import { renderModel } from '../client/src/audio/models.js';

const kinds = Object.keys(INSTRUMENTS);
let bad = 0;
for (const kind of kinds) {
  let inst;
  try { inst = makeInstrument(kind); } catch (e) { console.log('MAKE-FAIL', kind, e.message); bad++; continue; }
  for (const layer of [0, 2]) {
    try {
      const buf = renderModel(kind, 48000, 60, layer, inst.params);
      if (!buf || buf.length === 0) console.log('EMPTY', kind, layer);
    } catch (e) {
      console.log('RENDER-FAIL', kind, 'layer', layer, '=>', e.message);
      bad++;
      break;
    }
  }
}
console.log('失败乐器数', bad, '/', kinds.length);
