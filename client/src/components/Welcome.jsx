import { useStore } from '../state/store.js';
import { Icon } from './ui/Icon.jsx';

/** 精选模板：卡片文案按「第一次上课的老师」来写，点卡片直接建工程，不弹命名框。 */
const PICKS = [
  ['minyue', '民乐合奏', '古筝·二胡·笛子·锣', '课堂首选', 'cover_minyue.jpg'],
  ['eastasian', '东亚 Lo-fi', '日本筝·尺八·太鼓', '安静氛围', 'cover_eastasian.jpg'],
  ['lofi', 'Lo-fi 嘻哈', '慢节奏学习伴奏', '轻松', 'cover_lofi.jpg'],
  ['band', '流行乐队', '钢琴·吉他·贝斯·弦乐', '合唱伴奏', 'cover_band.jpg'],
  ['trap', '陷阱说唱', '808 低音·利落鼓组', '节奏感', 'cover_trap.jpg'],
  ['house', '深层浩室', '四踩电子舞曲', '律动', 'cover_house.jpg']
];

const STEPS = [
  ['1', '挑一个模板听成品', '点下面的卡片，立刻有一首编好的曲子。空格键播放／停止。'],
  ['2', '点开乐器改一改', '左侧浏览器把乐器加进通道架：格子点按做节奏，钢琴卷帘画旋律。'],
  ['3', '导出带去课堂', '左上 ◆ 菜单 → 导出歌曲为 WAV，一个音频文件就能分享全班。']
];

export function Welcome() {
  const open = useStore((s) => s.welcomeOpen);
  if (!open) return null;
  const dismiss = () => useStore.getState().dismissWelcome();
  const pick = async ([key, label]) => {
    dismiss();
    const st = useStore.getState();
    st.unlockAudio().catch(() => {}); // 在点击手势里解锁音频，稍后的自动播放才不会哑
    const p = await st.createProject({ name: label, template: key });
    if (!p) return;
    st.openWindow('playlist');
    st.openWindow('channelRack');
    // 等工程经实时同步落位后自动播放——课堂里点卡片就能听见成品
    for (let i = 0; i < 50 && useStore.getState().project?.id !== p.id; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = useStore.getState();
    if (s.project?.id === p.id && !s.playing && !s.starting) s.play();
  };
  const guide = () => { dismiss(); useStore.getState().openWindow('help'); };
  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="欢迎">
      <div className="welcome">
        <div className="welcome-hero" style={{ backgroundImage: 'url(/img/welcome_bg.jpg)' }} role="img" aria-label="民族乐器桌面" />
        <div className="welcome-head">
          <span className="welcome-mark">◆</span>
          <div>
            <h2>欢迎来到民乐音乐工作站</h2>
            <p>浏览器里的「库乐队」——不用安装，打开就能编曲，古筝二胡笛子都是真采样音色。</p>
          </div>
          <button className="tbtn" title="关闭" aria-label="关闭欢迎" onClick={dismiss}><Icon name="close" size={16} /></button>
        </div>

        <div className="welcome-steps">
          {STEPS.map(([n, t, d]) => (
            <div className="welcome-step" key={n}>
              <span className="step-num">{n}</span>
              <div><b>{t}</b><p>{d}</p></div>
            </div>
          ))}
        </div>

        <h3>从一个模板开始（点卡片立刻建工程）</h3>
        <div className="welcome-cards">
          {PICKS.map(([key, label, desc, tag, cover]) => (
            <button className="welcome-card" key={key} onClick={() => pick([key, label])}>
              <img className="card-cover" src={`/img/${cover}`} alt="" draggable="false" />
              <span className="card-tag">{tag}</span>
              <b>{label}</b>
              <span className="card-desc">{desc}</span>
              <Icon name="play" size={13} />
            </button>
          ))}
        </div>
        <p className="welcome-more">更多曲风在浏览器「我的乐曲」页或 ◆ 菜单 → 从模板新建。</p>

        <div className="welcome-actions">
          <button className="btn" onClick={guide}><Icon name="book" size={14} /> 三分钟上手指南</button>
          <button className="btn primary" onClick={dismiss}>开始使用</button>
        </div>
      </div>
    </div>
  );
}
