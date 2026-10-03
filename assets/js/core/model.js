// Modelo do documento de página.
//
// doc = { v, owner, title, page:{bg:{c,g}, h:{d,m}}, elements:[...], assets:{id:{ext,mime,w,h}} }
// Dispositivos: 'd' (PC, 1200 de largura) e 'm' (celular, 390).
// Cada elemento tem frame de PC (f.d, sempre) e frame de celular (f.m, opcional).
// Sem f.m, o celular usa uma versão proporcional derivada do PC (frameOf devolve derived:true).
import { uid, clone, clamp } from './util.js';

export const W = { d: 1200, m: 390 };
export const K = W.m / W.d;
export const DEV_LABEL = { d: 'PC', m: 'Celular' };

export function newDoc(owner = '', title = 'Minha página') {
  return { v: 1, owner, title, page: { bg: { c: '#ffffff', g: null }, h: { d: 900, m: 1400 } }, elements: [], assets: {} };
}

export const TEXT_DEFAULTS = { fontFamily: 'Inter', fontSize: 32, fontWeight: 400, italic: false, underline: false, upper: false, align: 'left', color: '#17161d', lh: 1.25, ls: 0 };

export function makeElement(t, props = {}, frame = {}) {
  const base = { id: uid(), t, name: '', lock: false, hide: false, f: { d: { x: 100, y: 100, w: 200, h: 200, r: 0, ...frame } }, s: {}, an: null, link: null };
  if (t === 'text') Object.assign(base, { text: 'Digite seu texto', ah: true, s: { ...TEXT_DEFAULTS } });
  if (t === 'shape') Object.assign(base, { shape: 'rect', label: '', ls: { fontFamily: 'Inter', fontSize: 24, fontWeight: 600, color: '#ffffff' }, s: { fill: '#e4572e', grad: null, stroke: '#17161d', sw: 0, dash: 0, radius: 0, sides: 5, inner: 0.45 } });
  if (t === 'path') Object.assign(base, { d: '', vb: [100, 100], s: { stroke: '#17161d', sw: 6, fill: null, cap: 'round' } });
  if (t === 'image') Object.assign(base, { asset: '', s: { fit: 'cover', radius: 0 } });
  if (t === 'svg') Object.assign(base, { code: '' });
  // props sobrescreve o padrão (merge raso de s / ls / f)
  for (const [k, v] of Object.entries(props)) {
    if (k === 's' || k === 'ls') base[k] = { ...base[k], ...v };
    else base[k] = v;
  }
  return base;
}

export const fontOwner = (el) => (el.t === 'text' ? el.s : el.t === 'shape' ? el.ls : null);

// Frame efetivo (em px de design) do elemento no dispositivo dado.
export function frameOf(el, dev) {
  const fs0 = fontOwner(el)?.fontSize ?? 0;
  if (dev === 'd') return { ...el.f.d, r: el.f.d.r || 0, fs: fs0 };
  const m = el.f.m;
  if (m) return { x: m.x, y: m.y, w: m.w, h: m.h, r: m.r || 0, fs: m.fs ?? fs0 * K };
  const d = el.f.d;
  return { x: d.x * K, y: d.y * K, w: d.w * K, h: d.h * K, r: d.r || 0, fs: fs0 * K, derived: true };
}

// Grava no frame do dispositivo; no celular, "materializa" o frame derivado antes.
export function setFrame(el, dev, patch) {
  if (dev === 'd') {
    const { fs, ...rest } = patch;
    Object.assign(el.f.d, rest);
    if (fs != null && fontOwner(el)) fontOwner(el).fontSize = Math.max(1, fs);
    return;
  }
  if (!el.f.m) { const { derived, ...fr } = frameOf(el, 'm'); el.f.m = fr; }
  Object.assign(el.f.m, patch);
}

export const pageH = (doc, dev) => (dev === 'd' ? doc.page.h.d : doc.page.h.m ?? doc.page.h.d * K);

// Caixa envolvente (alinhada aos eixos) de um frame rotacionado.
export function aabb(fr) {
  if (!fr.r) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
  const a = (fr.r * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = fr.w * c + fr.h * s, h = fr.w * s + fr.h * c;
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionBox(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function cloneElement(el, offset = 24) {
  const c = clone(el);
  c.id = uid();
  c.f.d.x += offset; c.f.d.y += offset;
  if (c.f.m) { c.f.m.x += offset; c.f.m.y += offset; }
  if (c.name) c.name += ' cópia';
  return c;
}

// Cores usadas no documento (para a paleta "Do documento").
export function docColors(doc) {
  const set = new Set();
  const add = (c) => { if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) set.add(c.toLowerCase()); };
  add(doc.page.bg.c);
  if (doc.page.bg.g) { add(doc.page.bg.g.c1); add(doc.page.bg.g.c2); }
  for (const e of doc.elements) {
    add(e.s?.color); add(e.s?.fill); add(e.s?.stroke); add(e.ls?.color);
    if (e.s?.grad) { add(e.s.grad.c1); add(e.s.grad.c2); }
    if (e.s?.shadow) add(e.s.shadow.c);
  }
  return [...set].slice(0, 18);
}

export const bgCss = (bg) => (bg.g ? `linear-gradient(${bg.g.a}deg, ${bg.g.c1}, ${bg.g.c2})` : bg.c);

// Harmonias de cor a partir de uma cor base (para as ferramentas inteligentes).
export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
export function hslToHex(hh, s, l) {
  hh = ((hh % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function harmonies(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return {};
  const [hh, s, l] = hexToHsl(hex);
  return {
    'Complementar': [hslToHex(hh + 180, s, l)],
    'Análogas': [hslToHex(hh - 30, s, l), hslToHex(hh + 30, s, l)],
    'Tríade': [hslToHex(hh + 120, s, l), hslToHex(hh + 240, s, l)],
    'Tons': [hslToHex(hh, s, l - 25), hslToHex(hh, s, l - 12), hslToHex(hh, s, l + 12), hslToHex(hh, s, l + 25)],
  };
}
