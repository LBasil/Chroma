(() => {
  const $ = s => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const f = (n, d = 2) => { const v = +(+n).toFixed(d); return Object.is(v, -0) ? '0' : String(v); };
  const pct = (n, d = 1) => f(n * 100, d) + '%';
  const h2 = n => n.toString(16).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const supportsP3 = window.CSS && CSS.supports('color', 'color(display-p3 1 0 0)');

  const el = {
    picker: $('#picker'), text: $('#text'), swatch: $('#swatch'), bigHex: $('#bigHex'), bigName: $('#bigName'),
    badges: $('#gamutBadges'), groups: $('#groups'), search: $('#search'), nav: $('#nav'),
    shades: $('#shades'), harmonies: $('#harmonies'), toast: $('#toast'),
    sR: $('#sR'), sG: $('#sG'), sB: $('#sB'), sA: $('#sA'),
    oR: $('#oR'), oG: $('#oG'), oB: $('#oB'), oA: $('#oA'),
  };

  const NAME_LIST = Object.entries(NAMES).map(([n, hex]) => {
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return { n, hex, ok: Color.xyzToOklab(Color.toXyz('srgb', rgb)) };
  });

  // Exact CSS keyword match, or the closest one by Euclidean distance in Oklab (≈ perceptual ΔE)
  function nearestName(ok, hex6) {
    const exact = NAME_LIST.filter(x => '#' + x.hex === hex6).map(x => x.n);
    if (exact.length) return { exact: true, names: exact };
    let best, bd = Infinity;
    for (const x of NAME_LIST) {
      const d = Math.hypot(ok[0] - x.ok[0], ok[1] - x.ok[1], ok[2] - x.ok[2]);
      if (d < bd) { bd = d; best = x; }
    }
    return { exact: false, names: [best.n], dist: bd };
  }

  // Nearest xterm-256 color: compare the 6×6×6 cube (16–231) with the grayscale ramp (232–255)
  function ansi256([R, G, B]) {
    const lv = [0, 95, 135, 175, 215, 255];
    const idx = v => lv.reduce((bi, l, i) => Math.abs(l - v) < Math.abs(lv[bi] - v) ? i : bi, 0);
    const [ri, gi, bi] = [idx(R), idx(G), idx(B)];
    const cube = [lv[ri], lv[gi], lv[bi]];
    const gIdx = clamp(Math.round(((R + G + B) / 3 - 8) / 10), 0, 23), gv = 8 + 10 * gIdx;
    const d = c => (c[0] - R) ** 2 + (c[1] - G) ** 2 + (c[2] - B) ** 2;
    return d([gv, gv, gv]) < d(cube) ? { i: 232 + gIdx, rgb: [gv, gv, gv] } : { i: 16 + 36 * ri + 6 * gi + bi, rgb: cube };
  }

  const inGamut = (space, xyz) => Color.fromXyz(space, xyz).every(v => v > -1e-4 && v < 1 + 1e-4);
  const xyzToHex = xyz => '#' + Color.fromXyz('srgb', xyz).map(v => h2(Math.round(clamp(v) * 255))).join('');

  // Binary-search the Oklch chroma down until the color fits inside sRGB (keeps L and H)
  function fitOklch(L, C, H) {
    const xyzOf = c => Color.oklabToXyz(Color.unpolar([L, c, H]));
    if (inGamut('srgb', xyzOf(C))) return xyzOf(C);
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; inGamut('srgb', xyzOf(mid)) ? lo = mid : hi = mid; }
    return xyzOf(lo);
  }

  // Single source of truth: CIE XYZ (D65) + alpha. Unclamped, so wide-gamut inputs survive.
  let state = { xyz: Color.toXyz('srgb', [1, 0.271, 0.329]), alpha: 1 };

  /* ---------- Compute every output format from the current state ---------- */
  function compute() {
    const { xyz, alpha: A } = state;
    const raw = Color.fromXyz('srgb', xyz);
    const gam = {
      srgb: inGamut('srgb', xyz), p3: inGamut('display-p3', xyz),
      a98: inGamut('a98-rgb', xyz), rec2020: inGamut('rec2020', xyz), prophoto: inGamut('prophoto-rgb', xyz),
    };
    const rgb = raw.map(v => clamp(v));
    const [R, G, B] = rgb.map(v => Math.round(v * 255));
    const A8 = Math.round(A * 255);
    const a = f(A, 3);
    const hex6 = '#' + h2(R) + h2(G) + h2(B), hex8 = hex6 + h2(A8);
    const slashA = A < 1 ? ` / ${a}` : '';
    const slashAp = A < 1 ? ` / ${pct(A, 1)}` : '';

    const hsl = Color.rgbToHsl(rgb), hsv = Color.rgbToHsv(rgb), hwb = Color.rgbToHwb(rgb), cmyk = Color.rgbToCmyk(rgb);
    const hsi = (() => { const I = (rgb[0] + rgb[1] + rgb[2]) / 3; return [hsv[0], I ? 1 - Math.min(...rgb) / I : 0, I]; })();
    const lab = Color.xyzToLab(xyz), lch = Color.polar(lab);
    const ok = Color.xyzToOklab(xyz), oklch = Color.polar(ok);
    const luv = Color.xyzToLuv(xyz), lchuv = Color.polar(luv);
    const xyz50 = Color.d65ToD50(xyz);
    const sum = xyz[0] + xyz[1] + xyz[2];
    const xy = sum ? [xyz[0] / sum, xyz[1] / sum] : [0.3127, 0.3290];
    // Correlated color temperature, McCamy's cubic approximation from CIE xy
    const cct = (() => {
      if (!sum) return '—';
      const n = (xy[0] - 0.3320) / (0.1858 - xy[1]);
      const t = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
      return t > 1000 && t < 25000 ? `≈ ${Math.round(t)} K` : 'hors plage (couleur trop saturée)';
    })();

    const lin = raw.map(Color.srgbToLin).map(v => clamp(v));
    const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const cW = contrast(Y, 1), cB = contrast(Y, 0);
    const grade = c => c >= 7 ? 'AAA' : c >= 4.5 ? 'AA' : c >= 3 ? 'AA grand texte' : 'échec';

    const sp = space => Color.fromXyz(space, xyz);
    const cssCol = (space, v, d = 4) => `color(${space} ${v.map(x => f(x, d)).join(' ')}${slashA})`;
    const p3 = sp('display-p3'), a98 = sp('a98-rgb'), r2020 = sp('rec2020'), pp = sp('prophoto-rgb');
    const linSrgb = sp('srgb-linear');
    const rec709 = lin.map(Color.linToR2020);
    const p3lin = Color.linearFromXyz('display-p3', xyz).map(v => clamp(v));
    const p3g26 = p3lin.map(v => v ** (1 / 2.6));

    const yc = (src, kr, kb, full) => {
      const [y, pb, pr] = Color.ypbpr(src, kr, kb);
      return full ? [y * 255, 128 + pb * 255, 128 + pr * 255] : [16 + 219 * y, 128 + 224 * pb, 128 + 224 * pr];
    };
    const ints = v => v.map(x => Math.round(clamp(x, 0, 255))).join(', ');
    const y601 = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const yuv = [y601, 0.492 * (rgb[2] - y601), 0.877 * (rgb[0] - y601)];
    const yiq = [y601,
      0.5959 * rgb[0] - 0.2746 * rgb[1] - 0.3213 * rgb[2],
      0.2115 * rgb[0] - 0.5227 * rgb[1] + 0.3112 * rgb[2]];
    const ycocg = [rgb[0] / 4 + rgb[1] / 2 + rgb[2] / 4, rgb[0] / 2 - rgb[2] / 2, -rgb[0] / 4 + rgb[1] / 2 - rgb[2] / 4];
    const ypp = Color.ypbpr(rgb, 0.2126, 0.0722);
    const r2020c = r2020.map(v => clamp(v));

    // Short hex only exists when each byte is a doubled digit (00, 11 … ff); otherwise round to the nearest one
    const nib = v => Math.round(v / 17).toString(16);
    const short3 = '#' + [R, G, B].map(nib).join('');
    const short4 = short3 + nib(A8);
    const exact3 = [R, G, B].every(v => v % 17 === 0), exact4 = exact3 && A8 % 17 === 0;
    const name = nearestName(ok, hex6);
    const nameStr = name.exact ? name.names.join(' / ') : `≈ ${name.names[0]}`;

    const grayLum = Math.round(clamp(Color.linToSrgb(Y)) * 255);
    const gray601 = Math.round(y601 * 255);
    const grayAvg = Math.round((R + G + B) / 3);
    const ghex = g => '#' + h2(g).repeat(3);
    const web = [R, G, B].map(v => Math.round(v / 51) * 51);
    const an = ansi256([R, G, B]);
    const q = (v, bits) => Math.round(v * (2 ** bits - 1));
    const rgb565 = (q(rgb[0], 5) << 11) | (q(rgb[1], 6) << 5) | q(rgb[2], 5);
    const rgb555 = (q(rgb[0], 5) << 10) | (q(rgb[1], 5) << 5) | q(rgb[2], 5);
    const argb1555 = ((A >= 0.5 ? 1 : 0) << 15) | rgb555;
    const argb4444 = (q(A, 4) << 12) | (q(rgb[0], 4) << 8) | (q(rgb[1], 4) << 4) | q(rgb[2], 4);
    const rgb332 = (q(rgb[0], 3) << 5) | (q(rgb[1], 3) << 2) | q(rgb[2], 2);
    const int24 = (R << 16) | (G << 8) | B;
    const hx = (n, w) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
    const fl = v => f(v, 3);
    const [fr, fg, fb] = rgb.map(fl);
    const AA = h2(A8).toUpperCase(), HEX = hex6.slice(1).toUpperCase();

    return {
      hex6, hex8, R, G, B, A, gam, rgb, name, Y, p3,
      groups: [
        {
          id: 'web', title: 'Web & CSS', desc: 'Les formats à coller directement dans un fichier CSS, HTML ou SVG.',
          items: [
            ['HEX', hex6],
            ['HEX majuscules', hex6.toUpperCase()],
            ['HEXA (8 caractères)', hex8],
            ['HEX court (#RGB)', short3, exact3 ? 'exact' : `approximation (${short3} = ${'#' + [...short3.slice(1)].map(c => c + c).join('')})`],
            ['HEXA court (#RGBA)', short4, exact4 ? 'exact' : `approximation (${short4} = ${'#' + [...short4.slice(1)].map(c => c + c).join('')})`],
            ['RGB / RVB', `rgb(${R}, ${G}, ${B})`],
            ['RGBA / RVBA', `rgba(${R}, ${G}, ${B}, ${a})`],
            ['RGB syntaxe moderne', `rgb(${R} ${G} ${B}${slashAp})`],
            ['RGB en %', `rgb(${pct(rgb[0])} ${pct(rgb[1])} ${pct(rgb[2])}${slashA})`],
            ['RGB décimal (0–1)', `${fr}, ${fg}, ${fb}`, 'valeurs normalisées'],
            ['RGBA décimal (0–1)', `${fr}, ${fg}, ${fb}, ${a}`],
            ['RGB entier décimal', String(int24), '(R × 65536) + (G × 256) + B'],
            ['HSL / TSL', `hsl(${f(hsl[0], 1)}, ${pct(hsl[1])}, ${pct(hsl[2])})`],
            ['HSLA / TSLA', `hsla(${f(hsl[0], 1)}, ${pct(hsl[1])}, ${pct(hsl[2])}, ${a})`],
            ['HSL syntaxe moderne', `hsl(${f(hsl[0], 1)}deg ${pct(hsl[1])} ${pct(hsl[2])}${slashA})`],
            ['HWB', `hwb(${f(hwb[0], 1)} ${pct(hwb[1])} ${pct(hwb[2])}${slashA})`],
            ['Nom CSS', nameStr, name.exact ? 'correspondance exacte' : 'nom le plus proche (Oklab)'],
            ['color(srgb)', cssCol('srgb', rgb)],
            ['color-mix (éclaircir)', `color-mix(in oklch, ${hex6} 70%, white)`],
            ['color-mix (assombrir)', `color-mix(in oklch, ${hex6} 70%, black)`],
            ['color-mix (transparence)', `color-mix(in srgb, ${hex6} 50%, transparent)`],
            ['Variable CSS', `--color-primary: ${A < 1 ? hex8 : hex6};`],
            ['Tailwind (valeur arbitraire)', `bg-[${A < 1 ? hex8 : hex6}]`],
            ['SCSS', `$color: ${A < 1 ? hex8 : hex6};`],
          ],
        },
        {
          id: 'models', title: 'Modèles TSV / TSL', desc: 'Les modèles teinte, saturation, clarté utilisés dans Photoshop, Figma et les logiciels de dessin.',
          items: [
            ['HSV / HSB / TSV', `hsv(${f(hsv[0], 1)}, ${pct(hsv[1])}, ${pct(hsv[2])})`, 'Photoshop, Figma, Procreate'],
            ['HSB (valeurs brutes)', `H ${Math.round(hsv[0])}°  S ${Math.round(hsv[1] * 100)}  B ${Math.round(hsv[2] * 100)}`],
            ['HSL (valeurs brutes)', `H ${Math.round(hsl[0])}°  S ${Math.round(hsl[1] * 100)}  L ${Math.round(hsl[2] * 100)}`],
            ['HSI', `hsi(${f(hsi[0], 1)}, ${pct(hsi[1])}, ${pct(hsi[2])})`, 'Teinte, saturation, intensité'],
            ['HWB (valeurs brutes)', `H ${Math.round(hwb[0])}°  W ${Math.round(hwb[1] * 100)}  B ${Math.round(hwb[2] * 100)}`],
          ],
        },
        {
          id: 'cie', title: 'CIE & espaces perceptuels', desc: 'Des espaces indépendants des appareils. CIE XYZ sert de passerelle à toutes les conversions.',
          items: [
            ['CIE XYZ (D65)', `X ${f(xyz[0] * 100, 3)}  Y ${f(xyz[1] * 100, 3)}  Z ${f(xyz[2] * 100, 3)}`],
            ['color(xyz-d65)', cssCol('xyz-d65', xyz, 5)],
            ['CIE XYZ (D50)', `X ${f(xyz50[0] * 100, 3)}  Y ${f(xyz50[1] * 100, 3)}  Z ${f(xyz50[2] * 100, 3)}`],
            ['color(xyz-d50)', cssCol('xyz-d50', xyz50, 5)],
            ['CIE xyY', `x ${f(xy[0], 4)}  y ${f(xy[1], 4)}  Y ${f(xyz[1] * 100, 3)}`],
            ['CIELAB (L*a*b*)', `lab(${f(lab[0], 2)}% ${f(lab[1], 2)} ${f(lab[2], 2)}${slashA})`, 'D50, comme en CSS'],
            ['CIE LCh (LCHab)', `lch(${f(lch[0], 2)}% ${f(lch[1], 2)} ${f(lch[2], 2)}${slashA})`],
            ['CIELUV (L*u*v*)', `L ${f(luv[0], 2)}  u ${f(luv[1], 2)}  v ${f(luv[2], 2)}`, 'D65'],
            ['CIE LCHuv', `L ${f(lchuv[0], 2)}  C ${f(lchuv[1], 2)}  H ${f(lchuv[2], 2)}°`],
            ['Oklab', `oklab(${f(ok[0] * 100, 2)}% ${f(ok[1], 4)} ${f(ok[2], 4)}${slashA})`],
            ['Oklch', `oklch(${f(oklch[0] * 100, 2)}% ${f(oklch[1], 4)} ${f(oklch[2], 2)}${slashA})`],
            ['Température de couleur', cct, 'approximation de McCamy'],
          ],
        },
        {
          id: 'gamut', title: 'Gamuts & espaces RGB', desc: 'La même couleur exprimée dans chaque espace RGB standard (valeurs 0–1).',
          items: [
            ['sRGB', cssCol('srgb', raw), gam.srgb ? 'standard du web' : 'hors gamut, écrêté pour le web'],
            ['sRGB linéaire', cssCol('srgb-linear', linSrgb)],
            ['Display P3', cssCol('display-p3', p3), 'écrans Apple, web moderne'],
            ['P3-D65 (γ 2,6, cinéma)', `R ${f(p3g26[0], 4)}  G ${f(p3g26[1], 4)}  B ${f(p3g26[2], 4)}`, 'DCI-P3 avec un blanc D65'],
            ['Adobe RGB (1998)', cssCol('a98-rgb', a98)],
            ['Rec. 709 (BT.709)', `R ${f(rec709[0], 4)}  G ${f(rec709[1], 4)}  B ${f(rec709[2], 4)}`, 'primaires sRGB, OETF vidéo HD'],
            ['Rec. 2020 / BT.2020', cssCol('rec2020', r2020), 'UHD 4K / 8K, HDR'],
            ['ProPhoto RGB', cssCol('prophoto-rgb', pp), 'Lightroom (D50)'],
            ['Display P3 (0–255)', ints(p3.map(v => v * 255))],
            ['Adobe RGB (0–255)', ints(a98.map(v => v * 255))],
          ],
        },
        {
          id: 'video', title: 'Vidéo & diffusion', desc: 'La luminance (Y) séparée de la chrominance. « Studio » signifie la plage 16–235.',
          items: [
            ['YCbCr BT.601 (JPEG, 0–255)', ints(yc(rgb, 0.299, 0.114, true)), 'plage complète'],
            ['YCbCr BT.601 (studio)', ints(yc(rgb, 0.299, 0.114, false)), 'SD, 16–235 / 16–240'],
            ['YCbCr BT.709 (studio)', ints(yc(rgb, 0.2126, 0.0722, false)), 'HD'],
            ['YCbCr BT.709 (0–255)', ints(yc(rgb, 0.2126, 0.0722, true))],
            ['YCbCr BT.2020 (studio)', ints(yc(r2020c, 0.2627, 0.0593, false)), 'UHD, depuis les valeurs Rec. 2020'],
            ['YPbPr (BT.709)', `Y ${f(ypp[0], 4)}  Pb ${f(ypp[1], 4)}  Pr ${f(ypp[2], 4)}`, 'composantes analogiques'],
            ['YUV (PAL)', `Y ${f(yuv[0], 4)}  U ${f(yuv[1], 4)}  V ${f(yuv[2], 4)}`],
            ['YIQ (NTSC)', `Y ${f(yiq[0], 4)}  I ${f(yiq[1], 4)}  Q ${f(yiq[2], 4)}`],
            ['YCoCg', `Y ${f(ycocg[0], 4)}  Co ${f(ycocg[1], 4)}  Cg ${f(ycocg[2], 4)}`, 'codecs et compression de textures'],
            ['Luma Y′ (Rec. 709)', f(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], 4)],
          ],
        },
        {
          id: 'print', title: 'Impression', desc: 'CMJN calculé mathématiquement, sans profil ICC. Pour une épreuve réelle, utilise le profil de ton imprimeur.',
          items: [
            ['CMJN / CMYK (%)', `C ${Math.round(cmyk[0] * 100)}  M ${Math.round(cmyk[1] * 100)}  J ${Math.round(cmyk[2] * 100)}  N ${Math.round(cmyk[3] * 100)}`],
            ['cmyk()', `cmyk(${cmyk.map(v => pct(v, 1)).join(', ')})`],
            ['device-cmyk() CSS', `device-cmyk(${cmyk.map(v => f(v, 3)).join(' ')}${slashA})`],
            ['CMYK (0–1)', cmyk.map(v => f(v, 4)).join(', ')],
            ['Encrage total', `${Math.round(cmyk.reduce((s, v) => s + v, 0) * 100)} %`, 'TAC, max conseillé ≈ 300 %'],
          ],
        },
        {
          id: 'bits', title: 'Stockage & profondeur de bits', desc: 'Ce que deviennent les données de ce pixel selon la profondeur de codage.',
          items: [
            ['Monochrome 1 bit', Y >= 0.18 ? '1 (blanc)' : '0 (noir)', 'seuil à 50 % de clarté perçue'],
            ['Niveaux de gris (luminance)', `${grayLum}  ${ghex(grayLum)}`, 'perceptuel, Rec. 709'],
            ['Niveaux de gris (luma 601)', `${gray601}  ${ghex(gray601)}`, 'Photoshop, JPEG'],
            ['Niveaux de gris (moyenne)', `${grayAvg}  ${ghex(grayAvg)}`],
            ['8 bits RGB332 (indexé)', `${rgb332}  ${hx(rgb332, 2)}`, '256 couleurs'],
            ['Couleur Web-safe (216)', '#' + web.map(h2).join(''), 'palette sûre historique'],
            ['ANSI 256 (xterm)', `${an.i}  #${an.rgb.map(h2).join('')}`, 'terminal'],
            ['High Color RGB565 (16 bits)', hx(rgb565, 4)],
            ['High Color RGB555 (15 bits)', hx(rgb555, 4)],
            ['ARGB1555', hx(argb1555, 4)],
            ['ARGB4444', hx(argb4444, 4)],
            ['True Color 24 bits', `${R}, ${G}, ${B}`, '16,7 millions de couleurs'],
            ['Deep Color 30 bits (10 bits/canal)', rgb.map(v => q(v, 10)).join(', '), 'HDR10, 0–1023'],
            ['Deep Color 36 bits (12 bits/canal)', rgb.map(v => q(v, 12)).join(', '), 'Dolby Vision, 0–4095'],
            ['48 bits (16 bits/canal)', rgb.map(v => q(v, 16)).join(', '), 'TIFF/PNG 16 bits, 0–65535'],
            ['48 bits en hexadécimal', '#' + rgb.map(v => q(v, 16).toString(16).padStart(4, '0')).join('')],
            ['Float 32 linéaire (EXR)', linSrgb.map(v => f(v, 6)).join(', '), 'rendu 3D, compositing'],
            ['Binaire', [R, G, B].map(v => v.toString(2).padStart(8, '0')).join(' ')],
          ],
        },
        {
          id: 'code', title: 'Code & langages', desc: 'La couleur prête à coller dans ton code.',
          items: [
            ['Entier décimal', String(int24)],
            ['0xRRGGBB', '0x' + HEX],
            ['0xAARRGGBB (ARGB)', '0x' + AA + HEX, 'Android, Flutter, .NET'],
            ['0xRRGGBBAA (RGBA)', '0x' + HEX + AA],
            ['Android XML', '#' + AA + HEX],
            ['Float normalisé 0–1', `${fr}, ${fg}, ${fb}, ${a}`],
            ['Swift UIKit', `UIColor(red: ${fr}, green: ${fg}, blue: ${fb}, alpha: ${a})`],
            ['SwiftUI', `Color(red: ${fr}, green: ${fg}, blue: ${fb}, opacity: ${a})`],
            ['SwiftUI Display P3', `Color(.displayP3, red: ${f(p3[0], 3)}, green: ${f(p3[1], 3)}, blue: ${f(p3[2], 3)}, opacity: ${a})`],
            ['Jetpack Compose', `Color(0x${AA}${HEX})`],
            ['Flutter', `Color(0x${AA}${HEX})`],
            ['Unity Color', `new Color(${fr}f, ${fg}f, ${fb}f, ${a}f)`],
            ['Unity Color32', `new Color32(${R}, ${G}, ${B}, ${A8})`],
            ['GLSL / HLSL', `vec4(${fr}, ${fg}, ${fb}, ${a})`],
            ['Java AWT', `new Color(${R}, ${G}, ${B}, ${A8})`],
            ['C# / .NET', `Color.FromArgb(${A8}, ${R}, ${G}, ${B})`],
            ['Python (tuple)', A < 1 ? `(${R}, ${G}, ${B}, ${A8})` : `(${R}, ${G}, ${B})`],
            ['Matplotlib', `(${fr}, ${fg}, ${fb}${A < 1 ? ', ' + a : ''})`],
            ['ANSI truecolor (terminal)', `\\x1b[38;2;${R};${G};${B}m`],
            ['LaTeX', `\\definecolor{macouleur}{HTML}{${HEX}}`],
          ],
        },
        {
          id: 'a11y', title: 'Accessibilité', desc: 'Contraste WCAG 2.x du texte sur cette couleur (transparence ignorée).',
          items: [
            ['Luminance relative', f(Y, 4)],
            ['Contraste avec le blanc', `${f(cW, 2)}:1`, grade(cW)],
            ['Contraste avec le noir', `${f(cB, 2)}:1`, grade(cB)],
            ['Texte conseillé', cW >= cB ? 'blanc (#ffffff)' : 'noir (#000000)'],
          ],
        },
      ],
    };
  }

  /* ---------- Rendering ---------- */
  const copyIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  let current;

  function renderGroups() {
    const q = el.search.value.trim().toLowerCase();
    const html = current.groups.map(g => {
      const items = g.items.filter(it => !q || it.join(' ').toLowerCase().includes(q) || g.title.toLowerCase().includes(q));
      if (!items.length) return '';
      return `<section class="group" id="g-${g.id}">
        <div class="group-head"><h2>${g.title}</h2><p>${g.desc}</p></div>
        <div class="items">${items.map(([k, v, n]) => `
          <button class="item" type="button" data-copy="${esc(v)}" ${v === '—' ? 'disabled' : ''}>
            <span class="k">${esc(k)}${n ? `<em>${esc(n)}</em>` : ''}</span>
            <span class="v">${esc(v)}</span>
            <span class="cp" aria-hidden="true">${copyIcon}</span>
          </button>`).join('')}
        </div></section>`;
    }).join('');
    el.groups.innerHTML = html || '<p class="empty">Aucun format ne correspond à ta recherche.</p>';
  }

  function swatchBtn(xyz, label) {
    const hex = xyzToHex(xyz);
    return `<button class="sw" type="button" data-set="${hex}" style="--c:${hex}" title="${label ? label + ' · ' : ''}${hex}"><span>${hex}</span></button>`;
  }

  function renderPalette() {
    const [L, C, H] = Color.polar(Color.xyzToOklab(state.xyz));
    const steps = [0.97, 0.92, 0.85, 0.76, 0.67, 0.58, 0.49, 0.40, 0.32, 0.24, 0.17];
    el.shades.innerHTML = steps.map((l, i) => swatchBtn(fitOklch(l, C, H), String(i ? i * 100 : 50))).join('');
    const harm = [
      ['Complémentaire', [0, 180]], ['Analogues', [-30, 0, 30]], ['Triade', [0, 120, 240]],
      ['Complémentaires adjacentes', [0, 150, 210]], ['Tétrade', [0, 90, 180, 270]],
    ];
    el.harmonies.innerHTML = harm.map(([n, offs]) => `
      <div class="harm"><span class="harm-name">${n}</span>
        <div class="harm-row">${offs.map(o => swatchBtn(fitOklch(L, C, (H + o + 360) % 360))).join('')}</div>
      </div>`).join('');
  }

  function update(source) {
    current = compute();
    const { hex6, hex8, R, G, B, A, gam, name, p3 } = current;

    // Out-of-sRGB colors are painted in Display P3 when the browser supports it
    const fill = !gam.srgb && supportsP3
      ? `color(display-p3 ${p3.map(v => f(clamp(v), 4)).join(' ')} / ${A})`
      : `rgb(${R} ${G} ${B} / ${A})`;
    el.swatch.style.background = fill;
    const dark = A < 0.45 ? matchMedia('(prefers-color-scheme: light)').matches : current.Y > 0.18;
    el.swatch.classList.toggle('on-light', dark);
    el.bigHex.textContent = (A < 1 ? hex8 : hex6).toUpperCase();
    el.bigName.textContent = name.exact ? name.names[0] : `≈ ${name.names[0]}`;
    document.documentElement.style.setProperty('--accent', hex6);

    const chip = (label, ok) => `<span class="badge ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'} ${label}</span>`;
    el.badges.innerHTML = chip('sRGB', gam.srgb) + chip('Display P3', gam.p3) + chip('Adobe RGB', gam.a98) +
      chip('Rec. 2020', gam.rec2020) + chip('ProPhoto', gam.prophoto) +
      (gam.srgb ? '' : '<span class="badge warn">Hors sRGB : valeurs web écrêtées</span>');

    el.picker.value = hex6;
    if (source !== 'text') { el.text.value = A < 1 ? hex8 : hex6; el.text.classList.remove('invalid'); }

    const [r, g, b] = [R, G, B];
    el.sR.value = r; el.sG.value = g; el.sB.value = b; el.sA.value = Math.round(A * 100);
    el.oR.textContent = r; el.oG.textContent = g; el.oB.textContent = b; el.oA.textContent = Math.round(A * 100) + '%';
    el.sR.style.setProperty('--track', `linear-gradient(90deg, rgb(0 ${g} ${b}), rgb(255 ${g} ${b}))`);
    el.sG.style.setProperty('--track', `linear-gradient(90deg, rgb(${r} 0 ${b}), rgb(${r} 255 ${b}))`);
    el.sB.style.setProperty('--track', `linear-gradient(90deg, rgb(${r} ${g} 0), rgb(${r} ${g} 255))`);
    el.sA.style.setProperty('--track', `linear-gradient(90deg, rgb(${r} ${g} ${b} / 0), rgb(${r} ${g} ${b}))`);

    renderGroups();
    renderPalette();

    // Keep the URL shareable: hex when possible, oklch() for wide-gamut colors
    const hash = gam.srgb ? (A < 1 ? hex8 : hex6).slice(1) : encodeURIComponent(current.groups[2].items[10][1]);
    history.replaceState(null, '', '#' + hash);
  }

  function setColor(xyz, alpha, source) {
    state = { xyz, alpha };
    update(source);
  }

  /* ---------- Event handlers ---------- */
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1400);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast(`Copié : ${text.length > 48 ? text.slice(0, 48) + '…' : text}`);
  }

  el.picker.addEventListener('input', () => {
    const p = Color.parse(el.picker.value);
    setColor(p.xyz, state.alpha, 'picker');
  });
  el.text.addEventListener('input', () => {
    const p = Color.parse(el.text.value);
    el.text.classList.toggle('invalid', !p && el.text.value.trim() !== '');
    if (p) setColor(p.xyz, p.alpha, 'text');
  });
  el.text.addEventListener('blur', () => { if (el.text.classList.contains('invalid')) update(); });

  [el.sR, el.sG, el.sB].forEach(s => s.addEventListener('input', () => {
    setColor(Color.toXyz('srgb', [el.sR.value / 255, el.sG.value / 255, el.sB.value / 255]), state.alpha, 'slider');
  }));
  el.sA.addEventListener('input', () => setColor(state.xyz, el.sA.value / 100, 'slider'));

  el.groups.addEventListener('click', e => {
    const b = e.target.closest('.item');
    if (b && !b.disabled) copy(b.dataset.copy);
  });
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-set]');
    if (s) { const p = Color.parse(s.dataset.set); setColor(p.xyz, state.alpha, 'palette'); }
  });
  el.bigHex.addEventListener('click', () => copy(el.bigHex.textContent));

  el.search.addEventListener('input', renderGroups);
  el.nav.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    el.search.value = '';
    renderGroups();
    document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const eye = $('#eyedrop');
  if ('EyeDropper' in window) {
    eye.addEventListener('click', async () => {
      try {
        const r = await new EyeDropper().open();
        const p = Color.parse(r.sRGBHex);
        setColor(p.xyz, 1, 'eyedrop');
      } catch { /* user cancelled the eyedropper */ }
    });
  } else {
    eye.disabled = true;
    eye.title = 'Pipette non prise en charge par ce navigateur (Chrome / Edge uniquement)';
  }
  $('#random').addEventListener('click', () => {
    const xyz = fitOklch(0.45 + Math.random() * 0.4, 0.08 + Math.random() * 0.2, Math.random() * 360);
    setColor(xyz, 1, 'random');
  });
  $('#share').addEventListener('click', () => copy(location.href));

  document.querySelectorAll('[data-example]').forEach(c => c.addEventListener('click', () => {
    el.text.value = c.dataset.example;
    el.text.dispatchEvent(new Event('input'));
    el.text.focus();
  }));

  // Boot: restore the color from the URL hash (#ff4554 or #oklch(...))
  const fromHash = location.hash.length > 1 && Color.parse(decodeURIComponent(location.hash.slice(1)));
  if (fromHash) state = fromHash;
  update();
})();
