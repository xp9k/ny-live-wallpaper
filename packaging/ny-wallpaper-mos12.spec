%global wallpaper_id org.ny.livewallpaper

Name:           ny-wallpaper
Version:        1.0.0
Release:        1%{?dist}
Summary:        New Year Live Wallpaper: animated wallpaper for KDE Plasma 5
Summary(ru):    New Year Live Wallpaper: живые обои для KDE Plasma 5
License:        MIT
URL:            https://github.com/xp9k/ny-live-wallpaper
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch
Requires:       plasma5-workspace >= 5.27
Requires:       qt5-qtdeclarative >= 5.15
Requires:       qml(org.kde.taskmanager)
Requires:       lib64qt5-qtquick-qml >= 5.15
Requires:       lib64qt5-qtquickcontrols2-qml >= 5.15
AutoReqProv:    no

%description
A New Year room whose light follows the time of day: daylight from the
window by day, the ceiling light in the evening, and at night only the tree,
the floor lamp, the TV and the candle glow. Snow falls outside the window, the
old TV shows antenna interference, the mantel clock shows the current time and
the wall calendar the current date.

The scene is rendered inside Plasma by Qt Quick and OpenGL. Settings are
available in the desktop wallpaper settings. The animation pauses while a
maximized or fullscreen window covers the screen.

%description -l ru
Новогодняя комната, свет в которой меняется по времени суток: днём дневной
свет из окна, вечером люстра, ночью горят только ёлка, торшер, телевизор и
свеча. За окном идёт снег, у старого телевизора помехи, часы на серванте
показывают текущее время, настенный календарь - текущую дату.

Сцена отрисовывается внутри Plasma средствами Qt Quick и OpenGL. Настройки
доступны в параметрах рабочего стола. Анимация останавливается, пока экран
закрыт развёрнутым или полноэкранным окном.

%prep
%setup -q

%install
install -d %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}
cp -a %{wallpaper_id}/. %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/
find %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id} -type d -exec chmod 0755 {} +
find %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id} -type f -exec chmod 0644 {} +

%check
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/metadata.json
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/contents/ui/ShaderSources.js

%files
%license LICENSE
%doc README.mos12.md settings.png
%{_datadir}/plasma/wallpapers/%{wallpaper_id}/

%changelog
* Mon Nov 09 2026 xp9k (https://github.com/xp9k) - 1.0.0-1
- Первый выпуск для MOS 12 / KDE Plasma 5.
