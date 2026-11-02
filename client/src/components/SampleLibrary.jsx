// The Samples tab of the Browser: the user's sample library in folders (each sample in one folder, or Unfiled), with
// search, drag-and-drop filing, a ⋯ menu per sample and per folder, and a select mode for moving/deleting several.
import { useState, useRef } from 'react';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { Icon } from './ui/Icon.jsx';
import { uploadSamples, addSamplerChannel, openSampleEditor } from '../lib/actions.js';
import { analyzeSampleInBrowser } from '../lib/jobs.js';
import { getEngine } from '../audio/index.js';
import { DND_SAMPLE } from '../lib/dnd.js';
import { longPressProps } from '../lib/touch.js';

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.opus,.flac,.aif,.aiff,.m4a,.aac,.webm';
const COLLAPSED_KEY = 'gtd.sampleFolders.collapsed';

/** Run an async UI action; failures become an error toast instead of an uncaught rejection. */
const guard = (fn) => Promise.resolve().then(fn).catch((e) => useStore.getState().toast(e.message || String(e), 'error'));

/** Open a menu under a button (keyboard clicks have no pointer position). */
function menuAt(e, items) {
  const r = e.currentTarget.getBoundingClientRect();
  useStore.getState().showContextMenu({ preventDefault() {}, stopPropagation() { e.stopPropagation(); }, clientX: r.left, clientY: r.bottom + 2 }, items);
}

/** What a search matches: name, folder, tags and the analysis words (character, pitch, key, tempo). */
export function sampleSearchText(s, folderName = '') {
  const a = s.analysis || {};
  const tags = Object.values(s.metadata?.tags || {}).join(' ');
  return [s.name, folderName, tags, a.character, a.kind, a.pitch?.note, a.key ? `${a.key.key} ${a.key.scale}` : '', a.tempo ? `${a.tempo.bpm} bpm` : ''].join(' ').toLowerCase();
}

const readCollapsed = () => {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch { return new Set(); }
};
const writeCollapsed = (set) => {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch { /* private mode: not remembered */ }
};

