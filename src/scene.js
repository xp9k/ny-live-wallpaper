/* New Year Live Wallpaper - shared scene: settings, time-of-day state and shader source.
   The fragment shader body is written once and wrapped for WebGL 1 here, and
   later for Qt 6 (qsb) and Qt 5 (GLSL ES 2) by the package build.
   Image coordinates: pixels of the 2752x1536 artwork, top-left origin. */
(function(root) {
'use strict';
const defaults = Object.freeze({light:1, snow:1, tv:1, twinkle:1, quality:'high', fps:30,
  timeMode:'auto', hour:19, time:0});
const ranges = Object.freeze({light:[.5,1.5], snow:[0,2], tv:[0,2], twinkle:[0,1], fps:[15,60], hour:[0,24]});
const pixelLimits = Object.freeze({eco:1440000, high:4200000, ultra:8294400});

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// Smooth value noise in time, 0..1.
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
// Winter (31 December) sun at 55.75 N, local solar noon at 12:30.
function sunElevation(hour) {
  const rad = Math.PI / 180, lat = 55.75 * rad, decl = -23.05 * rad;
  const angle = (hour - 12.5) * 15 * rad;
  return Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(angle)) / rad;
}
// Everything that depends on the clock and animation time, as shader uniforms.
// hour: 0..24 local time of day (lighting), clock: {h, m} shown on the mantel clock.
function sceneState(hour, time, clock, settings) {
  const elevation = sunElevation(hour);
  const day = smoothstep(-5, 6, elevation);
  const view = smoothstep(-6.5, 3, elevation);
  const deep = smoothstep(-9, -17, elevation);
  const warm = Math.exp(-Math.pow((elevation + 1.5) / 3.2, 2));
  // Residents are awake 6:45-23:30. The ceiling light is on while awake and dark;
  // the floor lamp burns whenever it is dark, the tree and the TV always.
  const wake = smoothstep(6.6, 6.75, hour) * (1 - smoothstep(23.4, 23.55, hour));
  const dark = 1 - smoothstep(.25, .75, day);
  // Old antenna reception: a calm picture with drifting snow, occasional
  // line tearing and a short loss of signal roughly every half minute.
  const tvAmount = settings.tv;
  const slot = Math.floor(time / 31);
  const burstAt = slot * 31 + 4 + hash1(slot) * 20, burstLength = 1.2 + hash1(slot + 9) * 2.2;
  const burst = smoothstep(burstAt, burstAt + .15, time) * (1 - smoothstep(burstAt + burstLength, burstAt + burstLength + .3, time));
  const tear = Math.pow(noise1(time * .7), 6) * 2.5 + burst;
  const rollSlot = Math.floor(time / 47), rollAt = rollSlot * 47 + 10 + hash1(rollSlot + 3) * 25;
  const roll = time > rollAt && time < rollAt + 2.4 ? smoothstep(rollAt, rollAt + 2.4, time) : 0;
  const level = .92 + .06 * noise1(time * 3.1) + .05 * burst * tvAmount;
  return {
    uDay: day, uView: view, uDeep: deep, uWarm: warm,
    // The garland, the star and the candle on the sill burn only while it is dark.
    uFill: wake * dark, uLamp: dark, uTree: dark, uCandle: dark, uTV: 1,
    uTVLevel: level, uTVBurst: Math.min(1, burst * tvAmount), uTVTear: Math.min(1.5, tear * tvAmount),
    uTVRoll: roll * Math.min(1, tvAmount), uTVNoise: tvAmount, uFrame: Math.floor(time * 25) % 997,
    uClockH: ((clock.h % 12) + clock.m / 60) / 12, uClockM: clock.m / 60,
    // Wall calendar: the real date (year, weekday of 1 January from Monday, leap year).
    uCalYear: clock.y, uCalJan1: (new Date(clock.y, 0, 1).getDay() + 6) % 7,
    uCalLeap: clock.y % 4 === 0 && (clock.y % 100 !== 0 || clock.y % 400 === 0) ? 1 : 0,
    uCalMonth: clock.mo, uCalDay: clock.d,
    uSnow: settings.snow, uTwinkle: settings.twinkle, uLight: settings.light, uTime: time
  };
}

// Uniforms besides samplers. Types map to QML: float -> real, vec2 -> vector2d.
const uniforms = [
  ['vec2','uCover'],['vec2','uOffset'],['vec2','uResolution'],
  ['float','uTime'],['float','uLight'],['float','uDay'],['float','uView'],['float','uDeep'],['float','uWarm'],
  ['float','uFill'],['float','uLamp'],['float','uTree'],['float','uCandle'],['float','uTV'],
  ['float','uTVLevel'],['float','uTVBurst'],['float','uTVTear'],['float','uTVRoll'],['float','uTVNoise'],['float','uFrame'],
  ['float','uClockH'],['float','uClockM'],['float','uSnow'],['float','uTwinkle'],
  ['float','uCalYear'],['float','uCalJan1'],['float','uCalLeap'],['float','uCalMonth'],['float','uCalDay']
];
const samplers = ['uPlate','uMasks','uMasks2','uDayPlate','uGlow','uOff','uShade','uGlyphs'];

// Shared GLSL ES 1.00 compatible body. TEX(s, uv) samples; FRAG is the output.
const body = `
const vec2 IMG = vec2(2752., 1536.);
const vec4 OFFBOX = vec4(0., 90., 1072., 1262.);
// Mantel clock dial: inverse of its homography (dial plane parallel to the right
// wall, horizontals toward the wall's vanishing point). Unit circle = bezel edge,
// hour marks between r = .70 and .87, 12 o'clock at (0, -1).
const vec3 DIAL0 = vec3(.548951356, 0., -1173.10427739);
const vec3 DIAL1 = vec3(.089534085, .410111507, -319.207878593);
const vec3 DIAL2 = vec3(.006896552, 0., 1.);
const vec2 TV_C = vec2(1579.5, 911.);
const vec2 TV_H = vec2(102., 84.);

// Sine-free hash (Hoskins): no diagonal patterns at large coordinates.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.)), vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(max(c, vec3(0.)), vec3(1. / 2.2)); }
// Soft light falloff: inverse square with a finite core, radius r in pixels.
float glow(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return 1. / (1. + dot(d, d)); }
float gauss(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }

// Light fields of the individual sources across the room.
float treeField(vec2 p) {
  return .55 * glow(p, vec2(445., 420.), vec2(230., 260.)) + .75 * glow(p, vec2(420., 830.), vec2(330., 300.))
    + .45 * gauss(p, vec2(380., 1330.), vec2(520., 230.));
}
float lampField(vec2 p) {
  float up = gauss(p, vec2(1795., 470.), vec2(170., 260.)) * smoothstep(640., 520., p.y);
  return .9 * glow(p, vec2(1792., 670.), vec2(160., 140.)) + .5 * up
    + .35 * gauss(p, vec2(1760., 1160.), vec2(380., 170.)) + .18 * glow(p, vec2(1900., 700.), vec2(500., 420.))
    + .55 * gauss(p, vec2(1700., 60.), vec2(560., 190.))
    // Wall strip between the lamp and the sideboard, and the sideboard's side.
    + .75 * gauss(p, vec2(1835., 930.), vec2(70., 300.)) + .35 * gauss(p, vec2(1830., 380.), vec2(90., 230.));
}
float tvField(vec2 p) {
  return .7 * glow(p, vec2(1580., 900.), vec2(150., 120.)) + .35 * gauss(p, vec2(1600., 1170.), vec2(320., 120.));
}
float windowField(vec2 p) {
  return .55 + .9 * glow(p, vec2(1015., 600.), vec2(330., 380.))
    + .55 * gauss(p, vec2(1080., 1300.), vec2(700., 260.)) + .14 * gauss(p, vec2(1050., 90.), vec2(800., 200.))
    - .18 * smoothstep(1700., 2700., p.x);
}
float candleField(vec2 p) {
  return .7 * glow(p, vec2(1028., 806.), vec2(30., 42.)) + .45 * glow(p, vec2(929., 845.), vec2(28., 36.))
    + .25 * glow(p, vec2(911., 879.), vec2(20., 20.));
}
float fillField(vec2 p) {
  vec2 d = (p - vec2(1300., 650.)) / vec2(1700., 1100.);
  return 1. - .35 * dot(d, d);
}

float segment(vec2 p, vec2 a, vec2 b, out float along) {
  vec2 pa = p - a, ba = b - a;
  along = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * along);
}
// Coverage of a tapered clock hand. Unit space of the clock face.
// Wall calendar sheet: inverse homography image -> sheet (unit square).
const vec3 CAL0 = vec3(.0037427983, 0., -5.6665965766);
const vec3 CAL1 = vec3(-.000220783, .001955507, -.3501619075);
const vec3 CAL2 = vec3(-.0001787291, 0., 1.);
// Glyph atlas (512 x 256 units, stored at 2x): large digits and weekday letters (24 x 32 cells) for the
// year; small prefiltered copies (6 x 8 cells, row y = 224) and month names
// (64 x 8, rows y = 232 and 240) for the tiny print of the grid.
float glyph(float index, vec2 l) {
  if (l.x < 0. || l.x > 1. || l.y < 0. || l.y > 1.) return 0.;
  return TEX(uGlyphs, (vec2(index * 24., 0.) + l * vec2(24., 32.)) / vec2(512., 256.)).r;
}
float smallGlyph(float index, vec2 l) {
  if (l.x < 0. || l.x > 1. || l.y < 0. || l.y > 1.) return 0.;
  return TEX(uGlyphs, (vec2(index * 6., 224.) + l * vec2(6., 8.)) / vec2(512., 256.)).r;
}
float monthName(float m, vec2 l) {
  if (l.x < 0. || l.x > 1. || l.y < 0. || l.y > 1.) return 0.;
  vec2 cell = vec2(mod(m, 8.) * 64., 232. + floor(m / 8.) * 8.);
  return TEX(uGlyphs, (cell + l * vec2(64., 8.)) / vec2(512., 256.)).r;
}
// A one or two digit number centred at c, glyph height h.
float number(float n, vec2 s, vec2 c, float h) {
  vec2 size = vec2(h * .75, h);
  float tens = floor(n / 10.), ones = n - tens * 10.;
  if (tens < .5) return smallGlyph(ones, (s - c) / size + .5);
  return max(smallGlyph(tens, (s - c + vec2(size.x * .36, 0.)) / size + .5),
             smallGlyph(ones, (s - c - vec2(size.x * .36, 0.)) / size + .5));
}
// Hand-drawn pencil ring: tilted, uneven, running on a little past its start.
float pencilRing(vec2 d, float aa) {
  float cs = cos(-.3), sn = sin(-.3);
  d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
  float a = atan(d.y, d.x);
  float r = length(d / vec2(4.3, 3.4));
  float wob = 1. + .07 * sin(2. * a + 1.3) + .05 * sin(5. * a + .4);
  float stroke = .2;
  float ring = smoothstep(stroke + aa, stroke - aa, abs(r - wob));
  float past = mod(a - 2.2, 6.2831853);
  float over = smoothstep(1.2, 0., past) * smoothstep(stroke + aa, stroke - aa, abs(r - wob * 1.14));
  return max(ring, over);
}

float hand(vec2 q, float turns, float len, float width, float aa) {
  float a = turns * 6.2831853;
  vec2 dir = vec2(sin(a), -cos(a));
  float along;
  float d = segment(q, -dir * .13, dir * len, along);
  float w = mix(width * 1.15, width * .35, along);
  return smoothstep(w + aa, w - aa, d);
}

// One layer of falling snow in pixel space.
float snowLayer(vec2 p, float cell, float radius, float speed, float drift, float density, float soft, float px, float seed) {
  vec2 q = p;
  q.y -= uTime * speed;
  q.x -= uTime * drift + sin(uTime * .37 + q.y * .006 + seed) * cell * .55;
  vec2 id = floor(q / cell);
  vec2 f = q / cell - id;
  float h = hash(id + seed);
  if (h > density) return 0.;
  vec2 c = vec2(hash(id + seed + 1.7), hash(id + seed + 5.3)) * .6 + .2;
  c.x += sin(uTime * (1.1 + h * 1.7) + h * 40.) * .14;
  float d = length((f - c) * cell);
  float r = radius * (.65 + .7 * hash(id + seed + 9.1));
  float edge = max(px * .8, r * soft);
  return smoothstep(r + edge, r - edge * .5, d) * (.55 + .45 * hash(id + seed + 3.3));
}

void main() {
  vec2 uv = vUV * uCover + uOffset;
  vec2 p = uv * IMG;
  float px = IMG.y * uCover.y / uResolution.y; // image pixels per screen pixel
  vec3 src = TEX(uPlate, uv).rgb;
  vec3 base = toLinear(src);
  // Unlit garland, star and candles come from the prepared lights-off plate.
  float treeZone = smoothstep(30., -30., abs(p.x - 440.) - max(0., p.y - 90.) * .42 - 60.)
    * smoothstep(1262., 1235., p.y) * smoothstep(90., 115., p.y);
  float candleZone = smoothstep(865., 885., p.x) * smoothstep(1072., 1052., p.x)
    * smoothstep(750., 770., p.y) * smoothstep(912., 900., p.y);
  float offMix = treeZone * (1. - uTree) + candleZone * (1. - uCandle);
  if (offMix > .001) base = mix(base, toLinear(TEX(uOff, (p - OFFBOX.xy) / (OFFBOX.zw - OFFBOX.xy)).rgb), offMix);
  // Shadows cast by the floor lamp (branches and curtain rod on the ceiling)
  // disappear while it is off.
  base *= 1. + 2. * TEX(uShade, uv).rgb * (1. - uLamp);
  float flicker = .86 + .07 * sin(uTime * 11.3) + .05 * sin(uTime * 23.7 + 1.3) + .03 * sin(uTime * 4.1);
  vec3 masks = TEX(uMasks, uv).rgb;
  vec3 m2 = TEX(uMasks2, uv).rgb;
  vec3 garland = TEX(uGlow, uv).rgb;
  garland *= garland; // stored square-root encoded

  // ---- relighting: image = albedo * reference light; swap the light ----
  float T = treeField(p), L = lampField(p) * 1.8, V = tvField(p), W = windowField(p), F = fillField(p);
  float C = candleField(p);
  vec3 candleColor = vec3(1., .68, .38);
  vec3 treeColor = vec3(1., .80, .58);
  vec3 lampColor = vec3(1., .82, .60);
  vec3 tvColor = vec3(.68, .80, 1.);
  vec3 fillColor = vec3(1., .88, .72);
  vec3 dayColor = vec3(.90, .98, 1.10);
  vec3 moonColor = vec3(.55, .66, 1.);
  // Reference: evening with the ceiling light, lamp, tree and TV on.
  vec3 reference = fillColor * F * .62 + treeColor * T * .8 + lampColor * L + tvColor * V * .35 + moonColor * W * .03
    + candleColor * C;
  float tvLight = uTV * uTVLevel * (1. + .25 * uTVBurst);
  float twinkle = 1. - uTwinkle * .08 * (.5 + .5 * sin(uTime * .9));
  vec3 now = fillColor * F * .62 * uFill + treeColor * T * .8 * uTree * twinkle + lampColor * L * uLamp
    + tvColor * V * .35 * tvLight + dayColor * W * 1.9 * uDay + moonColor * W * .03 * (1. - uDay)
    + fillColor * F * .025 + candleColor * C * uCandle * flicker;
  // Light of switched-off sources is also absent from the plate they now use.
  vec3 lit = reference - treeColor * T * .8 * (1. - uTree) * (1. - treeZone) - candleColor * C * (1. - uCandle);
  vec3 ratio = now / max(lit, vec3(.02));
  vec3 color = base * ratio;
  // Daylight white balance: the warm cast of the evening artwork fades.
  color = mix(color, vec3(lum(color)), .14 * uDay);

  // ---- the tree: garland, star and tinsel behave like real lights ----
  float night = 1. - uDay;
  float onTree = step(p.x, 812.); // masks2 carries star and tinsel left of the window
  // Coloured light spill from the bulbs onto the needles and ornaments. The
  // evening artwork already holds it under the ceiling light; without that
  // light the bulbs become the main source around them.
  vec3 albedo = base / reference;
  float cone = smoothstep(60., -20., abs(p.x - 440.) - max(0., p.y - 110.) * .34);
  float spill = mix(.22, 1., cone) * smoothstep(60., 140., p.y);
  color += albedo * garland * uTree * 1.25 * spill * (1. - .75 * uFill) * mix(1., .55, uDay);
  if (masks.r > .004 && uTree > 0.) {
    float mx = max(src.r, max(src.g, src.b)), mn = min(src.r, min(src.g, src.b));
    float hue = mx == mn ? 0. : (mx == src.r ? (src.g - src.b) / (mx - mn)
      : mx == src.g ? 2. + (src.b - src.r) / (mx - mn) : 4. + (src.r - src.g) / (mx - mn));
    float channel = floor(mod(hue + 6.5, 6.) / 1.5);
    float pulse = .5 + .5 * sin(uTime * .85 + channel * 1.5708);
    float bulb = (1. - uTwinkle * .38 * pulse * pulse) * mix(1., 1.45, night);
    vec3 emitted = base * mix(1., ratio.g, .2) * bulb * uTree;
    color = mix(color, max(color, emitted), masks.r * uTree);
  }
  float star = m2.r * onTree;
  if (star > .004 && uTree > 0.) {
    // Red glass lit from inside: brighter at the centre, deep red at the tips.
    float core = gauss(p, vec2(438., 172.), vec2(30., 30.));
    vec3 glass = base * (1.25 + .9 * night) + vec3(.55, .05, .02) * (.35 + .9 * core) * (.45 + .55 * night);
    color = mix(color, glass, star * uTree);
  }
  float tinsel = m2.g * onTree;
  if (tinsel > .004) {
    // Glitter: each tiny facet flashes when it turns toward a bulb.
    vec2 cell = floor(p / 2.5);
    float h = hash(cell);
    float flash = pow(max(0., sin(uTime * (1.3 + h * 2.4) + h * 60.)), 22.);
    vec3 tint = mix(vec3(1.), garland / max(.02, max(garland.r, max(garland.g, garland.b))), .45);
    color += base * tint * tinsel * (.35 + 3.2 * flash * uTwinkle) * mix(1.2, .6, uDay) * (.2 + .8 * uTree);
  }
  // Soft bloom of the lights in the air and the lens, stronger in the dark.
  color += garland * garland * uTree * .16 * (1. - .55 * uFill) * mix(1., .3, uDay);

  // ---- candle flames on the window sill ----
  float flame = m2.b * (1. - masks.b) * candleZone * uCandle;
  if (flame > .004) color = mix(color, base * (1.1 + .25 * night) * flicker, flame);

  // ---- lamp shade: glowing fabric, or plain fabric in daylight ----
  if (masks.g > .004) {
    float shading = .75 + .25 * smoothstep(740., 600., p.y);
    vec3 fabric = toLinear(vec3(.86, .82, .70)) * lum(now) * .55 * shading;
    vec3 shade = base * uLamp + fabric * (1. - uLamp);
    color = mix(color, shade, masks.g);
  }

  // ---- by day: the same room photographed in daylight ----
  // Lamps, garland and candles are off there; the evening path above fades out.
  vec3 dayBase = toLinear(TEX(uDayPlate, uv).rgb);
  float dayMix = smoothstep(0., 1., uDay);
  color = mix(color, dayBase, dayMix);

  // ---- wall calendar: current year, real month grid, today ringed in red pencil ----
  vec2 calq = p - vec2(1607., 540.);
  if (abs(calq.x) < 100. && abs(calq.y) < 195.) {
    vec3 hp = vec3(p, 1.);
    vec2 q = vec2(dot(CAL0, hp), dot(CAL1, hp)) / dot(CAL2, hp);
    if (q.x > .02 && q.x < .99 && q.y > .6 && q.y < .975) {
      vec2 s = q * vec2(186., 374.); // sheet units, about one image pixel
      float ink = 0., red = 0., pencil = 0.;
      if (s.y < 248.) {
        // Year as printed under the title: digits as tall as its capitals, dark ink.
        vec2 size = vec2(14.6, 19.5);
        vec2 c = vec2(92.5, 237.);
        float y = uCalYear;
        float d3 = floor(y / 1000.), d2 = mod(floor(y / 100.), 10.), d1 = mod(floor(y / 10.), 10.), d0 = mod(y, 10.);
        float pitch = size.x * .7;
        // 4 samples per pixel: the large atlas glyphs are minified about 3x here.
        for (int k = 0; k < 4; k++) {
          vec2 o = s + (vec2(mod(float(k), 2.), floor(float(k) / 2.)) - .5) * .5 * max(px, .5);
          ink += .25 * max(max(glyph(d3, (o - c + vec2(1.5 * pitch, 0.)) / size + .5), glyph(d2, (o - c + vec2(.5 * pitch, 0.)) / size + .5)),
                           max(glyph(d1, (o - c - vec2(.5 * pitch, 0.)) / size + .5), glyph(d0, (o - c - vec2(1.5 * pitch, 0.)) / size + .5)));
        }
        ink = min(1., ink * 1.45);
      } else {
        vec2 g = s - vec2(8., 250.);
        vec2 block = vec2(42.75, 37.);
        vec2 bi = floor(g / block);
        if (bi.x >= 0. && bi.x < 4. && bi.y >= 0. && bi.y < 3.) {
          float m = bi.y * 4. + bi.x;
          vec2 b = g - bi * block;
          ink = monthName(m, (b - vec2(2., 1.2)) / vec2(38.75, 5.));
          float cw = 38.75 / 7.;
          float before = m < 1.5 ? m * 31. : floor((153. * (m - 2.) + 2.) / 5.) + 59. + uCalLeap;
          float first = mod(uCalJan1 + before, 7.);
          if (abs(m - uCalMonth) < .5) {
            // Today, ringed by hand: the ring is larger than its cell.
            float idx = first + uCalDay - 1.;
            vec2 today = vec2(2. + (mod(idx, 7.) + .5) * cw, 12.3 + (floor(idx / 7.) + .5) * 4.);
            pencil = pencilRing(b - today, max(px, .5) / 3.4) * (.6 + .4 * hash(floor(p * 2.)));
          }
          float col = floor((b.x - 2.) / cw);
          if (col >= 0. && col < 7.) {
            float cx = 2. + (col + .5) * cw;
            float mark = smallGlyph(10. + col, (b - vec2(cx, 9.6)) / vec2(2.4, 3.2) + .5);
            float row = floor((b.y - 12.3) / 4.);
            if (row >= 0. && row < 6.) {
              float isShort = (abs(m - 3.) < .5 || abs(m - 5.) < .5 || abs(m - 8.) < .5 || abs(m - 10.) < .5) ? 1. : 0.;
              float len = abs(m - 1.) < .5 ? 28. + uCalLeap : 31. - isShort;
              float day = row * 7. + col - first + 1.;
              if (day > .5 && day < len + .5) {
                vec2 cc = vec2(cx, 12.3 + (row + .5) * 4.);
                mark = max(mark, number(day, b, cc, 3.2));
              }
            }
            if (col > 4.5) red = mark; else ink = max(ink, mark);
          }
        }
      }
      color *= mix(vec3(1.), vec3(.16, .15, .15), ink * .9);
      color *= mix(vec3(1.), vec3(.9, .26, .24), red * .9);
      color *= mix(vec3(1.), vec3(1., .3, .27), pencil * .95);
    }
  }

  // ---- outside: night, blue hour, day, falling snow ----
  if (masks.b > .004) {
    float sky = m2.r, lamps = m2.g, frost = m2.b;
    vec3 night = base * mix(1., .55, uDeep);
    night *= 1. + lamps * uDeep * .35; // lamps keep burning when the sky darkens
    night = mix(night, night * vec3(1.05, .95, 1.1) * 1.25, uWarm * (1. - uView));
    vec3 day = dayBase;
    float bright = .55 + .45 * uDay;
    day *= bright;
    // Low sun: rose tint near the horizon, stronger on the sky.
    day *= mix(vec3(1.), vec3(1.18, .92, .86), uWarm * (.4 + .6 * sky));
    vec3 outside = mix(night, day, uView);
    outside = mix(outside, outside * (1. - lamps) + base * lamps, (1. - uView) * .6);

    if (uSnow > 0.) {
      float flakes = snowLayer(p, 15., .8, 24., 4., .42 * uSnow, .6, px, 1.)
        + snowLayer(p, 23., 1.25, 37., 7., .40 * uSnow, .45, px, 7.)
        + snowLayer(p, 37., 2., 58., 11., .36 * uSnow, .45, px, 13.)
        + snowLayer(p, 55., 2.6, 80., 15., .24 * uSnow, .6, px, 21.);
      flakes = min(1., flakes) * (1. - frost * .75);
      vec3 nightFlake = vec3(.30, .36, .50) * mix(1., .55, uDeep) + base * .6;
      vec3 dayFlake = mix(vec3(.92, .93, .95), vec3(.58, .60, .64), sky * .8) * bright;
      outside = mix(outside, mix(nightFlake, dayFlake, uView), flakes * .85);
    }
    color = mix(color, outside, masks.b);
  }

  // ---- TV: old antenna reception ----
  vec2 tq = (p - TV_C) / TV_H;
  if (abs(tq.x) < 1.05 && abs(tq.y) < 1.05) {
    float shape = pow(abs(tq.x), 5.) + pow(abs(tq.y), 5.);
    float screen = smoothstep(1., .86, shape);
    if (screen > 0.) {
      float lines = 2. * TV_H.y;
      float line = floor((tq.y * .5 + .5) * lines);
      float frame = uFrame;
      float tear = (hash(vec2(line, frame)) - .5) * .02 * uTVNoise
        + sin(line * .21 + uTime * 23.) * .012 * uTVTear * smoothstep(.2, 1., hash(vec2(floor(line / 9.), frame)))
        + .05 * uTVTear * smoothstep(.97, 1., hash(vec2(floor(line / 3.), floor(frame / 3.))));
      vec2 s = vec2(tq.x + tear, tq.y);
      s.y = mod(s.y + uTVRoll * 2. + 1., 2.) - 1.;
      float blank = uTVRoll > 0. ? smoothstep(.92, .98, abs(mod(tq.y + uTVRoll * 2. + 1., 2.) - 1.)) : 0.;
      vec2 sc = clamp(s, vec2(-.86), vec2(.86));
      vec3 pic = toLinear(TEX(uPlate, (TV_C + sc * TV_H) / IMG).rgb);
      vec3 ghost = toLinear(TEX(uPlate, (TV_C + clamp(s + vec2(.11, 0.), vec2(-.86), vec2(.86)) * TV_H) / IMG).rgb);
      pic = mix(pic, ghost, .22 * min(1., uTVNoise));
      pic = mix(vec3(lum(pic)), pic, .6);
      // Grain is stretched along the scan lines, as on a real kinescope.
      vec2 cellSize = vec2(2.2, 1.) * max(1., px * .9);
      float grain = hash(floor(p / cellSize) + vec2(frame * 37., frame * 101.));
      float snowy = (.16 + .12 * hash(vec2(frame, 3.))) * min(1., uTVNoise) + .85 * uTVBurst;
      vec3 picture = mix(pic, vec3(pow(grain, 1.6) * .95), clamp(snowy, 0., 1.));
      float hum = sin((tq.y - uTime * .18) * 3.14159);
      picture *= 1. - .10 * min(1., uTVNoise) * smoothstep(.5, 1., hum);
      picture *= .88 + .12 * sin(line * 3.14159);
      picture *= (1. - blank) * uTVLevel * (1. - .22 * shape);
      color = mix(color, picture * uTV, screen);
    }
  }

  // ---- mantel clock: real time, hands in the perspective of the dial ----
  vec2 dq = p - vec2(2137., 312.);
  if (abs(dq.x) < 34. && abs(dq.y) < 40.) {
    vec3 hp = vec3(p, 1.);
    vec2 cq = vec2(dot(DIAL0, hp), dot(DIAL1, hp)) / dot(DIAL2, hp);
    if (dot(cq, cq) < 1.3) {
      float aa = px / 27.; // about 27 image pixels per dial unit
      vec2 shadowOffset = vec2(.035, .055);
      float shadow = max(hand(cq - shadowOffset, uClockH, .5, .05, aa * 3.), hand(cq - shadowOffset, uClockM, .74, .036, aa * 3.));
      color *= 1. - .35 * shadow;
      float cover = max(hand(cq, uClockH, .5, .05, aa), hand(cq, uClockM, .74, .036, aa));
      cover = max(cover, smoothstep(.065 + aa, .065 - aa, length(cq)));
      vec3 face = mix(base * ratio, dayBase, dayMix);
      color = mix(color, face * .07 + vec3(.004, .003, .002) * lum(ratio), cover);
    }
  }

  color *= uLight;
  // Gentle shoulder above the reference range keeps daylight from clipping.
  color = mix(color, .82 + (color - .82) / (1. + (color - .82) * 2.2), step(.82, color));
  vec3 outColor = toSRGB(color) + (hash(gl_FragCoord.xy + fract(uTime) * 61.) - .5) / 255.;
  FRAG = vec4(clamp(outColor, 0., 1.), 1.);
}`;

function webglShaders() {
  const vertex = `attribute vec2 aPosition;
varying vec2 vUV;
void main() {
  vUV = vec2(aPosition.x * .5 + .5, .5 - aPosition.y * .5);
  gl_Position = vec4(aPosition, 0., 1.);
}`;
  const fragment = `precision highp float;
varying vec2 vUV;
${uniforms.map(([type, name]) => `uniform ${type} ${name};`).join('\n')}
${samplers.map(name => `uniform sampler2D ${name};`).join('\n')}
#define TEX texture2D
#define FRAG gl_FragColor
${body}`;
  return {vertex, fragment};
}

// Function sources for the QML library generated by the package build.
const sources = Object.fromEntries([smoothstep, hash1, noise1, sunElevation, sceneState].map(f => [f.name, f.toString()]));
const scene = {defaults, ranges, pixelLimits, uniforms, samplers, body, sceneState, sunElevation, webglShaders, sources};
if (typeof module !== 'undefined') module.exports = scene; else root.NYScene = scene;
})(globalThis);
