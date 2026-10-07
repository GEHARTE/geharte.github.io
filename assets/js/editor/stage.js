// Palco do editor: renderização, zoom, seleção, arrastar/redimensionar/rotacionar, ferramentas de desenho.
import { h } from '../core/dom.js';
import { renderArtboard, renderElement } from '../core/render.js';
import { W, frameOf, setFrame, pageH, pageW, aabb, unionBox, bgCss } from '../core/model.js';
import { clamp, round } from '../core/util.js';
import { S, on, emit, byId, selEls, select, mutateGeom, mutate, commit, touch, assetUrl, setTool, removeEls, duplicate, reorder } from './state.js';
import { createShape, createText, createPath, insertImageFile, ensureHeight, defaultShapeSize, inkColor } from './tools.js';
import { abrirEditorImagem } from './imagem.js';
import { toast } from './ui.js';
import { pontoNaImagem } from '../core/imagem-edicao.js';
import { icon } from './icons.js';
import { guiasDe, candidatosDeGuias } from '../core/reguas.js';
import { cabeNaTela, ajustarNaGrade } from '../core/grade.js';
import { gradeAtual } from './reguas.js';
import { temGabarito, margemMm, sangriaPx, caixaDeCorte, caixaSegura, candidatosDeGabarito } from '../core/gabarito.js';

const PAD = 48;
let vp, stage, holder, selLayer, fxLayer, guiasLayer, gabLayer, gradeLayer, ab;
let previaGuia = null;   // guia sendo arrastada a partir da régua (editor/reguas.js)

const ctx = () => ({ dev: S.dev, assetUrl, editing: true, doc: S.doc });
export const nodeOf = (id) => ab?.querySelector(`:scope > [data-id="${id}"]`);
const guard = (el) => el && !el.hide;

// ---------- coordenadas ----------
function toDocRaw(cx, cy) {
  const r = holder.getBoundingClientRect();
  return { x: (cx - r.left) / S.zoom, y: (cy - r.top) / S.zoom };
}
const toDoc = (e) => toDocRaw(e.clientX, e.clientY);
const sx = (x) => PAD + x * S.zoom;

function boxOf(el) {
  const fr = { ...frameOf(el, S.dev) };
  if (el.t === 'text' && el.ah) { const n = nodeOf(el.id); if (n) fr.h = n.offsetHeight; }
  return fr;
}

function measure(el, node) {
  if (el.t !== 'text' || !el.ah || !node) return;
  const hh = round(node.offsetHeight, 1);
  if (S.dev === 'd') el.f.d.h = hh; else if (el.f.m) el.f.m.h = hh;
}
export function measureAll() { for (const el of S.doc.elements) measure(el, nodeOf(el.id)); }

// ---------- renderização ----------
function layout() {
  const z = S.zoom, w = pageW(S.doc, S.dev), hh = pageH(S.doc, S.dev);
  stage.style.width = w * z + PAD * 2 + 'px';
  stage.style.height = hh * z + PAD * 2 + 'px';
  Object.assign(holder.style, { left: PAD + 'px', top: PAD + 'px', width: w * z + 'px', height: hh * z + 'px' });
  if (ab) { ab.style.transform = `scale(${z})`; ab.style.width = w + 'px'; ab.style.height = hh + 'px'; }
  desenharGrade();
  desenharGuias();
  desenharGabarito();
}

// Grade de apoio (RG-08): um só elemento com duas camadas de linhas repetidas (barata mesmo em A0). Parte do 0 da régua (o corte).
// Com o passo apertado demais para o zoom (< 5 px de tela) some, mas o ímã continua valendo.
function desenharGrade() {
  if (!gradeLayer || !S.doc) return;
  gradeLayer.replaceChildren();
  const g = gradeAtual(), z = S.zoom;
  if (!g.visivel || !cabeNaTela(g.passoPx, z)) return;
  const s = g.passoPx * z, o = g.origemPx * z;
  gradeLayer.append(h('i', { class: 'grade-u', style: { left: PAD + 'px', top: PAD + 'px', width: pageW(S.doc, S.dev) * z + 'px', height: pageH(S.doc, S.dev) * z + 'px', backgroundSize: `${s}px ${s}px`, backgroundPosition: `${o}px ${o}px` } }));
}

