"""Render the packaged Scene.qml in a real Qt Quick and check it.

    python build/verify-qt.py qt6 .cache/release/native/org.ny.livewallpaper OUT
    python build/verify-qt.py qt5 .cache/release/mos12/org.ny.livewallpaper OUT
    python3 verify-qt.py pyqt6 /usr/share/plasma/wallpapers/org.ny.livewallpaper OUT   (on MOS 13)

Qt 6 uses PySide6 (the compiled .qsb), Qt 5 uses PyQt5 (GLSL sources). The
Plasma shell (main.qml) needs a desktop session; this loads the scene itself.
"""
import json
import sys
from pathlib import Path

binding, plugin, output = sys.argv[1], Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve()
if binding == 'pyqt6':
    from PyQt6.QtCore import QUrl, Qt, qInstallMessageHandler
    from PyQt6.QtGui import QGuiApplication, QImage
    from PyQt6.QtQuick import QQuickView
    from PyQt6.QtTest import QTest
elif binding == 'qt6':
    from PySide6.QtCore import QUrl, Qt, qInstallMessageHandler
    from PySide6.QtGui import QGuiApplication, QImage
    from PySide6.QtQuick import QQuickView
    from PySide6.QtTest import QTest
else:
    from PyQt5.QtCore import QUrl, Qt, qInstallMessageHandler
    from PyQt5.QtGui import QGuiApplication, QImage
    from PyQt5.QtQuick import QQuickView
    from PyQt5.QtTest import QTest


def main():
    output.mkdir(parents=True, exist_ok=True)
    messages = []
    qInstallMessageHandler(lambda kind, context, message: (messages.append(message), print(message, file=sys.stderr)))
    app = QGuiApplication(sys.argv)
    view = QQuickView()
    view.setResizeMode(QQuickView.ResizeMode.SizeRootObjectToView)
    view.setSource(QUrl.fromLocalFile(str(plugin / 'contents/ui/Scene.qml')))
    assert view.status() == QQuickView.Status.Ready, [e.toString() for e in view.errors()]
    view.resize(960, 540)
    view.show()
    scene = view.rootObject()
    for key, value in dict(timeMode='manual', hour=2.0, paused=True, quality='high', fps=30.0).items():
        scene.setProperty(key, value)
    QTest.qWait(2500)
    assert scene.property('texturesReady'), 'textures not loaded'

    def frame(name, hour):
        scene.setProperty('hour', hour)
        QTest.qWait(500)
        image = view.grabWindow().convertToFormat(QImage.Format.Format_RGBA8888 if binding in ('qt6', 'pyqt6') else QImage.Format_RGBA8888)
        image.save(str(output / f'{name}.png'))
        width, height = image.width(), image.height()
        total = 0
        for y in range(0, height, 6):
            for x in range(0, width, 6):
                c = image.pixelColor(x, y)
                total += c.red() + c.green() + c.blue()
        return total / ((width // 6 + 1) * (height // 6 + 1) * 765)

    night, day, evening = frame('night', 2.0), frame('day', 13.0), frame('evening', 19.0)
    # The wall calendar's year is drawn by the shader from the glyph atlas: its
    # digits must be dark against the paper (both are lit the same way).
    image = view.grabWindow()
    sx, sy = image.width() / 2752 * (16 / 9) / (image.width() / image.height()), image.height() / 1536
    def lum(x, y):
        c = image.pixelColor(int((x - 1376) * sy + image.width() / 2), int(y * sy))
        return c.red() * .2126 + c.green() * .7152 + c.blue() * .0722
    year = [lum(x, y) for y in range(584, 598) for x in range(1586, 1630)]
    paper = sorted(year)[len(year) * 3 // 4]
    assert min(year) < paper * .6, ('calendar year not drawn', min(year), paper)
    assert scene.property('hardware'), 'software renderer: animation is not tested'
    assert night < evening * .85 and day > night * 1.3, (night, evening, day)
    scene.setProperty('paused', False)
    QTest.qWait(300)
    before = scene.property('sceneTime')
    QTest.qWait(700)
    assert scene.property('sceneTime') > before, 'animation time must advance'
    scene.setProperty('paused', True)
    errors = [m for m in messages if any(w in m.lower() for w in ('error', 'failed', 'is not defined', 'cannot assign'))]
    assert not errors, errors
    result = dict(binding=binding, night=round(night, 3), evening=round(evening, 3), day=round(day, 3), passed=True)
    (output / 'results.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
    view.close()


if __name__ == '__main__':
    main()
