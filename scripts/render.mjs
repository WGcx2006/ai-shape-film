import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dependency, root, out, settings, frames, chunkFrames, chunkCount, url, ffmpegPath, browserPath, insideProject } from './runtime.mjs';

const mode = process.argv[2] || 'stills';
const errors = [], failedRequests = [];
let browser, page;
function hashFile(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
function renderIdentity() {
  const source = [path.join(root, 'index.html'), ...sourceFiles(path.join(root, 'src')), ...sourceFiles(path.join(root, 'fonts')), ...['render.mjs', 'runtime.mjs'].map(name => path.join(root, 'scripts', name))];
  const hash = crypto.createHash('sha256');
  for (const filename of source) { hash.update(path.relative(root, filename)); hash.update(fs.readFileSync(filename)); }
  hash.update(JSON.stringify({ width: settings.width, height: settings.height, fps: settings.fps, duration: settings.duration, crf: settings.crf, chunkFrames }));
  return hash.digest('hex');
}
async function open() {
  const { chromium } = dependency('playwright');
  browser = await chromium.launch({ executablePath: browserPath(), headless: true,
    args: ['--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', '--allow-file-access-from-files'] });
  page = await browser.newPage({ viewport: { width: settings.width, height: settings.height }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('requestfailed', request => { if (!request.url().includes('favicon.ico')) failedRequests.push({ url: request.url(), error: request.failure()?.errorText }); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const canvas = document.getElementById('screen');
    return { duration: window.__duration, render: typeof window.__render, width: canvas?.width, height: canvas?.height, fonts: document.fonts.status };
  });
  if (info.duration !== settings.duration || info.render !== 'function' || info.width !== settings.width || info.height !== settings.height) throw new Error(`Invalid film export interface: ${JSON.stringify(info)}`);
  console.log('Film ready', JSON.stringify(info));
}
async function capture(t, png = false) {
  const data = await page.evaluate(({ t, png }) => {
    window.__render(t);
    return document.getElementById('screen').toDataURL(png ? 'image/png' : 'image/jpeg', 0.98).split(',')[1];
  }, { t, png });
  if (errors.length) throw new Error(errors.join('\n'));
  return Buffer.from(data, 'base64');
}
async function encode(args, produce) {
  const proc = spawn(ffmpegPath(), args, { cwd: root, windowsHide: true, stdio: [produce ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let log = '', failure;
  proc.stderr.on('data', data => { log = (log + data).slice(-24000); });
  proc.once('error', error => { failure = error; });
  proc.stdin?.on('error', error => { failure = error; });
  const done = new Promise(resolve => proc.once('close', code => resolve({ code })));
  try {
    if (produce) {
      await produce(async buffer => {
        if (failure) throw failure;
        if (!proc.stdin.write(buffer)) await Promise.race([once(proc.stdin, 'drain'), done.then(() => { throw new Error(log || 'Encoder closed its input.'); })]);
      });
      proc.stdin.end();
    }
    const { code } = await done;
    if (failure || code !== 0) throw new Error(`FFmpeg failed (${code}): ${failure?.message || ''}\n${log}`);
  } catch (error) { proc.kill(); throw error; }
}
function partFile(directory, index) { return path.join(directory, `part-${String(index).padStart(2, '0')}.mp4`); }
function completedPart(directory, index, identity) {
  const filename = partFile(directory, index);
  try {
    const marker = JSON.parse(fs.readFileSync(filename + '.json', 'utf8'));
    return marker.identity === identity && marker.index === index && marker.frames === chunkFrames && marker.fps === settings.fps && fs.statSync(filename).size === marker.bytes;
  } catch { return false; }
}
async function worker() {
  const index = Number(process.argv[3] || 0), count = Number(process.argv[4] || 1);
  if (!Number.isInteger(count) || count < 1 || count > 4 || !Number.isInteger(index) || index < 0 || index >= count) throw new Error('Usage: node scripts/render.mjs worker INDEX COUNT (COUNT 1–4)');
  const identity = renderIdentity(), directory = path.join(out, 'parts', identity.slice(0, 16));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(out, 'parts-current.txt'), directory);
  console.log(`Worker ${index + 1}/${count}; parts ${directory}`);
  const started = Date.now();
  for (let chunk = index; chunk < chunkCount; chunk += count) {
    if (completedPart(directory, chunk, identity)) { console.log(`Reused part ${chunk + 1}/${chunkCount}`); continue; }
    const filename = partFile(directory, chunk), temporary = filename + '.partial.mp4';
    await encode(['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(settings.fps), '-i', 'pipe:0', '-an',
      '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', process.env.FILM_PRESET || 'fast', '-crf', String(settings.crf), '-threads', process.env.FILM_ENCODER_THREADS || '2',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-frames:v', String(chunkFrames), '-movflags', '+faststart', temporary],
    async write => {
      for (let frame = chunk * chunkFrames; frame < (chunk + 1) * chunkFrames; frame++) {
        await write(await capture(frame / settings.fps));
        if ((frame + 1) % 180 === 0) console.log(`Frame ${frame + 1}/${frames}; elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }
    });
    fs.renameSync(temporary, filename);
    fs.writeFileSync(filename + '.json', JSON.stringify({ identity, index: chunk, start: chunk * settings.chunkSeconds, frames: chunkFrames, fps: settings.fps, bytes: fs.statSync(filename).size, sha256: hashFile(filename) }, null, 2));
    console.log(`Completed part ${chunk + 1}/${chunkCount}`);
  }
}
async function assemble() {
  const directory = insideProject(process.argv[3] || fs.readFileSync(path.join(out, 'parts-current.txt'), 'utf8').trim());
  const identity = renderIdentity();
  for (let i = 0; i < chunkCount; i++) if (!completedPart(directory, i, identity)) throw new Error(`Missing, outdated or incomplete part ${i}. Rerun export to resume.`);
  const list = path.join(directory, 'concat.txt');
  fs.writeFileSync(list, Array.from({ length: chunkCount }, (_, i) => `file 'part-${String(i).padStart(2, '0')}.mp4'`).join('\n') + '\n');
  const score = path.join(out, 'score.m4a');
  if (!fs.existsSync(score)) throw new Error('out/score.m4a is required before assembling. Generate the original score first.');
  const finalFile = path.join(out, settings.filename), temporary = path.join(out, 'film.partial.mp4');
  await encode(['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', list, '-i', score,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', String(settings.duration), '-movflags', '+faststart',
    '-metadata', `title=${settings.title}`, '-metadata', 'comment=Original procedural AI science film; 1920x1080, 30fps, 240 seconds.', temporary]);
  fs.renameSync(temporary, finalFile);
  fs.writeFileSync(path.join(out, 'export-manifest.json'), JSON.stringify({ filename: settings.filename, settings, renderIdentity: identity, scoreSha256: hashFile(score), parts: directory, frameCount: frames, exportedAt: new Date().toISOString() }, null, 2));
  console.log(`Assembled ${finalFile}`);
}
async function stills() {
  const sharp = dependency('sharp');
  const specified = process.env.FILM_STILL_TIMES?.split(',').map(Number);
  const times = specified || Array.from({ length: chunkCount }, (_, i) => i * settings.chunkSeconds + 6);
  const thumbnails = [];
  for (const t of times) {
    if (!Number.isFinite(t) || t < 0 || t >= settings.duration) throw new Error(`Invalid still time: ${t}`);
    const buffer = await capture(t, true), name = `frame-${t.toFixed(2).padStart(6, '0')}.png`;
    fs.writeFileSync(path.join(out, name), buffer);
    const thumbnail = await sharp(buffer).resize(480, 270).toBuffer();
    const label = Buffer.from(`<svg width="480" height="28"><rect width="480" height="28" fill="#09121d"/><text x="12" y="20" fill="#b7d2df" font-family="Arial" font-size="15">${t.toFixed(2)} s</text></svg>`);
    thumbnails.push(await sharp({ create: { width: 480, height: 298, channels: 3, background: '#09121d' } }).composite([{ input: thumbnail, left: 0, top: 0 }, { input: label, left: 0, top: 270 }]).png().toBuffer());
    console.log(`Still ${t.toFixed(2)}s`);
  }
  const sheet = path.join(out, 'contact-render.jpg');
  await sharp({ create: { width: 1920, height: Math.ceil(thumbnails.length / 4) * 298, channels: 3, background: '#09121d' } })
    .composite(thumbnails.map((input, i) => ({ input, left: (i % 4) * 480, top: Math.floor(i / 4) * 298 }))).jpeg({ quality: 94 }).toFile(sheet);
  console.log(`Contact sheet: ${sheet}`);
}
async function check() {
  const sharp = dependency('sharp'), time = 91.25;
  const first = await sharp(await capture(time, true)).removeAlpha().raw().toBuffer();
  await capture(18); await capture(183.7);
  const second = await sharp(await capture(time, true)).removeAlpha().raw().toBuffer();
  let difference = 0;
  for (let i = 0; i < first.length; i++) difference += Math.abs(first[i] - second[i]);
  difference /= first.length;
  const bad = [], missing = [], seenScenes = new Set();
  const times = [...Array.from({ length: 240 }, (_, i) => i + .25), ...Array.from({ length: chunkCount - 1 }, (_, i) => [(i + 1) * 12 - 1 / 30, (i + 1) * 12, (i + 1) * 12 + 1 / 30]).flat()];
  for (const t of times) {
    const info = await page.evaluate(t => window.__render(t), t);
    if (!info || !Array.isArray(info.boxes) || info.scene === undefined) { missing.push(t); continue; }
    seenScenes.add(info.scene);
    for (const box of info.boxes) {
      if (box.opacity !== undefined && box.opacity <= 0.05) continue;
      if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 0 || box.h < 0 || box.x < 0 || box.x + box.w > settings.width || box.y < 0 || box.y + box.h > settings.height) bad.push({ time: t, scene: info.scene, ...box });
    }
  }
  const started = Date.now();
  for (let i = 0; i < 90; i++) await capture(56 + i / 30);
  const elapsed = (Date.now() - started) / 1000;
  const report = { duration: settings.duration, expectedFrameCount: frames, sampledLayoutTimes: times.length, sceneIds: [...seenScenes], seekMeanPixelDifference: difference, benchmarkSeconds90Frames: elapsed, benchmarkFramesPerSecond: 90 / elapsed, textOutsideCanvas: bad, missingLayoutMetadata: missing, pageErrors: errors, failedRequests };
  report.passed = difference < 0.01 && bad.length === 0 && missing.length === 0 && errors.length === 0 && failedRequests.length === 0;
  fs.writeFileSync(path.join(out, 'render-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

try {
  if (mode === 'assemble') await assemble();
  else {
    if (!['stills', 'check', 'worker'].includes(mode)) throw new Error('Modes: stills, check, worker INDEX COUNT, assemble [PARTS_DIRECTORY]');
    await open();
    if (mode === 'stills') await stills();
    if (mode === 'check') await check();
    if (mode === 'worker') await worker();
  }
} catch (error) { console.error(error.stack || error); process.exitCode = 1; }
finally { if (browser) await browser.close(); }
