/* New Year Live Wallpaper - WebGL 1 renderer for browsers and Lively Wallpaper. */
(() => {
  'use strict';
  const canvas = document.getElementById('scene');
  const still = document.getElementById('still');
  const params = new URLSearchParams(location.search);
  const {defaults, ranges, pixelLimits, uniforms, samplers, sceneState, webglShaders} = window.NYScene;
  const numberParam = (name, fallback, [lo, hi]) => {
    const value = params.get(name);
    return value !== null && Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Number(value))) : fallback;
  };
  const settings = {
    light: numberParam('light', defaults.light, ranges.light),
    snow: numberParam('snow', defaults.snow, ranges.snow),
    tv: numberParam('tv', defaults.tv, ranges.tv),
    twinkle: numberParam('twinkle', defaults.twinkle, ranges.twinkle),
    fps: numberParam('fps', defaults.fps, ranges.fps),
    quality: ['eco', 'high', 'ultra'].includes(params.get('quality')) ? params.get('quality') : defaults.quality,
    // An explicit ?hour= selects manual time of day; otherwise follow the clock.
    timeMode: params.has('hour') ? 'manual' : defaults.timeMode,
    hour: numberParam('hour', defaults.hour, ranges.hour)
  };
  // Preview only: ?timelapse=60 runs a full day in 60 seconds.
  const timelapse = numberParam('timelapse', 0, [0, 86400]);
  if (timelapse) settings.timeMode = 'manual';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = params.get('paused') === '1', hostPaused = false;
  let time = numberParam('time', defaults.time, [0, 1e6]);
  let gl, program, buffer, locations = {}, ready = false, lost = false, raf = 0, previous = 0;
  let frames = 0, statStart = 0, statFrames = 0, measuredFps = 0;
  const images = {};

  const running = () => ready && !lost && !userPaused && !hostPaused && !document.hidden && !reduced.matches;
  // Preview only: ?date=2028-02-29 shows that day on the wall calendar.
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;
  const calendarDate = () => dateParam ? new Date(dateParam + 'T12:00:00') : new Date();
  function timeOfDay() {
    const today = calendarDate();
    const date = {y: today.getFullYear(), mo: today.getMonth(), d: today.getDate()};
    if (settings.timeMode === 'manual') {
      const minutes = Math.round(settings.hour * 60) % 1440;
      return {hour: settings.hour % 24, clock: {h: Math.floor(minutes / 60), m: minutes % 60, ...date}};
    }
    const now = new Date();
    const m = now.getMinutes() + now.getSeconds() / 60;
    return {hour: now.getHours() + m / 60, clock: {h: now.getHours(), m, ...date}};
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log);
    }
    return shader;
  }
  function texture(image, unit) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function initialize() {
    const {vertex, fragment} = webglShaders();
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const [, name] of uniforms) locations[name] = gl.getUniformLocation(program, name);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    samplers.forEach((name, unit) => {
      texture(images[name], unit);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    });
    ready = true; lost = false;
    resize();
    document.documentElement.classList.add('ready');
    schedule();
  }
  function resize() {
    if (!ready || lost) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = innerWidth * innerHeight * dpr * dpr;
    const scale = dpr * Math.min(1, Math.sqrt(pixelLimits[settings.quality] / pixels));
    const w = Math.max(1, Math.round(innerWidth * scale)), h = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    draw();
  }
  function cover() {
    const imageAspect = 2752 / 1536, screenAspect = canvas.width / canvas.height;
    const cx = Math.min(1, screenAspect / imageAspect), cy = Math.min(1, imageAspect / screenAspect);
    return {scale: [cx, cy], offset: [(1 - cx) * .5, (1 - cy) * .5]};
  }
  function draw() {
    if (!ready || lost) return;
    const {hour, clock} = timeOfDay();
    const state = sceneState(hour, time, clock, settings);
    const crop = cover();
    state.uCover = crop.scale; state.uOffset = crop.offset; state.uResolution = [canvas.width, canvas.height];
    for (const [type, name] of uniforms) {
      if (type === 'float') gl.uniform1f(locations[name], state[name]);
      else gl.uniform2fv(locations[name], state[name]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frames++;
  }
  function tick(now) {
    raf = 0;
    if (!running()) { previous = 0; return; }
    if (!previous) previous = now;
    const elapsed = now - previous;
    const cap = settings.quality === 'eco' ? Math.min(25, settings.fps) : settings.fps;
    if (elapsed >= 1000 / cap - .6) {
      const step = Math.min(elapsed / 1000, .1);
      time += step; previous = now;
      if (timelapse) settings.hour = (settings.hour + step * 24 / timelapse) % 24;
      draw();
      statFrames++;
      if (!statStart) statStart = now;
      if (now - statStart > 3000) { measuredFps = statFrames * 1000 / (now - statStart); statFrames = 0; statStart = now; }
    }
    raf = requestAnimationFrame(tick);
  }
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; previous = 0; statStart = 0; statFrames = 0;
    if (running()) raf = requestAnimationFrame(tick); else draw();
  }
  function configure(values) {
    for (const key of Object.keys(ranges)) {
      if (values[key] !== undefined && values[key] !== null && Number.isFinite(Number(values[key]))) {
        settings[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], Number(values[key])));
      }
    }
    if (['auto', 'manual'].includes(values.timeMode)) settings.timeMode = values.timeMode;
    if (['eco', 'high', 'ultra'].includes(values.quality)) settings.quality = values.quality;
    resize(); schedule();
  }
  function setPaused(value) { userPaused = Boolean(value); schedule(); }

  window.nyWallpaper = Object.freeze({
    pause: setPaused, configure,
    seek(seconds) { if (Number.isFinite(seconds)) { time = Math.max(0, seconds); draw(); } },
    getStats() {
      return {ready, lost, paused: !running(), time, frames, fps: Math.round(measuredFps),
        resolution: [canvas.width, canvas.height], settings: {...settings}, ...timeOfDay()};
    }
  });
  // Lively: sliders send integers (percent, minutes), dropdowns send indices.
  window.livelyPropertyListener = (name, value) => {
    if (name === 'paused') { setPaused(value === true); return; }
    const choices = {quality: ['eco', 'high', 'ultra'], timeMode: ['auto', 'manual']};
    if (Object.hasOwn(choices, name)) {
      if (Number.isInteger(value) && choices[name][value] !== undefined) configure({[name]: choices[name][value]});
      return;
    }
    if (!Object.hasOwn(ranges, name) || typeof value !== 'number' || !Number.isFinite(value)) return;
    const divisor = name === 'hour' ? 60 : name === 'fps' ? 1 : 100;
    configure({[name]: value / divisor});
  };
  window.wallpaperPropertyListener = {setPaused(value) { hostPaused = Boolean(value); schedule(); }};

  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', schedule);
  window.addEventListener('resize', resize, {passive: true});
  window.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); setPaused(!userPaused); }
    if (event.code === 'KeyF') {
      event.preventDefault();
      (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    }
  });
  // While paused, the frame still follows the clock (minute hand, daylight).
  setInterval(() => { if (!running() && !document.hidden) draw(); }, 20000);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost = true; ready = false; cancelAnimationFrame(raf); raf = 0;
    document.documentElement.classList.remove('ready');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { initialize(); } catch (error) { console.error('WebGL restore:', error); }
  });

  const load = src => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
  const assets = window.NY_ASSETS;
  still.src = assets.plate;
  Promise.all([assets.plate, assets.masks, assets.masks2, assets.day, assets.glow, assets.off, assets.shade, assets.glyphs].map(load)).then(list => {
    [images.uPlate, images.uMasks, images.uMasks2, images.uDayPlate, images.uGlow, images.uOff, images.uShade, images.uGlyphs] = list;
    if (params.get('static') === '1') return;
    gl = canvas.getContext('webgl', {alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: params.get('capture') === '1', powerPreference: 'low-power'});
    if (!gl) return; // the still image stays visible
    initialize();
  }).catch(error => console.error('Wallpaper initialization:', error));
})();
