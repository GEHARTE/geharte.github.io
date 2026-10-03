// Renderizador único: o editor, o preview e a página pública usam este código,
// então o que se vê ao editar é o que se publica.
//
// Camadas de cada elemento (separadas para animações não brigarem entre si):
//   .el  posição / tamanho / rotação
//   .el-in  animação de entrada, hover e link
//   .el-lp  animação contínua (loop)
//   .el-ct  conteúdo (opacidade, sombra, desfoque, mistura)
import { h } from './dom.js';
import { W, frameOf, pageH, bgCss } from './model.js';
import { sanitizeSvg } from './sanitize.js';
import { safeHref } from './util.js';
import { fontStack } from './fonts.js';

// ---------- formas ----------
// Formas "normalizadas" (caixa 100x100), esticadas para a caixa do elemento.
export const NORM = {
  heart: 'M50 88C20 65 2 48 2 28 2 14 13 4 26 4c10 0 19 6 24 14 5-8 14-14 24-14 13 0 24 10 24 24 0 20-18 37-48 60z',
  cloud: 'M26 82C10 82 2 70 2 58c0-11 8-20 19-21C23 22 35 12 50 12c15 0 27 10 29 24 11 1 19 10 19 21 0 14-10 25-24 25z',
  bubble: 'M12 8h76c5 0 8 3 8 8v50c0 5-3 8-8 8H44L22 94V74H12c-5 0-8-3-8-8V16c0-5 3-8 8-8z',
  bolt: 'M58 2L14 56h30L36 98l50-60H56z',
  blob: 'M50 4C72 2 94 18 96 42c2 24-10 52-34 54-24 2-58-6-60-36C0 30 26 6 50 4z',
  cross: 'M36 4h28v32h32v28H64v32H36V64H4V36h32z',
  arrowblock: 'M4 34h56V6l36 44-36 44V66H4z',
  drop: 'M50 4C50 4 12 46 12 66a38 38 0 0 0 76 0C88 46 50 4 50 4z',
  moon: 'M62 4a46 46 0 1 0 34 70A38 38 0 0 1 62 4z',
};

export const SHAPE_LIST = [
  ['rect', 'Retângulo'], ['ellipse', 'Círculo'], ['triangle', 'Triângulo'], ['diamond', 'Losango'], ['star', 'Estrela'],
  ['polygon', 'Polígono'], ['line', 'Linha'], ['arrow', 'Seta'], ['heart', 'Coração'], ['cloud', 'Nuvem'],
  ['bubble', 'Balão'], ['bolt', 'Raio'], ['blob', 'Blob'], ['cross', 'Cruz'], ['arrowblock', 'Seta cheia'], ['drop', 'Gota'], ['moon', 'Lua'],
];

const ngon = (cx, cy, rx, ry, n, rot = -Math.PI / 2, inner = 1) => {
  const pts = [], steps = inner === 1 ? n : n * 2;
  for (let i = 0; i < steps; i++) {
    const k = inner === 1 ? 1 : i % 2 ? inner : 1;
    const a = rot + (i * 2 * Math.PI) / steps;
    pts.push(`${(cx + Math.cos(a) * rx * k).toFixed(2)},${(cy + Math.sin(a) * ry * k).toFixed(2)}`);
  }
  return pts.join(' ');
};

