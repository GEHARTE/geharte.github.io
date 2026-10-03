// Criação de elementos e ferramentas "inteligentes" (alinhar, distribuir, empilhar no celular...).
import { makeElement, K, W, pageH, frameOf, setFrame, aabb, unionBox, TEXT_DEFAULTS } from '../core/model.js';
import { sanitizeSvg, svgNaturalSize } from '../core/sanitize.js';
import { sha256Hex, clamp, round } from '../core/util.js';
import { Store } from '../core/store.js';
import { S, addEls, byId, selEls, mutate, mutateGeom, commit, emit, setPage, select, touch } from './state.js';
import { toast } from './ui.js';

// ---------- posicionamento ----------
// Coloca o elemento com o frame dado no dispositivo atual; o outro dispositivo é derivado.
export function place(el, fr, fs) {
  const r = (n) => round(n, 1);
  const f = { x: r(fr.x), y: r(fr.y), w: r(fr.w), h: r(fr.h), r: 0 };
  if (S.dev === 'd') { el.f.d = f; return el; }
  el.f.m = { ...f };
  el.f.d = { x: r(f.x / K), y: r(f.y / K), w: r(f.w / K), h: r(f.h / K), r: 0 };
  if (fs && (el.t === 'text' || el.t === 'shape')) {
    (el.t === 'text' ? el.s : el.ls).fontSize = Math.round(fs / K);
    el.f.m.fs = fs;
  }
  return el;
}

const pageW = () => W[S.dev];
// Caixa centrada na área visível do canvas; se já há algo ali, desloca em cascata.
function centered(w, h) {
  const c = S.viewCenter?.() || { x: pageW() / 2, y: 300 };
  let x = clamp(c.x - w / 2, 0, Math.max(0, pageW() - w)), y = Math.max(0, c.y - h / 2);
  for (let i = 0; i < 12; i++) {
    const taken = S.doc.elements.some((e) => { const f = frameOf(e, S.dev); return Math.abs(f.x - x) < 10 && Math.abs(f.y - y) < 10; });
    if (!taken) break;
    x += 28; y += 28;
  }
  return { x: Math.min(x, Math.max(0, pageW() - w)), y, w, h };
}

// Cor de "tinta" que contrasta com o fundo da página (para texto, linhas e lápis novos).
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
export function pageIsDark() {
  const b = S.doc.page.bg, c = b.g ? [b.g.c1, b.g.c2] : [b.c];
  return c.reduce((a, x) => a + lum(x), 0) / c.length < 0.45;
}
export const inkColor = () => (pageIsDark() ? '#f3f1f8' : '#17161d');
const fit = (w, h, max = pageW() * 0.8, grow = false) => { const s = grow ? max / w : Math.min(1, max / w); return { w: w * s, h: h * s }; };

// ---------- criação ----------
const SHAPE_SIZE = { rect: [260, 160], ellipse: [200, 200], line: [260, 24], arrow: [260, 48] };
export function defaultShapeSize(kind) {
  const [w, h] = SHAPE_SIZE[kind] || [200, 200], k = S.dev === 'm' ? K * 1.6 : 1;
  return [w * k, h * k];
}
export function createShape(kind, box) {
  const lineLike = kind === 'line' || kind === 'arrow';
  const el = makeElement('shape', { shape: kind, s: lineLike ? { fill: null, stroke: inkColor(), sw: 6 } : {} });
  if (!box) { const [w, h] = defaultShapeSize(kind); box = centered(w, h); }
  place(el, box);
  addEls([el]);
  return el;
}

export function createText(box, preset = {}, text = 'Digite seu texto') {
  const s0 = { ...preset };
  // cor padrão (ou escura demais numa página escura) vira a tinta que contrasta com o fundo
  if (s0.color == null || (pageIsDark() && lum(s0.color) < 0.4)) s0.color = inkColor();
  const el = makeElement('text', { text, s: s0 });
  const fs = S.dev === 'm' ? Math.max(16, Math.round((preset.fontSize || TEXT_DEFAULTS.fontSize) * 0.6)) : null;
  place(el, { ...box, h: 40 }, fs);
  addEls([el]);
  return el;
}
export function addTextPreset(preset, text) {
  const w = S.dev === 'm' ? 320 : preset.w || 480;
  return createText(centered(w, 60), { ...preset, w: undefined }, text);
}