// Gabarito de impressão (papel): faixa da SANGRIA (rosa, além do corte), linha do CORTE (tracejada) e MARGEM SEGURA (verde, dentro do corte).
function desenharGabarito() {
  if (!gabLayer || !S.doc) return;
  gabLayer.replaceChildren();
  if (!temGabarito(S.doc) || S.dev !== 'd') return;
  const z = S.zoom, w = pageW(S.doc, 'd') * z, hh = pageH(S.doc, 'd') * z, b = sangriaPx(S.doc) * z, c = caixaDeCorte(S.doc), s = caixaSegura(S.doc);
  const caixa = (r, cls) => h('i', { class: cls, style: { left: sx(r.x) + 'px', top: sx(r.y) + 'px', width: r.w * z + 'px', height: r.h * z + 'px' } });
  if (b > 0) {
    const buraco = `polygon(evenodd, 0 0, ${w}px 0, ${w}px ${hh}px, 0 ${hh}px, 0 0, ${b}px ${b}px, ${b}px ${hh - b}px, ${w - b}px ${hh - b}px, ${w - b}px ${b}px, ${b}px ${b}px)`;
    gabLayer.append(h('i', { class: 'gab-sangria', title: 'Sangria: o fundo e as imagens de borda devem chegar até aqui', style: { left: PAD + 'px', top: PAD + 'px', width: w + 'px', height: hh + 'px', clipPath: buraco } }), caixa(c, 'gab-corte'));
  }
  if (margemMm(S.doc) > 0) gabLayer.append(caixa(s, 'gab-margem'));
}

// Guias do usuário (azul-piscina): as do documento neste dispositivo + a que está sendo arrastada da régua.
function desenharGuias() {
  if (!guiasLayer || !S.doc) return;
  const g = guiasDe(S.doc, S.dev), z = S.zoom, w = pageW(S.doc, S.dev) * z, hh = pageH(S.doc, S.dev) * z;
  const linha = (eixo, pos, extra = '') => h('i', { class: `guia-u ${eixo === 'x' ? 'v' : 'hz'}${extra}`, 'data-eixo': eixo, 'data-pos': pos,
    style: eixo === 'x' ? { left: sx(pos) + 'px', top: PAD + 'px', height: hh + 'px' } : { top: sx(pos) + 'px', left: PAD + 'px', width: w + 'px' } });
  const filhos = [...g.x.map((p) => linha('x', p)), ...g.y.map((p) => linha('y', p))];
  if (previaGuia) {
    const sr = stage.getBoundingClientRect();
    filhos.push(linha(previaGuia.eixo, previaGuia.pos, ' previa'), h('span', { class: 'guia-rot', style: { left: previaGuia.cx - sr.left + 14 + 'px', top: previaGuia.cy - sr.top + 14 + 'px' } }, previaGuia.rotulo));
  }
  guiasLayer.replaceChildren(...filhos);
}

export function renderAll() {
  if (!S.doc) return;
  holder.innerHTML = '';
  ab = renderArtboard(S.doc, ctx());
  ab.style.transformOrigin = '0 0';
  holder.append(ab);
  layout();
  measureAll();
  applyAnimState();
  refreshOverlay();
}

function rerender(id) {
  const el = byId(id), old = nodeOf(id);
  if (!old) { if (el) renderAll(); return; }
  if (!el) { old.remove(); return; }
  const n = renderElement(el, ctx());
  old.replaceWith(n);
  measure(el, n);
  applyAnimState();
}

function applyGeom(id) {
  const el = byId(id), n = nodeOf(id);
  if (!el || !n) return;
  if (el.t === 'shape' || el.t === 'text' || el.t === 'abas') return rerender(id);
  const fr = frameOf(el, S.dev);
  Object.assign(n.style, { left: fr.x + 'px', top: fr.y + 'px', width: fr.w + 'px', height: fr.h + 'px', transform: fr.r ? `rotate(${fr.r}deg)` : '' });
}

export function applyAnimState() {
  vp.classList.toggle('noanim', !S.anim);
  ab?.querySelectorAll('svg').forEach((s) => { try { S.anim ? s.unpauseAnimations() : s.pauseAnimations(); } catch { /* sem SMIL */ } });
}

