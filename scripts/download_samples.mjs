#!/usr/bin/env node
/**
 * Download and extract the public-domain sample bank (~220 MB WAV) for the browser DAW.
 *
 * The zip is hosted as a GitHub Release asset on equeenking/yueqi. Private Release
 * downloads need `GITHUB_TOKEN` (a GitHub personal access token with `public_repo`
 * or `repo:status` scope); public ones work with no token at all.
 *
 * Usage:
 *   node scripts/download_samples.mjs                      # public Release, 自动检测
 *   GITHUB_TOKEN=ghp_xxx npm run samples:download         # private Release
 *   npm run samples:download -- --force                   # 忽略已有目录，重新下载
 *
 * Source: FreePats CC0 + VSCO-2-CE CC0 + Freesound CC0 recordings,
 * processed by scripts/build_samples.py into client/public/samples/<kind>/*.wav.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEST = resolve(ROOT, 'client/public/samples');
const TMP_ZIP = resolve(__dirname, 'greentea-samples-v1.zip');

// --- metadata ----------------------------------------------------------------
const RELEASE_TAG  = 'samples-v1';
const ZIP_NAME     = 'greentea-samples-v1.zip';
const EXPECTED_SHA = '55f056df564e7023159ee79d1dc91bad2ce5eb7378fc10debbe3e4bbb5a15693';
const REPO         = 'equeenking/yueqi';
const PUBLIC_URL   = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${ZIP_NAME}`;
const API_URL      = `https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}`;

// --- helpers -----------------------------------------------------------------

function dirHasSamples(dirPath) {
  if (!existsSync(dirPath)) return false;
  try {
    const top = readdirSync(dirPath);
    return top.some((f) => {
      try { return statSync(resolve(dirPath, f)).isDirectory(); } catch { return false; }
    });
  } catch { return false; }
}

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchReleaseAssetUrl(token) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { headers });
  if (!res.ok) return null;
  const release = await res.json();
  const asset = (release.assets || []).find((a) => a.name === ZIP_NAME);
  return asset ? asset.browser_download_url : null;
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    mkdirSync(destDir, { recursive: true });
    // tar -xf strips the leading "samples/" directory from the archive so
    // the contents land directly in client/public/samples/.
    // bsdtar (Windows built-in tar.exe) may emit a harmless warning on
    // stderr even when extraction succeeds — treat "destDir became non-empty"
    // as the real success signal.
    const tarBin = process.platform === 'win32' ? 'tar.exe' : 'tar';
    const child = spawn(tarBin, ['-xf', zipPath, '-C', destDir, '--strip-components=1']);
    child.on('error', reject);
    child.on('exit', (code) => {
      const hasContent = existsSync(destDir) && readdirSync(destDir).length > 0;
      if (code === 0 || (code !== 0 && hasContent)) resolve();
      else reject(new Error(`tar exited ${code}`));
    });
  });
}

// --- main --------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));

  if (dirHasSamples(DEST) && !args.has('--force')) {
    console.log('✅ 采样目录已存在，跳过下载。加 --force 可重新下载。');
    return;
  }

  if (existsSync(DEST) && args.has('--force')) {
    rmSync(DEST, { recursive: true, force: true });
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let url = PUBLIC_URL;

  console.log(`📥 下载 ${ZIP_NAME}  (目标 ${DEST}) ...`);

  // Probe public URL with HEAD — private Release returns 404/401.
  // If we have a token, fall back to the API-resolved download URL.
  const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
  if (headRes && (headRes.status === 404 || headRes.status === 401) && token) {
    console.log('🔐 公开 URL 被拒（私有 Release），改用 API + GITHUB_TOKEN ...');
    const apiUrl = await fetchReleaseAssetUrl(token);
    if (!apiUrl) {
      console.error(`❌ 在 Release ${RELEASE_TAG} 里没找到 ${ZIP_NAME}。`);
      console.error('   请确认 Release 已创建、附件名正确、token 有 repo 权限。');
      process.exit(1);
    }
    url = apiUrl;
  }

  // Download
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`❌ GET ${url} → HTTP ${res.status} ${res.statusText}`);
    console.error('   私有 Release 需要 GITHUB_TOKEN / GH_TOKEN 环境变量。');
    console.error(`   或手动下载 zip 后运行：node scripts/download_samples.mjs --force`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(TMP_ZIP, buf);
  console.log(`   已下载 ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // sha256
  const got = await sha256File(TMP_ZIP);
  if (got !== EXPECTED_SHA) {
    console.error(`❌ sha256 校验失败`);
    console.error(`   期望  ${EXPECTED_SHA}`);
    console.error(`   实际  ${got}`);
    console.error('   Release 附件可能已被重新打包，请更新脚本里的 EXPECTED_SHA。');
    process.exit(1);
  }
  console.log('✅ sha256 匹配');

  // Extract
  console.log(`📦 解压到 ${DEST} ...`);
  mkdirSync(DEST, { recursive: true });
  await unzip(TMP_ZIP, DEST);
  rmSync(TMP_ZIP, { force: true });

  const wavCount = readdirSync(DEST, { recursive: true })
    .filter((p) => p.endsWith('.wav')).length;
  console.log(`✅ 完成：${wavCount} 个 .wav 已写入 ${DEST}`);
}

main().catch((err) => {
  console.error('❌ 失败：', err.message);
  process.exit(1);
});
