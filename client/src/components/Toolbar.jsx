import { TEMPLATES, PPQ, STEP, ticksPerBar, SPATIAL_EXPORTS, SPATIAL_EXPORT_IDS } from '@greanteadawy/core';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { Icon } from './ui/Icon.jsx';
import { Knob } from './ui/Knob.jsx';
import { DragNumber } from './ui/Controls.jsx';
import { Visualizer } from './Visualizer.jsx';
import { usePlayheadTick } from '../lib/hooks.js';
import {
  newPattern, clonePattern, renamePattern, deletePattern, exportWav, exportAs, exportStemsFromUi, exportSpatialFromUi, exportMidi, exportProjectJson,
  importProjectJson, importMidi
} from '../lib/actions.js';
import { connectMidi } from '../lib/midiInput.js';
import { APP_NAME } from '../lib/version.js';

/** File → Export song as…: the formats the server's ffmpeg can make (the rest shown disabled, with the reason). */
function exportFormatItems(info) {
  if (!info) return [{ label: '正在检查服务端的 ffmpeg…', disabled: true }];
  const items = info.formats.filter((f) => f.id !== 'wav').map((f) => ({
    label: `${f.label}${f.bitrates ? ` (${f.defaultBitrate} kbps)` : f.lossless ? ' (24-bit)' : ''}${f.available ? '' : ' — needs ffmpeg'}`,
    disabled: !f.available,
    onClick: () => exportAs(f.id)
  }));
  const lossy = info.formats.filter((f) => f.available && f.bitrates);
  const more = lossy.map((f) => ({ label: `${f.label} at…`, submenu: f.bitrates.map((b) => ({ label: `${b} kbps`, checked: b === f.defaultBitrate, onClick: () => exportAs(f.id, { bitrate: b }) })) }));
  return [
    { header: info.ffmpeg.available ? `via ffmpeg ${info.ffmpeg.version}` : '服务端没有可用的 ffmpeg' },
    ...items,
    ...(more.length ? ['-', ...more] : []),
    '-',
    { label: '音频导出设置…', onClick: () => { useStore.setState({ settingsTab: 'export' }); useStore.getState().openWindow('settings'); } }
  ];
}

function TimeDisplay() {
  const project = useStore((s) => s.project);
  const tick = usePlayheadTick(30);
  const t = tick ?? 0;
  const bar = ticksPerBar(project);
  const b = Math.floor(t / bar);
  const beat = Math.floor((t - b * bar) / PPQ);
  const step = Math.floor((t - b * bar - beat * PPQ) / STEP);
  const secs = (t / PPQ) * (60 / project.bpm);
  return (
    <div className="time-display" title="歌曲位置（小节 : 拍 : 步）">
      <span className="time-main">{String(b + 1).padStart(3, ' ')}:{beat + 1}:{String(step + 1).padStart(2, '0')}</span>
      <span className="time-sub">{Math.floor(secs / 60)}:{String(Math.floor(secs % 60)).padStart(2, '0')}</span>
    </div>
  );
}

// 打拍定速:工具栏按钮与 ◆ 菜单共用一份 taps(连续点三下以上生效,间隔 2.5 秒内的才算)
const tapTaps = [];
function tapTempo(dispatch) {
  const now = performance.now();
  while (tapTaps.length && now - tapTaps[0] > 2500) tapTaps.shift();
  tapTaps.push(now);
  if (tapTaps.length >= 3) {
    const d = tapTaps.slice(1).map((t, i) => t - tapTaps[i]);
    const bpm = Math.round(60000 / (d.reduce((a, b) => a + b, 0) / d.length));
    dispatch([{ type: 'project/update', patch: { bpm: Math.max(40, Math.min(300, bpm)) } }], { coalesce: 'tap' });
  }
}

function TapTempo() {
  const dispatch = useStore((s) => s.dispatch);
  return (
    <button className="tbtn small tap" title="打拍定速（跟着节奏连点三下）" onClick={() => tapTempo(dispatch)}>打拍</button>
  );
}

