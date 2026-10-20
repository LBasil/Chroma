/* Conversion engine — every color goes through CIE XYZ (D65 illuminant).
   Matrices and transfer functions follow CSS Color Module Level 4. */
const Color = (() => {
  const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const inv = m => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  };

  const D65 = [0.3127 / 0.3290, 1, (1 - 0.3127 - 0.3290) / 0.3290];
  const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

  // Linear RGB -> XYZ matrices (inverses are computed below)
  const M = {
    srgb: [
      [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
      [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
      [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
    ],
    p3: [
      [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
      [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
      [0, 0.04511338185890264, 1.043944368900976],
    ],
    a98: [
      [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
      [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
      [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
    ],
    rec2020: [
      [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
      [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
      [0, 0.028072693049087428, 1.060985057710791],
    ],
    prophoto: [ // relative to D50
      [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
      [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
      [0, 0, 0.8251046025104601],
    ],
  };
  const INV = Object.fromEntries(Object.entries(M).map(([k, m]) => [k, inv(m)]));

  // Bradford chromatic adaptation between D65 and D50 white points
  const D65_D50 = [
    [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
    [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
    [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
  ];
  const D50_D65 = inv(D65_D50);

  // Transfer functions (gamma encode/decode), mirrored for negative values so out-of-gamut colors round-trip
  const sgn = (c, fn) => Math.sign(c) * fn(Math.abs(c));
  const srgbToLin = c => sgn(c, a => a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
  const linToSrgb = c => sgn(c, a => a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055);
  const a98ToLin = c => sgn(c, a => a ** (563 / 256));
  const linToA98 = c => sgn(c, a => a ** (256 / 563));
  const RA = 1.09929682680944, RB = 0.018053968510807;
  const r2020ToLin = c => sgn(c, a => a < RB * 4.5 ? a / 4.5 : ((a + RA - 1) / RA) ** (1 / 0.45));
  const linToR2020 = c => sgn(c, a => a < RB ? a * 4.5 : RA * a ** 0.45 - (RA - 1));
  const ppToLin = c => sgn(c, a => a <= 16 / 512 ? a / 16 : a ** 1.8);
  const linToPp = c => sgn(c, a => a >= 1 / 512 ? a ** (1 / 1.8) : a * 16);

  const SPACES = {
    'srgb': { m: 'srgb', to: srgbToLin, from: linToSrgb },
    'srgb-linear': { m: 'srgb', to: x => x, from: x => x },
    'display-p3': { m: 'p3', to: srgbToLin, from: linToSrgb },
    'a98-rgb': { m: 'a98', to: a98ToLin, from: linToA98 },
    'rec2020': { m: 'rec2020', to: r2020ToLin, from: linToR2020 },
    'prophoto-rgb': { m: 'prophoto', to: ppToLin, from: linToPp, d50: true },
  };

  function toXyz(space, rgb) {
    const s = SPACES[space];
    const xyz = mul(M[s.m], rgb.map(s.to));
    return s.d50 ? mul(D50_D65, xyz) : xyz;
  }
  function fromXyz(space, xyz) {
    const s = SPACES[space];
    if (s.d50) xyz = mul(D65_D50, xyz);
    return mul(INV[s.m], xyz).map(s.from);
  }
  function linearFromXyz(space, xyz) {
    const s = SPACES[space];
    if (s.d50) xyz = mul(D65_D50, xyz);
    return mul(INV[s.m], xyz);
  }

  // CIELAB (D50, as in CSS)
  const E = 216 / 24389, K = 24389 / 27;
  function xyzToLab(xyz65) {
    const xyz = mul(D65_D50, xyz65);
    const f = xyz.map((v, i) => { const t = v / D50[i]; return t > E ? Math.cbrt(t) : (K * t + 16) / 116; });
    return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
  }
  function labToXyz([L, a, b]) {
    const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
    const x = fx ** 3 > E ? fx ** 3 : (116 * fx - 16) / K;
    const y = L > K * E ? fy ** 3 : L / K;
    const z = fz ** 3 > E ? fz ** 3 : (116 * fz - 16) / K;
    return mul(D50_D65, [x * D50[0], y * D50[1], z * D50[2]]);
  }

  // CIELUV (D65)
  function xyzToLuv([X, Y, Z]) {
    const [Xn, Yn, Zn] = D65;
    const d = X + 15 * Y + 3 * Z, dn = Xn + 15 * Yn + 3 * Zn;
    const up = d ? 4 * X / d : 0, vp = d ? 9 * Y / d : 0;
    const yr = Y / Yn;
    const L = yr > E ? 116 * Math.cbrt(yr) - 16 : K * yr;
    return [L, 13 * L * (up - 4 * Xn / dn), 13 * L * (vp - 9 * Yn / dn)];
  }

  // Oklab (Björn Ottosson), via the LMS cone response
  const XYZ_LMS = [
    [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
    [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
    [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
  ];
  const LMS_OK = [
    [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
    [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
    [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
  ];
  const LMS_XYZ = inv(XYZ_LMS), OK_LMS = inv(LMS_OK);
  const xyzToOklab = xyz => mul(LMS_OK, mul(XYZ_LMS, xyz).map(Math.cbrt));
  const oklabToXyz = lab => mul(LMS_XYZ, mul(OK_LMS, lab).map(v => v ** 3));

  // Cartesian <-> polar (LCh, Oklch, LCHuv); hue is 0 for achromatic colors
  const polar = ([L, a, b]) => {
    const C = Math.hypot(a, b);
    const H = C < 1e-6 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return [L, C, H];
  };
  const unpolar = ([L, C, H]) => [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];

  // Cylindrical models on top of gamma-encoded sRGB (channels 0–1)
  function rgbToHsv([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }
  function rgbToHsl(rgb) {
    const max = Math.max(...rgb), min = Math.min(...rgb), l = (max + min) / 2, d = max - min;
    return [rgbToHsv(rgb)[0], d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l];
  }
  function hslToRgb([h, s, l]) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
  }
  function hsvToRgb([h, s, v]) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }
  const rgbToHwb = rgb => [rgbToHsv(rgb)[0], Math.min(...rgb), 1 - Math.max(...rgb)];
  function hwbToRgb([h, w, b]) {
    if (w + b >= 1) { const g = w / (w + b); return [g, g, g]; }
    return hsvToRgb([h, 1, 1]).map(c => c * (1 - w - b) + w);
  }
  function rgbToCmyk([r, g, b]) {
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  }
  const cmykToRgb = ([c, m, y, k]) => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];

  // Luma / chroma split (video). kr and kb are the standard's luma coefficients.
  function ypbpr([r, g, b], kr, kb) {
    const y = kr * r + (1 - kr - kb) * g + kb * b;
    return [y, 0.5 * (b - y) / (1 - kb), 0.5 * (r - y) / (1 - kr)];
  }

  /* ---------- Free-form input parsing ---------- */
  // Parse a CSS number token; `ref` is what 100% maps to. Angle units are converted to degrees.
  function num(tok, ref = 1) {
    if (tok === 'none') return 0;
    const m = tok.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/);
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    switch (m[2]) {
      case '%': return v / 100 * ref;
      case 'grad': return v * 0.9;
      case 'rad': return v * 180 / Math.PI;
      case 'turn': return v * 360;
    }
    return v;
  }
  const hueNorm = h => ((h % 360) + 360) % 360;
  // Lenient percentage: "50%", "50" or "0.5"
  const loosePct = t => t.endsWith('%') ? num(t, 1) : (+t > 1 ? +t / 100 : +t);

  let ctx;
  // Last resort: let the browser parse it (any valid CSS color) and read the pixel back as 8-bit sRGB
  function viaCanvas(s) {
    try {
      ctx = ctx || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#010203';
      ctx.fillStyle = s;
      if (ctx.fillStyle === '#010203' && s.replace(/\s/g, '') !== '#010203') return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { xyz: toXyz('srgb', [d[0] / 255, d[1] / 255, d[2] / 255]), alpha: d[3] / 255 };
    } catch { return null; }
  }

  function parse(input) {
    let s = input.trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent') return { xyz: [0, 0, 0], alpha: 0 };
    if (NAMES[s]) s = '#' + NAMES[s];

    let m = s.match(/^(#|0x)?([0-9a-f]+)$/);
    // Without # or 0x, treat it as hex only if it contains a letter (otherwise it is a decimal integer)
    if (m && ([3, 4, 6, 8].includes(m[2].length) && m[1] || [6, 8].includes(m[2].length) && /[a-f]/.test(m[2]))) {
      let h = m[2];
      if (h.length <= 4) h = [...h].map(c => c + c).join('');
      const v = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2) || 'ff', 16) / 255);
      return { xyz: toXyz('srgb', v.slice(0, 3)), alpha: v[3] };
    }

    // 24-bit decimal integer (e.g. 16711680 = red)
    if (/^\d+$/.test(s) && +s <= 0xffffff) {
      const n = +s;
      return { xyz: toXyz('srgb', [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255)), alpha: 1 };
    }
    // Normalized 0–1 RGB (e.g. 1, 0.27, 0.33 or vec4(1, 0.27, 0.33, 0.5)); needs at least one decimal point
    const flt = s.replace(/^(?:vec[34]|rgba?)?\s*\(?|\)$/g, '').split(/[\s,]+/).filter(Boolean);
    if ((flt.length === 3 || flt.length === 4) && flt.every(t => /^(?:0|1)?(?:\.\d+)?$/.test(t) && t !== '' && +t <= 1) && flt.some(t => t.includes('.'))) {
      return { xyz: toXyz('srgb', flt.slice(0, 3).map(Number)), alpha: flt[3] !== undefined ? +flt[3] : 1 };
    }

    let fn, body;
    m = s.match(/^([a-z0-9-]+)\s*\(\s*(.*?)\s*\)$/);
    if (m) [, fn, body] = m;
    else if (/^[\d.\s,%]+$/.test(s)) { fn = 'rgb'; body = s; }
    else return viaCanvas(input);

    let [main, alphaTok] = body.split('/').map(x => x && x.trim());
    const toks = main.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    let space;
    if (fn === 'color') space = toks.shift();
    const expected = /cmyk/.test(fn) ? 4 : 3;
    if (alphaTok === undefined && toks.length === expected + 1) alphaTok = toks.pop();
    if (toks.length !== expected) return viaCanvas(input);
    const alpha = alphaTok === undefined ? 1 : Math.min(1, Math.max(0, num(alphaTok, 1)));

    let xyz;
    const pct100 = t => num(t, 100) / 100; // CSS: a bare number means a percentage here
    switch (fn) {
      case 'rgb': case 'rgba': case 'rvb': case 'rvba':
        xyz = toXyz('srgb', toks.map(t => num(t, 255) / 255)); break;
      case 'hsl': case 'hsla': case 'tsl':
        xyz = toXyz('srgb', hslToRgb([hueNorm(num(toks[0])), pct100(toks[1]), pct100(toks[2])])); break;
      case 'hsv': case 'hsb': case 'tsv':
        xyz = toXyz('srgb', hsvToRgb([hueNorm(num(toks[0])), pct100(toks[1]), pct100(toks[2])])); break;
      case 'hwb':
        xyz = toXyz('srgb', hwbToRgb([hueNorm(num(toks[0])), pct100(toks[1]), pct100(toks[2])])); break;
      case 'cmyk': case 'device-cmyk': case 'cmjn':
        xyz = toXyz('srgb', cmykToRgb(toks.map(loosePct))); break;
      case 'lab':
        xyz = labToXyz([num(toks[0], 100), num(toks[1], 125), num(toks[2], 125)]); break;
      case 'lch':
        xyz = labToXyz(unpolar([num(toks[0], 100), num(toks[1], 150), num(toks[2])])); break;
      case 'oklab': case 'oklch': {
        let L = num(toks[0], 1);
        if (!toks[0].endsWith('%') && L > 1) L /= 100;
        const lab = fn === 'oklab'
          ? [L, num(toks[1], 0.4), num(toks[2], 0.4)]
          : unpolar([L, num(toks[1], 0.4), num(toks[2])]);
        xyz = oklabToXyz(lab); break;
      }
      case 'color': {
        const v = toks.map(t => num(t, 1));
        if (SPACES[space]) xyz = toXyz(space, v);
        else if (space === 'xyz' || space === 'xyz-d65') xyz = v;
        else if (space === 'xyz-d50') xyz = mul(D50_D65, v);
        else return null;
        break;
      }
      default: return viaCanvas(input);
    }
    if (xyz.some(Number.isNaN) || Number.isNaN(alpha)) return null;
    return { xyz, alpha };
  }

  return {
    toXyz, fromXyz, linearFromXyz, xyzToLab, labToXyz, xyzToLuv, xyzToOklab, oklabToXyz,
    polar, unpolar, rgbToHsv, rgbToHsl, hslToRgb, hsvToRgb, rgbToHwb, hwbToRgb, rgbToCmyk, cmykToRgb,
    ypbpr, srgbToLin, linToSrgb, linToR2020, parse,
    d65ToD50: xyz => mul(D65_D50, xyz),
  };
})();
