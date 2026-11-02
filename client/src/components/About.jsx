import { useEffect, useState } from 'react';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_CATEGORIES, EFFECTS, EFFECT_TYPES } from '@greanteadawy/core';
import { api } from '../state/api.js';
import { APP_NAME, APP_VERSION } from '../lib/version.js';

// what ships with the studio (plugin instruments and effects are the user's own, so they don't count)
const BUILT_IN = INSTRUMENT_KINDS.filter((k) => !INSTRUMENTS[k].dynamic);
const BUILT_IN_EFFECTS = EFFECT_TYPES.filter((t) => !EFFECTS[t].dynamic).length;
const PRESETS = BUILT_IN.reduce((n, k) => n + Object.keys(INSTRUMENTS[k].presets).length, 0);
const COLLECTIONS = INSTRUMENT_CATEGORIES.filter(([cat]) => BUILT_IN.some((k) => INSTRUMENTS[k].category === cat)).length;

/** Real-recorded samples ship under CC0-1.0 (public domain). Phases 1+2 expand this table over time. */
const SAMPLE_CREDITS = [
  { instrument: '古筝 (guzheng)', source: 'Freesound · Pufermufin', note: '经 XSXB-Band-Samples 整理', license: 'CC0-1.0', link: 'https://freesound.org/' },
  { instrument: '二胡 (erhu)', source: 'sfzinstruments/aliexpress-erhu', note: '20 把真实演奏', license: 'CC0-1.0', link: 'https://github.com/sfzinstruments/aliexpress-erhu' },
  { instrument: '箫 (xiao)', source: 'sgossner/VCSL · 竖笛', note: '经 XSXB-Band-Samples 加工为箫', license: 'CC0-1.0', link: 'https://github.com/sgossner/VCSL' },
  { instrument: '唢呐 (suona)', source: 'sgossner/VSCO-2-CE · 双簧管', note: '经 XSXB-Band-Samples 加工为唢呐', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '埙 (xun)', source: 'sgossner/VCSL · 陶土奥卡里那', note: '与埙同为陶土气鸣乐器', license: 'CC0-1.0', link: 'https://github.com/sgossner/VCSL' },
  { instrument: '木鱼 (muyu)', source: 'sgossner/VCSL · 开槽木鼓', note: 'Hi / Lo 两种音区 × 三次敲击', license: 'CC0-1.0', link: 'https://github.com/sgossner/VCSL' },
  { instrument: '大锣 (gong)', source: 'sgossner/VCSL', note: '大小两面，五档力度', license: 'CC0-1.0', link: 'https://github.com/sgossner/VCSL' },
  { instrument: '电子贝斯 (bass)', source: 'freepats/electric-bass-YR', note: 'Yamaha RBX，finger + pick 两种演奏法', license: 'CC0-1.0', link: 'https://github.com/freepats/electric-bass-YR' },
  { instrument: '钢琴 (piano)', source: 'freepats/upright-piano-KW', note: '立式钢琴真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/upright-piano-KW' },
  { instrument: '古典吉他 (guitar)', source: 'freepats/spanish-classical-guitar', note: '西班牙古典吉他', license: 'CC0-1.0', link: 'https://github.com/freepats/spanish-classical-guitar' },
  { instrument: '尤克里里 (ukulele)', source: 'freepats/ukulele1', note: '尤克里里真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/ukulele1' },
  { instrument: '陶笛 (ocarina)', source: 'freepats/ocarina1', note: '陶笛真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/ocarina1' },
  { instrument: '管钟 (bells)', source: 'freepats/tubular-bells1', note: '管钟真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/tubular-bells1' },
  { instrument: '套鼓 (kick/snare/hat/tom/cymbal/rim)', source: 'freepats/colomboADK', note: 'Colombo 爵士鼓真实录音（预混成品）', license: 'CC0-1.0', link: 'https://github.com/freepats/colomboADK' },
  { instrument: '课堂打击 (clap/claves/castanets/tambourine/shaker/perc)', source: 'freepats/world-percussion', note: '拍手、响棒、响板、铃鼓、沙锤、康加鼓真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/world-percussion' },
  { instrument: '定音鼓 (timpani)', source: 'freepats/timpani', note: 'D2–A3 真实录音，两档力度', license: 'CC0-1.0', link: 'https://github.com/freepats/timpani' },
  { instrument: '手碟 (hang)', source: 'freepats/hang-D-minor', note: 'D 小调手碟真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/hang-D-minor' },
  { instrument: '电吉他 (eguitar)', source: 'freepats/electric-guitar-FSBS-clean', note: '清音电吉他真实录音', license: 'CC0-1.0', link: 'https://github.com/freepats/electric-guitar-FSBS-clean' },
  { instrument: '长笛 (flute)', source: 'sgossner/VSCO-2-CE · 长笛', note: '揉音持续音——《彼得与狼》里的小鸟', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '双簧管 (oboe)', source: 'sgossner/VSCO-2-CE · 双簧管', note: '持续音——《彼得与狼》里的鸭子', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '单簧管 (clarinet)', source: 'sgossner/VSCO-2-CE · 单簧管', note: '持续音——《彼得与狼》里的猫', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '巴松 (bassoon)', source: 'sgossner/VSCO-2-CE · 巴松', note: '持续音——《彼得与狼》里的爷爷', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '圆号 (horn)', source: 'sgossner/VSCO-2-CE · 圆号', note: '持续音——《彼得与狼》里的狼', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
  { instrument: '小提琴 (violin)', source: 'sgossner/VSCO-2-CE · 独奏小提琴', note: '揉音持续音——彼得本人', license: 'CC0-1.0', link: 'https://github.com/sgossner/VSCO-2-CE' },
];

/**
 * The About dialog's content (shown by the modal of kind "about"): the app's name and version, the server's version
 * (a different one means this tab still runs an older build) and what's built in.
 */
export function AboutBody() {
  const [server, setServer] = useState({ state: 'loading' });
  useEffect(() => {
    let live = true;
    api.status().then(
      (s) => { if (live) setServer({ state: 'ok', version: s.version }); },
      () => { if (live) setServer({ state: 'error' }); }
    );
    return () => { live = false; };
  }, []);
  const outdated = server.state === 'ok' && server.version && APP_VERSION !== 'dev' && server.version !== APP_VERSION;
  return (
    <div className="about">
      <div className="about-head">
        <span className="about-mark" aria-hidden="true">◆</span>
        <div>
          <h3 id="modal-title" className="about-name">{APP_NAME}</h3>
          <div className="about-version" data-testid="about-version">版本 {APP_VERSION}</div>
        </div>
      </div>
      <p className="about-tagline">浏览器里的图案式音乐工作站，Claude 与你共同制作。</p>
      <dl className="about-facts">
        <dt>应用</dt>
        <dd>{APP_NAME} {APP_VERSION}</dd>
        <dt>服务端</dt>
        <dd data-testid="about-server">{server.state === 'loading' ? '检查中…' : server.state === 'error' ? '无法连接' : `${APP_NAME} ${server.version}`}</dd>
        <dt>声音</dt>
        <dd>{BUILT_IN.length} 种乐器，分 {COLLECTIONS} 个分组，{PRESETS} 个预设，{BUILT_IN_EFFECTS} 个效果器</dd>
        <dt>许可</dt>
        <dd>MIT（开源）</dd>
      </dl>
      {outdated && <p className="about-warn" role="status">服务端运行的是 {server.version} 版本：刷新页面即可载入匹配的工作室。</p>}
      <section className="about-samples">
        <h4>采样来源与许可</h4>
        <p className="about-samples-intro">真实乐器录音来自公有领域（CC0-1.0）的免费采样项目。GreanTeaDawy 的渲染管线会优先使用这些录音，没有覆盖的乐器则自动回退到物理模型合成。</p>
        <table className="about-samples-table">
          <thead><tr><th>乐器</th><th>来源</th><th>备注</th><th>许可</th></tr></thead>
          <tbody>
            {SAMPLE_CREDITS.map((c) => (
              <tr key={c.instrument}>
                <td>{c.instrument}</td>
                <td><a href={c.link} target="_blank" rel="noopener noreferrer">{c.source}</a></td>
                <td>{c.note}</td>
                <td>{c.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="about-note">GreanTeaDawy 是一个独立的实验性项目，与任何音乐软件公司都没有关联，也不受其背书。</p>
      <p className="about-repo">源代码： <a href="https://github.com/vidux/GreanTeaDawy" target="_blank" rel="noopener noreferrer">github.com/vidux/GreanTeaDawy</a> — 喜欢的话，请点个星！</p>
    </div>
  );
}