export function Toolbar() {
  const project = useStore((s) => s.project);
  const mode = useStore((s) => s.mode);
  const playing = useStore((s) => s.playing);
  const recording = useStore((s) => s.recording);
  const metronome = useStore((s) => s.metronome);
  const selectedPatternId = useStore((s) => s.selectedPatternId);
  const windows = useStore((s) => s.windows);
  const browserOpen = useStore((s) => s.browserOpen);
  const connected = useStore((s) => s.connected);
  const claudeActive = useStore((s) => s.claudeActive);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const midiStatus = useStore((s) => s.midiStatus);
  const st = useStore.getState();

  const fileMenu = (e) => st.showContextMenu(e, [
    { header: '项目' },
    { label: '从模板新建', submenu: Object.entries(TEMPLATES).map(([key, t]) => ({ label: t.label, onClick: async () => {
      const name = await st.prompt({ title: '新建项目', value: key === 'empty' || key === 'default' ? '未命名' : t.label.split(' (')[0] });
      if (name !== null) st.createProject({ name: name || '未命名', template: key });
    } })) },
    { label: '重命名项目…', onClick: async () => {
      const name = await st.prompt({ title: '重命名项目', value: project.name });
      if (name) st.dispatch([{ type: 'project/update', patch: { name } }]);
    } },
    { label: '打拍定速（跟着节奏连点）', onClick: () => tapTempo(useStore.getState().dispatch) },
    { label: '拍号…', onClick: async () => {
      const v = await st.prompt({ title: '拍号', value: project.timeSig.join('/'), label: '每小节拍数／音符单位（如 4/4、3/4、6/8）' });
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v || '');
      if (m) st.dispatch([{ type: 'project/update', patch: { timeSig: [Number(m[1]), Number(m[2])] } }]);
    } },
    { label: '版本…', onClick: () => st.openWindow('versions') },
    { label: '保存副本', onClick: async () => {
      const p = await api.duplicateProject(project.id, `${project.name} (copy)`);
      st.refreshProjects();
      st.toast(`已另存为「${p.name}」`, 'success');
    } },
    '-',
    { header: '导出' },
    { label: '导出歌曲为 WAV', submenu: [
      { label: '16 位（含抖动，便于分享）', onClick: () => exportWav('song', { bitDepth: 16 }) },
      { label: '24 位（用于母带）', onClick: () => exportWav('song', { bitDepth: 24 }) }
    ] },
    { label: '导出歌曲为…', submenu: exportFormatItems(st.exportFormats) },
    { label: '导出片段循环为 WAV', onClick: () => exportWav('pattern') },
    { label: '导出分轨（各通道，存到导出）', onClick: exportStemsFromUi },
    { label: '导出空间混音（3D）…', submenu: SPATIAL_EXPORT_IDS.map((k) => ({ label: SPATIAL_EXPORTS[k].label, onClick: () => exportSpatialFromUi(k) })) },
    { label: '导出 MIDI（歌曲）', onClick: () => exportMidi('song') },
    { label: '导出项目文件（.json）', onClick: exportProjectJson },
    '-',
    { header: '导入' },
    { label: '把 MIDI 导入当前片段…', onClick: importMidi },
    { label: '导入项目文件…', onClick: importProjectJson },
    '-',
    // secondary windows live here, not on the bar: the bar only keeps the three daily views
    { header: '窗口' },
    { label: '播放列表', shortcut: 'F5', checked: windows.playlist?.open, onClick: () => st.toggleWindow('playlist') },
    { label: '通道架', shortcut: 'F6', checked: windows.channelRack?.open, onClick: () => st.toggleWindow('channelRack') },
    { label: '弹奏（智能乐器）', checked: windows.play?.open, onClick: () => st.toggleWindow('play') },
    { label: '钢琴卷帘', shortcut: 'F7', checked: windows.pianoRoll?.open, onClick: () => st.toggleWindow('pianoRoll') },
    { label: '通道设置', shortcut: 'F8', checked: windows.channelSettings?.open, onClick: () => st.toggleWindow('channelSettings') },
    { label: '混音台', shortcut: 'F9', checked: windows.mixer?.open, onClick: () => st.toggleWindow('mixer') },
    { label: '空间混音台（3D／全景声）', checked: windows.spatial?.open, onClick: () => st.toggleWindow('spatial') },
    { label: '连接 MIDI 键盘', checked: !!midiStatus, onClick: connectMidi },
    '-',
    { label: '设置…', onClick: () => st.openWindow('settings') },
    { label: '连接 Claude（API 令牌与 MCP）…', onClick: () => { useStore.setState({ settingsTab: 'api' }); st.openWindow('settings'); } },
    { label: '跟随 Claude（自动打开它的项目）', checked: st.followClaude, onClick: () => st.setPref('followClaude', !st.followClaude) },
    { label: '重置窗口布局', onClick: st.resetLayout },
    { label: '键盘快捷键与帮助', onClick: () => st.openWindow('help') },
    { label: `关于 ${APP_NAME}…`, onClick: () => st.showAbout() }
  ]);

  const user = useStore.getState().auth.user;
  const initials = (user?.displayName || user?.username || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const userMenu = (e) => st.showContextMenu(e, [
    { header: `${user.displayName} (@${user.username})` },
    { label: '账号设置', onClick: () => { useStore.setState({ settingsTab: 'account' }); st.openWindow('settings'); } },
    { label: 'API 令牌与 MCP', onClick: () => { useStore.setState({ settingsTab: 'api' }); st.openWindow('settings'); } },
    user.role === 'admin' && { label: '管理用户', onClick: () => { useStore.setState({ settingsTab: 'users' }); st.openWindow('settings'); } },
    '-',
    !useStore.getState().auth.authDisabled && { label: '退出登录', onClick: () => st.signOut() }
  ].filter(Boolean));

  const patternMenu = (e) => st.showContextMenu(e, [
    { label: '新建片段', shortcut: 'F4', onClick: () => newPattern() },
    { label: '克隆片段', onClick: () => clonePattern(selectedPatternId) },
    { label: '重命名…', onClick: () => renamePattern(selectedPatternId) },
    { label: '删除', danger: true, onClick: () => deletePattern(selectedPatternId) }
  ]);

  const master = project.mixer[0];
  const winBtn = (name, icon, label, key, withText) => (
    <button className={`tbtn win ${windows[name]?.open ? 'active' : ''}`} title={key ? `${label} (${key})` : label} onClick={() => st.toggleWindow(name)}>
      <Icon name={icon} size={16} />{withText && <span className="win-label">{label}</span>}
    </button>
  );

  // GarageBand-for-iPad style bar, trimmed to what a class actually uses daily, ordered by frequency:
  // left = project + the three daily views; center = transport (highest priority); right = clip / master / status.
  // Everything else (piano roll, mixer, settings, MIDI, about) lives in the ◆ menu under 窗口 — F-keys still work.
  return (
    <div className="toolbar" role="toolbar">
      <div className="tb-side tb-left">
        <div className="tb-group">
          <button className="tbtn logo" onClick={fileMenu} title="菜单">
            <span className="logo-mark">◆</span><span className="logo-text">GreanTeaDawy</span><Icon name="chevronDown" size={12} />
          </button>
          <button className="tbtn" title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={st.undo}><Icon name="undo" /></button>
          <button className="tbtn" title="重做（Ctrl+Y）" disabled={!canRedo} onClick={st.redo}><Icon name="redo" /></button>
          <button className="tbtn" title="新手指南：三分钟上手（模板、播放、导出）" onClick={() => useStore.setState({ welcomeOpen: true })}><Icon name="book" /></button>
        </div>
        <div className="tb-group windows">
          <button className={`tbtn win ${browserOpen ? 'active' : ''}`} title="浏览器（Alt+F8）" onClick={() => st.setPref('browserOpen', !browserOpen)}><Icon name="folder" /></button>
          {winBtn('playlist', 'playlist', '播放列表', 'F5', true)}
          {winBtn('channelRack', 'rack', '通道架', 'F6', true)}
          {winBtn('play', 'music', '弹奏', null, true)}
        </div>
      </div>

      <div className="tb-center">
        <div className="tb-group transport">
          <div className="mode-switch" role="radiogroup" aria-label="播放模式">
            <button role="radio" aria-checked={mode === 'pattern'} className={mode === 'pattern' ? 'on pat' : ''} onClick={() => st.setMode('pattern')} title="片段模式：循环所选片段（Shift+L 切换）">片段</button>
            <button role="radio" aria-checked={mode === 'song'} className={mode === 'song' ? 'on song' : ''} onClick={() => st.setMode('song')} title="歌曲模式：播放播放列表（Shift+L 切换）">歌曲</button>
          </div>
          <button className={`tbtn play ${playing ? 'active' : ''}`} title="播放／停止（空格）" onClick={st.togglePlay}>
            <Icon name={playing ? 'pause' : 'play'} size={20} />
          </button>
          <button className="tbtn" title="停止" onClick={st.stop}><Icon name="stop" size={16} /></button>
          <button className={`tbtn rec ${recording ? 'active' : ''}`} title="录音：播放时在电脑键盘／MIDI 上弹的音符会写入片段" onClick={() => useStore.setState({ recording: !recording })}>
            <Icon name="record" size={16} />
          </button>
          <div className="tempo" title="速度（BPM）">
            <DragNumber value={project.bpm} min={20} max={400} step={1} sensitivity={0.3}
              format={(v) => v.toFixed(v % 1 ? 2 : 0)} className="tempo-num"
              onChange={(v) => st.dispatch([{ type: 'project/update', patch: { bpm: v } }], { coalesce: 'bpm' })} />
            <span className="tempo-label">BPM</span>
          </div>
          <TapTempo />
          <button className={`tbtn metro ${metronome ? 'active' : ''}`} title="节拍器" onClick={st.toggleMetronome}><Icon name="metronome" /></button>
          <button className="tbtn mic" title="录制音频（麦克风）：打开录音器" aria-label="录制音频" onClick={() => st.toggleWindow('recorder')}>
            <Icon name="mic" size={16} />
          </button>
          <TimeDisplay />
        </div>
      </div>

      <div className="tb-side tb-right">
        <div className="tb-group pattern-pick">
          <button className="tbtn small pat-nav" title="上一个片段" onClick={() => {
            const i = project.patterns.findIndex((p) => p.id === selectedPatternId);
            if (i > 0) st.selectPattern(project.patterns[i - 1].id);
          }}>‹</button>
          <select className="ui-select pattern-select" value={selectedPatternId || ''} onChange={(e) => st.selectPattern(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()} title="当前片段">
            {project.patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="tbtn small pat-nav" title="下一个片段" onClick={() => {
            const i = project.patterns.findIndex((p) => p.id === selectedPatternId);
            if (i < project.patterns.length - 1) st.selectPattern(project.patterns[i + 1].id);
          }}>›</button>
          <button className="tbtn small" title="片段选项：新建／克隆／重命名／删除" onClick={patternMenu}><Icon name="dots" size={14} /></button>
        </div>

        <div className="tb-group">
          <Knob value={master.volume} min={0} max={1.25} def={1} size={28} title={`主音量 ${Math.round(master.volume * 100)}%`}
            onChange={(v) => st.dispatch([{ type: 'mixer/update', index: 0, patch: { volume: v } }], { coalesce: 'mastervol' })} />
          <Visualizer />
        </div>

        <div className="tb-group status">
          {claudeActive && (
            <span className="claude-indicator active" title="Claude 正在编辑…">
              <Icon name="claude" size={14} />Claude 正在编辑…
            </span>
          )}
          <span className={`conn ${connected ? 'ok' : 'down'}`} title={connected ? '已连接服务端（实时同步）' : '已断开——正在重连…'} />
          <button className="avatar" title={`${user?.displayName} — 账号菜单`} onClick={userMenu} aria-label="账号菜单">{initials}</button>
        </div>
      </div>
    </div>
  );
}
