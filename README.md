# ◆ GreanTeaDawy

**A pattern-based browser DAW — with Claude as your co-producer.**

GreanTeaDawy is an open-source, self-hosted beat-making studio: channel rack and step sequencer, piano roll, playlist,
mixer with effects, automation, sampler and audio clips, all running in the browser with a Node.js backend. Its
built-in [MCP](https://modelcontextprotocol.io) server gives Claude 78 music-production tools, so you can say
*"make a dark trap beat at 145 BPM and mix it for streaming"* and watch every edit appear live in your studio.

[![MIT licence](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
![Node 20.19+](https://img.shields.io/badge/node-%E2%89%A520.19-339933)
![React 19](https://img.shields.io/badge/react-19-61dafb)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-orange)

[![The studio: playlist, channel rack and piano roll](docs/screenshots/studio.png)](docs/screenshots/studio.png)

> GreanTeaDawy is an independent experimental project. It is not affiliated with or endorsed by a Music Software company.

## Contents

- [Features](#features) · [Screenshots](#screenshots) · [Quick start](#quick-start) · [Make music with Claude](#make-music-with-claude)
- [Configuration](#configuration) · [Docker](#docker) · [Documentation](#documentation) · [Development](#development)
- [Security](#security) · [Troubleshooting](#troubleshooting) · [Contributing](#contributing) · [Licence](#licence)

## Features

**Studio**

- **Channel rack & step sequencer** — per-channel volume/pan/mute/solo, swing, pattern length, fills, randomize,
  choke groups, per-channel groove (nudge in ms, swing share), mini piano-roll previews for melodic channels.
- **Expressive velocity** — a hardware-style squared curve, and softer notes are darker (drums, filters, FM, sampler,
  piano/guitar/bass tone).
- **Instruments** — synthesized kick, snare, clap, hats, toms, rim, cowbell, cymbal, shaker, perc; 808 bass with glide
  and distortion; 3-oscillator subtractive synth; FM synth; **sampler** for your own audio; and a GarageBand-style
  band: modelled **grand piano**, **electric piano** (tine/reed), **drawbar organ** (percussion, rotary), **guitar**
  (acoustic/nylon/electric), **bass guitar** (finger/pick/slap/upright) and **strings** (ensemble or solo; legato,
  staccato, pizzicato). Four world collections: **flutes** (concert, pan, recorder, tin whistle, ocarina),
  **beatbox** (mouth kick, snares, hats, bass, scratch/click-roll FX), **Indian** (sitar with jawari and sympathetic
  strings, tanpura, tabla bols, bansuri, shehnai, santoor, harmonium) and **East Asian** (koto, guzheng, pipa,
  shamisen, erhu, shakuhachi, dizi, suona, taiko, gong): 47 instruments, about 200 presets, plus Japanese
  pentatonic and Indian thaat scales.
- **Piano roll** — draw/select/erase tools, chord stamp, snap, quantize, legato, humanize, scale highlighting, ghost
  notes, velocity lane, copy/paste/duplicate, keyboard nudging.
- **Playlist** — pattern, audio and automation clips on up to 200 tracks; section markers; audio clip gain, fades and
  repitch-to-tempo; loop region; song/pattern mode.
- **Mixer** — inserts with faders, pan, routing and sends; EQ with high/low-pass, filter, compressor (with parallel
  mix), delay, reverb (room size, frequency-dependent decay), distortion, chorus, phaser, bitcrusher, stereo width with
  mono bass, **kick-triggered sidechain**, and a limiter with a −1 dB default ceiling and an oversampled clip stage.
  Automation for any automatable param.
- **Spatial (Dolby Atmos-style) mixing** — make inserts 3D objects in a room (x/y/height, LFE send), move them with
  automation, monitor **binaurally** on headphones, and export binaural, **5.1 / 7.1 / 7.1.4** WAVs, object stems with
  position data or an experimental **ADM BWF** ([docs/spatial.md](docs/spatial.md)).
- **Export formats** — WAV (16/24-bit), and with ffmpeg on the server MP3, AAC, Ogg Vorbis, Opus, FLAC, Apple
  Lossless, AIFF (Settings → Audio export shows what's available).
- **Plugins** — add your own **instruments** (DSP code or multisampled), **effects** and **note generators** as `.zip`
  packages. They run sandboxed in the browser (audio worklet / an isolated, network-less iframe), ask for explicit
  permissions and are only installed after you confirm you trust the author ([docs/plugins.md](docs/plugins.md),
  examples in [`plugins/`](plugins)).
- **Recording** — notes from the computer keyboard or a MIDI keyboard (Web MIDI), metronome, tap tempo; and **audio
  from a microphone**, alone or over the song/pattern with count-in, metronome and latency compensation: every take is
  saved as a sample and placed on the playlist where you recorded it.
- **Sample library** — upload or record WAV/MP3/OGG/FLAC/AIFF/M4A/WebM; **folders** (drag to file, bulk move/delete),
  **search** by name, folder, key or tempo; codec, sample rate, bit depth, bitrate, channels, tags plus an analysis
  (LUFS, peak, spectrum, tempo, key, pitch, one-shot vs loop). Deleting a sample in use says which projects it leaves
  silent.
- **Wave editor** — select (zero-crossing snap), cut/copy/paste, trim, fades, gain, normalise, reverse, invert, DC
  removal, speed, **time stretch**, **pitch shift**, undo/redo; save as a new sample or replace the original everywhere
  (with a warning that lists every project using it).
- **Pitch correction** — auto-tune a voice or solo instrument to the project's key and scale with amount, speed and
  flatten (natural to robotic), see the sung and corrected pitch, and drag single notes up or down by hand.
- **Projects** — 18 genre templates, from trap, drill and afrobeats to bossa nova, cinematic and a beatbox jam (with
  shared FX buses and sidechain), versions (named snapshots), undo/redo,
  16-bit (dithered) or 24-bit WAV, **stems**, MIDI and project export, MIDI import.
- **Live sync** across tabs and devices, mobile-friendly layout, keyboard-accessible controls.

**Claude integration (MCP)**

- **Streamable HTTP** (`/mcp`) and **stdio** (for Claude Desktop) transports.
- 78 tools: projects, sounds, drums, chords (symbols or roman numerals, jazz/neo-soul voicings), basslines (degree
  lines with 808 slides), melodies, rolls, transforms, arrangement with markers, automation, mixer and effects,
  samples, versions, undo, play/stop, MIDI and stem export.
- **Production tools** — `apply_groove` (boom bap, Dilla, lo-fi, trap, drill, house, afrobeats feels), `add_fill`
  (snare rolls, tom runs, hat rolls, drop-outs…), `add_transition` (risers, swells, snare builds, impacts on the
  downbeat).
- **`render_mix`** — Claude renders the mix in your browser and reads it like a mastering engineer: integrated LUFS,
  loudness range, true peak, limiter gain reduction, spectral balance, low-end note and width, loudness per section and
  per-channel stems — against a delivery target (streaming, club, hip-hop, EDM, broadcast…) with exact fixes.
- **`analyze_sound`** — measures one note of a channel (pitch, low-end note, envelope) so Claude tunes 808s and kicks.
- Sample metadata and analysis so Claude picks, tunes and tempo-matches your sounds correctly; it searches and files
  them in folders and edits them with **`edit_sample`** (trim, fades, stretch, pitch shift, **pitch correction**) —
  saved as new samples unless you ask it to replace one.
- Your **plugins**: `list_plugins`, plugin channels and effects, `run_generator` (Claude can use them, never install them).
- Prompts: `make_beat`, `mix_review`, `use_my_samples`, `spatial_mix`.
- **Skills** for Claude Desktop / claude.ai / Claude Code in [`skills/`](skills): beat making, arranging, mixing by
  the numbers, spatial mixing and plugin authoring (`npm run skills:pack` makes uploadable zips).

**Accounts & security**

- User accounts (first-run admin setup, optional registration, admin user management), private projects per user.
- Personal **API tokens** for MCP — generate, regenerate or delete in *Settings → API & MCP*. Optional on your own
  computer, required over the network.
- scrypt passwords, hashed sessions and tokens, CSRF/origin and host checks, CSP, rate limits, setup code for exposed
  servers, sandboxed plugins. See [docs/security.md](docs/security.md).

## Screenshots

| | |
|---|---|
| [![Studio](docs/screenshots/studio.png)](docs/screenshots/studio.png) **Studio** — playlist, channel rack, piano roll | [![Mixer](docs/screenshots/mixer.png)](docs/screenshots/mixer.png) **Mixer** — inserts, effects, sends |
| [![Piano roll](docs/screenshots/piano-roll.png)](docs/screenshots/piano-roll.png) **Piano roll** — scale highlight, velocity lane | [![Samples](docs/screenshots/samples.png)](docs/screenshots/samples.png) **Sample library** — folders, search, metadata & analysis |
| [![Claude activity](docs/screenshots/claude-activity.png)](docs/screenshots/claude-activity.png) **Claude** — live activity log | [![API & MCP settings](docs/screenshots/settings-api.png)](docs/screenshots/settings-api.png) **Settings → API & MCP** — tokens & setup |
| [![Spatial mixer](docs/screenshots/spatial.png)](docs/screenshots/spatial.png) **Spatial (3D)** — objects around and above the listener | [![Plugin install](docs/screenshots/settings-plugins.png)](docs/screenshots/settings-plugins.png) **Plugins** — review & trust before installing |
| [![Audio export settings](docs/screenshots/settings-export.png)](docs/screenshots/settings-export.png) **Settings → Audio export** — ffmpeg & formats | [![Phone](docs/screenshots/mobile.png)](docs/screenshots/mobile.png) **Phone layout** |
| [![World collections](docs/screenshots/world.png)](docs/screenshots/world.png) **World collections** — the Indian Fusion template, sitar settings | [![Sign in](docs/screenshots/login.png)](docs/screenshots/login.png) **Sign in** |
| [![Wave editor](docs/screenshots/wave-editor.png)](docs/screenshots/wave-editor.png) **Wave editor** — select, cut, fade, stretch, pitch shift | [![Pitch correction](docs/screenshots/pitch-correction.png)](docs/screenshots/pitch-correction.png) **Pitch correction** — auto-tune and notes moved by hand |
| [![Recorder](docs/screenshots/recorder.png)](docs/screenshots/recorder.png) **Recorder** — takes over the song, placed on the playlist | [![About](docs/screenshots/about.png)](docs/screenshots/about.png) **About** — app name and version (ⓘ, top right) |

## Quick start

Requirements: **Node.js 20.19+** (22 LTS recommended) and a modern browser.

```bash
git clone <repo-url> greanteadawy && cd greanteadawy
npm install
npm run build
npm start                 # → http://127.0.0.1:3001
```

1. Open http://127.0.0.1:3001 and **create the admin account** (first run).
2. A **Welcome Trap Beat** project is ready — click once to enable audio and press **Space**.
3. Read the [user guide](docs/user-guide.md) or jump straight to Claude below.

Development mode with hot reload: `npm run dev` → http://localhost:5173.

## Make music with Claude

Keep the studio open in your browser, then connect a client. *Settings → API & MCP* shows these commands with your
URL and token filled in.

**Claude Code**

```bash
claude mcp add --transport http greanteadawy http://localhost:3001/mcp \
  --header "Authorization: Bearer <your gtd_ token>"
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "greanteadawy": {
      "command": "node",
      "args": ["/absolute/path/to/greanteadawy/server/src/mcp/stdio.js"],
      "env": { "GREANTEADAWY_URL": "http://127.0.0.1:3001", "GREANTEADAWY_TOKEN": "<your gtd_ token>" }
    }
  }
}
```

The token is optional on your own computer (an admin setting allows local token-less access) and required for anything
reaching the server over a network. Then try:

> *Make a lo-fi beat at 80 BPM in F major with jazzy 7th chords, dusty drums with swing and a warm bass.
> Arrange intro/verse/hook/outro, mix it to around −14 LUFS, save a version and play it.*

More: [Making music with Claude](docs/claude-mcp.md) · [MCP tool reference](docs/MCP.md).

## Configuration

Environment variables (or a `.env` file — see [`.env.example`](.env.example)):

| Variable | Default | |
|----------|---------|---|
| `PORT` / `HOST` | `3001` / `127.0.0.1` | where to listen (`0.0.0.0` for Docker/LAN) |
| `DATA_DIR` | `./data` | projects, samples, exports, accounts |
| `PUBLIC_URL` | — | external URL (links for Claude, allowed origin) |
| `ALLOWED_HOSTS` | localhost on loopback | Host header allow-list |
| `TRUST_PROXY` | off | set behind a reverse proxy (hop count) |
| `SESSION_TTL_DAYS` | `30` | sign-in lifetime |
| `SETUP_CODE` | random, in the log | first-run admin setup code (remote or proxied setup) |
| `MCP_TOKEN` | — | legacy shared MCP token (disables token-less MCP) |
| `MAX_UPLOAD_MB` | `50` | sample upload limit |
| `FFMPEG_PATH` | `ffmpeg` on the PATH | MP3/AAC/Ogg/Opus/FLAC/ALAC/AIFF export (`off` disables) |
| `PLUGINS_ENABLED` | `true` | allow users to install their own plugins (also an admin setting) |
| `GREANTEADAWY_URL` / `GREANTEADAWY_TOKEN` | — | for the stdio bridge |

Full details: [docs/deployment.md](docs/deployment.md).

## Docker

```bash
cp .env.example .env               # optional settings
docker compose up -d --build       # studio on http://localhost:3001 (ffmpeg included)
docker compose logs greanteadawy   # first run: the setup code for the admin account
```

Add HTTPS for other computers with the bundled Caddy profile (`docker compose --profile proxy up -d` after setting
`DOMAIN`, `PUBLIC_URL`, `ALLOWED_HOSTS`, `TRUST_PROXY=1`). Configuration, backups, upgrades and hardening:
[docs/docker.md](docs/docker.md); other reverse proxies and systemd: [docs/deployment.md](docs/deployment.md).

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | install, first run, first beat |
| [User guide](docs/user-guide.md) | every window, tool and shortcut |
| [Making music with Claude](docs/claude-mcp.md) | connecting, tokens, `render_mix`, tips |
| [MCP reference](docs/MCP.md) | all tools and parameters (generated) |
| [Spatial mixing](docs/spatial.md) | 3D objects, binaural, 5.1 / 7.1.4, ADM |
| [Plugins](docs/plugins.md) | write, pack and install instruments, effects, generators |
| [Docker](docs/docker.md) | image, compose, HTTPS, backups |
| [Deployment](docs/deployment.md) | Docker, proxies, env vars, backups |
| [Security](docs/security.md) | auth model and hardening checklist |
| [Architecture](docs/architecture.md) | ops, live sync, browser jobs, audio engine |
| [REST & WebSocket API](docs/api.md) | for scripts and integrations |
| [Development](docs/development.md) | layout, scripts, tests, conventions |
| [Roadmap & product review](docs/roadmap.md) | music-industry review, done & next |

## Development

```bash
npm run dev          # server + client with hot reload
npm run lint         # ESLint
npm test             # unit & integration tests
npm run test:e2e     # Playwright end-to-end (npx playwright install chromium once)
npm run docs:mcp     # regenerate docs/MCP.md
npm run screenshots  # regenerate README screenshots
npm run plugin:pack -- <folder> | --examples   # validate + zip a plugin
```

```
packages/core   shared model, ops, music theory, MIDI, audio analysis
server          Express + WebSocket hub + MCP server + accounts
client          React UI + Web Audio engine
e2e             Playwright tests (a real browser plus an MCP client playing "Claude")
plugins         example plugins (npm run plugin:pack -- --examples → plugins/dist/*.zip)
skills          music-production skills for Claude users (npm run skills:pack → skills/dist/*.zip)
docs            documentation
.claude         skills & agents for developing GreanTeaDawy with Claude Code (see CLAUDE.md)
```

Working on the code with Claude Code? Start with [CLAUDE.md](CLAUDE.md); recipes for common changes are in
`.claude/skills/`, and `.claude/agents/` has a QA reviewer and a music-industry advisor.

## Security

Private by default: listens on `127.0.0.1`, every account's data is private, tokens and sessions are stored hashed.
Before exposing it to a network read [docs/security.md](docs/security.md) (HTTPS, `PUBLIC_URL`, `ALLOWED_HOSTS`,
`TRUST_PROXY`, tokens for every MCP client) — behind a reverse proxy, always set `PUBLIC_URL`. Please report
vulnerabilities privately.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No sound | Click anywhere once (browsers need a gesture), check master volume and mutes. |
| Claude: "No studio is open in a browser" | Keep the studio open, signed in as the token's account. |
| Claude: 401 on `/mcp` | Create a token in Settings → API & MCP; token-less access is local-only and can be disabled. |
| Forgot the admin password | Stop the server and run `npm run reset-password -- <username>`. |
| Port in use | `PORT=3002 npm start` |

## Contributing

Issues and pull requests are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first. Please run
`npm run lint && npm test && npm run test:e2e` and update the docs with your change; the repo layout and conventions are
in [docs/development.md](docs/development.md).

## Sample credits

The built-in sample bank ships real instrument recordings, all in the public domain
([CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)). Per instrument:

| 乐器 | 来源 | 许可 |
|------|------|------|
| 古筝 (guzheng) | [Freesound · Pufermufin](https://freesound.org/)（经 XSXB-Band-Samples 整理） | CC0-1.0 |
| 二胡 (erhu) | [sfzinstruments/aliexpress-erhu](https://github.com/sfzinstruments/aliexpress-erhu) | CC0-1.0 |
| 箫 (xiao) | [sgossner/VCSL](https://github.com/sgossner/VCSL)（竖笛，经 XSXB-Band-Samples 加工为箫） | CC0-1.0 |
| 唢呐 (suona) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（双簧管，经 XSXB-Band-Samples 加工为唢呐） | CC0-1.0 |
| 埙 (xun) | [sgossner/VCSL](https://github.com/sgossner/VCSL)（陶土奥卡里那） | CC0-1.0 |
| 木鱼 (muyu) | [sgossner/VCSL](https://github.com/sgossner/VCSL)（开槽木鼓） | CC0-1.0 |
| 大锣 (gong) | [sgossner/VCSL](https://github.com/sgossner/VCSL) | CC0-1.0 |
| 电子贝斯 (bass) | [freepats/electric-bass-YR](https://github.com/freepats/electric-bass-YR)（finger + pick） | CC0-1.0 |
| 钢琴 (piano) | [freepats/upright-piano-KW](https://github.com/freepats/upright-piano-KW)（立式钢琴） | CC0-1.0 |
| 古典吉他 (guitar) | [freepats/spanish-classical-guitar](https://github.com/freepats/spanish-classical-guitar) | CC0-1.0 |
| 尤克里里 (ukulele) | [freepats/ukulele1](https://github.com/freepats/ukulele1) | CC0-1.0 |
| 陶笛 (ocarina) | [freepats/ocarina1](https://github.com/freepats/ocarina1) | CC0-1.0 |
| 管钟 (bells) | [freepats/tubular-bells1](https://github.com/freepats/tubular-bells1) | CC0-1.0 |
| 套鼓 (kick/snare/hat/tom/cymbal/rim) | [freepats/colomboADK](https://github.com/freepats/colomboADK)（预混单声道成品 take） | CC0-1.0 |
| 课堂打击 (clap/claves/castanets/tambourine/shaker/perc) | [freepats/world-percussion](https://github.com/freepats/world-percussion) | CC0-1.0 |
| 定音鼓 (timpani) | [freepats/timpani](https://github.com/freepats/timpani)（D2–A3） | CC0-1.0 |
| 手碟 (hang) | [freepats/hang-D-minor](https://github.com/freepats/hang-D-minor)（D 小调） | CC0-1.0 |
| 电吉他 (eguitar) | [freepats/electric-guitar-FSBS-clean](https://github.com/freepats/electric-guitar-FSBS-clean)（清音） | CC0-1.0 |
| 长笛 (flute) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（揉音持续音，《彼得与狼》小鸟） | CC0-1.0 |
| 双簧管 (oboe) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（《彼得与狼》鸭子） | CC0-1.0 |
| 单簧管 (clarinet) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（《彼得与狼》猫） | CC0-1.0 |
| 巴松 (bassoon) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（《彼得与狼》爷爷） | CC0-1.0 |
| 圆号 (horn) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（《彼得与狼》狼） | CC0-1.0 |
| 小提琴 (violin) | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)（独奏，彼得本人） | CC0-1.0 |

CC0-1.0（公有领域贡献）意味着这些录音可以自由用于任何用途，无需署名——上表所列来源是对原作者的致谢，而非许可要求。
录音经重采样、音区校准与响度归一后打包进 `client/public/samples/`；清单见
[client/public/samples/manifest.json](client/public/samples/manifest.json)，每件乐器的 `source` 字段记录其出处。

## 重建采样库

仓库体积所限，约 230 MB 的 WAV 采样 **未进入版本库**（`client/public/samples/` 在 `.gitignore` 中）。
新 clone 下来的仓库**没有**这些真实录音——应用会回退到合成音色（合成引擎零依赖，开箱即用）。
下面的脚本可以从三个 CC0 来源重建完整的采样库：

**前置依赖**：Python 3.10+、`pip install numpy soundfile requests`、Git LFS（可选）。

```bash
# 第 1 步：从 GitHub 下载公共领域录音到 assets/real/<kind>/
python scripts/fetch_freepats.py    # FreePats：电贝斯、钢琴、吉他、尤克里里、管钟、架子鼓、定音鼓、手碟、电吉他、打击乐
python scripts/fetch_vsco.py        # VSCO-2-CE：长笛、双簧管、单簧管、巴松、圆号、小提琴（管弦乐）
# 民乐（古筝/二胡/箫/唢呐/埙/木鱼/锣）：手动从 Freesound / SFZ Instruments 下载 CC0 录音，
#        放进 assets/real/<kind>/，文件名随意——build_samples.py 会自动识别音高。

# 第 2 步：分析每个录音的真实基频、重采样到 44.1 kHz、拷贝到 client/public/samples/<kind>/、写 manifest
python scripts/build_samples.py --copy

# 第 3 步（可选）：校验 manifest 里的每条 notes 都引用了真实文件
python scripts/validate_manifest.py
```

重建完成后，刷新浏览器即可加载真实采样。以后若想扩展乐器（加一个新的 FreePats 仓库、
或一件新的民乐），只需在 `scripts/fetch_freepats.py` 的 `INSTRUMENTS` 字典里加一行、
在 `packages/core/src/instruments.js` 注册 kind + preset，然后重跑 `build_samples.py`。

## Licence

[MIT](LICENSE) © GreanTeaDawy contributors.
