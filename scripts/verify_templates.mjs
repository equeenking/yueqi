// 逐模板生成工程，核对通道/片段/音符是否真的装配成功。
import { TEMPLATES, createProjectFromTemplate } from '../packages/core/src/templates.js';

let bad = 0;
for (const id of Object.keys(TEMPLATES)) {
  let p;
  try {
    p = createProjectFromTemplate(id, {});
  } catch (e) {
    console.log(`!! ${id} 抛错: ${e.message}`);
    bad++;
    continue;
  }
  const chNames = p.channels.map((c) => c.name);
  const noteCount = p.patterns.reduce((n, pt) => n + Object.values(pt.notes).reduce((a, l) => a + l.length, 0), 0);
  const emptyPat = p.patterns.filter((pt) => Object.values(pt.notes).every((l) => !l.length)).map((pt) => pt.name);
  // 发送目标是否解析成功（sends.to 应为有效索引）
  const badSends = [];
  p.mixer.forEach((m, i) => {
    for (const s of m.sends || []) {
      if (typeof s.to !== 'number' || s.to < 0 || s.to >= p.mixer.length) badSends.push(`${i}->${s.to}`);
    }
  });
  const flag = emptyPat.length || badSends.length ? '!!' : 'OK';
  if (flag === '!!') bad++;
  console.log(
    `${flag} ${id.padEnd(11)} 通道${String(p.channels.length).padStart(2)} 片段${String(p.patterns.length).padStart(2)} 音符${String(noteCount).padStart(4)} 片段名:${p.patterns.map((x) => x.name).join('/')}`
  );
  if (emptyPat.length) console.log(`   空片段: ${emptyPat.join('、')}`);
  if (badSends.length) console.log(`   发送异常: ${badSends.join(', ')}`);
  if (chNames.some((n) => /[A-Za-z]{3,}/.test(n))) console.log(`   通道名仍含英文: ${chNames.join('、')}`);
}
console.log('问题模板数', bad);