// Suaviza uma linha à mão livre: simplifica (Ramer–Douglas–Peucker) e curva (Catmull–Rom -> Bézier).
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let dmax = 0, idx = 0;
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.y - a.y) * pts[i].x - (b.x - a.x) * pts[i].y + b.x * a.y - b.y * a.x) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
export function smoothPath(pts) {
  const f = (n) => round(n, 1);
  if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0.01 0`;
  if (pts.length === 2) return `M${f(pts[0].x)} ${f(pts[0].y)}L${f(pts[1].x)} ${f(pts[1].y)}`;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}
export function createPath(points) {
  if (!points.length) return null;
  const simple = rdp(points, 1.6 / Math.max(0.5, S.zoom));
  const PAD = 6;
  const x0 = Math.min(...simple.map((p) => p.x)) - PAD, y0 = Math.min(...simple.map((p) => p.y)) - PAD;
  const x1 = Math.max(...simple.map((p) => p.x)) + PAD, y1 = Math.max(...simple.map((p) => p.y)) + PAD;
  const rel = simple.map((p) => ({ x: p.x - x0, y: p.y - y0 }));
  const el = makeElement('path', { d: smoothPath(rel), vb: [x1 - x0, y1 - y0], s: { stroke: S.pen.stroke || inkColor(), sw: S.pen.sw, fill: null, cap: 'round' } });
  place(el, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  addEls([el]);
  return el;
}

// ---------- imagens ----------
async function processImage(file) {
  if (file.type === 'image/svg+xml') {
    const txt = await file.text();
    const n = svgNaturalSize(txt);
    return { blob: new Blob([txt], { type: 'image/svg+xml' }), ext: 'svg', mime: 'image/svg+xml', w: n.w, h: n.h };
  }
  const bmp = await createImageBitmap(file);
  if (file.type === 'image/gif') return { blob: file, ext: 'gif', mime: 'image/gif', w: bmp.width, h: bmp.height };
  const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  let blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.86));
  let ext = 'webp', mime = 'image/webp';
  if (!blob || blob.type !== 'image/webp') { blob = await new Promise((r) => cv.toBlob(r, 'image/png')); ext = 'png'; mime = 'image/png'; }
  return { blob, ext, mime, w: cv.width, h: cv.height };
}

export async function addAsset(file) {
  const p = await processImage(file);
  const id = (await sha256Hex(await p.blob.arrayBuffer())).slice(0, 10);
  const meta = { ext: p.ext, mime: p.mime, w: p.w, h: p.h };
  if (!S.assets.has(id)) S.assets.set(id, { ...meta, blob: p.blob, url: URL.createObjectURL(p.blob) });
  S.doc.assets[id] = meta;
  await Store.putAsset(S.slug, id, p.blob, meta);
  emit('assets');
  return { id, ...meta };
}

export async function insertImageFile(file, at) {
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) { toast('Formato não suportado: use PNG, JPG, WebP, GIF ou SVG.', 'err'); return null; }
  try {
    const a = await addAsset(file);
    return insertAsset(a.id, at);
  } catch (e) { console.error(e); toast('Não consegui abrir essa imagem.', 'err'); return null; }
}
export function insertAsset(id, at) {
  const m = S.doc.assets[id];
  const { w, h } = fit(m.w, m.h, S.dev === 'm' ? 300 : 420);
  const el = makeElement('image', { asset: id });
  place(el, at ? { x: at.x - w / 2, y: at.y - h / 2, w, h } : centered(w, h));
  addEls([el]);
  return el;
}
export async function replaceImage(el, file) {
  const a = await addAsset(file);
  mutate([el.id], (e) => { e.asset = a.id; }, 'struct');
  commit();
}

// ---------- SVG ----------
export function insertSvg(code, name = 'SVG', at) {
  const r = sanitizeSvg(code, 'svg-check');
  if (!r.ok) { toast(r.error, 'err'); return null; }
  const n = svgNaturalSize(code);
  const want = S.dev === 'm' ? 260 : Math.min(360, Math.max(n.w, 240));   // SVG de viewBox pequeno não entra minúsculo
  const { w, h } = fit(n.w, n.h, want, true);
  const el = makeElement('svg', { code, name });
  place(el, at ? { x: at.x - w / 2, y: at.y - h / 2, w, h } : centered(w, h));
  addEls([el]);
  return el;
}
// SVG que cobre a página inteira (fundos animados).
export function insertSvgBackground(code, name) {
  const el = makeElement('svg', { code, name });
  const dev = S.dev, H = pageH(S.doc, dev);
  place(el, { x: 0, y: 0, w: W[dev], h: H });
  el.lock = false;
  addEls([el]);
  S.doc.elements.splice(S.doc.elements.indexOf(el), 1);
  S.doc.elements.unshift(el); // vai para o fundo
  emit('struct');
  select([el.id]);
  commit();
}

// ---------- alinhar / distribuir ----------
const move = (ids, fn) => mutateGeom(ids, (el) => {
  const fr = frameOf(el, S.dev);
  const p = fn(aabb(fr), fr);
  setFrame(el, S.dev, { x: round(fr.x + p.dx, 1), y: round(fr.y + p.dy, 1) });
});

export function alignSel(mode) {
  const els = selEls();
  if (!els.length) return;
  const boxes = els.map((e) => aabb(frameOf(e, S.dev)));
  const ref = els.length === 1 ? { x: 0, y: 0, w: pageW(), h: pageH(S.doc, S.dev) } : unionBox(boxes);
  const ids = els.map((e) => e.id);
  move(ids, (b) => ({
    dx: mode === 'left' ? ref.x - b.x : mode === 'center' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : mode === 'right' ? ref.x + ref.w - (b.x + b.w) : 0,
    dy: mode === 'top' ? ref.y - b.y : mode === 'middle' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : mode === 'bottom' ? ref.y + ref.h - (b.y + b.h) : 0,
  }));
  commit();
}

export function distribute(axis) {
  const els = selEls();
  if (els.length < 3) return;
  const items = els.map((e) => ({ e, b: aabb(frameOf(e, S.dev)) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const size = (i) => (axis === 'h' ? i.b.w : i.b.h);
  const start = axis === 'h' ? items[0].b.x : items[0].b.y;
  const last = items[items.length - 1];
  const end = (axis === 'h' ? last.b.x : last.b.y) + size(last);
  const gap = (end - start - items.reduce((s, i) => s + size(i), 0)) / (items.length - 1);
  let pos = start;
  const target = new Map();
  for (const i of items) { target.set(i.e.id, pos); pos += size(i) + gap; }
  mutateGeom(els.map((e) => e.id), (el) => {
    const fr = frameOf(el, S.dev), b = aabb(fr), t = target.get(el.id);
    setFrame(el, S.dev, axis === 'h' ? { x: round(fr.x + (t - b.x), 1) } : { y: round(fr.y + (t - b.y), 1) });
  });
  commit();
}

// ---------- celular ----------
const isBackdrop = (el, H) => el.f.d.w >= W.d * 0.9 && el.f.d.h >= H * 0.6;

// Empilha os elementos do PC numa coluna única, na ordem de leitura. O resultado é só um ponto de partida.
export function autoStack(measureAll) {
  const H = pageH(S.doc, 'd');
  const els = S.doc.elements.filter((e) => !e.hide);
  const back = els.filter((e) => isBackdrop(e, H));
  const flow = els.filter((e) => !isBackdrop(e, H)).sort((a, b) => a.f.d.y - b.f.d.y || a.f.d.x - b.f.d.x);
  const MAXW = W.m - 40;
  for (const el of flow) {
    const d = el.f.d, s = d.w > MAXW ? MAXW / d.w : 1;
    if (el.t === 'text') {
      const fs0 = el.s.fontSize, w = Math.min(d.w, MAXW);
      const fs = Math.max(14, Math.round(fs0 * Math.max(s, 0.55)));
      el.f.m = { x: el.s.align === 'center' ? (W.m - w) / 2 : el.s.align === 'right' ? W.m - 20 - w : 20, y: 0, w, h: d.h, r: 0, fs };
    } else {
      const w = d.w * s, hh = d.h * s;
      el.f.m = { x: (W.m - w) / 2, y: 0, w, h: hh, r: d.r || 0 };
      if (el.t === 'shape' && el.label) el.f.m.fs = Math.max(12, Math.round(el.ls.fontSize * Math.max(s, 0.6)));
    }
  }
  emit('struct');
  measureAll(); // altura real dos textos com a nova largura/fonte
  let y = 28;
  flow.forEach((el, i) => {
    el.f.m.y = Math.round(y);
    el.f.m.x = Math.round(el.f.m.x);
    const next = flow[i + 1];
    const gap = next ? clamp((next.f.d.y - (el.f.d.y + el.f.d.h)) * 0.5, 14, 48) : 0;
    y += el.f.m.h + gap;
  });
  const total = Math.max(Math.round(y + 40), 700);
  for (const el of back) el.f.m = { x: 0, y: 0, w: W.m, h: total, r: 0 };
  setPage((p) => { p.h.m = total; });
  emit('struct');
  commit();
  toast('Layout do celular montado. Ajuste o que precisar.', 'ok');
}

export function resetMobile() {
  for (const el of S.doc.elements) delete el.f.m;
  setPage((p) => { delete p.h.m; });
  emit('struct');
  commit();
}

export function fitPageHeight() {
  const els = S.doc.elements.filter((e) => !e.hide);
  const bottoms = els.filter((e) => !isBackdrop(e, pageH(S.doc, 'd')) || S.dev === 'm').map((e) => { const b = aabb(frameOf(e, S.dev)); return b.y + b.h; });
  const h = Math.ceil((bottoms.length ? Math.max(...bottoms) : 600) + 60);
  setPage((p) => { p.h[S.dev] = h; });
  commit();
}

// Expande a altura da página se algo foi arrastado para além do fim.
export function ensureHeight() {
  const bottoms = S.doc.elements.filter((e) => !e.hide).map((e) => { const b = aabb(frameOf(e, S.dev)); return b.y + b.h; });
  const need = Math.ceil(Math.max(0, ...bottoms) + 40);
  if (need > pageH(S.doc, S.dev)) setPage((p) => { p.h[S.dev] = need; });
}
