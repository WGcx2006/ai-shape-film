import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const out = path.join(root, 'out');
export const runtimeRoot = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies');
export const settings = Object.freeze({
  width: 1920, height: 1080, fps: 30, duration: 240, chunkSeconds: 12,
  port: Number(process.env.FILM_PORT || 5192),
  crf: Number(process.env.FILM_CRF || 18),
  workers: Number(process.env.FILM_WORKERS || 3),
  title: '智能的形状 · AI 如何从数据中学习',
  filename: '智能的形状_AI科普短片.mp4',
});
export const frames = settings.duration * settings.fps;
export const chunkFrames = settings.chunkSeconds * settings.fps;
export const chunkCount = frames / chunkFrames;
export const url = `http://127.0.0.1:${settings.port}/?export=1`;

export function dependency(name) {
  const candidates = [name];
  if (process.env.FILM_NODE_MODULES) candidates.push(path.join(process.env.FILM_NODE_MODULES, name));
  candidates.push(path.join(runtimeRoot, 'node', 'node_modules', name));
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error(`Missing ${name}. Run npm install in this project, or set FILM_NODE_MODULES.`);
}

function onPath(name) {
  const names = process.platform === 'win32' ? [name, `${name}.exe`] : [name];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const filename of names) {
      const candidate = path.join(dir, filename);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
}

export function pythonPath() {
  const candidates = [process.env.PYTHON_PATH, path.join(runtimeRoot, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'), onPath('python3'), onPath('python')];
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Python 3 is required for verification. Set PYTHON_PATH.');
  return found;
}

export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) {
    if (!fs.existsSync(process.env.FFMPEG_PATH)) throw new Error('FFMPEG_PATH does not exist.');
    return process.env.FFMPEG_PATH;
  }
  const local = path.join(root, '.tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) return local;
  const binaryDir = path.join(root, '.deps', 'imageio_ffmpeg', 'binaries');
  if (fs.existsSync(binaryDir)) {
    const name = fs.readdirSync(binaryDir).find(name => /^ffmpeg/.test(name) && !name.endsWith('.md'));
    if (name) return path.join(binaryDir, name);
  }
  const system = onPath('ffmpeg');
  if (system) return system;
  const discovered = spawnSync(pythonPath(), ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true, encoding: 'utf8' });
  const candidate = discovered.stdout?.trim();
  if (discovered.status === 0 && candidate && fs.existsSync(candidate)) return candidate;
  throw new Error('FFmpeg is required. Set FFMPEG_PATH, add .tools/ffmpeg.exe, or install imageio-ffmpeg into .deps.');
}

export function browserPath() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  if (process.platform !== 'win32') return undefined; // Playwright-managed browser.
  return [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).flatMap(base => [path.join(base, 'Microsoft/Edge/Application/msedge.exe'), path.join(base, 'Google/Chrome/Application/chrome.exe')])
    .find(candidate => fs.existsSync(candidate));
}

export function insideProject(candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Output path must stay inside this project: ${resolved}`);
  return resolved;
}

fs.mkdirSync(out, { recursive: true });