export function playEntrance(ids) {
  const targets = ids?.length ? ids : S.doc.elements.filter((e) => e.an?.in?.k).map((e) => e.id);
  for (const id of targets) {
    const inner = nodeOf(id)?.querySelector('.el-in');
    if (!inner || !inner.classList.contains('an-in')) continue;
    inner.classList.remove('an-go');
    void inner.offsetWidth;
    inner.classList.add('an-go');
    inner.addEventListener('animationend', () => inner.classList.remove('an-go'), { once: true });
  }
}

// ---------- zoom ----------
export function setZoom(z, cx, cy) {
  z = clamp(z, 0.1, 4);
  const r = vp.getBoundingClientRect();
  const ax = cx ?? r.left + r.width / 2, ay = cy ?? r.top + r.height / 2;
  const p = toDocRaw(ax, ay);
  S.zoom = z;
  layout();
  const hr = holder.getBoundingClientRect();
  vp.scrollLeft += hr.left + p.x * z - ax;
  vp.scrollTop += hr.top + p.y * z - ay;
  refreshOverlay();
  emit('zoom');
}
export function fit() {
  const w = pageW(S.doc, S.dev), hh = pageH(S.doc, S.dev);
  const zw = (vp.clientWidth - PAD * 2) / w, zh = (vp.clientHeight - 40) / Math.min(hh, S.dev === 'm' ? 844 : 760);
  S.zoom = clamp(Math.min(zw, zh, 1.5), 0.1, 4);
  layout();
  vp.scrollLeft = (stage.offsetWidth - vp.clientWidth) / 2;
  vp.scrollTop = 0;
  refreshOverlay();
  emit('zoom');
}

// ---------- overlay (seleção) ----------
const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

export function refreshOverlay() {
  if (!selLayer || !S.doc) return;
  selLayer.innerHTML = '';
  const els = selEls().filter(guard);
  if (!els.length) return;
  const z = S.zoom;

  if (els.length === 1) {
    const el = els[0], b = boxOf(el);
    const box = h('div', { class: 'sel-box' + (el.lock ? ' locked' : '') });
    Object.assign(box.style, { left: sx(b.x) + 'px', top: sx(b.y) + 'px', width: b.w * z + 'px', height: b.h * z + 'px', transform: b.r ? `rotate(${b.r}deg)` : '' });
    if (!el.lock && S.editing !== el.id) {
      const textLike = el.t === 'text';
      for (const [k, [px, py]] of Object.entries(HANDLES)) {
        if (textLike && (k === 'n' || k === 's')) continue;
        box.append(h('i', { class: 'hdl hdl-' + k, 'data-h': k, style: { left: px + '%', top: py + '%' } }));
      }
      box.append(h('i', { class: 'hdl-rot', 'data-h': 'rot', html: icon('reset', 12) }));
    }
    box.append(h('span', { class: 'dim' }, `${round(b.w, 0)} × ${round(b.h, 0)}`));
    selLayer.append(box);
  } else {
    for (const el of els) {
      const b = boxOf(el);
      selLayer.append(h('div', { class: 'sel-box sub', style: { left: sx(b.x) + 'px', top: sx(b.y) + 'px', width: b.w * z + 'px', height: b.h * z + 'px', transform: b.r ? `rotate(${b.r}deg)` : '' } }));
    }
    const u = unionBox(els.map((e) => aabb(boxOf(e))));
    const g = h('div', { class: 'sel-box group', style: { left: sx(u.x) + 'px', top: sx(u.y) + 'px', width: u.w * z + 'px', height: u.h * z + 'px' } });
    for (const k of ['nw', 'ne', 'se', 'sw']) g.append(h('i', { class: 'hdl hdl-' + k, 'data-h': k, style: { left: HANDLES[k][0] + '%', top: HANDLES[k][1] + '%' } }));
    g.append(h('span', { class: 'dim' }, `${els.length} itens`));
    selLayer.append(g);
  }
  if (S.editing) return;

  // barra flutuante
  const u = unionBox(els.map((e) => aabb(boxOf(e))));
  const bar = h('div', { class: 'floatbar' });
  const fb = (ic, title, fn) => h('button', { type: 'button', title, html: icon(ic, 15), onclick: fn });
  const unica = els.length === 1 && els[0].t === 'image' && !/gif|svg/.test(S.doc.assets?.[els[0].asset]?.mime || '') ? els[0] : null;
  bar.append(
    ...(unica ? [fb('wand', 'Varinha mágica: tirar o fundo / fazer PNG', () => abrirEditorImagem(unica, { ferramenta: 'varinha' })), fb('crop', 'Recortar imagem', () => abrirEditorImagem(unica, { ferramenta: 'recorte' }))] : []),
    fb('copy', 'Duplicar (Ctrl+D)', () => duplicate()),
    fb(els.every((e) => e.lock) ? 'lock' : 'unlock', 'Travar / destravar', () => { const lock = !els.every((e) => e.lock); mutate(S.sel, (e) => { e.lock = lock; }, 'struct'); commit(); refreshOverlay(); emit('struct-lite'); }),
    fb('front', 'Trazer para frente (])', () => reorder(S.sel, 'front')),
    fb('back', 'Enviar para trás ([)', () => reorder(S.sel, 'back')),
    fb('trash', 'Excluir (Del)', () => removeEls(S.sel)),
  );
  const cx = sx(u.x + u.w / 2);
  let top = sx(u.y) - 46;
  if (top < 4) top = sx(u.y + u.h) + 14;
  Object.assign(bar.style, { left: cx + 'px', top: top + 'px' });
  selLayer.append(bar);
}

