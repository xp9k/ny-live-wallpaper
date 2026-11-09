'use strict';
// Checks the built Lively ZIP: exact contents, metadata, menu defaults and saved
// values, lighting by time of day, TV noise, clock, snow and pause.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {unzipSync} = require('fflate');
const {chromium, options} = require('./browser.cjs');
const scene = require('../src/scene.js');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;

async function main() {
  const bundle = unzipSync(fs.readFileSync(path.join(root, `dist/ny-wallpaper-win-${version}.zip`)));
  const expected = ['LICENSE.txt', 'LivelyInfo.json', 'LivelyProperties.json', 'README.txt', 'assets/scene-assets.js',
    'index.html', 'preview.gif', 'scene.js', 'style.css', 'thumbnail.jpg', 'wallpaper.js'];
  assert.deepEqual(Object.keys(bundle).sort(), expected);
  for (const name of expected) assert.ok(bundle[name].length, 'Empty entry: ' + name);
  const info = JSON.parse(Buffer.from(bundle['LivelyInfo.json']).toString());
  assert.equal(info.Type, 1); assert.equal(info.FileName, 'index.html'); assert.equal(info.IsAbsolutePath, false);
  assert.equal(info.Thumbnail, 'thumbnail.jpg'); assert.equal(info.Preview, 'preview.gif');
  const properties = JSON.parse(Buffer.from(bundle['LivelyProperties.json']).toString());
  assert.deepEqual(Object.keys(properties).sort(), ['fps', 'hour', 'light', 'paused', 'quality', 'snow', 'timeMode', 'tv', 'twinkle']);

  const directory = path.join(root, '.cache/windows-theme');
  fs.rmSync(directory, {recursive: true, force: true});
  for (const [name, bytes] of Object.entries(bundle)) {
    const target = path.resolve(directory, name);
    assert.ok(target.startsWith(directory + path.sep), 'Archive path must stay inside the theme');
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes);
  }
  const browser = await chromium.launch(options);
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href + '?capture=1');
    await page.waitForFunction(() => window.nyWallpaper?.getStats().ready, null, {timeout: 60000});
    // Lively sends every saved value on load: defaults first.
    await page.evaluate(p => { for (const [n, v] of Object.entries(p)) livelyPropertyListener(n, v.value); }, properties);
    let stats = await page.evaluate(() => nyWallpaper.getStats());
    for (const name of Object.keys(properties).filter(n => n !== 'paused')) {
      assert.equal(stats.settings[name], scene.defaults[name], 'Lively default: ' + name);
    }
    assert.equal(stats.paused, false);
    const now = new Date();
    assert.equal(stats.clock.h, now.getHours(), 'Clock follows the computer time');
    // Saved values from the menu.
    const saved = {timeMode: 1, hour: 1290, snow: 150, tv: 40, twinkle: 0, light: 120, quality: 0, fps: 24, paused: true};
    await page.evaluate(v => { for (const [n, x] of Object.entries(v)) livelyPropertyListener(n, x); }, saved);
    stats = await page.evaluate(() => nyWallpaper.getStats());
    assert.deepEqual(stats.settings, {light: 1.2, snow: 1.5, tv: .4, twinkle: 0, fps: 24, quality: 'eco', timeMode: 'manual', hour: 21.5});
    assert.equal(stats.paused, true);
    const today = new Date();
    // Manual time moves the clock hands; the wall calendar keeps the real date.
    assert.deepEqual(stats.clock, {h: 21, m: 30, y: today.getFullYear(), mo: today.getMonth(), d: today.getDate()});
    // Invalid payloads are ignored.
    await page.evaluate(() => { livelyPropertyListener('quality', 99); livelyPropertyListener('snow', null); livelyPropertyListener('x', 1); });
    assert.equal((await page.evaluate(() => nyWallpaper.getStats())).settings.quality, 'eco');

    await page.evaluate(() => nyWallpaper.configure({quality: 'high', light: 1, snow: 1, tv: 1, twinkle: 1}));
    // Region brightness of the canvas (image-relative rectangles, 16:9 crop is close to the artwork).
    const measure = (hour, time, rect) => page.evaluate(({hour, time, rect}) => {
      nyWallpaper.configure({timeMode: 'manual', hour}); nyWallpaper.seek(time);
      const s = document.getElementById('scene'), c = document.createElement('canvas');
      c.width = s.width; c.height = s.height; const x = c.getContext('2d'); x.drawImage(s, 0, 0);
      const [l, t, r, b] = rect, d = x.getImageData(l * s.width, t * s.height, (r - l) * s.width, (b - t) * s.height).data;
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4 * 765);
    }, {hour, time, rect});
    const room = [0, 0, 1, 1], rightCorner = [.8, .05, 1, .5], tree = [.05, .1, .28, .75], window = [.31, .22, .36, .5];
    const tv = [.545, .55, .6, .63], clock = [.765, .17, .79, .23];
    const night = await measure(2, 5, rightCorner), evening = await measure(19, 5, rightCorner), day = await measure(13, 5, rightCorner);
    assert.ok(night < evening * .7, `Night room must be darker than evening: ${night} vs ${evening}`);
    assert.ok(day > night * 1.5, `Day must be brighter than night: ${day} vs ${night}`);
    const treeNight = await measure(2, 5, tree);
    assert.ok(treeNight > night * 1.6, `The tree must glow at night: ${treeNight} vs ${night}`);
    const outsideNight = await measure(2, 5, window), outsideDay = await measure(13, 5, window);
    assert.ok(outsideDay > outsideNight * 1.8, `Daylight outside: ${outsideDay} vs ${outsideNight}`);
    const tvA = await measure(2, 5, tv), tvB = await measure(2, 5.2, tv);
    assert.notEqual(tvA, tvB, 'TV picture must change between frames');
    const clockA = await measure(2, 5, clock), clockB = await measure(2.5, 5, clock);
    assert.notEqual(clockA, clockB, 'Clock hands must move with the time');
    const snowA = await measure(2, 5, window), snowB = await measure(2, 5.5, window);
    assert.notEqual(snowA, snowB, 'Snow must fall');
    assert.ok(await measure(13, 5, room) > .05);
    // Pause and resume.
    await page.evaluate(() => { nyWallpaper.configure({timeMode: 'auto'}); nyWallpaper.pause(false); });
    const t0 = (await page.evaluate(() => nyWallpaper.getStats())).time;
    await page.waitForFunction(t => nyWallpaper.getStats().time > t + .2, t0);
    await page.evaluate(() => nyWallpaper.pause(true));
    const t1 = (await page.evaluate(() => nyWallpaper.getStats())).time;
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(() => nyWallpaper.getStats())).time, t1, 'Paused time must stand still');
    await page.setViewportSize({width: 720, height: 1280});
    await page.waitForFunction(() => nyWallpaper.getStats().resolution[0] === 720);
    assert.deepEqual(errors, []);
    console.log('PASS: Lively ZIP contents and metadata, menu defaults and saved values, night/evening/day light, glowing tree, daylight outside, TV noise, clock, snow, pause, portrait resize');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
