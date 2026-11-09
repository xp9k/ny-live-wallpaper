"""Screenshot of the wallpaper settings page for the README: python build/settings.py

Renders the real plasma/contents/ui/config.qml with Qt Quick Controls (PySide6,
Fusion style in Breeze Dark colours). The surrounding Plasma dialog is not
part of the picture. Writes docs/settings.png.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QColor, QGuiApplication, QPalette
from PySide6.QtQuick import QQuickView
from PySide6.QtQuickControls2 import QQuickStyle
from PySide6.QtTest import QTest

ROOT = Path(__file__).resolve().parent.parent


def main():
    work = Path(tempfile.mkdtemp(prefix='ny-settings-'))
    config = (ROOT / 'plasma/contents/ui/config.qml').read_text(encoding='utf8')
    (work / 'config.qml').write_text(config, encoding='utf8')
    library = subprocess.run(['node', '-e', "process.stdout.write(require('./build/build.cjs').sceneConfig())"],
                             cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf8').stdout
    (work / 'SceneConfig.js').write_text(library, encoding='utf8')
    # Page wrapper: title and margins as on the Plasma wallpaper page.
    (work / 'Page.qml').write_text('''import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
Rectangle {
    color: "#2a2e32"
    width: 720; height: 330
    palette.window: "#2a2e32"; palette.windowText: "#fcfcfc"; palette.base: "#1b1e20"
    palette.text: "#fcfcfc"; palette.button: "#31363b"; palette.buttonText: "#fcfcfc"
    palette.highlight: "#3daee9"; palette.highlightedText: "#fcfcfc"; palette.light: "#40464c"
    palette.mid: "#4d5257"; palette.dark: "#1b1e20"; palette.midlight: "#3a3f44"; palette.shadow: "#101214"
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 18; spacing: 14
        Label { text: "New Year Live Wallpaper"; font.pixelSize: 20 }
        Loader { id: page; source: "config.qml"; Layout.fillWidth: true; Layout.fillHeight: true }
    }
}
''', encoding='utf8')
    QQuickStyle.setStyle('Fusion')
    app = QGuiApplication(sys.argv)
    palette = QPalette()
    colors = {QPalette.Window: '#2a2e32', QPalette.WindowText: '#fcfcfc', QPalette.Base: '#1b1e20',
              QPalette.AlternateBase: '#232629', QPalette.Text: '#fcfcfc', QPalette.Button: '#31363b',
              QPalette.ButtonText: '#fcfcfc', QPalette.Highlight: '#3daee9', QPalette.HighlightedText: '#fcfcfc',
              QPalette.Mid: '#4d5257', QPalette.Dark: '#1b1e20', QPalette.Light: '#40464c'}
    for role, value in colors.items():
        palette.setColor(role, QColor(value))
    palette.setColor(QPalette.Disabled, QPalette.WindowText, QColor('#727679'))
    palette.setColor(QPalette.Disabled, QPalette.Text, QColor('#727679'))
    app.setPalette(palette)
    view = QQuickView()
    view.setResizeMode(QQuickView.SizeRootObjectToView)
    view.setColor(QColor('#2a2e32'))
    view.setSource(QUrl.fromLocalFile(str(work / 'Page.qml')))
    assert view.status() == QQuickView.Ready, [e.toString() for e in view.errors()]
    view.resize(720, 330)
    view.show()
    view.rootObject().forceActiveFocus()  # no keyboard focus frame in the picture
    QTest.qWait(800)
    image = view.grabWindow()
    out = ROOT / 'docs/settings.png'
    image.save(str(out))
    print(out, image.width(), image.height())


if __name__ == '__main__':
    main()