export function shapeSvg(el, w, hgt) {
  const s = el.s, sw = +s.sw || 0, i = sw / 2;
  const iw = Math.max(1, w - sw), ih = Math.max(1, hgt - sw);
  const gid = `gr-${el.id}`;
  let defs = '';
  let fill = s.fill || 'none';
  if (s.grad) {
    const a = ((s.grad.a - 90) * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    defs = `<defs><linearGradient id="${gid}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}"><stop offset="0" stop-color="${s.grad.c1}"/><stop offset="1" stop-color="${s.grad.c2}"/></linearGradient></defs>`;
    fill = `url(#${gid})`;
  }
  const mk = (w) => {
    const dash = s.dash === 1 ? `stroke-dasharray="${w * 3} ${w * 2}"` : s.dash === 2 ? `stroke-dasharray="0.01 ${w * 2}" stroke-linecap="round"` : '';
    return `fill="${fill}" stroke="${sw ? s.stroke : 'none'}" stroke-width="${w}" stroke-linejoin="round" ${dash}`;
  };
  const common = mk(sw);
  const lineCommon = `fill="none" stroke="${s.stroke}" stroke-width="${sw || 4}" stroke-linecap="round" stroke-linejoin="round" ${s.dash === 1 ? `stroke-dasharray="${sw * 3} ${sw * 2}"` : s.dash === 2 ? `stroke-dasharray="0.01 ${sw * 2}"` : ''}`;
  let body = '';
  switch (el.shape) {
    case 'rect': { const r = Math.min(+s.radius || 0, iw / 2, ih / 2); body = `<rect x="${i}" y="${i}" width="${iw}" height="${ih}" rx="${r}" ${common}/>`; break; }
    case 'ellipse': body = `<ellipse cx="${w / 2}" cy="${hgt / 2}" rx="${iw / 2}" ry="${ih / 2}" ${common}/>`; break;
    case 'triangle': body = `<polygon points="${w / 2},${i} ${w - i},${hgt - i} ${i},${hgt - i}" ${common}/>`; break;
    case 'diamond': body = `<polygon points="${w / 2},${i} ${w - i},${hgt / 2} ${w / 2},${hgt - i} ${i},${hgt / 2}" ${common}/>`; break;
    case 'star': body = `<polygon points="${ngon(w / 2, hgt / 2, iw / 2, ih / 2, Math.max(3, s.sides | 0), -Math.PI / 2, s.inner ?? 0.45)}" ${common}/>`; break;
    case 'polygon': body = `<polygon points="${ngon(w / 2, hgt / 2, iw / 2, ih / 2, Math.max(3, s.sides | 0))}" ${common}/>`; break;
    case 'line': body = `<line x1="${i + 2}" y1="${hgt / 2}" x2="${w - i - 2}" y2="${hgt / 2}" ${lineCommon}/>`; break;
    case 'arrow': { const hd = Math.min(hgt / 2 - 2, w / 3, 40); body = `<path d="M${i + 2} ${hgt / 2}H${w - 4}M${w - 4 - hd} ${hgt / 2 - hd}L${w - 4} ${hgt / 2}L${w - 4 - hd} ${hgt / 2 + hd}" ${lineCommon}/>`; break; }
    default:
      if (NORM[el.shape]) {
        const k = Math.sqrt((iw / 100) * (ih / 100)) || 1;   // compensa a escala para a espessura ficar igual
        body = `<g transform="translate(${i} ${i}) scale(${iw / 100} ${ih / 100})"><path d="${NORM[el.shape]}" ${mk(sw / k)}/></g>`;
      }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" style="overflow:visible;display:block">${defs}${body}</svg>`;
}

function pathSvg(el, fr) {
  const s = el.s;
  // sem non-scaling-stroke: assim "desenhar o traço" (dasharray em pathLength=1) funciona; a espessura compensa a escala
  const k = Math.sqrt((fr.w / el.vb[0]) * (fr.h / el.vb[1])) || 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${el.vb[0]} ${el.vb[1]}" preserveAspectRatio="none" style="overflow:visible;display:block"><path d="${el.d}" fill="${s.fill || 'none'}" stroke="${s.stroke}" stroke-width="${s.sw / k}" stroke-linecap="${s.cap || 'round'}" stroke-linejoin="round"/></svg>`;
}

// ---------- elementos ----------
const svgCache = new Map();
function svgFor(el) {
  const key = el.id + '|' + el.code;
  if (!svgCache.has(key)) { if (svgCache.size > 200) svgCache.clear(); svgCache.set(key, sanitizeSvg(el.code, `svg-${el.id}`)); }
  return svgCache.get(key);
}

function effects(el, ct) {
  const s = el.s || {};
  const f = [];
  if (s.shadow) f.push(`drop-shadow(${s.shadow.x}px ${s.shadow.y}px ${s.shadow.b}px ${s.shadow.c})`);
  if (s.blur) f.push(`blur(${s.blur}px)`);
  if (f.length) ct.style.filter = f.join(' ');
  if (s.opacity != null && s.opacity < 1) ct.style.opacity = s.opacity;
  if (s.blend && s.blend !== 'normal') ct.style.mixBlendMode = s.blend;
}

function content(el, fr, ctx) {
  const ct = h('div', { class: 'el-ct' });
  switch (el.t) {
    case 'text': {
      const s = el.s;
      ct.classList.add('txt');
      Object.assign(ct.style, {
        fontFamily: fontStack(s.fontFamily), fontSize: fr.fs + 'px', fontWeight: s.fontWeight, fontStyle: s.italic ? 'italic' : 'normal',
        textDecoration: s.underline ? 'underline' : 'none', textTransform: s.upper ? 'uppercase' : 'none', textAlign: s.align,
        color: s.color, lineHeight: s.lh, letterSpacing: s.ls + 'em',
      });
      ct.textContent = el.text;
      break;
    }
    case 'shape': {
      ct.innerHTML = shapeSvg(el, fr.w, fr.h);
      if (el.label) {
        const l = el.ls;
        const lab = h('div', { class: 'shape-label' }, el.label);
        Object.assign(lab.style, { fontFamily: fontStack(l.fontFamily), fontSize: fr.fs + 'px', fontWeight: l.fontWeight, color: l.color });
        ct.append(lab);
      }
      break;
    }
    case 'path': ct.innerHTML = pathSvg(el, fr); break;
    case 'image': {
      const url = el.asset && ctx.assetUrl ? ctx.assetUrl(el.asset) : null;
      if (url) {
        const img = h('img', { src: url, alt: el.name || '', draggable: 'false' });
        Object.assign(img.style, { objectFit: el.s.fit || 'cover', borderRadius: (el.s.radius || 0) + 'px' });
        ct.append(img);
      } else ct.append(h('div', { class: 'img-missing' }, 'imagem'));
      break;
    }
    case 'svg': {
      ct.classList.add('el-svg', `svg-${el.id}`);
      const r = svgFor(el);
      if (r.ok) ct.innerHTML = r.svg;
      else ct.append(h('div', { class: 'img-missing' }, r.error));
      break;
    }
  }
  effects(el, ct);
  if (el.an?.in?.k === 'draw') ct.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect').forEach((n) => n.setAttribute('pathLength', '1'));
  return ct;
}

export function renderElement(el, ctx) {
  const fr = frameOf(el, ctx.dev);
  const wrap = h('div', { class: `el el-${el.t}`, 'data-id': el.id });
  const st = wrap.style;
  st.left = fr.x + 'px'; st.top = fr.y + 'px'; st.width = fr.w + 'px';
  st.height = el.t === 'text' && el.ah ? 'auto' : fr.h + 'px';
  if (fr.r) st.transform = `rotate(${fr.r}deg)`;
  if (ctx.editing) {
    if (el.hide) wrap.classList.add('is-hidden');
    if (el.lock) wrap.classList.add('is-locked');
  }

  const href = !ctx.editing && el.link?.href ? safeHref(el.link.href) : null;
  const inner = href
    ? h('a', { class: 'el-in', href, target: el.link.blank ? '_blank' : null, rel: 'noopener' })
    : h('div', { class: 'el-in' });
  const lp = h('div', { class: 'el-lp' });
  lp.append(content(el, fr, ctx));
  inner.append(lp);
  wrap.append(inner);

  const an = el.an;
  if (an?.in?.k) {
    inner.classList.add('an-in', 'an-in-' + an.in.k);
    inner.style.setProperty('--ad', (an.in.dur ?? 0.8) + 's');
    inner.style.setProperty('--adl', (an.in.delay ?? 0) + 's');
    inner.style.setProperty('--ae', an.in.ease || 'ease-out');
    if (!ctx.editing) inner.classList.add('an-pre');
  }
  if (an?.loop?.k) {
    lp.classList.add('an-loop', 'an-loop-' + an.loop.k);
    lp.style.setProperty('--ld', (an.loop.dur ?? 3) + 's');
  }
  if (an?.hover?.k) inner.classList.add('an-hover', 'an-hover-' + an.hover.k);
  return wrap;
}

export function renderArtboard(doc, ctx) {
  const ab = h('div', { class: 'artboard', 'data-dev': ctx.dev });
  ab.style.width = W[ctx.dev] + 'px';
  ab.style.height = pageH(doc, ctx.dev) + 'px';
  ab.style.background = bgCss(doc.page.bg);
  for (const el of doc.elements) if (ctx.editing || !el.hide) ab.append(renderElement(el, ctx));
  return ab;
}

// Dispara as animações de entrada quando cada elemento entra na tela (página pública).
export function observeEntrances(root) {
  const items = [...root.querySelectorAll('.an-pre')];
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) { items.forEach((n) => { n.classList.remove('an-pre'); n.classList.add('an-go'); }); return; }
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('an-go');
      e.target.classList.remove('an-pre');
      io.unobserve(e.target);
    }
  }, { threshold: 0.12 });
  items.forEach((n) => io.observe(n));
}

export function usedFonts(doc) {
  const set = new Set();
  for (const e of doc.elements) { if (e.t === 'text') set.add(e.s.fontFamily); if (e.t === 'shape' && e.label) set.add(e.ls.fontFamily); }
  return [...set];
}
