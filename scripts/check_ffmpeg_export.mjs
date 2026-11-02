// 用本机真 ffmpeg 验证导出链路（Windows 下「假 ffmpeg」用例跑不了，这里直接跑真活儿）
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFfmpeg } from '../server/src/ffmpeg.js';
import { makeWav } from '../server/test/helpers.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gtd-exp-'));
const ff = createFfmpeg({ path: process.env.FFMPEG_PATH || 'ffmpeg' });
const st = await ff.status();
console.log('ffmpeg 可用:', st.available, '版本:', st.version);
console.log('可用格式:', (await ff.formats()).filter((f) => f.available).map((f) => f.id).join(', '));

const wav = path.join(tmp, 'mix.wav');
await fs.writeFile(wav, makeWav(1, { sr: 44100 }));
for (const [id, ext] of [['mp3', 'mp3'], ['flac', 'flac'], ['aac', 'm4a']]) {
  const out = path.join(tmp, `mix.${ext}`);
  const r = await ff.convert({ input: wav, output: out, format: id, bitrate: 192 });
  const s = await fs.stat(out);
  console.log(`${id}: ${r ? 'ok' : 'fail'}  ${(s.size / 1024).toFixed(1)} KB`);
}
await fs.rm(tmp, { recursive: true, force: true });