function clearFx() { fxLayer.innerHTML = ''; }
function guides(list) {
  clearFx();
  const hh = pageH(S.doc, S.dev), w = pageW(S.doc, S.dev);
  for (const g of list) {
    fxLayer.append(g.x != null
      ? h('i', { class: 'guide v', style: { left: sx(g.x) + 'px', top: PAD + 'px', height: hh * S.zoom + 'px' } })
      : h('i', { class: 'guide hz', style: { top: sx(g.y) + 'px', left: PAD + 'px', width: w * S.zoom + 'px' } }));
  }
}

// ---------- gestos ----------
let abortDrag = null;   // encerra o arraste em curso (o segundo dedo do gesto de pinça cancela o que o primeiro começou)
function drag(e, onMove, onUp) {
  const move = (ev) => onMove(ev);
  const up = (ev) => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); abortDrag = null; onUp?.(ev); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
  addEventListener('pointercancel', up, { once: true });
  abortDrag = () => up();
}

// ---------- toque: pinça (zoom + mover com dois dedos) e arrastar com um dedo no vazio ----------
const dedos = new Map();
function startPinch() {
  abortDrag?.();
  const pts = () => [...dedos.values()];
  const dist = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const meio = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d0 = dist(pts()), z0 = S.zoom;
  let last = meio(pts());
  const move = (ev) => {
    if (!dedos.has(ev.pointerId)) return;
    dedos.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (dedos.size < 2) return;
    const m = meio(pts());
    setZoom(z0 * dist(pts()) / d0, last[0], last[1]);          // o ponto sob os dedos fica sob os dedos...
    vp.scrollLeft += last[0] - m[0]; vp.scrollTop += last[1] - m[1];   // ...e acompanha o movimento deles
    last = m;
  };
  const fim = () => { if (dedos.size < 2) { removeEventListener('pointermove', move); removeEventListener('pointerup', fim); removeEventListener('pointercancel', fim); } };
  addEventListener('pointermove', move); addEventListener('pointerup', fim); addEventListener('pointercancel', fim);
}
function startTouchPan(e) {
  const x0 = e.clientX, y0 = e.clientY, sl = vp.scrollLeft, st = vp.scrollTop;
  let moved = false;
  drag(e, (ev) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; moved = true; vp.scrollLeft = sl - (ev.clientX - x0); vp.scrollTop = st - (ev.clientY - y0); },
    () => { if (!moved) select([]); });   // toque rápido no vazio = desmarcar
}

