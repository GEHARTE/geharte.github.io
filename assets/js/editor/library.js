// Biblioteca lateral: elementos, SVGs animados, mídia, Drive, modelos e camadas.
import { h } from '../core/dom.js';
import { makeElement, K, W } from '../core/model.js';
import { sanitizeSvg } from '../core/sanitize.js';
import { SHAPE_LIST, shapeSvg } from '../core/render.js';
import { S, on, emit, commit, select } from './state.js';
import { createShape, addTextPreset, insertSvg, insertSvgBackground, insertImageFile, insertAsset } from './tools.js';
import { renderLayers } from './layers.js';
import { driveTab } from './drive.js';
import { icon } from './icons.js';
import { btn, toast, modal } from './ui.js';

// ---------- presets de texto ----------
const TEXTS = [
  ['Título', { fontFamily: 'Space Grotesk', fontSize: 72, fontWeight: 700, lh: 1.05, ls: -0.03, w: 640 }, 'Título'],
  ['Subtítulo', { fontFamily: 'Inter', fontSize: 32, fontWeight: 500, lh: 1.25, color: '#5a5766', w: 560 }, 'Um subtítulo'],
  ['Parágrafo', { fontFamily: 'Inter', fontSize: 20, fontWeight: 400, lh: 1.6, w: 520 }, 'Escreva aqui um texto mais longo. Clique duas vezes para editar e arraste as bordas para mudar a largura.'],
  ['Citação', { fontFamily: 'Playfair Display', fontSize: 42, fontWeight: 500, italic: true, lh: 1.25, w: 620 }, '“Uma frase marcante.”'],
  ['Etiqueta', { fontFamily: 'Inter', fontSize: 14, fontWeight: 700, upper: true, ls: 0.14, color: '#e4572e', w: 260 }, 'Seção'],
  ['Manuscrito', { fontFamily: 'Caveat', fontSize: 64, fontWeight: 700, w: 520, color: '#7b5cff' }, 'Olá, mundo!'],
];

