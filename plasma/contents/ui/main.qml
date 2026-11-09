import QtQuick
import QtQuick.Window
import org.kde.plasma.plasmoid
import org.kde.taskmanager as TaskManager

WallpaperItem {
    id: wallpaper

    // True while a maximized or fullscreen window covers this screen on the
    // current virtual desktop and activity. The scene then stops redrawing,
    // so neither Plasma nor screen capture has new frames to process.
    property bool covered: false

    function updateCovered() {
        for (let i = 0; i < coverage.count; ++i) {
            const window = coverage.objectAt(i);
            if (window && window.covers) {
                covered = true;
                return;
            }
        }
        covered = false;
    }

    TaskManager.VirtualDesktopInfo { id: desktopInfo }
    TaskManager.ActivityInfo { id: activityInfo }

    TaskManager.TasksModel {
        id: windows
        groupMode: TaskManager.TasksModel.GroupDisabled
        screenGeometry: Qt.rect(wallpaper.Screen.virtualX, wallpaper.Screen.virtualY,
            wallpaper.Screen.width, wallpaper.Screen.height)
        virtualDesktop: desktopInfo.currentDesktop
        activity: activityInfo.currentActivity
        filterByScreen: true
        filterByVirtualDesktop: true
        filterByActivity: true
        filterMinimized: true
        filterHidden: true
    }

    Instantiator {
        id: coverage
        model: wallpaper.configuration.autoPause ? windows : null
        delegate: QtObject {
            readonly property bool covers: model.IsMaximized === true || model.IsFullScreen === true
            onCoversChanged: Qt.callLater(wallpaper.updateCovered)
        }
        onObjectAdded: Qt.callLater(wallpaper.updateCovered)
        onObjectRemoved: Qt.callLater(wallpaper.updateCovered)
    }

    Scene {
        anchors.fill: parent
        light: wallpaper.configuration.light
        snow: wallpaper.configuration.snow
        tv: wallpaper.configuration.tv
        twinkle: wallpaper.configuration.twinkle
        quality: wallpaper.configuration.quality
        fps: wallpaper.configuration.fps
        timeMode: wallpaper.configuration.timeMode
        hour: wallpaper.configuration.hour
        paused: wallpaper.configuration.paused || (wallpaper.configuration.autoPause && wallpaper.covered)
    }
}
