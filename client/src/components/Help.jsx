import { Window } from './ui/Window.jsx';
import { SHORTCUTS } from '../lib/keyboard.js';
import { useStore } from '../state/store.js';

const STEPS = [
  ['1 · 挑一个模板，先听成品', '点顶部 ◆ 菜单 → 从模板新建（推荐「民乐合奏」），或左侧浏览器「项目」页选模板点「新建」。建好按空格键播放——先听一遍整首。'],
  ['2 · 认识两个播放模式', '工具栏的「片段 / 歌曲」开关：片段＝循环当前乐句，适合练习和编节奏；歌曲＝按播放列表从头放到尾，适合听整首效果。Shift+L 快速切换。'],
  ['3 · 加乐器、改音符', '浏览器「声音」页点乐器旁的 ＋ 加进通道架；在通道架的格子上点按，立刻写出一段节奏；选中一条通道按 F7 打开钢琴卷帘，用鼠标画旋律。左上角 ◆ 菜单随时可以重开这些窗口。'],
  ['4 · 导出，带去课堂', '◆ 菜单 → 导出歌曲为 WAV（16 位即可分享），得到一个音频文件，班级电脑、投影都能直接放。']
];

const GLOSSARY = [
  ['片段（Pattern）', '一小段循环乐句——一段鼓点、一句旋律。做音乐就是先做好几个片段。'],
  ['播放列表（Playlist）', '把片段按时间排成整首歌的「时间线」，像编排节目单。'],
  ['通道架（Channel Rack）', '这首曲子用到的乐器清单，每件乐器下面有打节奏的步进格子。'],
  ['钢琴卷帘（Piano Roll）', '逐个音符编辑的画布：横轴是时间，纵轴是音高。'],
  ['混音台（Mixer）', '每件乐器的音量、左右声像和效果（混响等），最后都汇到主音量。']
];

export function Help() {
  const st = useStore.getState();
  const showWelcome = () => useStore.setState({ welcomeOpen: true });
  const openApi = () => { useStore.setState({ settingsTab: 'api' }); st.openWindow('settings'); };
  return (
    <Window name="help" title="三分钟上手指南" icon="book" minW={420} minH={300}>
      <div className="help">
        <h3>四步做出第一首课堂乐曲</h3>
        {STEPS.map(([t, d]) => (
          <p key={t}><b>{t}</b><br />{d}</p>
        ))}
        <p><button className="btn primary" onClick={showWelcome}>打开新手欢迎页（含精选模板）</button></p>

        <h3>名词小词典</h3>
        <table className="shortcuts">
          <tbody>
            {GLOSSARY.map(([k, d]) => <tr key={k}><td className="gl-term">{k}</td><td>{d}</td></tr>)}
          </tbody>
        </table>

        <h3>最常用的快捷键</h3>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
          </tbody>
        </table>

        <details>
          <summary>进阶：与 Claude 一起做音乐（MCP）</summary>
          <p>本站内置 MCP 服务器（70+ 工具），连接后 Claude 可以直接在这个窗口里建通道、写鼓点与旋律、管理采样、编曲、混音、导出并按下播放——所有修改实时同步显示。</p>
          <p><button className="btn primary" onClick={openApi}>打开「设置 → API 与 MCP」</button> 里面有 Claude Code / Claude Desktop 的接入说明和个人 API 令牌。</p>
          <p>试试对 Claude 说：<i>“用民乐合奏模板做一首 88 BPM 的曲子，古筝主旋律，混音到 -14 LUFS，然后播放。”</i></p>
        </details>
      </div>
    </Window>
  );
}