// ---------- biblioteca de SVG animados (SMIL e CSS) ----------
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const confetti = () => {
  const cols = ['#e4572e', '#ffb703', '#7b5cff', '#1f9d8b', '#d6336c'];
  let o = '';
  for (let i = 0; i < 26; i++) {
    const x = Math.round(rnd() * 380 + 10), d = (3 + rnd() * 3).toFixed(1), b = (-rnd() * 6).toFixed(1), c = cols[i % 5], w = 6 + Math.round(rnd() * 6);
    o += `<rect x="${x}" y="-20" width="${w}" height="${w * 1.6}" rx="1.5" fill="${c}"><animate attributeName="y" from="-30" to="440" dur="${d}s" begin="${b}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="rotate" from="0 ${x} 0" to="${rnd() > 0.5 ? 360 : -360} ${x} 0" dur="${(1.4 + rnd() * 2).toFixed(1)}s" begin="${b}s" repeatCount="indefinite"/></rect>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420">${o}</svg>`;
};
const bubbles = () => {
  let o = '';
  for (let i = 0; i < 14; i++) {
    const x = Math.round(rnd() * 1100 + 50), r = 8 + Math.round(rnd() * 34), d = (9 + rnd() * 9).toFixed(1), b = (-rnd() * 14).toFixed(1);
    o += `<circle cx="${x}" cy="900" r="${r}" fill="#fff" fill-opacity="${(0.07 + rnd() * 0.13).toFixed(2)}"><animate attributeName="cy" from="900" to="-80" dur="${d}s" begin="${b}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x};${x + 30};${x - 20};${x}" dur="${d}s" begin="${b}s" repeatCount="indefinite"/></circle>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b5fd9"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs><rect width="1200" height="800" fill="url(#bg)"/>${o}</svg>`;
};
const stars = () => {
  const pts = [[40, 50, 1.6, 2.2], [150, 30, 1, 1.6], [230, 90, 1.4, 2.8], [90, 140, 0.8, 1.8], [200, 200, 1.2, 2.4], [30, 230, 1, 3.1], [260, 250, 1.5, 1.9]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${pts.map(([x, y, s, d], i) => `<g transform="translate(${x} ${y}) scale(${s})"><path fill="#ffb703" d="M0-14Q0 0 14 0Q0 0 0 14Q0 0-14 0Q0 0 0-14Z"><animate attributeName="opacity" values=".15;1;.15" dur="${d}s" begin="${-i * 0.5}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="scale" values=".5;1.1;.5" dur="${d}s" begin="${-i * 0.5}s" repeatCount="indefinite"/></path></g>`).join('')}</svg>`;
};

export const SVG_LIB = [
  { name: 'Órbitas', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="78" fill="none" stroke="#17161d" stroke-opacity=".15" stroke-width="2"/><circle cx="100" cy="100" r="58" fill="none" stroke="#17161d" stroke-opacity=".1" stroke-width="2"/><circle cx="100" cy="100" r="22" fill="#e4572e"/><g><animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="6s" repeatCount="indefinite"/><circle cx="178" cy="100" r="11" fill="#7b5cff"/></g><g><animateTransform attributeName="transform" type="rotate" from="360 100 100" to="0 100 100" dur="3.5s" repeatCount="indefinite"/><circle cx="100" cy="42" r="7" fill="#ffb703"/></g></svg>' },
  { name: 'Ondas de rádio', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g fill="none" stroke="#e4572e" stroke-width="3"><circle cx="100" cy="100" r="10"><animate attributeName="r" values="10;92" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="2.4s" repeatCount="indefinite"/></circle><circle cx="100" cy="100" r="10"><animate attributeName="r" values="10;92" dur="2.4s" begin="0.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="2.4s" begin="0.8s" repeatCount="indefinite"/></circle><circle cx="100" cy="100" r="10"><animate attributeName="r" values="10;92" dur="2.4s" begin="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="2.4s" begin="1.6s" repeatCount="indefinite"/></circle></g><circle cx="100" cy="100" r="10" fill="#e4572e"/></svg>' },
  { name: 'Blob vivo', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4572e"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs><path fill="url(#g)" d="M100 20C150 20 180 55 180 100C180 150 145 180 100 180C55 180 20 148 20 100C20 55 50 20 100 20Z"><animate attributeName="d" dur="9s" repeatCount="indefinite" values="M100 20C150 20 180 55 180 100C180 150 145 180 100 180C55 180 20 148 20 100C20 55 50 20 100 20Z;M100 28C140 10 190 60 175 105C165 150 130 190 90 175C45 165 12 140 25 95C32 55 65 40 100 28Z;M105 15C155 30 185 70 170 115C158 160 120 185 80 172C40 160 15 120 28 80C40 40 75 8 105 15Z;M100 20C150 20 180 55 180 100C180 150 145 180 100 180C55 180 20 148 20 100C20 55 50 20 100 20Z"/></path></svg>' },
  { name: 'Onda', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200"><path fill="#2e6be4" fill-opacity=".35" d="M0 100C40 130 80 70 120 100S200 130 240 100V200H0Z"><animate attributeName="d" dur="5s" repeatCount="indefinite" values="M0 100C40 130 80 70 120 100S200 130 240 100V200H0Z;M0 100C40 70 80 130 120 100S200 70 240 100V200H0Z;M0 100C40 130 80 70 120 100S200 130 240 100V200H0Z"/></path><path fill="#2e6be4" d="M0 110C40 80 80 140 120 110S200 80 240 110V200H0Z"><animate attributeName="d" dur="3.6s" repeatCount="indefinite" values="M0 110C40 80 80 140 120 110S200 80 240 110V200H0Z;M0 110C40 140 80 80 120 110S200 140 240 110V200H0Z;M0 110C40 80 80 140 120 110S200 80 240 110V200H0Z"/></path></svg>' },
  { name: 'Coração batendo', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.h{transform-origin:50px 50px;animation:beat 1.1s ease-in-out infinite}@keyframes beat{0%,100%{transform:scale(1)}15%{transform:scale(1.18)}30%{transform:scale(1)}45%{transform:scale(1.12)}}</style><path class="h" fill="#e4572e" d="M50 88C20 65 2 48 2 28 2 14 13 4 26 4c10 0 19 6 24 14 5-8 14-14 24-14 13 0 24 10 24 24 0 20-18 37-48 60z"/></svg>' },
  { name: 'Estrelas piscando', cat: 'Animados', code: stars() },
  { name: 'Rabisco desenhando', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><style>.p{fill:none;stroke:#17161d;stroke-width:5;stroke-linecap:round;stroke-dasharray:420;stroke-dashoffset:420;animation:dr 3.2s ease-in-out infinite}@keyframes dr{0%{stroke-dashoffset:420}60%,100%{stroke-dashoffset:0}}</style><path class="p" d="M10 90C50 10 90 10 120 60S190 110 220 50 270 20 290 60"/></svg>' },
  { name: 'Sublinhado', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 40"><style>.u{fill:none;stroke:#e4572e;stroke-width:6;stroke-linecap:round;stroke-dasharray:320;stroke-dashoffset:320;animation:u 1.4s .2s ease-out forwards}@keyframes u{to{stroke-dashoffset:0}}</style><path class="u" d="M8 26C60 10 120 34 170 18S260 10 292 22"/></svg>' },
  { name: 'Carregando', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><g fill="#17161d"><circle cx="30" cy="20" r="8"><animate attributeName="cy" values="20;8;20" dur="1s" repeatCount="indefinite"/></circle><circle cx="60" cy="20" r="8"><animate attributeName="cy" values="20;8;20" dur="1s" begin=".15s" repeatCount="indefinite"/></circle><circle cx="90" cy="20" r="8"><animate attributeName="cy" values="20;8;20" dur="1s" begin=".3s" repeatCount="indefinite"/></circle></g></svg>' },
  { name: 'Anel degradê', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4572e"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs><circle cx="100" cy="100" r="76" fill="none" stroke="url(#g)" stroke-width="16" stroke-linecap="round" stroke-dasharray="360 120"><animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="2.4s" repeatCount="indefinite"/></circle></svg>' },
  { name: 'Confete', cat: 'Animados', code: confetti() },
  { name: 'Rolar para baixo', cat: 'Animados', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 90"><g fill="none" stroke="#17161d" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="44" height="78" rx="22" stroke-opacity=".35"/><path d="M22 52l8 8 8-8"><animate attributeName="opacity" values="0;1;0" dur="1.6s" repeatCount="indefinite"/></path><circle cx="30" cy="26" r="5" fill="#17161d" stroke="none"><animate attributeName="cy" values="22;40;22" dur="1.6s" repeatCount="indefinite"/></circle></g></svg>' },
  { name: 'Aurora', cat: 'Fundos', bg: true, code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter></defs><rect width="1200" height="800" fill="#14121f"/><g filter="url(#b)"><circle r="260" cx="300" cy="260" fill="#e4572e" opacity=".8"><animate attributeName="cx" values="300;560;300" dur="14s" repeatCount="indefinite"/><animate attributeName="cy" values="260;420;260" dur="11s" repeatCount="indefinite"/></circle><circle r="240" cx="900" cy="560" fill="#7b5cff" opacity=".8"><animate attributeName="cx" values="900;650;900" dur="16s" repeatCount="indefinite"/></circle><circle r="200" cx="700" cy="160" fill="#1f9d8b" opacity=".7"><animate attributeName="cy" values="160;380;160" dur="12s" repeatCount="indefinite"/></circle></g></svg>' },
  { name: 'Degradê girando', cat: 'Fundos', bg: true, code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="14s" repeatCount="indefinite"/><stop offset="0" stop-color="#ff7e5f"/><stop offset=".5" stop-color="#d6336c"/><stop offset="1" stop-color="#4b3fd8"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>' },
  { name: 'Bolhas subindo', cat: 'Fundos', bg: true, code: bubbles() },
];

// ---------- modelos ----------
function E(t, props, d, m) {
  const el = makeElement(t, props, d);
  if (m) el.f.m = { r: 0, ...m };
  return el;
}
const TPL = [
  {
    name: 'Em branco', desc: 'Comece do zero.',
    build: () => ({ page: { bg: { c: '#ffffff', g: null }, h: { d: 900, m: 1400 } }, elements: [] }),
  },
  {
    name: 'Cartão de apresentação', desc: 'Foto, nome, resumo e botão.',
    build: () => ({
      page: { bg: { c: '#17161d', g: { a: 160, c1: '#17161d', c2: '#3a1f3d' } }, h: { d: 760, m: 900 } },
      elements: [
        E('svg', { name: 'Órbitas', code: SVG_LIB[0].code, an: { loop: { k: 'float', dur: 5 } } }, { x: 820, y: 120, w: 300, h: 300 }, { x: 95, y: 40, w: 200, h: 200 }),
        E('shape', { name: 'Foto', shape: 'ellipse', s: { fill: null, grad: { a: 135, c1: '#e4572e', c2: '#7b5cff' } }, an: { in: { k: 'zoom-in', dur: 0.8, delay: 0, ease: 'ease-out' } } }, { x: 110, y: 150, w: 280, h: 280 }, { x: 105, y: 260, w: 180, h: 180 }),
        E('text', { name: 'Etiqueta', text: 'Olá, eu sou', s: { fontFamily: 'Inter', fontSize: 16, fontWeight: 700, upper: true, ls: 0.16, color: '#ffb703', lh: 1.2 }, an: { in: { k: 'fade-up', dur: 0.7, delay: 0.1, ease: 'ease-out' } } }, { x: 450, y: 170, w: 400, h: 24 }, { x: 24, y: 470, w: 342, h: 20, fs: 13 }),
        E('text', { name: 'Nome', text: 'Seu Nome', s: { fontFamily: 'Space Grotesk', fontSize: 96, fontWeight: 700, color: '#ffffff', lh: 1, ls: -0.035 }, an: { in: { k: 'fade-up', dur: 0.8, delay: 0.2, ease: 'ease-out' } } }, { x: 450, y: 205, w: 640, h: 100 }, { x: 24, y: 498, w: 342, h: 54, fs: 52 }),
        E('text', { name: 'Resumo', text: 'Escreva aqui uma frase sobre você, o que estuda e no que está trabalhando no Geharte.', s: { fontFamily: 'Inter', fontSize: 22, fontWeight: 400, color: '#cfcbe0', lh: 1.55 }, an: { in: { k: 'fade-up', dur: 0.8, delay: 0.35, ease: 'ease-out' } } }, { x: 450, y: 335, w: 560, h: 100 }, { x: 24, y: 566, w: 342, h: 100, fs: 17 }),
        E('shape', { name: 'Botão', shape: 'rect', label: 'Fale comigo', link: { href: 'mailto:', blank: false }, s: { fill: '#e4572e', radius: 9999 }, ls: { fontFamily: 'Inter', fontSize: 20, fontWeight: 600, color: '#ffffff' }, an: { hover: { k: 'lift' }, in: { k: 'bounce-in', dur: 0.8, delay: 0.55, ease: 'ease-out' } } }, { x: 450, y: 480, w: 220, h: 60 }, { x: 24, y: 690, w: 200, h: 54, fs: 18 }),
      ],
    }),
  },
  {
    name: 'Portfólio', desc: 'Título, 3 cartões e rodapé.',
    build: () => ({
      page: { bg: { c: '#f6f1e9', g: null }, h: { d: 1000, m: 1500 } },
      elements: [
        E('svg', { name: 'Blob', code: SVG_LIB[2].code, an: { loop: { k: 'float', dur: 7 } } }, { x: 860, y: 40, w: 280, h: 280 }, { x: 220, y: 20, w: 150, h: 150 }),
        E('text', { name: 'Título', text: 'Meus projetos', s: { fontFamily: 'Space Grotesk', fontSize: 88, fontWeight: 700, color: '#17161d', lh: 1, ls: -0.035 }, an: { in: { k: 'fade-up', dur: 0.8, delay: 0, ease: 'ease-out' } } }, { x: 100, y: 120, w: 720, h: 90 }, { x: 24, y: 120, w: 342, h: 100, fs: 46 }),
        E('text', { name: 'Subtítulo', text: 'Um pouco do que eu faço, aprendo e crio.', s: { fontFamily: 'Inter', fontSize: 26, fontWeight: 400, color: '#5a5766', lh: 1.4 }, an: { in: { k: 'fade-up', dur: 0.8, delay: 0.15, ease: 'ease-out' } } }, { x: 100, y: 245, w: 640, h: 40 }, { x: 24, y: 245, w: 342, h: 60, fs: 18 }),
        ...[0, 1, 2].map((i) => E('shape', { name: `Cartão ${i + 1}`, shape: 'rect', label: `Projeto ${i + 1}`, s: { fill: ['#e4572e', '#7b5cff', '#1f9d8b'][i], radius: 28, shadow: { x: 0, y: 18, b: 30, c: '#17161d33' } }, ls: { fontFamily: 'Space Grotesk', fontSize: 34, fontWeight: 700, color: '#ffffff' }, an: { in: { k: 'fade-up', dur: 0.7, delay: 0.2 + i * 0.15, ease: 'ease-out' }, hover: { k: 'lift' } } }, { x: 100 + i * 340, y: 370, w: 300, h: 380 }, { x: 24, y: 340 + i * 210, w: 342, h: 190, fs: 26 })),
        E('text', { name: 'Rodapé', text: 'Feito no Geharte · UEM', s: { fontFamily: 'Inter', fontSize: 16, fontWeight: 500, color: '#8a8799', lh: 1.4, align: 'center' } }, { x: 100, y: 900, w: 1000, h: 24 }, { x: 24, y: 1000, w: 342, h: 20, fs: 14 }),
      ],
    }),
  },
];

function applyTemplate(t) {
  const go = () => {
    const b = t.build();
    S.doc.elements = b.elements;
    S.doc.page = b.page;
    S.sel = [];
    emit('struct'); emit('select'); emit('page');
    commit();
    emit('fit');
  };
  if (S.doc.elements.length) modal({ title: 'Trocar de modelo?', body: h('p', {}, 'O conteúdo atual da página será substituído. (Dá para desfazer com Ctrl+Z.)'), actions: [btn({ label: 'Substituir', cls: 'primary', onClick: (e) => { go(); e.target.closest('.modal-back').remove(); } })] });
  else go();
}

// ---------- UI ----------
const TABS = [['els', 'square', 'Elementos'], ['svg', 'burst', 'SVG animado'], ['media', 'image', 'Mídia'], ['drive', 'cloud', 'Drive'], ['tpl', 'template', 'Modelos'], ['layers', 'layers', 'Camadas']];

export function initLibrary(root) {
  const tabs = h('div', { class: 'lib-tabs' });
  const body = h('div', { class: 'lib-body' });
  root.append(tabs, body);
  let cur = localStorage.getItem('geharte.libtab') || 'els';
  let cleanup = null;   // aba que precisa limpar algo ao sair (Drive)

  const tabEls = {};
  for (const [id, ic, title] of TABS) {
    tabEls[id] = h('button', { title, 'aria-label': title, html: icon(ic, 18), onclick: () => show(id) });
    tabs.append(tabEls[id]);
  }

  function show(id) {
    cur = id;
    cleanup?.(); cleanup = null;
    try { localStorage.setItem('geharte.libtab', id); } catch { /* ok */ }
    for (const k in tabEls) tabEls[k].classList.toggle('on', k === id);
    body.innerHTML = '';
    body.dataset.tab = id;
    ({ els, svg, media, drive, tpl, layers })[id]();
  }

  function els() {
    body.append(h('h4', {}, 'Texto'));
    body.append(h('div', { class: 'tpresets' }, TEXTS.map(([name, p, txt]) => h('button', { class: 'tp', style: { fontFamily: `'${p.fontFamily}'`, fontWeight: p.fontWeight, fontStyle: p.italic ? 'italic' : 'normal', textTransform: p.upper ? 'uppercase' : 'none', letterSpacing: (p.ls || 0) + 'em' }, onclick: () => addTextPreset(p, txt) }, name))));
    body.append(h('h4', {}, 'Formas'));
    body.append(h('div', { class: 'grid shapes' }, SHAPE_LIST.map(([k, label]) => {
      const prev = makeElement('shape', { shape: k, s: k === 'line' || k === 'arrow' ? { fill: null, stroke: '#cfcbe0', sw: 4 } : { fill: '#cfcbe0' } });
      return h('button', { class: 'cell', title: label, onclick: () => { S.shapeKind = k; createShape(k); } }, h('div', { class: 'pv', html: shapeSvg(prev, 52, 52) }));
    })));
    body.append(h('p', { class: 'hint pad' }, 'Clique para inserir. Para desenhar no tamanho que quiser, use a ferramenta Forma (R) e arraste no canvas.'));
  }

  function svg() {
    const cats = [...new Set(SVG_LIB.map((s) => s.cat))];
    for (const cat of cats) {
      body.append(h('h4', {}, cat));
      body.append(h('div', { class: 'grid svgs' }, SVG_LIB.filter((s) => s.cat === cat).map((s, i) => {
        const r = sanitizeSvg(s.code, 'lib-' + SVG_LIB.indexOf(s));
        return h('button', { class: 'cell wide' + (s.bg ? ' bgcell' : ''), title: s.name, onclick: () => (s.bg ? insertSvgBackground(s.code, s.name) : insertSvg(s.code, s.name)) },
          h('div', { class: 'pv', html: r.ok ? r.svg : '' }), h('span', {}, s.name));
      })));
    }
    body.append(h('div', { class: 'pad' }, btn({ label: 'Colar meu SVG…', ic: 'code', onClick: pasteSvg }), h('p', { class: 'hint' }, 'Suporta animações CSS e SMIL. Dica: exporte do Figma/Inkscape como SVG e cole aqui.')));
  }

  function media() {
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => { for (const f of file.files) await insertImageFile(f); file.value = ''; show('media'); } });
    body.append(h('div', { class: 'pad' }, btn({ label: 'Enviar imagem', ic: 'upload', cls: 'primary', onClick: () => file.click() }), file,
      h('p', { class: 'hint' }, 'PNG, JPG, WebP, GIF ou SVG. Também dá para arrastar arquivos para o canvas ou colar (Ctrl+V). As imagens são otimizadas automaticamente.')));
    const used = [...S.assets.entries()];
    if (!used.length) body.append(h('p', { class: 'hint pad' }, 'Nenhuma imagem enviada ainda.'));
    body.append(h('div', { class: 'grid media' }, used.map(([id, a]) => h('button', { class: 'cell', title: 'Inserir', onclick: () => insertAsset(id) }, h('img', { src: a.url, alt: '' })))));
  }

  function drive() { cleanup = driveTab(body); }

  function tpl() {
    body.append(h('p', { class: 'hint pad' }, 'Pontos de partida. Tudo é editável depois.'));
    body.append(h('div', { class: 'tpls' }, TPL.map((t) => h('button', { class: 'tpl', onclick: () => applyTemplate(t) }, h('b', {}, t.name), h('span', {}, t.desc)))));
  }

  function layers() { renderLayers(body); }

  on('assets', () => { if (cur === 'media') show('media'); });
  for (const ev of ['struct', 'select', 'struct-lite', 'layers']) on(ev, () => { if (cur === 'layers') renderLayers(body); });
  show(cur);
  return { show };
}

function pasteSvg() {
  const ta = h('textarea', { rows: 12, class: 'mono', spellcheck: 'false', placeholder: '<svg viewBox="0 0 100 100"> … </svg>' });
  const m = modal({ title: 'Colar SVG', wide: true, body: [h('p', { class: 'hint' }, 'Cole o código completo do SVG. Scripts e links externos são removidos automaticamente.'), ta],
    actions: [btn({ label: 'Inserir', cls: 'primary', onClick: () => { if (insertSvg(ta.value, 'SVG colado')) m.close(); } })] });
  ta.focus();
}
