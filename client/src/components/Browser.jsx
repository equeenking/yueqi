import { Fragment, useState, useEffect, useCallback } from 'react';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_CATEGORIES, TEMPLATES } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { Icon } from './ui/Icon.jsx';
import { addChannel, addPluginChannel, exportWav, exportAs } from '../lib/actions.js';
import { DND_INSTRUMENT } from '../lib/dnd.js';
import { SampleLibrary } from './SampleLibrary.jsx';
import { hasSampleBank } from '../audio/sampleBank.js';
import { getEngine } from '../audio/index.js';

// plugin instruments have their own section (installed plugins, above)
const CATS = INSTRUMENT_CATEGORIES.filter(([cat]) => cat !== 'plugins');
// generated category tiles (client/public/img); categories without one keep the plain label
const CAT_IMG = {
  drums: '/img/cat_drums.jpg', keys: '/img/cat_keys.jpg', guitar: '/img/cat_guitar.jpg',
  strings: '/img/cat_strings.jpg', flutes: '/img/cat_flutes.jpg', eastasian: '/img/cat_eastasian.jpg',
  bass: '/img/cat_bass.jpg', synth: '/img/cat_synth.jpg', beatbox: '/img/cat_beatbox.jpg',
  indian: '/img/cat_indian.jpg', sampler: '/img/cat_sampler.jpg', orchestra: '/img/cat_orchestra.jpg'
};
// instruments with a dedicated tile photo (client/public/img/inst_<kind>.jpg) — real instruments get
// studio shots, electronic instruments get their hardware (synths, drum machines, mics); the plugin
// kind alone keeps a colour-gradient tile
const INST_IMG = new Set([
  'guzheng', 'erhu', 'dizi', 'xiao', 'suona', 'pipa', 'gong', 'xun', 'muyu', 'taiko', 'koto', 'shamisen', 'shakuhachi',
  'triangle', 'bells', 'tambourine', 'castanets', 'twotone', 'guiro', 'melodica', 'glockenspiel',
  'piano', 'guitar', 'ukulele', 'eguitar', 'flute', 'recorder', 'ocarina', 'panflute', 'whistle',
  'kick', 'snare', 'hat', 'tom', 'cymbal', 'cowbell', 'shaker', 'sleighbells', 'claves', 'timpani', 'hang',
  'violin', 'oboe', 'clarinet', 'bassoon', 'horn',
  'epiano', 'organ', 'strings', 'bass',
  'sitar', 'tanpura', 'tabla', 'bansuri', 'shehnai', 'santoor', 'harmonium',
  'synth', 'fm', 'bass808', 'clap', 'rim', 'perc', 'sampler'
]);
// beatbox sounds are made with the mouth, so no object to photograph: the tile shows the syllable
// that produces the sound (K's beatbox notation) instead of a misleading photo
const BB_GLYPH = { bbkick: 'B', bbsnare: 'Pf', bbhat: 't', bbbass: 'oo', bbfx: 'fx' };
// project card covers: match the template a name came from, else the generic cover
const COVER_MAP = [
  [/民乐|minyue/i, 'cover_minyue.jpg'],
  [/东亚|尺八|eastasian/i, 'cover_eastasian.jpg'],
  [/lo-?fi/i, 'cover_lofi.jpg'],
  [/乐队|流行|band/i, 'cover_band.jpg'],
  [/陷阱|trap/i, 'cover_trap.jpg'],
  [/浩室|house/i, 'cover_house.jpg']
];
const coverFor = (name) => `/img/${(COVER_MAP.find(([re]) => re.test(name)) || [null, 'cover_default.jpg'])[1]}`;

// representative kind per category (the first instrument the catalog lists) — what a category tile plays
const CAT_REP = {};
for (const [kind, def] of Object.entries(INSTRUMENTS)) if (def.category && !CAT_REP[def.category]) CAT_REP[def.category] = kind;

/** 点击试听：采样库已加载时用真录音，否则合成引擎兜底。在点击处理器里先解锁音频（浏览器手势要求）。 */
const audition = async (kind, preset) => {
  if (!kind || kind === 'plugin' || !INSTRUMENTS[kind]) return;
  try { await useStore.getState().unlockAudio(); } catch { /* 无音频设备时忽略 */ }
  getEngine()?.previewInstrument(kind, preset);
};

