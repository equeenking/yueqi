export const GUIDE = `# GreanTeaDawy 使用指南

这是一个跑在浏览器里的 FL Studio 式工作站（通道架、片段、钢琴卷帘、播放列表、混音台、自动化）。你做的每一处改动，都会实时出现在用户的浏览器里。

## 基本概念
- **通道**（通道架）＝乐器：合成鼓组（底鼓、军鼓、拍手、踩镲、嗵鼓、边击、牛铃、吊镲、沙锤、打击乐）、
  808 贝斯（bass808）、减法合成器（synth）、FM 合成器（fm）、采样器（用户上传的音频），以及乐队乐器：
  三角钢琴（piano）、电钢琴（epiano：音叉／簧片）、拉杆风琴（organ）、吉他（木吉他、尼龙弦、电吉他）、
  贝斯吉他（bass：指弹／拨片／击弦／低音提琴）和弦乐（连奏、断奏、拨奏；合奏或独奏）。
  世界乐器：吹管（长笛、排箫、竖笛、口哨、陶笛）、人声节奏（bbkick、bbsnare、bbhat、bbbass、bbfx）、
  印度乐器（西塔琴、坦普拉、塔布拉、印度竹笛、唢呐类的 shehnai、桑图尔、手风琴）和中国与东亚民乐
  （日本筝、古筝、琵琶、三味线、二胡、尺八、笛子、箫、唢呐、太鼓、锣）。每种都有预设与参数；
  其中古筝、二胡、箫、唢呐用的是真实录音采样（真乐器录的，不是合成音）；
  list_instruments category="中国与东亚民乐" 可以只看一个分组。
- **片段** 存放任意多个通道的音符（可复用的积木）。默认长度 1 小节 ＝ 16 步。
- **播放列表** 按时间把片段块（以及音频块／自动化块）排在各条轨道上（歌曲模式）。块比片段长时会自动循环片段。
- **混音台**：0 号通道条＝主输出。每个通道接到某条通道条（mixerTrack）。每条通道条最多挂 10 个效果器
  （eq 带高通／低通、filter、compressor（mix < 1 即并联）、delay、reverb、distortion、chorus、phaser、
  bitcrusher、stereo（宽度 + monoBelow）、pump（侧链闪避：来源是某个通道或速度网格）、limiter），
  还有输出路由与发送。
- **标记** 给播放列表上方的段落起名字（arrange_song 会生成；set_markers 可以编辑）。
- **自动化** 曲线让某个参数随时间变化（通道 volume/pan/pitch/filterCutoff/filterRes、混音台 volume/pan、
  以及可自动化的效果器参数）。

## 时间与音符
- 时间单位默认是 **步** ＝ 十六分音符。4 步＝1 拍，16 步＝1 小节（4/4）。PPQ＝96 ticks/拍，1 步＝24 ticks。
- 工具里的小节与轨道是 **从 1 开始数**（第 1 小节＝曲子开头）。片段内部的步是 **从 0 开始数**。
- 音符：写成 C4、F#3、Bb2 这样的音名（C4＝MIDI 60＝中央 C），也可以直接给 MIDI 数字。力度 0..1（1＝最响）或 MIDI 2..127。
- 鼓的步进串：x＝敲击，X＝重音，o＝弱击，1-9＝力度 10-90%，- 或 .＝休止。空格和 | 会被忽略。
  例如底鼓 "x---x---x---x---"、军鼓 "----x-------x---"、踩镲 "x-x-x-x-x-x-x-x-"。串比片段长时会把片段拉长。
- 旋律串："C5:2 D5:2 Eb5:4 -:2 G5:6"（音名:步数，"-"＝休止，后缀 "!"＝重音，后缀 "~"＝在带滑音的单音乐器上滑进下一个音）。
- 和弦：和弦记号（Am7、F、Cmaj9、G7sus4、C/E），或工程调内的级数（i、VI、bVII、V7、ii°）。music_theory 能列出调内和弦。
- 鼓类乐器在 C4（60）上发它本来的音高；写别的音就整体变调。
- 808、贝斯吉他和设了 mono=true 的合成器在音符重叠时会滑音（写贝斯时用 "~" 后缀制造滑音）。
- 乐队乐器：钢琴、吉他、贝斯和拨奏是物理建模——一个音会自然衰减到结束（长音相当于踩着延音踏板；要让钢琴自然，
  就让和弦音一直延续到下一个和弦）。吉他和弦写在吉他音区（八度 3，rhythm 风格 "x--x--x-" 是扫弦），
  贝斯吉他写在 E1–G2 附近（add_bassline 用 octave 1–2），钢琴和弦写在 C3–C5 附近、左手再低一两个八度，
  弦乐用长音（legato）或短音用 "staccato"／"pizzicato" 预设。风琴几乎不吃力度（想要音色变化靠拉杆与打击音栓）。
  乐队乐器短促瞬间的响度比平均响度高（和真实录音一样）：判断音量请用 render_mix 的分轨数据。
- 世界乐器：西塔琴、坦普拉、桑图尔、日本筝、古筝、琵琶、三味线都是和吉他一样的物理建模。
  西塔琴、印度竹笛、shehnai、二胡、尺八、笛子、箫、唢呐、口哨、bbbass 默认是带滑音的单音乐器：在 write_melody 里
  给时值后加 "~"（"C4:4~ Db4:2"），或让音符重叠，就能得到 meend、滑音与推拉音。把西塔琴的 sa 参数设成歌曲的主音，
  它的共鸣弦才会跟着拉格一起响（在 D 调就写 sa "D"）。塔布拉是「一种鼓语一条通道」（预设 Na、Tin、Tun、Te、Ge、Ke、
  Dha、Dhin；"Ge Slide" 会上滑）——例如在 Dha/Na/Tin/Ge 几条通道上打一个 theka；它的高音鼓在 C4 上发 C，
  所以用通道的 pitch 把它移调到你这首歌的 Sa。坦普拉是持续音：很长的 Sa／Pa 音（C3 + G2），每一两小节再拨一次。
  太鼓和锣像鼓一样跟着音符的音高走。人声节奏：闭合镲与开镲放在同一个掐音组；bbbass 落在 C1–C3 附近。
  音阶：日本筝／尺八／三味线用 hirajoshi、inSen、iwato、yo；拉格用 thaat 的 bhairav、todi、purvi、marwa
  （或者 major/lydian/mixolydian/dorian/minor/phrygian 对应 Bilawal/Kalyan/Khamaj/Kafi/Asavari/Bhairavi），
  旋律写在持续音之上而不是按三和弦写（music_theory 的 diatonic_chords 对这几个 thaat 会拒绝出三和弦）。
- **力度是平方曲线**（和硬件一样）：1.0＝0 dB，0.8＝-3.9 dB，0.6＝-8.9 dB，0.45（弱击 "o"）＝-14 dB，
  0.3＝-21 dB。轻的音同时也会更暗（军鼓、踩镲、合成器滤波、FM 亮度、采样器截止、钢琴／吉他／贝斯／电钢琴的音色）。
  真正的律动就靠力度：重拍加重音，弱位踩镲约 0.6–0.7，幽灵军鼓 0.35–0.5（"o"＝0.45）。
- 摇摆（update_project，0–100）：MPC／Ableton 的摇摆百分比 ≈ 50 + 摇摆值/4（MPC 54%＝16，58%＝32，62%＝48，
  66%≈三连音 shuffle＝64；100＝75%，附点感）。house 15–25，afrobeats 30–40，boom bap 40–55，lo-fi 50–65。

## 用户的采样
- list_samples / get_sample_info 会给出技术信息（格式、编码、码率、采样率、位深、声道数、时长、标签）
  以及分析结果：响度（LUFS）、峰值、频谱平衡、起音点、速度、调、音高，还有它大概是什么（底鼓、踩镲、旋律循环…）。
- 一次性音色装进采样器通道（add_channel instrument=sampler sampleId=...；根音键用测出来的音高），
  循环／人声则作为音频块放进去（add_audio_clip）。要把循环的速度／调与工程对齐。
- 采样库按文件夹整理（每个采样只在一个文件夹里，或者「未归档」）：list_samples 可以指定 folder 和搜索词
  （"底鼓"、"人声 140 bpm"、"铺底 A 小调"）；sample_folders 列出／新建／重命名／删除文件夹；move_samples 归档采样
  （给一个新名字就会新建文件夹）。用户录的音会落在「录音」文件夹里。
- edit_sample 是给 Claude 用的波形编辑器（在用户的浏览器里跑）：裁剪、删除、静音、淡入淡出、增益、归一化、倒转、
  反相、单声道／立体声、去除直流、修掉静音段、speed（唱机式变速）、stretch（保持音高）、pitch_shift（保持长度）
  以及 pitch_correct（给独唱人声／独奏乐器按调＋音阶自动修音：amount、speed 毫秒——0 是机械感，50-100 自然——
  还有 flatten 处理颤音）。时间单位是秒。默认存成一个**新采样**；saveAs 用 "replace" 会改动所有用到该采样的工程
  （回复里会列出来）——只有用户要求时才这么做。常见的人声处理链：trim_silence、remove_dc、按工程调 pitch_correct、
  归一化到 -1，然后 add_audio_clip。
- delete_sample（只在用户要求时）会报出哪些工程、通道和片段块会变成静音。

## 听你做的东西
- render_mix 在用户的浏览器里渲染整首（或某个片段），返回一份混音分析：整体响度、响度范围、采样峰值与真峰值、
  主限幅器增益衰减、频谱平衡、最强的低频、立体声宽度（含低频宽度）、分段响度，以及逐通道的分轨数据
  （每条贝斯分轨还给出它的低音音高）。给它 target（streaming、apple-music、club、hip-hop、edm、lo-fi、
  broadcast、podcast）或 targetLufs：报表会直接告诉你主限幅器的输入增益要动几个 dB。
- analyze_sound 渲染某个通道的**一个**音并测量它：音高（带音分）、低频音高、响度、频谱、起音与衰减时间。
  用它把 808／底鼓调到调上、让底鼓与 808 的基频错开（≥ 2 个半音，或者做侧链），以及检查 808 的尾音有没有拖到下一击。

## 三维声场混音（杜比全景声风格）
- set_spatial 打开三维混音；place_object 把一条混音通道条（或某个通道所在的通道条）变成房间里的三维对象；
  其余声音留在立体声床里。坐标（Atmos／ADM 直角坐标）：x -1 左墙 … 1 右墙，y -1 后方 … 1 前方（屏幕那侧），
  z 0 耳朵高度 … 1 天花板；也可以用预设位置（front-left、overhead、rear-right…），或用方位角（顺时针，90＝正右）／
  仰角／距离。只有直接进主输出的通道条才能做对象。
- 一个稳妥的起点：底鼓、贝斯／808、主唱／主音和主要鼓组留在床声里（或放正前方）；铺底与弦乐放宽或放头顶
  （z 0.5–1）；吉他／键盘左右展开（x ±0.8，y 0.3–0.6）；打击乐、音效、延迟与点缀音绕在四周与身后（y -0.5…-1）。
  用 move_object 让东西动起来（circle、fly-over、rise、left-right、points）——要克制，只用在过渡处。混响总线留在床声里。
- set_spatial monitor=binaural 让用户戴耳机实时听到。export_spatial 能渲染双耳、5.1、7.1、7.1.4、对象分轨
  （＋位置 JSON）或实验性的 ADM BWF。在音箱／对象渲染里，对象不经过主输出限幅器：让对象分轨的峰值保持在
  -1 dBFS 以下（报表会列出各声道峰值）。lfe 只在对象里有大的低频元素时给 0.1–0.3（床声的低频留在 L/R）。

## 导出
- list_export_formats 说明这台服务器现在能出什么（WAV 一直可以；装了 ffmpeg 才有 MP3、AAC、Ogg、Opus、FLAC、ALAC、AIFF）。
  export_audio 渲染并转换（有损格式给码率，写标题／作者标签），返回下载链接。
  export_stems 给每个通道出一个 WAV；export_spatial 出三维的交付件。

## 用户的插件
- list_plugins 列出用户装好的乐器、效果器与生成器插件，带参数与预设。用法和内置的一样：
  add_channel instrument="plugin" plugin="<id>"（可给 preset、params），add_effect type="plugin" plugin="<id>"，
  改参数用 update_channel / update_effect（会按插件自己的范围校验）。
- run_generator plugin="<id>" pattern channel（params、bars、seed）会用生成器的音符填满该通道的这段范围
  （跑在用户浏览器的沙箱里；同种子＝同结果）。带读取工程权限的生成器能看到片段里其它音符——
  那就先写旋律，再生成和声／对旋律。
- 你不能装插件（那是用户在「设置 → 插件」里确认信任作者之后做的事）。别让用户去装你凭空想象的插件；
  只有用户问起时才推荐。
- 插件是第三方代码：加完一个插件后要跑一次 render_mix 检查（电平、有没有 INVALID RENDER）；
  出错的插件会被旁通（效果器）或静音（乐器）。

## 增益分配与按数字混音（照做，别猜）
- 推子：通道音量 0.78（默认）≈ -2.2 dB，混音通道条 0.8（默认）≈ -1.9 dB，主输出 1.0（默认）＝ 0 dB。
  set_mixer 可以直接用 volumeDb。
- 从底鼓开始：让它的分轨峰值落在 -6 dBFS 左右。808／贝斯分轨的 LUFS ≈ 底鼓 +1…+3 dB（trap／drill）
  或 -2…0 dB（house／pop）。军鼓／拍手 ≈ 底鼓 -1…-3 dB。踩镲比底鼓低 8–12 dB。铺底／和弦比底鼓低 10–12 dB，
  主音／人声站在最上面（≈ 底鼓 -2…0 dB）。用 render_mix 的分轨数据检查、调整、再渲染一次。
- 除了底鼓和贝斯，其它都过高通：pad／键盘／主音／踩镲用 eq hpf 100–200 Hz，军鼓 60–80 Hz。
- 低频做成单声道：给贝斯／808／铺底挂 stereo 效果 {"monoBelow":120,"width":1}
  （width > 1 只用在铺底和主音上，绝不用在贝斯上）。
- 侧链：给贝斯／808／铺底那条通道条挂 pump，参数 {"source":"底鼓"}，它会在每一次真实底鼓上闪避（切分的 trap 底鼓也算）：
  808／贝斯 depth 0.3–0.5、shape 0.2–0.3（刚好给底鼓让出位置）；铺底／和弦 depth 0.6–0.8、shape 0.4–0.5
  （house／EDM 要听得出来的抽吸感）。网格模式（不写 source）只适合四拍落地。
- 底鼓 vs 808：底鼓要短（decay ≤ 0.3 秒，例如 kick 的 "Trap" 预设），且它的基频与 808 的音符至少差 2 个半音——
  两者都用 analyze_sound 测一下，用 tune 参数把底鼓调准——再把 808 侧链到底鼓上。
- 空间感：用一条共用的混响通道条（reverb mix 1.0、decay 1.5–3 秒、size 0.4–0.7），由各通道发送过去
  （set_mixer 的 sends 给 0.1–0.3），而不是每个通道各挂一个混响；延迟同理。延迟本身已经给回声加了高通。
- 鼓组总线：把各鼓通道的通道条路由到同一条（set_mixer 的 output），给它做粘合——
  compressor {"threshold":-30,"ratio":6,"attack":0.005,"release":0.1,"makeup":12,"mix":0.4}（并联）——
  再上一点点饱和——distortion {"drive":0.15,"mix":0.3}。压缩器的 Makeup 旋钮是唯一的补偿增益
  （浏览器自动补偿被去掉了）：把它调到与旁通时电平一致，再判断粘合感。
  Makeup 的补偿量跟着压缩器设定的 threshold／ratio 走，不跟着它们的自动化走。
- 主输出：给流媒体的话限幅器天花板 -1 dB；输入增益 ＝ 目标 LUFS − 实测 LUFS（render_mix 会告诉你）。
  主输出推子保持在 0 dB（它在限幅器之后，调低只会浪费余量）。如果限幅器衰减超过约 6 dB，
  先修平衡，不要硬推。

## 律动、过门与过渡
- apply_groove 一次调用就给鼓组加上手感（boom-bap、dilla、lo-fi、trap、drill、house、afrobeats、straight）：
  摇摆、各通道的提前量（慵懒的军鼓 +10…+20 毫秒）、摇摆占比、踩镲重音、人性化，以及可选的幽灵军鼓。
  update_channel 的 nudge／swingMix 可以微调单条通道。摇摆也会作用在稍微偏离网格的音符上。
- add_fill 把一个鼓片段做成过门版本（snare_roll、tom_run、hat_roll、stutter、dropout、kick_build）：
  放在段落的最后一小节（每 4 或 8 小节一次）。
- add_transition 一次做出上扬（滤波＋音量扫频）、下沉、反向涌起、军鼓推进、吊镲、低频坠落和重击，
  并且都正好落在段落起点上。一个 drop 通常需要：riser 4–8 小节 + snare_build 2 小节 + 重击落在重拍上 +
  前一小节放一个 dropout 过门。

## 和声与贝斯
- add_chords 的排列法：close、open、drop2（新灵魂／爵士键盘）、drop3、spread（电影感）、shell（根音-三音-七音，
  lo-fi 伴奏）、rootless（贝斯之上的 3-5-7-9）。register 把和弦保持在某个音高附近（键盘用 "E4"，通透铺底用 "C5"）。
- add_bassline 的 line 写的是音级："R:3 R:1 -:2 5:2 R:2~ 8:4 b7:2"（R 根音，3/5/7 是和弦本身的音，8 八度，
  -5 下方五度，"~:2" 延音，"!" 重音，"?" 弱击，"~" 后缀＝滑进下一个音——808 的滑音）。

## 交付
- render_mix save=true 会留下一份 24 位 WAV（bitDepth 16 则加抖动）。export_stems 给每个通道写一个 WAV
  （带上它的通道条效果与发送，不带主输出上的效果），供混音师和合作者使用。
- 音频块：add_audio_clip／update_clips 可以设 gainDb、fadeInSteps／fadeOutSteps 和 fit="repitch"（或 rate），
  用变速的方式让循环对齐工程速度（音高会跟着变，像唱机）。

## 保险措施
- 大改动前先 save_version；要回退用 restore_version。undo 撤销你自己最近一次改动。

## 范围与重写
- 小节范围是两端都算的：copy_bars / remove_clips 的 fromBar 9、toBar 16 ＝ 第 9–16 这 8 个小节。
- write_melody、add_chords 和 add_bassline（replace=true，默认）只清掉它们要写的那段范围，
  所以你可以一小节一小节地把片段搭起来（start 就是步偏移）。想叠加就用 replace=false。
- id：会创建东西的工具会在返回里带上 id（放在方括号里）；get_project / get_pattern 会列出它们。

## 一个顺手的工作流
1. create_project（可选从模板起步），或者直接用当前工程（先 get_project 看一眼）。设好调／音阶／速度。
2. 为每个声音 add_channel（底鼓、军鼓／拍手、踩镲、808／贝斯、和弦、主音、铺底、音效；或用用户的采样）。
   踩镲：开镲与闭镲放在同一个 chokeGroup 里。
3. 每个声部 create_pattern（"鼓组""鼓组过门""808""和弦""旋律"…），然后 write_drums / add_chords /
   add_bassline / write_melody / add_notes / add_roll。加些变化：幽灵音、力度起伏、过门、呼应对答。
4. 手感：按风格用 apply_groove；用 analyze_sound 把 808／底鼓调到调上。
5. arrange_song 排出各段落（前奏、主歌、预副歌、副歌、桥段、尾奏），段与段之间要有能量变化；
   段落结尾加 add_fill，进副歌／drop 加 add_transition；扫频用自动化。
6. 按上面的数字混：电平、高通、侧链（pump source=底鼓）、共用的混响／延迟发送、主输出限幅器。
7. render_mix target=<风格／平台>（打开 stems）→ 读数字 → 修 → 反复直到报表干净。
8. save_version、播放，并讲清楚你做了什么。用户要文件时用 export_stems / render_mix save=true。
`;

