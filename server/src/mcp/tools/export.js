// Audio export in any format: list_export_formats (what this server can make — ffmpeg availability, bitrates) and
// export_audio (render in the user's browser, then convert with ffmpeg on the server).
import { findPattern } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A } from '../util.js';
import { FORMAT_IDS } from '../../ffmpeg.js';
import { progressNotifier } from './mix.js';

function describeFormats({ ffmpeg, formats }) {
  const head = ffmpeg.available
    ? `服务器上的 ffmpeg ${ffmpeg.version} 可用。`
    : `ffmpeg 不可用（${ffmpeg.reason}）：只能导出 WAV。用户（或管理员）可以装一下 ffmpeg 或设置 FFMPEG_PATH——见「设置 → 音频导出」。`;
  const lines = formats.map((f) => {
    const opts = f.bitrates ? `码率 ${f.bitrates.join('/')} kbps（默认 ${f.defaultBitrate}）` : f.id === 'wav' ? '位深 16（加抖动）或 24' : '沿用渲染时的位深（16 或 24）';
    return `- ${f.id} — ${f.label}${f.available ? '' : ' [不可用]'}: ${f.description}；${opts}${f.encoder ? `（编码器 ${f.encoder}）` : ''}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

export function registerExportTools({ tool, backend, load }) {
  tool('list_export_formats', {
    title: '列出可导出的音频格式',
    description: '这台服务器现在能导出哪些音频格式：WAV 一直可以；装了 ffmpeg 才能出 MP3、AAC（.m4a）、Ogg Vorbis、Opus、FLAC、Apple Lossless 和 AIFF。会给出 ffmpeg 版本、各有损格式的码率，以及某个格式为什么不可用。用户指定格式时，先调它再调 export_audio。',
    inputSchema: {},
    annotations: A.readOnly
  }, async () => {
    const r = await backend.exportFormats();
    return ok(describeFormats(r), r);
  });

  tool('export_audio', {
    title: '导出音频（WAV、MP3、AAC、Ogg、Opus、FLAC、ALAC、AIFF）',
    description: '在用户的浏览器里渲染整首歌（或某个片段），按指定格式存进用户的导出目录：wav 直接渲染；mp3/aac/ogg/opus/flac/alac/aiff 由服务器上的 ffmpeg 从 24 位渲染结果转换而来（先查 list_export_formats）。会给文件写上标题／作者／专辑等元数据，返回下载链接。要出成品，先用 render_mix 看一下响度。需要在浏览器里打开本工作室。',
    inputSchema: {
      projectId: projectIdArg,
      format: z.enum(FORMAT_IDS).describe('wav、mp3、aac、ogg、opus、flac、alac 或 aiff'),
      mode: z.enum(['song', 'pattern']).optional().describe('默认：播放列表里有片段就整首，否则单片段'),
      pattern: z.string().optional().describe('mode=pattern 时用（默认第一个片段）'),
      loops: z.number().int().min(1).max(16).optional().describe('单片段模式：渲染几遍（默认 2）'),
      bitrate: z.number().int().optional().describe('有损格式的码率 kbps（见 list_export_formats；默认 MP3 320、AAC 256、Ogg 192、Opus 160）'),
      bitDepth: z.union([z.literal(16), z.literal(24)]).optional().describe('WAV/FLAC/ALAC/AIFF 的位深（默认 24；16 位会加抖动）'),
      title: z.string().max(200).optional().describe('元数据标题（默认用工程名）'),
      artist: z.string().max(200).optional().describe('元数据作者（默认用用户的显示名）'),
      album: z.string().max(200).optional().describe('元数据专辑名'),
      genre: z.string().max(100).optional().describe('元数据流派'),
      keepWav: z.boolean().optional().describe('把中间那份 WAV 也留在导出目录（默认不留）')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ projectId, format, mode, pattern, loops = 2, bitrate, bitDepth = 24, title, artist, album, genre, keepWav = false }, extra) => {
    const p = await load(projectId);
    // validate everything before the (slow) render: an unavailable format or a bad bitrate fails fast
    const { ffmpeg, formats } = await backend.exportFormats();
    const f = formats.find((x) => x.id === format);
    if (!f.available) throw new Error(`${f.label} 在这里导不了：${f.reason || 'ffmpeg 不可用'}。能导的：${formats.filter((x) => x.available).map((x) => x.id).join('、')}。`);
    if (bitrate !== undefined && !f.bitrates) throw new Error(`${f.label} 没有码率设置${f.lossless ? '（它是无损格式）' : ''}`);
    if (bitrate !== undefined && !f.bitrates.includes(bitrate)) throw new Error(`${f.label} 的码率只能是 ${f.bitrates.join('、')} kbps`);
    const m = mode || (p.playlist.clips.length ? 'song' : 'pattern');
    const patternId = pattern ? findPattern(p, pattern).id : p.patterns[0]?.id;
    const depth = format === 'wav' || f.lossless ? bitDepth : 24; // lossy encoders get the best source
    const notify = progressNotifier(extra, '正在浏览器里渲染');
    const result = await backend.requestJob(
      { kind: 'render', projectId: p.id, mode: m, patternId, loops, stems: false, save: true, bitDepth: depth, name: p.name },
      { projectId: p.id, timeoutMs: 240000, onProgress: notify ? (x) => notify(x * (format === 'wav' ? 1 : 0.8)) : null }
    );
    const wav = result.export;
    if (!wav) throw new Error('浏览器渲染完了，但没把 WAV 存下来');
    const loud = result.mix ? ` — 整体响度 ${result.mix.lufs} LUFS，真峰值 ${result.mix.truePeakDb} dBTP` : '';
    if (format === 'wav') {
      return ok(`已导出 ${wav.name}（${depth} 位 WAV，${Math.round(wav.bytes / 1024)} KB${loud}）到用户的导出目录（工程 → 导出）：${wav.url}`, { export: { ...wav, format: 'wav', bitDepth: depth } });
    }
    let out;
    try {
      out = await backend.convertExport(wav.name, {
        format, bitrate,
        metadata: { title: title || p.name, ...(artist ? { artist } : {}), ...(album ? { album } : {}), ...(genre ? { genre } : {}) }
      });
    } finally {
      if (!keepWav) await backend.deleteExport(wav.name).catch(() => {});
    }
    notify?.(1);
    const quality = out.bitrate ? `${out.bitrate} kbps` : out.bitDepth ? `${out.bitDepth} 位` : '';
    return ok(`已导出 ${out.name}（${f.label}${quality ? `、${quality}` : ''}，${Math.round(out.bytes / 1024)} KB，ffmpeg ${ffmpeg.version}${loud}）到用户的导出目录（工程 → 导出）：${out.url}${keepWav ? `\n那份 ${depth} 位 WAV 也留下了：${wav.url}` : ''}`, { export: out });
  });
}