function snapBox(box, others) {
  const T = 6 / S.zoom, w = pageW(S.doc, S.dev), hh = pageH(S.doc, S.dev);
  const gu = candidatosDeGuias(S.doc, S.dev);                      // as guias do usuário também "grudam"
  const gb = candidatosDeGabarito(S.doc, S.dev);                    // corte e margem segura (papel)
  const xs = [0, w / 2, w, ...gu.xs, ...gb.xs], ys = [0, hh / 2, hh, ...gu.ys, ...gb.ys];
  for (const o of others) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  const best = (mine, cands) => {
    let d = null;
    for (const m of mine) for (const c of cands) { const v = c - m; if (Math.abs(v) <= T && (d == null || Math.abs(v) < Math.abs(d))) d = v; }
    return d;
  };
  let dx = best([box.x, box.x + box.w / 2, box.x + box.w], xs), dy = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
  const grade = gradeAtual();                                       // ímã na grade: só quando nenhuma guia, borda ou vizinho está ao alcance
  if (grade.ima && (dx == null || dy == null)) { const gd = ajustarNaGrade(box, grade.passoPx, grade.origemPx, grade.origemPx); dx ??= gd.dx; dy ??= gd.dy; }
  dx ??= 0; dy ??= 0;
  const out = [];
  for (const m of [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx]) { const c = xs.find((c) => Math.abs(c - m) < 0.5); if (c != null) out.push({ x: c }); }
  for (const m of [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy]) { const c = ys.find((c) => Math.abs(c - m) < 0.5); if (c != null) out.push({ y: c }); }
  return { dx, dy, guides: out };
}

function startPan(e) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY, sl = vp.scrollLeft, st = vp.scrollTop;
  vp.classList.add('panning-now');
  drag(e, (ev) => { vp.scrollLeft = sl - (ev.clientX - x0); vp.scrollTop = st - (ev.clientY - y0); }, () => vp.classList.remove('panning-now'));
}

function startMove(e, hitId) {
  const els = selEls().filter((x) => !x.lock);
  if (!els.length) return;
  for (const el of els) if (S.dev === 'm' && !el.f.m) setFrame(el, 'm', {});
  const ids = els.map((x) => x.id);
  const start = new Map(els.map((el) => [el.id, { ...frameOf(el, S.dev) }]));
  const ub = unionBox([...start.values()].map(aabb));
  const others = S.doc.elements.filter((x) => guard(x) && !ids.includes(x.id)).map((x) => aabb(boxOf(x)));
  const p0 = toDoc(e);
  let moved = false;
  drag(e, (ev) => {
    if (!moved) { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return; moved = true; selLayer.classList.add('dragging'); }
    const p = toDoc(ev);
    let dx = p.x - p0.x, dy = p.y - p0.y;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (!ev.altKey) { const sn = snapBox({ x: ub.x + dx, y: ub.y + dy, w: ub.w, h: ub.h }, others); dx += sn.dx; dy += sn.dy; guides(sn.guides); } else clearFx();
    mutateGeom(ids, (el) => { const s = start.get(el.id); setFrame(el, S.dev, { x: round(s.x + dx, 1), y: round(s.y + dy, 1) }); });
    refreshOverlay();
  }, () => {
    clearFx(); selLayer.classList.remove('dragging');
    if (moved) { ensureHeight(); commit(); emit('page'); } else if (ids.length > 1 && !e.shiftKey) select([hitId]);
    refreshOverlay();
  });
}

function startRotate(e) {
  const el = selEls()[0];
  if (!el || el.lock) return;
  if (S.dev === 'm' && !el.f.m) setFrame(el, 'm', {});
  const f = frameOf(el, S.dev), c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  drag(e, (ev) => {
    const p = toDoc(ev);
    let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
    a = ((a + 540) % 360) - 180;
    const snap = ev.shiftKey ? 15 : 0;
    if (snap) a = Math.round(a / snap) * snap;
    else for (const t of [-180, -90, 0, 90, 180]) if (Math.abs(a - t) < 3) a = t;
    mutateGeom([el.id], (x) => setFrame(x, S.dev, { r: round(a, 1) }));
    refreshOverlay();
  }, () => commit());
}

