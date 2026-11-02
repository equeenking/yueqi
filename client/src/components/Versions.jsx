import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { api } from '../state/api.js';
import { Window } from './ui/Window.jsx';
import { Icon } from './ui/Icon.jsx';

/** Named snapshots of the current project (also created by Claude via save_version). */
export function Versions() {
  const project = useStore((s) => s.project);
  const open = useStore((s) => s.windows.versions?.open);
  const versionsRev = useStore((s) => s.versionsRev);
  const st = useStore.getState();
  const [list, setList] = useState(null);
  const pid = project?.id;

  const load = useCallback(() => {
    if (!pid) return;
    api.listVersions(pid).then(setList).catch((e) => useStore.getState().toast(e.message, 'error'));
  }, [pid]);
  useEffect(() => { if (open) load(); }, [open, load, versionsRev]);

  if (!project) return null;
  const save = async () => {
    const name = await st.prompt({ title: '保存版本', value: `${project.name} — ${new Date().toLocaleString()}` });
    if (name === null) return;
    try {
      await api.saveVersion(pid, name);
      st.toast('版本已保存', 'success');
      load();
    } catch (e) { st.toast(e.message, 'error'); }
  };
  const restore = async (v) => {
    if (!(await st.confirm({ title: `Restore "${v.name}"?`, message: '当前状态会被替换（想保留就先存一个版本）。可以用 Ctrl+Z 撤销。', okLabel: '恢复' }))) return;
    try {
      const r = await api.restoreVersion(pid, v.id);
      st.setProjectFromServer(r.project);
      st.toast('版本已恢复', 'success');
    } catch (e) { st.toast(e.message, 'error'); }
  };
  const remove = async (v) => {
    if (!(await st.confirm({ title: `Delete version "${v.name}"?`, danger: true, okLabel: '删除' }))) return;
    await api.deleteVersion(pid, v.id).catch((e) => st.toast(e.message, 'error'));
    load();
  };

  return (
    <Window name="versions" title={`版本历史 — ${project.name}`} icon="history" minW={360} minH={220}
      toolbar={<button className="btn tiny primary" onClick={save}><Icon name="plus" size={12} /> 保存版本</button>}>
      <div className="versions">
        {list === null && <div className="spinner" />}
        {list?.length === 0 && <p className="empty-hint">还没有版本：改动前先「保存版本」，随时可以回到这一刻（Claude 也能在试验前自动存版本）。</p>}
        {list?.map((v) => (
          <div key={v.id} className="version-row">
            <div className="version-info">
              <b>{v.name}</b>
              <span className="muted">{new Date(v.createdAt).toLocaleString()} · {v.bpm} BPM · {v.channels} channels · {v.patterns} patterns</span>
            </div>
            <button className="btn tiny" onClick={() => restore(v)}>恢复</button>
            <button className="tbtn small" title="删除" onClick={() => remove(v)}><Icon name="trash" size={13} /></button>
          </div>
        ))}
      </div>
    </Window>
  );
}