/** 打开工程，等它经实时同步落位后自动播放——课堂里点封面就能听成品。 */
const openAndPlay = async (id) => {
  const s0 = useStore.getState();
  s0.unlockAudio().catch(() => {});
  s0.openProject(id);
  for (let i = 0; i < 50 && useStore.getState().project?.id !== id; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const s = useStore.getState();
  if (s.project?.id === id && !s.playing && !s.starting) s.play();
};

function Instruments() {
  const [open, setOpen] = useState({});
  // photo-tile lightbox: the kind whose studio photo is enlarged (null = closed)
  const [zoom, setZoom] = useState(null);
  // the bank decodes in the background: redraw when it lands so the 采样 marks appear
  const [, bankTick] = useState(0);
  useEffect(() => {
    const on = () => bankTick((n) => n + 1);
    globalThis.addEventListener?.('samplebank-ready', on);
    return () => globalThis.removeEventListener?.('samplebank-ready', on);
  }, []);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => { if (e.key === 'Escape') setZoom(null); };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [zoom]);
  const plugins = useStore((s) => s.plugins.plugins).filter((p) => p.enabled && p.type === 'instrument');
  return (
    <div className="br-list">
      {plugins.length > 0 && (
        <div className="br-section" data-testid="browser-plugins">
          <div className="br-cat">插件</div>
          {plugins.map((p) => (
            <div key={p.id}>
              <div className="br-item" title={`${p.manifest.description || p.name} — 插件作者 ${p.manifest.author || '未知'}；单击加入`}>
                <button className="br-expand" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} aria-label="显示预设">
                  <Icon name={open[p.id] ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <span className="br-dot" style={{ background: p.manifest.color }} />
                <button className="br-name" onClick={() => addPluginChannel(p)}>{p.name}</button>
                <button className="br-add" title="加入通道架" onClick={() => addPluginChannel(p)}><Icon name="plus" size={12} /></button>
              </div>
              {open[p.id] && Object.keys(p.manifest.presets).map((pr) => (
                <div key={pr} className="br-item preset">
                  <button className="br-name" onClick={() => addPluginChannel(p, pr)}>{pr}</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {CATS.map(([cat, label]) => (
        <div key={cat} className="br-section">
          <div className="br-cat">
            {CAT_IMG[cat]
              ? <button className="br-cat-btn" title={`点击试听${label}音色`} onClick={() => audition(CAT_REP[cat])}>
                  <img className="br-cat-img" src={CAT_IMG[cat]} alt="" draggable="false" />
                  <Icon name="speaker" size={10} />
                </button>
              : <button className="br-cat-btn plain" title={`点击试听${label}音色`} onClick={() => audition(CAT_REP[cat])}><Icon name="speaker" size={12} /></button>}
            {label}
          </div>
          <div className="inst-grid">
            {INSTRUMENT_KINDS.filter((k) => INSTRUMENTS[k].category === cat).map((kind) => {
              const def = INSTRUMENTS[kind];
              const presets = Object.keys(def.presets);
              return (
                <Fragment key={kind}>
                  <div className="inst-tile" draggable
                    onDragStart={(e) => e.dataTransfer.setData(DND_INSTRUMENT, JSON.stringify({ kind }))}
                    title={`${def.description || def.label} — 点击试听 · ＋加入通道架 · ⌄ 预设${INST_IMG.has(kind) ? ' · 放大镜看大图' : ''} · 也可拖入通道架`}>
                    <button className="inst-photo" onClick={() => audition(kind)} aria-label={`试听${def.label}`}>
                      {BB_GLYPH[kind]
                        ? <span className="inst-ph bb" style={{ background: `radial-gradient(120% 120% at 30% 0%, ${def.color}55, #17171c 70%)` }}>
                            <b>{BB_GLYPH[kind]}</b>
                            <span className="bb-wave"><i /><i /><i /><i /><i /></span>
                          </span>
                        : INST_IMG.has(kind)
                          ? <img src={`/img/inst_${kind}.jpg`} alt="" draggable="false" loading="lazy" />
                          : <span className="inst-ph" style={{ background: `linear-gradient(150deg, ${def.color}cc, ${def.color}33 60%, #17171c)` }}>{def.label.slice(0, 1)}</span>}
                      {hasSampleBank(kind) && <span className="inst-samp">采样</span>}
                    </button>
                    <button className="inst-x" aria-label="显示预设" onClick={() => setOpen((o) => ({ ...o, [kind]: !o[kind] }))}>
                      <Icon name={open[kind] ? 'chevronDown' : 'chevronRight'} size={10} />
                    </button>
                    <button className="inst-add" title="加入通道架" onClick={() => addChannel(kind)}><Icon name="plus" size={12} /></button>
                    {INST_IMG.has(kind) && (
                      <button className="inst-zoom-btn" title="放大查看" onClick={() => setZoom(kind)} aria-label={`放大查看${def.label}`}>
                        <Icon name="zoomIn" size={11} />
                      </button>
                    )}
                    <span className="inst-label">{def.label}</span>
                  </div>
                  {open[kind] && (
                    <div className="inst-presets">
                      {presets.map((pr) => (
                        <div key={pr} className="br-item preset" draggable
                          onDragStart={(e) => e.dataTransfer.setData(DND_INSTRUMENT, JSON.stringify({ kind, preset: pr }))}>
                          <button className="br-name" title={`单击试听「${pr}」`} onClick={() => audition(kind, pr)}>{pr}</button>
                          <button className="br-add" title="加入通道架" onClick={() => addChannel(kind, { preset: pr, name: pr })}><Icon name="plus" size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
      {zoom && (() => {
        const def = INSTRUMENTS[zoom];
        const cat = CATS.find(([c]) => c === def.category)?.[1];
        return (
          <div className="inst-lightbox" onClick={() => setZoom(null)}>
            <div className="inst-zoom" role="dialog" aria-label={`${def.label} 大图`} onClick={(e) => e.stopPropagation()}>
              <img src={`/img/inst_${zoom}.jpg`} alt={def.label} draggable="false" />
              <button className="inst-zoom-x" aria-label="关闭" onClick={() => setZoom(null)}><Icon name="close" size={13} /></button>
              <div className="inst-zoom-name">{def.label}</div>
              <div className="inst-zoom-cat">{cat}{hasSampleBank(zoom) ? ' · 真乐器录音采样' : ''}</div>
              <div className="inst-zoom-desc">{def.description}</div>
              <div className="inst-zoom-actions">
                <button className="btn primary" onClick={() => audition(zoom)}><Icon name="speaker" size={13} /> 试听</button>
                <button className="btn" onClick={() => { addChannel(zoom); setZoom(null); }}><Icon name="plus" size={13} /> 加入通道架</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Run an async UI action; failures become an error toast instead of an uncaught rejection. */
const guard = (fn) => Promise.resolve().then(fn).catch((e) => useStore.getState().toast(e.message || String(e), 'error'));

function Exports() {
  const [list, setList] = useState(null);
  const exportsRev = useStore((s) => s.exportsRev); // bumped when a render is saved
  const mp3Ok = useStore((s) => !!s.exportFormats?.formats?.find((f) => f.id === 'mp3' && f.available));
  const load = useCallback(() => api.listExports().then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load, exportsRev]);
  return (
    <>
      <div className="br-cat">导出（成品与 MIDI）</div>
      <div className="br-quick">
        <button className="btn tiny" title="渲染整首歌并下载 16 位 WAV——班级电脑、投影都能直接放" onClick={() => exportWav('song', { bitDepth: 16 })}>
          <Icon name="download" size={12} /> 导出歌曲 WAV
        </button>
        <button className="btn tiny" title="导出 MP3（需要服务器装有 ffmpeg）" disabled={!mp3Ok}
          onClick={() => exportAs('mp3')}>
          <Icon name="download" size={12} /> 导出 MP3
        </button>
      </div>
      {!list?.length ? null : list.slice(0, 20).map((x) => (
        <div key={x.name} className="br-item">
          <Icon name="download" size={13} />
          <a className="br-name" href={x.url} download title={new Date(x.createdAt).toLocaleString()}>{x.name}</a>
          <span className="br-meta">{x.bytes > 1e6 ? `${(x.bytes / 1e6).toFixed(1)}MB` : `${Math.round(x.bytes / 1024)}KB`}</span>
          <button className="br-add" title="删除" onClick={() => guard(async () => { await api.deleteExport(x.name); load(); })}><Icon name="trash" size={12} /></button>
        </div>
      ))}
    </>
  );
}

function Projects() {
  const projects = useStore((s) => s.projects);
  const current = useStore((s) => s.project?.id);
  const st = useStore.getState();
  const [template, setTemplate] = useState('default');
  return (
    <div className="br-list">
      <div className="br-new">
        <select className="ui-select" value={template} onChange={(e) => setTemplate(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
          {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <button className="btn primary" onClick={async () => {
          const name = await st.prompt({ title: '新建项目', value: template === 'default' || template === 'empty' ? '未命名' : TEMPLATES[template].label.split(' (')[0] });
          if (name !== null) st.createProject({ name: name || '未命名', template });
        }}>新建</button>
      </div>
      <div className="prj-grid">
        {projects.map((p) => (
          <button key={p.id} className={`prj-card ${p.id === current ? 'active' : ''}`}
            onClick={() => openAndPlay(p.id)} title={`点击播放「${p.name}」（更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN')}）`}
            onContextMenu={(e) => st.showContextMenu(e, [
              { label: '打开', onClick: () => st.openProject(p.id) },
              { label: '复制一份', onClick: () => guard(async () => { await api.duplicateProject(p.id); st.refreshProjects(); }) },
              { label: '删除', danger: true, disabled: projects.length <= 1, onClick: () => guard(async () => {
                if (await st.confirm({ title: `Delete "${p.name}"?`, message: '此操作无法撤销。', danger: true, okLabel: '删除' })) {
                  // leave the project first, so live sync doesn't treat our own delete as "deleted elsewhere"
                  if (p.id === current) st.openProject(projects.find((x) => x.id !== p.id).id);
                  await api.deleteProject(p.id);
                  await st.refreshProjects();
                }
              }) }
            ])}>
            <img src={coverFor(p.name)} alt="" draggable="false" />
            <span className="prj-name">{p.name}</span>
            <span className="prj-meta">{Math.round(p.bpm)} BPM</span>
          </button>
        ))}
      </div>
      <Exports />
    </div>
  );
}

function ClaudePanel() {
  const activity = useStore((s) => s.activity);
  const st = useStore.getState();
  const mcpUrl = `${location.origin}/mcp`;
  const openApi = () => { useStore.setState({ settingsTab: 'api' }); st.openWindow('settings'); };
  const copy = (text) => { navigator.clipboard?.writeText(text); st.toast('已复制', 'success', 1200); };
  return (
    <div className="br-list claude">
      <div className="claude-setup">
        <p><b>与 Claude 一起做音乐。</b> 连接 MCP 服务器，然后这样说： <i>“make a dark trap beat at 145 BPM”</i>. Edits appear here live.</p>
        <div className="copy-row"><code>{mcpUrl}</code><button className="btn tiny" onClick={() => copy(mcpUrl)}>复制</button></div>
        <button className="btn tiny" onClick={openApi}>API 令牌与设置</button>
      </div>
      <div className="br-cat">动态</div>
      {activity.length === 0 && <p className="br-empty">还没有 Claude 的动静。</p>}
      {activity.map((a, i) => (
        <div key={i} className="activity-item">
          <span className="activity-time">{new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{a.text}</span>
        </div>
      ))}
    </div>
  );
}

const TABS = [['instruments', '声音'], ['samples', '采样'], ['projects', '我的乐曲'], ['claude', 'Claude']];

export function Browser() {
  const [tab, setTab] = useState('instruments');
  return (
    <aside className="browser" aria-label="浏览器">
      <div className="br-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k === 'claude' && <Icon name="claude" size={11} />}{label}
          </button>
        ))}
      </div>
      {tab === 'instruments' && <Instruments />}
      {tab === 'samples' && <SampleLibrary />}
      {tab === 'projects' && <Projects />}
      {tab === 'claude' && <ClaudePanel />}
    </aside>
  );
}
