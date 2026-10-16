import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, out, settings, ffmpegPath, pythonPath } from './runtime.mjs';

const children = new Set();
let server;
function run(binary, args, label, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: root, windowsHide: true, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.stdout.on('data', data => process.stdout.write(`[${label}] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[${label}] ${data}`));
    child.once('error', reject);
    child.once('close', code => { children.delete(child); if (code === 0) resolve(); else reject(new Error(`${label} exited with ${code}`)); });
  });
}
async function health() {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.port}/__film_health`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) throw new Error(`Port ${settings.port} is occupied by another server.`);
    const data = await response.json();
    if (data.project !== 'ai-shape-film' || path.resolve(data.root) !== root) throw new Error(`Port ${settings.port} is serving another project.`);
    return true;
  } catch (error) {
    if (error.message.includes('another')) throw error;
    return false;
  }
}
try {
  if (!Number.isInteger(settings.workers) || settings.workers < 2 || settings.workers > 4) throw new Error('FILM_WORKERS must be 2, 3 or 4.');
  const ffmpeg = ffmpegPath();
  if (!fs.existsSync(path.join(out, 'score.m4a'))) throw new Error('Generate out/score.m4a before export.');
  if (!(await health())) {
    server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
    server.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await health()) { ready = true; break; }
      if (server.exitCode !== null) break;
    }
    if (!ready) throw new Error('Could not start the film preview server.');
  }
  const renderer = path.join(root, 'scripts', 'render.mjs');
  await run(process.execPath, [renderer, 'check'], 'check');
  await Promise.all(Array.from({ length: settings.workers }, (_, i) => run(process.execPath, [renderer, 'worker', String(i), String(settings.workers)], `worker-${i + 1}`, { FFMPEG_PATH: ffmpeg })));
  await run(process.execPath, [renderer, 'assemble'], 'assemble', { FFMPEG_PATH: ffmpeg });
  if (process.env.FILM_SKIP_VERIFY !== '1') await run(pythonPath(), [path.join(root, 'scripts', 'verify.py')], 'verify', { FFMPEG_PATH: ffmpeg, PYTHONIOENCODING: 'utf-8' });
  console.log(`Finished: ${path.join(out, settings.filename)}`);
} catch (error) { console.error(error.stack || error); process.exitCode = 1; }
finally { for (const child of children) child.kill(); server?.kill(); }