/** "Beat 1 (channel Vox, 3 clips)" for each project that uses a sample. */
const usageText = (list) => list.map((u) => `${u.projectName} (${[u.channels.length ? `channel${u.channels.length > 1 ? 's' : ''} ${u.channels.join(', ')}` : '', u.clips ? `${u.clips} clip${u.clips > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')})`).join(', ');

/** Ask (with what still uses them), then delete samples. Resolves true when they were deleted. */
export async function deleteSamplesWithWarning(list) {
  const st = useStore.getState();
  if (!list.length) return false;
  const usage = await api.sampleUsage(list.map((s) => s.id));
  const used = list.filter((s) => usage[s.id]?.length);
  const title = list.length === 1 ? `Delete sample "${list[0].name}"?` : `Delete ${list.length} samples?`;
  const editing = (st.editorDirty || st.editorSaving) && st.windows.waveEditor?.open ? list.find((s) => s.id === st.editSampleId) : null;
  const note = editing ? `\n\n"${editing.name}" is open in the wave editor with edits: the editor keeps that audio, so you can still save it as a new sample.` : '';
  const message = (used.length
    ? `Still in use — these sampler channels and audio clips will go silent:\n${used.map((s) => `• ${list.length > 1 ? `${s.name}: ` : ''}${usageText(usage[s.id])}`).join('\n')}\n\nThis cannot be undone.`
    : '此操作无法撤销。') + note;
  if (!(await st.confirm({ title, message, danger: true, okLabel: '删除' }))) return false;
  if (list.length === 1) await api.deleteSample(list[0].id);
  else await api.deleteSamples(list.map((s) => s.id));
  // an editor showing a deleted sample closes only when it holds nothing of its own: edits (or a save that was running)
  // stay there with a "deleted" banner and Save as new. It may also have moved on to a new sample meanwhile.
  const now = useStore.getState();
  if (list.some((s) => s.id === now.editSampleId) && !editing && !now.editorDirty && !now.editorSaving) now.closeWindow('waveEditor');
  st.toast(list.length === 1 ? `Deleted ${list[0].name}` : `Deleted ${list.length} samples`, 'success', 1500);
  await st.refreshSamples();
  return true;
}

export async function newSampleFolder() {
  const st = useStore.getState();
  const name = await st.prompt({ title: '新建文件夹', placeholder: '例如：鼓、人声、循环' });
  if (!name?.trim()) return null;
  const f = await api.createSampleFolder(name);
  await st.refreshSamples();
  return f;
}

function SampleDetails({ s }) {
  const m = s.metadata || {};
  const a = s.analysis;
  const facts = [
    s.duration ? `${s.duration.toFixed(2)} s` : null,
    m.sampleRate ? `${m.sampleRate / 1000} kHz` : null,
    m.bitsPerSample ? `${m.bitsPerSample}-bit` : null,
    m.bitrateKbps ? `${m.bitrateKbps} kbps` : null,
    m.channels ? (m.channels === 1 ? 'mono' : `${m.channels} ch`) : null,
    m.codec || m.container || null,
    s.size ? `${Math.round(s.size / 1024)} KB` : null
  ].filter(Boolean);
  return (
    <div className="sample-details">
      <div className="facts">{facts.map((f) => <span key={f}>{f}</span>)}</div>
      {m.tags && Object.keys(m.tags).length > 0 && (
        <div className="muted">{Object.entries(m.tags).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
      )}
      {a ? (
        <>
          <div className="facts accent">
            <span>{a.character}</span>
            {Number.isFinite(a.lufs) && a.lufs > -100 && <span>{a.lufs} LUFS</span>}
            <span>peak {a.peakDb} dB</span>
            {a.pitch && a.kind === 'one-shot' && <span>{a.pitch.note}</span>}
            {a.tempo && a.tempo.confidence >= 0.35 && <span>{a.tempo.bpm} BPM</span>}
            {a.key && a.key.confidence > 0.5 && <span>{a.key.key} {a.key.scale}</span>}
          </div>
          <div className="bands" title="频谱平衡：超低 · 低 · 中低 · 中 · 中高 · 高">
            {Object.entries(a.spectrum?.bandsPercent || {}).map(([k, v]) => <i key={k} style={{ flexGrow: Math.max(0.5, v) }} className={`band-${k}`} />)}
          </div>
        </>
      ) : <div className="muted">尚未分析。</div>}
    </div>
  );
}

export function SampleLibrary() {
  const samples = useStore((s) => s.samples);
  const folders = useStore((s) => s.sampleFolders);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [over, setOver] = useState(null); // drop target: 'list' or a folder key
  const fileRef = useRef(null);
  const uploadTo = useRef(null);
  const st = useStore.getState();

  const byId = new Map(folders.map((f) => [f.id, f]));
  const folderKey = (s) => (byId.has(s.folderId) ? s.folderId : '');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = words.length ? samples.filter((s) => { const t = sampleSearchText(s, byId.get(s.folderId)?.name); return words.every((w) => t.includes(w)); }) : samples;
  const groups = [
    ...folders.map((f) => ({ key: f.id, folder: f, name: f.name, items: visible.filter((s) => s.folderId === f.id) })),
    { key: '', folder: null, name: 'Unfiled', items: visible.filter((s) => !byId.has(s.folderId)) }
  ].filter((g) => (words.length ? g.items.length : g.folder || g.items.length || folders.length));
  const flat = !folders.length; // no folders yet: a plain list, no "未归档" header
  // the selection, without samples deleted meanwhile (here, in another tab or by Claude)
  const selectedList = samples.filter((s) => selected.has(s.id));
  const selectedIds = selectedList.map((s) => s.id);
  // what "全部" selects: the rows that are visible (open folders, the current search)
  const visibleRows = flat ? visible : groups.filter((g) => words.length > 0 || !collapsed.has(g.key)).flatMap((g) => g.items);

  const toggleCollapsed = (key) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(key)) n.delete(key); else n.add(key);
    writeCollapsed(n);
    return n;
  });
  const toggleSelected = (id) => setSelected((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const endSelect = () => { setSelecting(false); setSelected(new Set()); };

  // accept by MIME type or by extension (some systems report .wav as application/octet-stream, .webm as video/webm)
  const onFiles = (files, folderId = null) => {
    const list = [...files];
    const ok = list.filter((f) => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|opus|flac|aiff?|m4a|aac|webm)$/i.test(f.name));
    if (ok.length < list.length) st.toast(`跳过 ${list.length - ok.length} 个不是音频的文件`, 'warn');
    if (ok.length) uploadSamples(ok, { folderId });
  };
  const pickFiles = (folderId = null) => { uploadTo.current = folderId; fileRef.current?.click(); };
  const move = (ids, folderId) => guard(async () => {
    await api.moveSamples(ids, folderId);
    await st.refreshSamples();
    if (folderId && collapsed.has(folderId)) toggleCollapsed(folderId);
    st.toast(`Moved ${ids.length === 1 ? samples.find((s) => s.id === ids[0])?.name || '1 sample' : `${ids.length} samples`} to ${folderId ? byId.get(folderId)?.name || 'folder' : '未归档'}`, 'success', 1400);
  });
  const moveMenu = (ids, current) => [
    { label: '未归档', checked: current === undefined ? undefined : current === '', onClick: () => move(ids, null) },
    ...folders.map((f) => ({ label: f.name, checked: current === undefined ? undefined : current === f.id, onClick: () => move(ids, f.id) })),
    '-',
    { label: '新建文件夹…', onClick: () => guard(async () => { const f = await newSampleFolder(); if (f) move(ids, f.id); }) }
  ];
  const analyze = (s) => guard(async () => {
    st.toast(`正在分析「${s.name}」的音高…`, 'info', 1500);
    await analyzeSampleInBrowser(s.id);
    await st.refreshSamples();
  });
  const rename = (s) => guard(async () => {
    const name = await st.prompt({ title: '重命名采样', value: s.name });
    if (name?.trim()) { await api.updateSample(s.id, { name }); await st.refreshSamples(); }
  });
  const sampleMenu = (s) => [
    { label: '添加为采样器通道', onClick: () => addSamplerChannel(s) },
    { label: '在波形编辑器中编辑', onClick: () => openSampleEditor(s.id) },
    { label: '移动到文件夹', submenu: moveMenu([s.id], folderKey(s)) },
    { label: '重命名…', onClick: () => rename(s) },
    '-',
    { label: openId === s.id ? '隐藏详情' : '显示详情', onClick: () => setOpenId(openId === s.id ? null : s.id) },
    { label: '重新分析', onClick: () => analyze(s) },
    '-',
    { label: '删除…', danger: true, onClick: () => guard(() => deleteSamplesWithWarning([s])) }
  ];
  const folderMenu = (f) => [
    { label: '上传到此文件夹…', onClick: () => pickFiles(f.id) },
    { label: '重命名文件夹…', onClick: () => guard(async () => {
      const name = await st.prompt({ title: '重命名文件夹', value: f.name });
      if (name?.trim() && name.trim() !== f.name) { await api.renameSampleFolder(f.id, name); await st.refreshSamples(); }
    }) },
    { label: '删除文件夹…', danger: true, onClick: () => guard(async () => {
      const n = samples.filter((s) => s.folderId === f.id).length;
      const ok = await st.confirm({ title: `Delete folder "${f.name}"?`, message: n ? `Its ${n} sample${n === 1 ? '' : 's'} will be kept and moved to Unfiled.` : '这个文件夹是空的。', danger: true, okLabel: '删除文件夹' });
      if (ok) { await api.deleteSampleFolder(f.id); await st.refreshSamples(); }
    }) }
  ];

  // drag a sample (or the selection it belongs to) onto a folder header to file it; drop audio files there to upload
  const dropProps = (key) => ({
    onDragOver: (e) => {
      const t = e.dataTransfer.types;
      if (!t.includes(DND_SAMPLE) && !t.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = t.includes('Files') ? 'copy' : 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      if (e.dataTransfer.files?.length) return onFiles(e.dataTransfer.files, key || null);
      let s;
      try { s = JSON.parse(e.dataTransfer.getData(DND_SAMPLE)); } catch { return; }
      const ids = selecting && selected.has(s.id) ? selectedIds : [s.id];
      const moving = ids.filter((id) => folderKey(samples.find((x) => x.id === id) || {}) !== key);
      if (moving.length) move(moving, key || null);
    }
  });

  const row = (s) => {
    const sel = selected.has(s.id);
    return (
      <div key={s.id}>
        <div className={`br-item sample ${sel ? 'sel' : ''}`} draggable data-sample={s.id}
          onDragStart={(e) => { e.dataTransfer.setData(DND_SAMPLE, JSON.stringify(s)); e.dataTransfer.effectAllowed = 'copyMove'; }}
          {...longPressProps((e) => st.showContextMenu(e, sampleMenu(s)))}>
          {selecting
            ? <input type="checkbox" className="smp-check" checked={sel} onChange={() => toggleSelected(s.id)} aria-label={`Select ${s.name}`} />
            : <Icon name="wave" size={13} />}
          <button className="br-name" title={selecting ? 'Select' : '试听'} onClick={async () => {
            if (selecting) return toggleSelected(s.id);
            await st.unlockAudio();
            getEngine()?.previewSample(s.id);
          }}>{s.name}</button>
          {s.duration ? <span className="br-meta">{s.duration.toFixed(1)}s</span> : null}
          <button className={`br-add info ${openId === s.id ? 'on' : ''}`} title="详情" aria-label={`Details of ${s.name}`} onClick={() => setOpenId(openId === s.id ? null : s.id)}><Icon name="info" size={12} /></button>
          <button className="br-add" title="添加为采样器通道" aria-label={`Add ${s.name} as sampler channel`} onClick={() => addSamplerChannel(s)}><Icon name="plus" size={12} /></button>
          <button className="br-add more" title="更多操作" aria-label={`More actions for ${s.name}`} aria-haspopup="menu" onClick={(e) => menuAt(e, sampleMenu(s))}><Icon name="dots" size={12} /></button>
        </div>
        {openId === s.id && <SampleDetails s={s} />}
      </div>
    );
  };

  return (
    <div className={`br-list samples ${over === 'list' ? 'drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); if (over !== 'list') setOver('list'); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
      onDrop={(e) => { e.preventDefault(); setOver(null); if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files); }}>
      <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple hidden data-testid="sample-file-input"
        onChange={(e) => { onFiles(e.target.files, uploadTo.current); uploadTo.current = null; e.target.value = ''; }} />
      <div className="smp-tools">
        <button className="btn tiny" onClick={() => pickFiles(null)}><Icon name="upload" size={12} /> 上传</button>
        <button className="btn tiny" onClick={() => st.openWindow('recorder')}><Icon name="mic" size={12} /> 录音</button>
        <span className="spacer" />
        <button className="btn tiny icon-btn" title="新建文件夹" aria-label="新建文件夹" onClick={() => guard(newSampleFolder)}><Icon name="folderPlus" size={13} /></button>
        <button className={`btn tiny icon-btn ${selecting ? 'on' : ''}`} title="选择多个采样" aria-label="选择多个采样" aria-pressed={selecting}
          onClick={() => (selecting ? endSelect() : setSelecting(true))}><Icon name="check" size={13} /></button>
      </div>
      {samples.length > 0 && (
        <label className="smp-search">
          <Icon name="search" size={12} />
          <input type="search" value={query} placeholder="搜索名称、文件夹、调、BPM…" aria-label="搜索采样"
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
        </label>
      )}
      {selecting && (
        <div className="smp-bulk" role="toolbar" aria-label="已选采样">
          <span>{selectedIds.length} selected</span>
          <button className="btn tiny" onClick={() => setSelected(new Set(visibleRows.map((s) => s.id)))}>全部</button>
          <button className="btn tiny" disabled={!selectedIds.length} onClick={(e) => menuAt(e, moveMenu(selectedIds))}>移动到…</button>
          <button className="btn tiny danger" disabled={!selectedIds.length} onClick={() => guard(async () => { if (await deleteSamplesWithWarning(selectedList)) endSelect(); })}>删除</button>
          <button className="btn tiny" onClick={endSelect}>完成</button>
        </div>
      )}
      {flat
        ? visible.map(row)
        : groups.map((g) => {
          const isOpen = words.length > 0 || !collapsed.has(g.key);
          return (
            <div key={g.key || 'unfiled'} className="smp-folder" data-folder={g.name}>
              <div className={`br-item br-folder ${over === g.key ? 'drop' : ''}`} {...dropProps(g.key)}
                {...(g.folder ? longPressProps((e) => st.showContextMenu(e, folderMenu(g.folder))) : null)}>
                <button className="br-expand" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${g.name}`} onClick={() => toggleCollapsed(g.key)}>
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <Icon name="folder" size={13} />
                <button className="br-name" onClick={() => toggleCollapsed(g.key)}>{g.name}</button>
                <span className="br-meta">{g.items.length}</span>
                {g.folder
                  ? <button className="br-add more" title="文件夹操作" aria-label={`Actions for folder ${g.name}`} aria-haspopup="menu" onClick={(e) => menuAt(e, folderMenu(g.folder))}><Icon name="dots" size={12} /></button>
                  : <span className="br-add-spacer" aria-hidden="true" />}
              </div>
              {isOpen && <div className="smp-items">{g.items.map(row)}{!g.items.length && <p className="br-empty">把采样拖到这里。</p>}</div>}
            </div>
          );
        })}
      {!samples.length && (
        <p className="br-hint">把音频拖到这里，或上传／录制。把采样拖到播放列表（音频片段）或通道架（采样器）即可使用。</p>
      )}
      {samples.length > 0 && words.length > 0 && !visible.length && <p className="br-empty">没有匹配「{query}」的采样。</p>}
    </div>
  );
}