function startResize(handle, e) {
  const el = selEls()[0];
  if (!el || el.lock) return;
  if (S.dev === 'm' && !el.f.m) setFrame(el, 'm', {});
  const f0 = boxOf(el);
  const rad = ((f0.r || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const R = (v) => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos });
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const c0 = { x: f0.x + f0.w / 2, y: f0.y + f0.h / 2 };
  const aL = R({ x: -hx * f0.w / 2, y: -hy * f0.h / 2 });
  const A = { x: c0.x + aL.x, y: c0.y + aL.y };           // âncora: ponto oposto, fixo durante o gesto
  const MIN = 8, corner = hx && hy;
  const lockAspect = (ev) => (el.t === 'text' ? true : (el.t === 'image' || el.t === 'svg') ? !ev.shiftKey : ev.shiftKey);
  const fs0 = f0.fs;
  drag(e, (ev) => {
    const p = toDoc(ev), d = { x: p.x - A.x, y: p.y - A.y };
    const lx = d.x * cos + d.y * sin, ly = -d.x * sin + d.y * cos;
    let w = hx ? Math.max(MIN, hx * lx) : f0.w, hh = hy ? Math.max(MIN, hy * ly) : f0.h;
    if (corner && lockAspect(ev)) { const s = Math.max(w / f0.w, hh / f0.h); w = f0.w * s; hh = f0.h * s; }
    const aN = R({ x: -hx * w / 2, y: -hy * hh / 2 });
    const patch = { x: round(A.x - aN.x - w / 2, 1), y: round(A.y - aN.y - hh / 2, 1), w: round(w, 1), h: round(hh, 1) };
    if (el.t === 'text') { delete patch.h; if (corner) patch.fs = Math.max(6, round(fs0 * (w / f0.w), 1)); }
    mutateGeom([el.id], (x) => setFrame(x, S.dev, patch));
    refreshOverlay();
  }, () => { ensureHeight(); commit(); emit('page'); });
}

function startGroupScale(handle, e) {
  const els = selEls().filter((x) => !x.lock);
  for (const el of els) if (S.dev === 'm' && !el.f.m) setFrame(el, 'm', {});
  const start = new Map(els.map((el) => [el.id, { ...boxOf(el) }]));
  const u = unionBox([...start.values()].map(aabb));
  const hx = handle.includes('e') ? 1 : -1, hy = handle.includes('s') ? 1 : -1;
  const o = { x: hx > 0 ? u.x : u.x + u.w, y: hy > 0 ? u.y : u.y + u.h };
  const corner = { x: hx > 0 ? u.x + u.w : u.x, y: hy > 0 ? u.y + u.h : u.y };
  const vx = corner.x - o.x, vy = corner.y - o.y, vl = vx * vx + vy * vy;
  drag(e, (ev) => {
    const p = toDoc(ev);
    const s = clamp(((p.x - o.x) * vx + (p.y - o.y) * vy) / vl, 0.05, 20);
    mutateGeom(els.map((x) => x.id), (el) => {
      const f = start.get(el.id);
      const patch = { x: round(o.x + (f.x - o.x) * s, 1), y: round(o.y + (f.y - o.y) * s, 1), w: round(f.w * s, 1), h: round(f.h * s, 1) };
      if (el.t === 'text') { delete patch.h; patch.fs = Math.max(6, round(f.fs * s, 1)); }
      else if (el.t === 'shape' && el.label) patch.fs = Math.max(6, round(f.fs * s, 1));
      setFrame(el, S.dev, patch);
    });
    refreshOverlay();
  }, () => { ensureHeight(); commit(); emit('page'); });
}

