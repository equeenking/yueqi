import { memo, useEffect, useRef } from 'react';
import { useStore, COMPACT_WIDTH } from './state/store.js';
import { Toolbar } from './components/Toolbar.jsx';
import { Browser } from './components/Browser.jsx';
import { ChannelRack } from './components/ChannelRack.jsx';
import { PianoRoll } from './components/PianoRoll.jsx';
import { Playlist } from './components/Playlist.jsx';
import { Mixer } from './components/Mixer.jsx';
import { ChannelSettings } from './components/ChannelSettings.jsx';
import { AutomationEditor } from './components/AutomationEditor.jsx';
import { Help } from './components/Help.jsx';
import { Settings } from './components/Settings.jsx';
import { Versions } from './components/Versions.jsx';
import { Spatial } from './components/Spatial.jsx';
import { Generate } from './components/Generate.jsx';
import { Play } from './components/Play.jsx';
import { WaveEditor } from './components/WaveEditor.jsx';
import { Recorder } from './components/Recorder.jsx';
import { Welcome } from './components/Welcome.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { ContextMenu, Modal, Toasts } from './components/ui/Overlays.jsx';
import { WorkspaceContext } from './components/ui/Window.jsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import { Icon } from './components/ui/Icon.jsx';
import { useElementSize, useWindowWidth } from './lib/hooks.js';
import { installKeyboard } from './lib/keyboard.js';

// Panels take no props and subscribe to exactly the state they need, so memo() keeps window moves,
// focus changes and unrelated edits from re-rendering every panel.
const Panels = {
  Playlist: memo(Playlist), ChannelRack: memo(ChannelRack), PianoRoll: memo(PianoRoll), Mixer: memo(Mixer),
  ChannelSettings: memo(ChannelSettings), AutomationEditor: memo(AutomationEditor), Help: memo(Help),
  Settings: memo(Settings), Versions: memo(Versions), Browser: memo(Browser), Toolbar: memo(Toolbar), Spatial: memo(Spatial), Generate: memo(Generate),
  Play: memo(Play),
  WaveEditor: memo(WaveEditor), Recorder: memo(Recorder)
};

/** Open windows, topmost first, as a string so the selector only changes when the set or order changes. */
const openWindowsKey = (s) => Object.entries(s.windows).filter(([, w]) => w.open).sort((a, b) => b[1].z - a[1].z).map(([k]) => k).join(',');

const WINDOW_TABS = [
  ['playlist', '播放列表', 'playlist'],
  ['channelRack', '通道架', 'rack'],
  ['play', '弹奏', 'music'],
  ['pianoRoll', '钢琴卷帘', 'piano'],
  ['mixer', '混音台', 'mixer'],
  ['channelSettings', '通道', 'sliders']
];

export default function App() {
  const phase = useStore((s) => s.auth.phase);
  if (phase !== 'ready') {
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    );
  }
  return <Studio />;
}

