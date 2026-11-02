// Studio status, projects, versions and undo.
import { TEMPLATES, SCALES, summarizeProject, normalizeKey } from '@greanteadawy/core';
import { z, ok, projectIdArg, annotations as A } from '../util.js';

export function registerProjectTools({ tool, backend, load, resolveProjectId }) {
  tool('get_studio_status', {
    title: '工作室状态',
    description: '显示当前登录的账号、连接方式、正在编辑的工程，以及开了几个浏览器标签页（这样你就知道用户能不能听到播放、render_mix 用不用得了）。',
    inputSchema: {},
    annotations: A.readOnly
  }, async () => {
    const status = await backend.status();
    const active = await backend.getActiveId();
    let activeName = null;
    if (active) { try { activeName = (await backend.getProject(active)).name; } catch { /* ignore */ } }
    return ok(`Active project: ${activeName ? `"${activeName}" [${active}]` : 'none'}`, status);
  });

  tool('list_projects', {
    title: '列出工程',
    description: '列出用户保存的工程（id、名字、速度、最后更新时间）。带 * 的是当前在编辑的那个。',
    inputSchema: {},
    annotations: A.readOnly
  }, async () => {
    const list = await backend.listProjects();
    const active = await backend.getActiveId();
    return ok(list.map((p) => `${p.id === active ? '* ' : '  '}${p.name} [${p.id}] ${p.bpm} BPM, ${p.channels} channels, ${p.patterns} patterns, ${p.clips} clips, updated ${p.updatedAt}`).join('\n') || 'No projects.');
  });

  tool('create_project', {
    title: '新建工程',
    description: `新建一个工程，设为当前工程并在浏览器里打开。模板：${Object.entries(TEMPLATES).map(([k, v]) => `${k}（${v.label}）`).join('、')}。用 "empty" 从空白开始，用 "default" 得到标准的四条鼓通道（底鼓、拍手、踩镲、军鼓）。`,
    inputSchema: {
      name: z.string().min(1).max(100).describe('工程名'),
      bpm: z.number().min(20).max(400).optional(),
      template: z.enum(Object.keys(TEMPLATES)).optional().describe('起始模板（默认 "empty"）'),
      key: z.string().optional().describe('主音，例如「C」「F#」（级数记号与钢琴卷帘的音阶高亮都用它）'),
      scale: z.enum(Object.keys(SCALES)).optional(),
      timeSignature: z.string().regex(/^\d+\/\d+$/).optional().describe('例如「4/4」「3/4」「6/8」')
    },
    annotations: A.edit
  }, async ({ name, bpm, template = 'empty', key, scale, timeSignature }) => {
    // validate everything before creating anything (a failed call must not leave a half-made project behind)
    const k = key !== undefined ? normalizeKey(key) : null;
    if (key !== undefined && !k) throw new Error(`Invalid key "${key}": give the root only (C, F#, Bb) and the mode via scale (e.g. key "A", scale "minor")`);
    let timeSig = null;
    if (timeSignature) {
      timeSig = timeSignature.split('/').map(Number);
      if (!(timeSig[0] >= 1 && timeSig[0] <= 32 && [2, 4, 8, 16].includes(timeSig[1]))) throw new Error('Time signature must be N/2, N/4, N/8 or N/16 with N from 1 to 32');
    }
    const templated = !['empty', 'default'].includes(template);
    if (templated && timeSig && !(timeSig[0] === 4 && timeSig[1] === 4)) {
      throw new Error(`The "${template}" template is written in 4/4. Use template "empty" or "default" for ${timeSignature}, or create it in 4/4.`);
    }
    let p = await backend.createProject({ name, bpm, template, ...(k && templated ? { key: k } : {}) });
    const warnings = [];
    if (templated && scale && scale !== p.scale) {
      warnings.push(`Note: the "${template}" template is written in ${p.scale}${k ? `; its chords/melody were moved to ${k}` : ''} but keep their ${p.scale} colour — rewrite them for ${scale}.`);
    }
    const patch = {};
    if (k) patch.key = k;
    if (scale) patch.scale = scale;
    if (timeSig) patch.timeSig = timeSig;
    if (Object.keys(patch).length) p = await backend.applyOps(p.id, [{ type: 'project/update', patch }]);
    await backend.setActive(p.id);
    const opened = await backend.openProject(p.id);
    return ok(`Created "${p.name}" [${p.id}] at ${p.bpm} BPM from template "${template}". ${opened ? 'Opened in the browser.' : 'No browser connected right now.'}${warnings.length ? `\n${warnings.join('\n')}` : ''}\n\n${summarizeProject(p, { maxNotes: 24 })}`);
  });

  tool('open_project', {
    title: '打开工程',
    description: '把某个工程设为当前工程，并在已连接的浏览器里打开它。',
    inputSchema: { projectId: z.string() },
    annotations: A.edit
  }, async ({ projectId }) => {
    const p = await backend.getProject(projectId);
    await backend.setActive(p.id);
    await backend.openProject(p.id);
    return ok(`Opened "${p.name}" [${p.id}].`);
  });

  tool('duplicate_project', {
    title: '复制工程',
    description: '把一个工程另存为一个新工程（比如做另一个版本／重混）。',
    inputSchema: { projectId: projectIdArg, name: z.string().optional() },
    annotations: A.edit
  }, async ({ projectId, name }) => {
    const id = await resolveProjectId(projectId);
    const p = await backend.duplicateProject(id, name);
    return ok(`Duplicated as "${p.name}" [${p.id}] (not opened; use open_project to switch).`);
  });

  tool('delete_project', {
    title: '删除工程',
    description: '永久删除一个工程及其所有版本。只有用户明确要求时才这么做。',
    inputSchema: { projectId: z.string() },
    annotations: A.destructive
  }, async ({ projectId }) => {
    await backend.deleteProject(projectId);
    return ok(`Deleted project ${projectId}.`);
  });

  tool('get_project', {
    title: '查看工程',
    description: '一个工程的文字概览：速度、调、通道、每个片段的步进格／音符表、播放列表编排、混音台与效果器、自动化。用它来在编辑前后「看」一遍整首歌。format="json" 会返回原始工程数据。',
    inputSchema: {
      projectId: projectIdArg,
      includeNotes: z.boolean().optional().describe('是否包含片段内容（默认包含）'),
      format: z.enum(['summary', 'json']).optional()
    },
    annotations: A.readOnly
  }, async ({ projectId, includeNotes = true, format = 'summary' }) => {
    const p = await load(projectId);
    if (format === 'json') {
      const { ownerId: _ownerId, ...data } = p;
      return ok(JSON.stringify(data));
    }
    return ok(summarizeProject(p, { notes: includeNotes }));
  });

  tool('update_project', {
    title: '修改工程设置',
    description: '改速度、摇摆、拍号、名字或调／音阶。',
    inputSchema: {
      projectId: projectIdArg,
      name: z.string().min(1).max(100).optional(),
      bpm: z.number().min(20).max(400).optional(),
      swing: z.number().min(0).max(100).optional().describe('摇摆 0–100：把每第二个十六分往后推。MPC／Ableton 的摇摆百分比 ≈ 50 + 摇摆值/4（MPC 54%＝16，58%＝32，62%＝48，66%≈三连音 shuffle＝64；100＝75%，附点感）。常见取值：house 15–25，boom bap 40–55，lo-fi 50–65。'),
      timeSignature: z.string().regex(/^\d+\/\d+$/).optional().describe('例如「4/4」「3/4」「6/8」'),
      key: z.string().optional(),
      scale: z.enum(Object.keys(SCALES)).optional()
    },
    annotations: A.edit
  }, async ({ projectId, name, bpm, swing, timeSignature, key, scale }) => {
    const id = await resolveProjectId(projectId);
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (bpm !== undefined) patch.bpm = bpm;
    if (swing !== undefined) patch.swing = swing / 100;
    if (timeSignature) patch.timeSig = timeSignature.split('/').map(Number);
    if (key) patch.key = key;
    if (scale) patch.scale = scale;
    if (!Object.keys(patch).length) throw new Error('Nothing to change');
    const p = await backend.applyOps(id, [{ type: 'project/update', patch }]);
    return ok(`Project "${p.name}": ${p.bpm} BPM, ${p.timeSig.join('/')}, swing ${Math.round(p.swing * 100)}%, key ${p.key} ${p.scale}.`);
  });

  // ---------------------------------------------------------------- versions & undo
  tool('save_version', {
    title: '保存版本',
    description: '给工程存一个带名字的快照（就像 DAW 里的「另存为版本」）。在做大的或有风险的改动之前先存一下，或者用来保留备选方案（例如「缩混前」「副歌 v2」）。',
    inputSchema: { projectId: projectIdArg, name: z.string().max(80).optional() },
    annotations: A.edit
  }, async ({ projectId, name }) => {
    const id = await resolveProjectId(projectId);
    const v = await backend.saveVersion(id, name);
    return ok(`Saved version "${v.name}" [${v.id}].`);
  });

  tool('list_versions', {
    title: '列出版本',
    description: '列出工程保存过的版本（快照），最新的排最前。',
    inputSchema: { projectId: projectIdArg },
    annotations: A.readOnly
  }, async ({ projectId }) => {
    const id = await resolveProjectId(projectId);
    const list = await backend.listVersions(id);
    return ok(list.length ? list.map((v) => `${v.name} [${v.id}] ${v.createdAt} — ${v.bpm} BPM, ${v.channels} channels, ${v.patterns} patterns`).join('\n') : 'No versions saved yet (use save_version).');
  });

  tool('restore_version', {
    title: '恢复版本',
    description: '用某个已保存的版本替换当前工程状态。提示：如果当前状态以后可能还要用，先 save_version 存一份。',
    inputSchema: { projectId: projectIdArg, versionId: z.string() },
    annotations: A.destructive
  }, async ({ projectId, versionId }) => {
    const id = await resolveProjectId(projectId);
    const p = await backend.restoreVersion(id, versionId);
    return ok(`Restored version ${versionId}. "${p.name}" now has ${p.channels.length} channels and ${p.patterns.length} patterns.`);
  });

  tool('undo', {
    title: '撤销上一次改动',
    description: '撤销你（Claude）通过这些工具做的最近一次改动。如果用户之后又手动改过工程，默认会拒绝；除非 force=true（这样连用户后来的改动也一起丢掉）。',
    inputSchema: { projectId: projectIdArg, force: z.boolean().optional() },
    annotations: A.destructive
  }, async ({ projectId, force = false }) => {
    const id = await resolveProjectId(projectId);
    const r = await backend.undo(id, { force });
    return ok(`Undid: ${r.undone || 'last change'}.`);
  });
}
