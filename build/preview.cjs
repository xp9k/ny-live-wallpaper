'use strict';
// Render the real scene: docs/preview.gif (round-the-clock cycle) and docs/thumbnail.jpg.
// Build machine only: Playwright Chromium, gifski, ffmpeg.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {chromium, options} = require('./browser.cjs');
const root = path.resolve(__dirname, '..');
const frames = path.join(root, '.cache/preview-frames');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

function run(args) {
  const result = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], {encoding: 'utf8', timeout: 300000});
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
}
// Day, a quick pass through dusk, night with the glowing tree, dawn back to day.
function hourAt(seconds) {
  if (seconds < 3) return 13;
  if (seconds < 5) return (13 + (seconds - 3) * 6) % 24;
  if (seconds < 10) return 1;
  return (1 + (seconds - 10) * 6) % 24;
}
async function main() {
  const localEncoder = path.join(root, '.cache/gifski/win/gifski.exe');
  const encoder = process.env.GIFSKI || (fs.existsSync(localEncoder) ? localEncoder : 'gifski');
  if (spawnSync(encoder, ['--version'], {encoding: 'utf8'}).status !== 0) throw new Error('gifski not found. Set GIFSKI to its executable.');
  const fps = 15, seconds = 12, count = fps * seconds, width = 1280, height = 720;
  fs.rmSync(frames, {recursive: true, force: true});
  fs.mkdirSync(frames, {recursive: true});
  const browser = await chromium.launch(options);
  try {
    const page = await browser.newPage({viewport: {width, height}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href + '?paused=1&capture=1&quality=high&hour=13');
    await page.waitForFunction(() => window.nyWallpaper?.getStats().ready, null, {timeout: 60000});
    const grab = (hour, time) => page.evaluate(({hour, time}) => {
      nyWallpaper.configure({timeMode: 'manual', hour}); nyWallpaper.seek(time);
      return document.getElementById('scene').toDataURL('image/png').split(',')[1];
    }, {hour, time});
    for (let i = 0; i < count; i++) {
      const png = await grab(hourAt(i / fps), 8 + i / fps);
      fs.writeFileSync(path.join(frames, String(i).padStart(4, '0') + '.png'), Buffer.from(png, 'base64'));
    }
    fs.writeFileSync(path.join(frames, 'thumbnail.png'), Buffer.from(await grab(0.5, 6), 'base64'));
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs, {recursive: true});
  run(['-i', path.join(frames, 'thumbnail.png'), '-vf', 'scale=640:360:flags=lanczos', '-q:v', '3', path.join(docs, 'thumbnail.jpg')]);
  // gifski: temporal dithering and delta frames keep detail at a sane size.
  const inputs = Array.from({length: count}, (_, i) => path.join(frames, String(i).padStart(4, '0') + '.png'));
  const result = spawnSync(encoder, ['--quiet', '--fps', String(fps), '--width', String(width), '--height', String(height),
    '--quality', '85', '--motion-quality', '80', '--lossy-quality', '80', '--repeat', '0',
    '--output', path.join(docs, 'preview.gif'), ...inputs], {encoding: 'utf8', timeout: 600000});
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  console.log(`Preview: ${count} frames, ${fps} fps, ${width}x${height}, day/night cycle; ${Math.round(fs.statSync(path.join(docs, 'preview.gif')).size / 1048576 * 10) / 10} MB`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