export const INSTRUCTIONS = `本工作室让你在一个浏览器工作站里做音乐（像 FL Studio：通道架、片段、钢琴卷帘、播放列表、混音台、自动化）。
改动会实时出现在用户的浏览器里。先调 get_project 看看当前这首曲子。时间单位默认是十六分音符步，
除非某个工具另有说明；小节与轨道从 1 开始数。记谱细节去读 greanteadawy://guide 这个资源。
善用用户上传与录制的采样（list_samples / get_sample_info 会给出文件夹、码率、采样率、响度、速度、调与音高；
sample_folders / move_samples 用来整理；edit_sample 可以裁剪、淡入淡出、伸缩、移调与自动修音）。
用 render_mix（带 target）把混音「听」成数字，用 analyze_sound 测量单个音色；按指南里的数字来混
（增益分配、高通、底鼓触发的侧链、共用的混响发送）。apply_groove、add_fill 和 add_transition 一次调用
就能加手感、过门与上扬／重击。place_object / move_object / export_spatial 做全景声风格的三维混音
（双耳、5.1、7.1.4、ADM）；export_audio 出 MP3/AAC/FLAC/…（先查 list_export_formats）。
list_plugins 列出用户自己的乐器／效果器／生成器插件（通过 add_channel／add_effect／run_generator 使用）。
有风险的改动前先 save_version。
做完之后调用 play 让用户听到，并描述你做了什么。`;
