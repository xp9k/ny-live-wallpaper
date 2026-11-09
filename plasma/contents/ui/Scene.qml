import QtQuick
import QtQuick.Window
import "SceneConfig.js" as Settings

Item {
    id: scene
    clip: true
    property real light: Settings.defaults.light
    property real snow: Settings.defaults.snow
    property real tv: Settings.defaults.tv
    property real twinkle: Settings.defaults.twinkle
    property string quality: Settings.defaults.quality
    property real fps: Settings.defaults.fps
    property bool paused: false
    property string timeMode: Settings.defaults.timeMode
    property real hour: Settings.defaults.hour
    property real sceneTime: Settings.defaults.time
    // Bumped by the wall clock so the minute hand and daylight follow the time while paused.
    property int clockTick: 0

    function timeOfDay() {
        clockTick;
        // The wall calendar always shows the real date.
        const now = new Date();
        if (timeMode === "manual") {
            const minutes = Math.round(Math.max(0, Math.min(24, hour)) * 60) % 1440;
            return { hour: minutes / 60, clock: { h: Math.floor(minutes / 60), m: minutes % 60,
                y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() } };
        }
        const m = now.getMinutes() + now.getSeconds() / 60;
        return { hour: now.getHours() + m / 60, clock: { h: now.getHours(), m: m,
            y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() } };
    }
    readonly property var values: {
        const t = timeOfDay();
        return Settings.sceneState(t.hour, sceneTime, t.clock,
            { light: light, snow: snow, tv: tv, twinkle: twinkle });
    }

    readonly property real aspect: 2752 / 1536
    readonly property real cropX: Math.min(1, width / Math.max(1, height) / aspect)
    readonly property real cropY: Math.min(1, aspect / (width / Math.max(1, height)))
    readonly property bool texturesReady: plate.status === Image.Ready && dayPlate.status === Image.Ready
        && masks.status === Image.Ready && masks2.status === Image.Ready && glow.status === Image.Ready
        && off.status === Image.Ready && shade.status === Image.Ready && glyphAtlas.status === Image.Ready
    readonly property bool hardware: GraphicsInfo.api !== GraphicsInfo.Software
    readonly property real renderScale: Math.min(1, Math.sqrt(
        (Settings.pixelLimits[quality] || Settings.pixelLimits.high)
        / Math.max(1, width * height * Screen.devicePixelRatio * Screen.devicePixelRatio)))

    Timer {
        id: frames
        property double previous: 0
        interval: Math.max(1, Math.round(1000 / Math.max(15, Math.min(scene.quality === "eco" ? 25 : 60, scene.fps))))
        repeat: true
        running: scene.visible && !scene.paused && scene.texturesReady && scene.hardware
        onRunningChanged: previous = 0
        onTriggered: {
            const now = Date.now();
            if (previous) scene.sceneTime += Math.min((now - previous) / 1000, 0.1);
            previous = now;
        }
    }

    // Wall clock: the hands and the daylight follow the time while paused as well.
    Timer {
        interval: 20000
        repeat: true
        running: scene.timeMode !== "manual"
        onTriggered: scene.clockTick++
    }

    Image { id: plate; source: "../images/plate.jpg"; visible: false }
    Image { id: dayPlate; source: "../images/day.jpg"; visible: false }
    Image { id: masks; source: "../images/masks.png"; visible: false }
    Image { id: masks2; source: "../images/masks2.png"; visible: false }
    Image { id: glow; source: "../images/glow.png"; visible: false }
    Image { id: off; source: "../images/off.jpg"; visible: false }
    Image { id: shade; source: "../images/shade.png"; visible: false }
    // Not named "font": that is a QML value type name.
    Image { id: glyphAtlas; source: "../images/glyphs.png"; visible: false }

    Rectangle { anchors.fill: parent; color: "#1a140e" }
    // Still picture for the software renderer or before the textures are ready.
    Image {
        source: scene.values.uDay > 0.5 ? dayPlate.source : plate.source
        width: Math.max(scene.width, scene.height * scene.aspect)
        height: width / scene.aspect
        x: (scene.width - width) * 0.5
        y: (scene.height - height) * 0.5
        visible: !scene.hardware || background.status === ShaderEffect.Error || !scene.texturesReady
    }

    Item {
        id: render
        objectName: "render"
        anchors.fill: parent
        visible: scene.hardware && scene.texturesReady && background.status !== ShaderEffect.Error
        layer.enabled: true
        layer.smooth: true
        layer.textureSize: Qt.size(Math.max(1, Math.round(width * Screen.devicePixelRatio * scene.renderScale)),
            Math.max(1, Math.round(height * Screen.devicePixelRatio * scene.renderScale)))

        ShaderEffect {
            id: background
            objectName: "background"
            anchors.fill: parent
            blending: false
            property var uPlate: plate
            property var uMasks: masks
            property var uMasks2: masks2
            property var uDayPlate: dayPlate
            property var uGlow: glow
            property var uOff: off
            property var uShade: shade
            property var uGlyphs: glyphAtlas
            property vector2d uCover: Qt.vector2d(scene.cropX, scene.cropY)
            property vector2d uOffset: Qt.vector2d((1 - scene.cropX) * 0.5, (1 - scene.cropY) * 0.5)
            property vector2d uResolution: Qt.vector2d(width * Screen.devicePixelRatio * scene.renderScale,
                height * Screen.devicePixelRatio * scene.renderScale)
            // @SCENE_UNIFORMS@ (generated by build/build.cjs from src/scene.js)
            fragmentShader: "../shaders/scene.frag.qsb"
            onStatusChanged: if (status === ShaderEffect.Error) console.warn("New Year scene:", log)
        }
    }
}
