'use strict';
// MOS 12 / Plasma 5.27 / Qt 5.15 variant of the Plasma 6 package: versioned
// imports, the Plasma 5 wallpaper root and GLSL source strings instead of .qsb.
const fs = require('node:fs');
const path = require('node:path');

function preparePlasma5(source, destination, shader) {
  fs.cpSync(source, destination, {recursive: true});
  const ui = path.join(destination, 'contents/ui');
  for (const name of ['main.qml', 'Scene.qml', 'config.qml']) {
    const file = path.join(ui, name);
    let qml = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
      .replace(/^import QtQuick$/m, 'import QtQuick 2.15')
      .replace(/^import QtQuick.Window$/m, 'import QtQuick.Window 2.15')
      .replace(/^import QtQuick.Controls$/m, 'import QtQuick.Controls 2.15')
      .replace(/^import QtQuick.Layouts$/m, 'import QtQuick.Layouts 1.15');
    if (name === 'main.qml') {
      qml = qml.replace('import org.kde.plasma.plasmoid\n', '')
        .replace('import org.kde.taskmanager as TaskManager', 'import org.kde.taskmanager 0.1 as TaskManager')
        .replace('WallpaperItem {\n    id: wallpaper', 'Item {\n    id: root')
        .replaceAll('wallpaper.covered', 'root.covered')
        .replaceAll('wallpaper.updateCovered', 'root.updateCovered')
        .replaceAll('wallpaper.Screen', 'root.Screen');
    }
    if (name === 'Scene.qml') {
      qml = qml.replace('import "SceneConfig.js" as Settings', 'import "SceneConfig.js" as Settings\nimport "ShaderSources.js" as Shaders')
        // On the MOS Qt 5 build the status stays Error even for a working
        // shader; the compilation log tells real failures apart.
        .replace('id: scene', 'id: scene\n    readonly property bool shaderFailed: /error|failed/i.test(background.log)')
        .replaceAll('background.status === ShaderEffect.Error', 'scene.shaderFailed')
        .replaceAll('background.status !== ShaderEffect.Error', '!scene.shaderFailed')
        .replaceAll('if (status === ShaderEffect.Error)', 'if (/error|failed/i.test(log))')
        .replace('"../shaders/scene.frag.qsb"', 'Shaders.scene_frag');
    }
    fs.writeFileSync(file, qml);
  }
  fs.rmSync(path.join(destination, 'contents/shaders'), {recursive: true, force: true});
  fs.writeFileSync(path.join(ui, 'ShaderSources.js'), `.pragma library\nvar scene_frag = ${JSON.stringify(shader)};\n`);
  const metadataPath = path.join(destination, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath));
  metadata['X-Plasma-API-Minimum-Version'] = '5.27';
  metadata['X-Plasma-API'] = 'declarativeappletscript';
  metadata['X-Plasma-MainScript'] = 'ui/main.qml';
  metadata.KPlugin.ServiceTypes = ['Plasma/Wallpaper'];
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}
module.exports = {preparePlasma5};
