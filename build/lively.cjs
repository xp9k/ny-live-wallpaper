'use strict';
// Windows theme for Lively Wallpaper: dist/ny-wallpaper-win-<version>.zip.
// The ZIP holds the web scene unchanged plus Lively metadata and settings.
const fs = require('node:fs');
const path = require('node:path');
const {zipSync} = require('fflate');
const scene = require('../src/scene.js');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;

// Lively sliders carry integers: percent, minutes for the hour; dropdowns carry indices.
function properties() {
  const result = {};
  const dropdown = (name, text, items, values) => {
    result[name] = {type: 'dropdown', text, items, value: values.indexOf(scene.defaults[name])};
  };
  const slider = (name, text, scale, step = 1) => {
    result[name] = {type: 'slider', text, min: Math.round(scene.ranges[name][0] * scale),
      max: Math.round(scene.ranges[name][1] * scale), step, value: Math.round(scene.defaults[name] * scale)};
  };
  dropdown('timeMode', 'Время суток', ['По часам компьютера', 'Вручную'], ['auto', 'manual']);
  slider('hour', 'Время вручную (минуты от полуночи)', 60, 15);
  slider('snow', 'Снег за окном (%)', 100);
  slider('tv', 'Помехи телевизора (%)', 100);
  slider('twinkle', 'Мерцание гирлянды и мишуры (%)', 100);
  slider('light', 'Яркость (%)', 100);
  dropdown('quality', 'Качество', ['Экономичное', 'Высокое', 'Ультра'], ['eco', 'high', 'ultra']);
  slider('fps', 'Частота кадров (FPS)', 1);
  result.paused = {type: 'checkbox', text: 'Пауза анимации', value: false};
  return result;
}
function files(directory, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(out, files(file, name + '/'));
    else out[name] = fs.readFileSync(file);
  }
  return out;
}
function main() {
  for (const needed of ['docs/thumbnail.jpg', 'docs/preview.gif', 'src/assets/scene-assets.js']) {
    if (!fs.existsSync(path.join(root, needed))) throw new Error(`Missing ${needed}: run npm run assets / npm run preview first.`);
  }
  const archive = files(path.join(root, 'src'));
  archive['LivelyInfo.json'] = fs.readFileSync(path.join(root, 'packaging/LivelyInfo.json'));
  archive['LivelyProperties.json'] = Buffer.from(JSON.stringify(properties(), null, 2) + '\n');
  archive['README.txt'] = fs.readFileSync(path.join(root, 'docs/windows.md'));
  archive['LICENSE.txt'] = fs.readFileSync(path.join(root, 'LICENSE'));
  archive['thumbnail.jpg'] = fs.readFileSync(path.join(root, 'docs/thumbnail.jpg'));
  archive['preview.gif'] = fs.readFileSync(path.join(root, 'docs/preview.gif'));
  const out = path.join(root, 'dist', `ny-wallpaper-win-${version}.zip`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, zipSync(archive, {level: 6}));
  console.log(`Windows theme: ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KiB)`);
}
if (require.main === module) main();
module.exports = {properties, main};