function startMarquee(e) {
  const r0 = stage.getBoundingClientRect();
  const x0 = e.clientX - r0.left, y0 = e.clientY - r0.top;
  const m = h('div', { class: 'marquee' });
  fxLayer.append(m);
  let moved = false, box = null;
  drag(e, (ev) => {
    const x1 = ev.clientX - r0.left, y1 = ev.clientY - r0.top;
    if (!moved && Math.hypot(x1 - x0, y1 - y0) < 3) return;
    moved = true;
    box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    Object.assign(m.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
  }, () => {
    m.remove();
    if (!moved) return;
    const z = S.zoom;
    const q = { x: (box.x - PAD) / z, y: (box.y - PAD) / z, w: box.w / z, h: box.h / z };
    const hits = S.doc.elements.filter((el) => {
      if (el.hide || el.lock) return false;
      const b = aabb(boxOf(el));
      return b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y;
    }).map((el) => el.id);
    select(hits, e.shiftKey ? 'add' : 'set');
  });
}

// ----- ferramentas de desenho -----
// Ferramenta "Varinha mágica" da barra lateral: clique numa imagem abre o editor já com a varinha no ponto clicado.
function usarVarinha(e) {
  const node = e.target.closest('.el'), el = node && byId(node.dataset.id);
  setTool('select');
  if (!el || el.t !== 'image') { toast('Clique em cima de uma imagem para usar a varinha mágica.'); return; }
  const m = S.doc.assets?.[el.asset];
  const ponto = m ? pontoNaImagem(toDoc(e), frameOf(el, S.dev), { w: m.w, h: m.h }, el.s?.fit || 'cover') : null;
  select([el.id]);
  abrirEditorImagem(el, { ferramenta: 'varinha', ponto });
}

function startDraw(e) {
  const p0 = toDoc(e), tool = S.tool;
  const r0 = stage.getBoundingClientRect();
  const stageXY = (ev) => ({ x: ev.clientX - r0.left, y: ev.clientY - r0.top });

  if (tool === 'pencil') {
    const pts = [p0];
    const svg = h('svg', { class: 'pen-prev', width: stage.offsetWidth, height: stage.offsetHeight, html: `<path fill="none" stroke="${S.pen.stroke || inkColor()}" stroke-width="${S.pen.sw * S.zoom}" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>` });
    fxLayer.append(svg);
    const path = svg.querySelector('path');
    const draw = () => { path.setAttribute('d', 'M' + pts.map((p) => `${sx(p.x)} ${sx(p.y)}`).join('L')); };
    draw();
    drag(e, (ev) => { pts.push(toDoc(ev)); draw(); }, () => { svg.remove(); const el = createPath(pts); if (el) emit('page'); });
    return;
  }

  const m = h('div', { class: 'marquee draw' });
  fxLayer.append(m);
  let moved = false, box = null;
  drag(e, (ev) => {
    const p = toDoc(ev);
    let w = p.x - p0.x, hh = p.y - p0.y;
    if (tool === 'shape' && ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; }
    if (!moved && Math.hypot(w, hh) * S.zoom < 4) return;
    moved = true;
    box = { x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + hh), w: Math.abs(w), h: Math.abs(hh) };
    Object.assign(m.style, { left: sx(box.x) + 'px', top: sx(box.y) + 'px', width: box.w * S.zoom + 'px', height: box.h * S.zoom + 'px' });
  }, () => {
    m.remove();
    if (tool === 'shape') {
      let b = box;
      if (!moved) { const [w, hh] = defaultShapeSize(S.shapeKind); b = { x: p0.x - w / 2, y: p0.y - hh / 2, w, h: hh }; }
      if (S.shapeKind === 'line' || S.shapeKind === 'arrow') b.h = Math.max(b.h, 24);
      createShape(S.shapeKind, b);
      setTool('select');
    } else if (tool === 'text') {
      const w = moved && box.w > 40 ? box.w : (S.dev === 'm' ? 300 : 420);
      const el = createText({ x: p0.x, y: p0.y, w }, { fontSize: 36 }, 'Digite seu texto');
      setTool('select');
      requestAnimationFrame(() => editText(el.id, true));
    }
    emit('page');
  });
}

// ---------- edição de texto no lugar ----------
export function editText(id, selectAll = false) {
  const el = byId(id), node = nodeOf(id);
  if (!el || !node || el.t !== 'text' || el.lock) return;
  const ct = node.querySelector('.el-ct');
  S.editing = id;
  node.classList.add('is-editing');
  ct.contentEditable = 'plaintext-only';
  if (ct.contentEditable !== 'plaintext-only') ct.contentEditable = 'true';
  ct.focus();
  const sel = getSelection(), rg = document.createRange();
  rg.selectNodeContents(ct);
  if (!selectAll) rg.collapse(false);
  sel.removeAllRanges(); sel.addRange(rg);
  refreshOverlay();

  const onInput = () => { measure(el, node); refreshOverlay(); };
  ct.addEventListener('input', onInput);
  ct.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); });
  ct.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') ct.blur(); });
  ct.addEventListener('blur', () => {
    const text = ct.innerText.replace(/\n$/, '');
    S.editing = null;
    if (!text.trim()) { removeEls([id]); return; }
    mutate([id], (x) => { x.text = text; }, 'canvas');
    commit();
  }, { once: true });
}