function Studio() {
  const hasProject = useStore((s) => !!s.project);
  const projectName = useStore((s) => s.project?.name);
  const loading = useStore((s) => s.loading);
  const connected = useStore((s) => s.connected);
  const browserOpen = useStore((s) => s.browserOpen);
  const audioReady = useStore((s) => s.audioReady);
  const pendingPlay = useStore((s) => s.pendingPlay);
  const busy = useStore((s) => s.busy);
  const openKey = useStore(openWindowsKey);
  const wsRef = useRef(null);
  const size = useElementSize(wsRef);
  // decided by the window (not the workspace, whose width itself depends on compact mode → flicker)
  const compact = useWindowWidth() < COMPACT_WIDTH;

  useEffect(() => installKeyboard(), []);
  useEffect(() => { useStore.getState().maybeShowWelcome(); }, []);
  useEffect(() => {
    const unlock = () => useStore.getState().unlockAudio();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);
  useEffect(() => {
    if (projectName) document.title = `${projectName} — GreanTeaDawy`;
  }, [projectName]);

  if (!hasProject) {
    return (
      <div className="splash">
        <div className="logo-big">◆ GreanTeaDawy</div>
        <p>{loading && connected ? '正在载入工程…' : connected ? '正在准备…' : '正在连接 GreanTeaDawy 服务端…'}</p>
        {!connected && <p className="muted">请确认服务正在运行： <code>npm run dev</code> 或 <code>npm start</code></p>}
      </div>
    );
  }

  const openWins = openKey ? openKey.split(',') : [];
  const topWindow = openWins[0] || null;
  const { Playlist: PlaylistP, ChannelRack: RackP, PianoRoll: PianoP, Mixer: MixerP, ChannelSettings: ChanP, AutomationEditor: AutoP, Help: HelpP, Settings: SettingsP, Versions: VersionsP, Browser: BrowserP, Toolbar: ToolbarP, Spatial: SpatialP, Generate: GenerateP, Play: PlayP, WaveEditor: WaveEditorP, Recorder: RecorderP } = Panels;

  return (
    <div className={`app ${compact ? 'compact' : ''}`}>
      <ErrorBoundary name="工具栏"><ToolbarP /></ErrorBoundary>
      <div className="main">
        {browserOpen && !compact && <ErrorBoundary name="浏览器"><BrowserP /></ErrorBoundary>}
        {/* a click on the empty workspace gives the keyboard back to the studio (Space plays, Ctrl+Z undoes the project) */}
        <div className="workspace" ref={wsRef} onPointerDown={(e) => { if (e.target === e.currentTarget && document.activeElement?.closest?.('.window')) document.activeElement.blur(); }}>
          <WorkspaceContext.Provider value={{ compact, width: size.width, height: size.height, topWindow }}>
            <ErrorBoundary name="播放列表"><PlaylistP /></ErrorBoundary>
            <ErrorBoundary name="通道架"><RackP /></ErrorBoundary>
            <ErrorBoundary name="钢琴卷帘"><PianoP /></ErrorBoundary>
            <ErrorBoundary name="混音台"><MixerP /></ErrorBoundary>
            <ErrorBoundary name="通道设置"><ChanP /></ErrorBoundary>
            <ErrorBoundary name="自动化"><AutoP /></ErrorBoundary>
            <HelpP />
            <ErrorBoundary name="设置"><SettingsP /></ErrorBoundary>
            <ErrorBoundary name="版本"><VersionsP /></ErrorBoundary>
            <ErrorBoundary name="空间"><SpatialP /></ErrorBoundary>
            <ErrorBoundary name="生成"><GenerateP /></ErrorBoundary>
            <ErrorBoundary name="弹奏"><PlayP /></ErrorBoundary>
            <ErrorBoundary name="波形编辑器"><WaveEditorP /></ErrorBoundary>
            <ErrorBoundary name="录音"><RecorderP /></ErrorBoundary>
          </WorkspaceContext.Provider>
          {compact && browserOpen && <div className="browser-overlay"><BrowserP /></div>}
          {!openWins.length && !compact && (
            <div className="workspace-empty">
              <p>这里是你的工作台——从下面任选一处开始：</p>
              <div className="empty-actions">
                <button className="btn primary" onClick={() => useStore.getState().openWindow('playlist')}>打开播放列表（编曲）</button>
                <button className="btn" onClick={() => useStore.getState().openWindow('channelRack')}>打开通道架（乐器）</button>
                <button className="btn" onClick={() => useStore.getState().showWelcome()}>新手指南</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {compact && (
        <nav className="tabbar">
          <button className={browserOpen ? 'on' : ''} onClick={() => useStore.getState().setPref('browserOpen', !browserOpen)}>
            <Icon name="folder" size={16} /><span>浏览</span>
          </button>
          {WINDOW_TABS.map(([name, label, icon]) => (
            <button key={name} className={topWindow === name && !browserOpen ? 'on' : ''} onClick={() => { useStore.getState().setPref('browserOpen', false); useStore.getState().openWindow(name); }}>
              <Icon name={icon} size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {!audioReady && (
        <button className={`audio-banner ${pendingPlay ? 'urgent' : ''}`} onClick={() => useStore.getState().unlockAudio()}>
          <Icon name="speaker" size={14} /> {pendingPlay ? 'Claude 想播放你的节拍 — 点击启用声音' : '点击任意位置以启用声音'}
        </button>
      )}
      {busy && <div className="busy"><div className="spinner" />{busy}</div>}
      <Welcome />
      <ContextMenu />
      <Modal />
      <Toasts />
    </div>
  );
}
