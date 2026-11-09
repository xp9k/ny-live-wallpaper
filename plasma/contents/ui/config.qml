import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "SceneConfig.js" as Settings

ColumnLayout {
    id: config
    // Set by the Plasma wallpaper configuration dialog.
    property var configDialog
    property var wallpaperConfiguration
    property real cfg_light: Settings.defaults.light
    property real cfg_snow: Settings.defaults.snow
    property real cfg_tv: Settings.defaults.tv
    property real cfg_twinkle: Settings.defaults.twinkle
    property string cfg_quality: Settings.defaults.quality
    property real cfg_fps: Settings.defaults.fps
    property bool cfg_paused: false
    property bool cfg_autoPause: true
    property string cfg_timeMode: Settings.defaults.timeMode
    property real cfg_hour: Settings.defaults.hour

    GridLayout {
        columns: 3
        Label { text: "Время суток" }
        ComboBox {
            Layout.columnSpan: 2
            Layout.minimumWidth: timeMetrics.width + 70
            TextMetrics { id: timeMetrics; text: "По часам компьютера" }
            textRole: "text"
            valueRole: "value"
            model: [
                { text: "По часам компьютера", value: "auto" },
                { text: "Вручную", value: "manual" }
            ]
            currentIndex: config.cfg_timeMode === "manual" ? 1 : 0
            onActivated: config.cfg_timeMode = currentValue
        }
        Label { text: "Час" }
        Slider {
            id: hourSlider
            Layout.fillWidth: true
            enabled: config.cfg_timeMode === "manual"
            from: 0; to: 24; stepSize: 0.25
            value: config.cfg_hour
            onMoved: config.cfg_hour = value
        }
        Label {
            enabled: hourSlider.enabled
            readonly property int minutes: Math.round(hourSlider.value * 60) % 1440
            text: Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0")
            Layout.minimumWidth: hourMetrics.width
            TextMetrics { id: hourMetrics; text: "00:00" }
        }
        Label { text: "Снег за окном" }
        Slider { Layout.fillWidth: true; from: 0; to: 2; value: config.cfg_snow; onMoved: config.cfg_snow = value }
        Label { text: Math.round(config.cfg_snow * 100) + "%" }
        Label { text: "Помехи телевизора" }
        Slider { Layout.fillWidth: true; from: 0; to: 2; value: config.cfg_tv; onMoved: config.cfg_tv = value }
        Label { text: Math.round(config.cfg_tv * 100) + "%" }
        Label { text: "Мерцание гирлянды" }
        Slider { Layout.fillWidth: true; from: 0; to: 1; value: config.cfg_twinkle; onMoved: config.cfg_twinkle = value }
        Label { text: Math.round(config.cfg_twinkle * 100) + "%" }
        Label { text: "Яркость" }
        Slider { Layout.fillWidth: true; from: 0.5; to: 1.5; value: config.cfg_light; onMoved: config.cfg_light = value }
        Label { text: Math.round(config.cfg_light * 100) + "%" }
        Label { text: "Качество" }
        ComboBox {
            Layout.columnSpan: 2
            model: ["eco", "high", "ultra"]
            currentIndex: Math.max(0, model.indexOf(config.cfg_quality))
            onActivated: config.cfg_quality = currentText
        }
        Label { text: "Частота кадров" }
        SpinBox { Layout.columnSpan: 2; from: 15; to: 60; value: config.cfg_fps; onValueModified: config.cfg_fps = value }
        Label { text: "Пауза" }
        CheckBox { Layout.columnSpan: 2; checked: config.cfg_paused; onToggled: config.cfg_paused = checked }
        Label { text: "Автопауза" }
        CheckBox {
            Layout.columnSpan: 2
            text: "Когда экран закрыт развёрнутым окном"
            checked: config.cfg_autoPause
            onToggled: config.cfg_autoPause = checked
        }
    }
    Item { Layout.fillHeight: true }
}