// ---------- inicialização ----------
export function nudge(dx, dy) {
  const els = selEls().filter((e) => !e.lock);
  if (!els.length) return;
  for (const el of els) if (S.dev === 'm' && !el.f.m) setFrame(el, 'm', {});
  mutateGeom(els.map((e) => e.id), (el) => { const f = frameOf(el, S.dev); setFrame(el, S.dev, { x: round(f.x + dx, 1), y: round(f.y + dy, 1) }); });
  refreshOverlay();
  touch();
}

export function initStage(refs) {
  ({ vp, stage, holder } = refs);
  selLayer = h('div', { class: 'ov-sel' });
  fxLayer = h('div', { class: 'ov-fx' });
  guiasLayer = h('div', { class: 'ov-guias' });
  gabLayer = h('div', { class: 'ov-gabarito' });
  gradeLayer = h('div', { class: 'ov-grade' });
  refs.overlay.append(gradeLayer, gabLayer, guiasLayer, selLayer, fxLayer);
  on('guias', desenharGuias);
  on('grade', desenharGrade);
  on('guia-previa', (p) => { previaGuia = p; desenharGuias(); });

  S.viewCenter = () => {
    const r = vp.getBoundingClientRect(), p = toDocRaw(r.left + r.width / 2, r.top + r.height / 2);
    return { x: clamp(p.x, 0, pageW(S.doc, S.dev)), y: clamp(p.y, 0, pageH(S.doc, S.dev)) };
  };

  on('struct', renderAll);
  on('device', () => { renderAll(); fit(); });
  on('page', () => { if (!ab) return; ab.style.background = bgCss(S.doc.page.bg); layout(); refreshOverlay(); });
  on('select', refreshOverlay);
  on('struct-lite', refreshOverlay);
  on('el', ({ ids }) => { ids.forEach(rerender); refreshOverlay(); });
  on('geom', ({ ids }) => ids.forEach(applyGeom));
  on('tool', () => { vp.dataset.tool = S.tool; });
  on('assets', () => S.doc.elements.filter((e) => e.t === 'image').forEach((e) => rerender(e.id)));

  // dedos na tela: o 2º dedo vira pinça e o resto do tratamento do ponteiro nem chega a ver o evento
  const largaDedo = (e) => dedos.delete(e.pointerId);
  vp.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    dedos.set(e.pointerId, [e.clientX, e.clientY]);
    if (dedos.size === 2) { e.stopImmediatePropagation(); e.preventDefault(); startPinch(); }
    else if (dedos.size > 2) e.stopImmediatePropagation();
  }, true);
  addEventListener('pointerup', largaDedo); addEventListener('pointercancel', largaDedo);

  vp.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    if (S.editing) { if (e.target.closest('.is-editing')) return; document.activeElement?.blur(); }
    if (e.target.closest('.floatbar')) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    if (e.button === 1 || S.space || S.tool === 'hand') return startPan(e);
    const hd = e.target.closest('[data-h]');
    if (hd) { e.preventDefault(); const k = hd.dataset.h; return k === 'rot' ? startRotate(e) : S.sel.length > 1 ? startGroupScale(k, e) : startResize(k, e); }
    if (S.tool === 'wand') { e.preventDefault(); return usarVarinha(e); }
    if (S.tool !== 'select') { e.preventDefault(); return startDraw(e); }
    const node = e.target.closest('.el');
    if (node && ab.contains(node)) {
      e.preventDefault();
      const id = node.dataset.id;
      if (e.shiftKey) { select([id], 'toggle'); return; }
      if (!S.sel.includes(id)) select([id]);
      startMove(e, id);
    } else {
      e.preventDefault();
      if (e.pointerType === 'touch') return startTouchPan(e);   // no celular, arrastar no vazio move a vista (a seleção em área fica para o mouse)
      if (!e.shiftKey) select([]);
      startMarquee(e);
    }
  });

  vp.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.el');
    if (!node) return;
    const el = byId(node.dataset.id);
    if (!el) return;
    if (el.t === 'text') editText(el.id);
    else if (el.t === 'svg') emit('editsvg', el.id);
    else if (el.t === 'shape') emit('focuslabel', el.id);
  });

  vp.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(S.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  vp.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  vp.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const at = toDoc(e);
    for (const f of files) await insertImageFile(f, at);
  });

  new ResizeObserver(() => refreshOverlay()).observe(vp);
}
