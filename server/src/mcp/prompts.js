// MCP prompts: ready-made workflows the user can pick in their MCP client.
import { z } from 'zod';

const msg = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

export function registerPrompts({ server }) {
  server.registerPrompt('make_beat', {
    title: '做一首完整的曲子',
    description: '让 Claude 在本工作室里做出一首编排完整、混好的曲子',
    argsSchema: {
      genre: z.string().describe('风格，例如 trap、house、lo-fi、drill、boom bap、techno、afrobeats、synthwave'),
      mood: z.string().optional().describe('情绪，例如 暗色、明亮、松弛'),
      bpm: z.string().optional().describe('速度，例如 90、140'),
      reference: z.string().optional().describe('想参考的歌手／曲目（只学风格，不抄旋律）')
    }
  }, ({ genre, mood, bpm, reference }) => msg(`在本工作室里做一首${mood ? `${mood}的` : ''}${genre}曲子${bpm ? `，速度 ${bpm}` : ''}${reference ? `，风格上参考 ${reference}（不要照抄旋律）` : ''}。
1. create_project（模板 "empty"），取一个贴切的名字，设好速度、调与音阶。先 list_samples 看看用户上传的素材里有没有能用上的。
2. add_channel 加鼓组（底鼓、军鼓／拍手、闭合镲与开镲放同一个掐音组、打击乐）和旋律声部（贝斯／808、和弦、主音、铺底、音效）。按风格选预设并调参数。
3. 各声部写在不同的片段里（"鼓组""贝斯""和弦""旋律""对旋律""音效"…）。用 write_drums、add_chords（可以直接写调内级数；排列法按风格挑）、add_bassline（808 用带滑音的音级串）、write_melody／add_notes、add_roll。副歌要有一个好记的动机并做变化；力度要有起伏（重音、弱起的轻音、幽灵音）。
4. apply_groove 加上这个风格的律动；用 analyze_sound 测底鼓和 808／贝斯，把它们调到调上、并让两者基频错开。
5. add_fill 做段落结尾的过门，然后 arrange_song 排成 前奏／主歌／预副歌／副歌／间奏／尾奏（至少 48 小节），能量要有明显起伏；用 add_transition 做进副歌／drop 的过渡（riser、snare_build、impact、reverse_swell），扫频配上自动化。
6. 按指南里的数值来混：增益分配、高通、按风格需要时给贝斯／铺底挂底鼓触发的侧链（pump source=底鼓）、用发送做共用的混响／延迟、最后挂主输出限幅器，天花板 -1 dB。
7. save_version 存一份「初稿」，再 render_mix target=<合适的目标>（打开 stems），读报表里的数字，修平衡、遮蔽、响度与动态，反复渲染直到报表干净。
8. 播放整首，并讲清楚你的编排与混音思路。`));

  server.registerPrompt('mix_review', {
    title: '混音体检',
    description: '让 Claude 用 render_mix 分析当前混音，并像混音师那样改进它',
    argsSchema: { target: z.string().optional().describe('例如「流媒体（-14 LUFS）」「club」「温暖带颗粒」') }
  }, ({ target }) => msg(`给当前这个工程做一次混音体检${target ? `，目标是 ${target}` : ''}。
1. 先 get_project 摸清编排，再 save_version 存一份「混音体检前」。
2. render_mix 打开 stems，选一个合适的目标${target ? `「${target}」` : ''}。读响度（LUFS、响度范围）、采样峰值与真峰值、限幅器增益衰减、波峰因数、频谱平衡、低频音高与宽度、分段响度，以及每条分轨的电平与低频峰值。
3. 先修最大的问题：底鼓与贝斯的平衡和遮蔽（用 analyze_sound、调音、pump source=底鼓）、浑浊的中低频、刺耳的高频、过宽的低频（stereo 的 monoBelow）、人声／主音没站到前面、段落之间动态平淡、真峰值超标。
   用 set_mixer、update_channel、add_effect／update_effect（eq 的 hpf／lpf、含并联 mix 的压缩器、混响／延迟发送、pump、stereo、limiter）以及自动化来调整。
4. 按报表里给出的目标差值设好主输出限幅器的输入增益，再 render_mix 一次，报出前后数字和你改了什么。`));

  server.registerPrompt('spatial_mix', {
    title: '三维声场混音（全景声风格）',
    description: '让 Claude 把当前曲子做成沉浸式的三维混音，并导出耳机版与音箱版',
    argsSchema: { deliver: z.string().optional().describe('例如「双耳 + 7.1.4」「给我的 Atmos 工程用 ADM」') }
  }, ({ deliver }) => msg(`把当前这个工程做成沉浸式的三维声场版本（杜比全景声风格）${deliver ? `，交付：${deliver}` : ''}。
1. 先 get_project，save_version 存一份「三维混音前」。确认每个你想摆放的声部都各自占一条直接进主输出的混音通道条。
2. 底鼓、贝斯／808、主音和核心鼓组留在床声里（或放正前方）。其余用 place_object 摆位：铺底／弦乐放宽或放头顶，吉他／键盘左右展开，打击乐、音效和点缀音绕在四周与身后。混响总线留在床声里。
3. 在过渡处加一两个移动（用 move_object，例如上扬的音往上走、扫频绕一圈、某个音效飞过头顶）——要克制。
4. set_spatial monitor=binaural，让用户能戴耳机听；播放整首。
5. export_spatial ${deliver ? `导出：${deliver}` : '导出双耳版与 7.1.4'}，并检查报表里的各声道峰值（对象不经过主输出限幅器：过响的对象要拉低再导一次）。
6. 讲清楚你的摆位思路，并列出导出的文件。`));

  server.registerPrompt('use_my_samples', {
    title: '用我的采样做曲子',
    description: '让 Claude 看看用户上传的采样（码率、速度、调、音高），并围绕它们搭一首曲子',
    argsSchema: { idea: z.string().optional().describe('想拿它们做成什么') }
  }, ({ idea }) => msg(`看看我上传和录制的采样（list_samples——按文件夹分好；对有意思的几个用 get_sample_info：看采样率／码率质量、速度、调、音高，以及每个声音是什么）。
围绕它们搭一首曲子${idea ? `：${idea}` : ''}。把工程的速度／调设成跟循环合得上（或者 add_audio_clip 用 fit="repitch"），把一次性音色装进采样器通道（根音键用测出来的音高），循环／人声作为音频块放进去并设好增益与淡入淡出，再用本工作室自带的乐器补足。如果某段人声或独奏需要收拾，用 edit_sample（trim_silence、按工程调做 pitch_correct、normalize）另存为一个新采样——除非我明确要求，绝不要覆盖原件。最后 render_mix 并播放。`));
}
