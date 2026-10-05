// Painel direito: propriedades contextuais do que está selecionado (ou da página).
import { h } from '../core/dom.js';
import { debounce, round } from '../core/util.js';
import { W, K, frameOf, setFrame, pageH, fontOwner, DEV_LABEL } from '../core/model.js';
import { FONTS, fontStack } from '../core/fonts.js';
import { SHAPE_LIST } from '../core/render.js';
import { sanitizeSvg } from '../core/sanitize.js';
import { S, on, emit, selEls, mutate, mutateGeom, commit, touch, setPage, byId } from './state.js';
import { inkColor, alignSel, distribute, autoStack, resetMobile, fitPageHeight, replaceImage } from './tools.js';
import { measureAll, playEntrance, nodeOf } from './stage.js';
import { icon } from './icons.js';
import { btn, section, row, hint, num, range, select, seg, toggle, textInput, colorField } from './ui.js';

let root;
let geom = {};   // inputs de geometria, para atualizar durante arrastes

const val = (get) => {
  const v = selEls().map(get);
  return v.every((x) => JSON.stringify(x) === JSON.stringify(v[0])) ? v[0] : null;
};
const set = (fn) => mutate(S.sel, fn, 'panel');
const all = (t) => selEls().every((e) => e.t === t);

const TYPE_LABEL = { text: 'Texto', shape: 'Forma', path: 'Desenho', image: 'Imagem', svg: 'SVG' };
const TYPE_ICON = { text: 'text', shape: 'square', path: 'pencil', image: 'image', svg: 'burst' };

// ---------- geometria ----------
function boxNow(el) {
  const fr = { ...frameOf(el, S.dev) };
  if (el.t === 'text' && el.ah) { const n = nodeOf(el.id); if (n) fr.h = n.offsetHeight; }
  return fr;
}
function secGeom(el) {
  const patch = (p) => { mutateGeom([el.id], (e) => setFrame(e, S.dev, p)); touch(); };
  const fr = boxNow(el);
  geom = {
    x: num({ label: 'X', value: fr.x, step: 1, onChange: (v) => patch({ x: v }) }),
    y: num({ label: 'Y', value: fr.y, step: 1, onChange: (v) => patch({ y: v }) }),
    w: num({ label: 'L', value: fr.w, min: 4, step: 1, onChange: (v) => patch({ w: v }) }),
    h: num({ label: 'A', value: fr.h, min: 4, step: 1, onChange: (v) => patch({ h: v }) }),
    r: num({ label: '°', value: fr.r, min: -360, max: 360, step: 1, onChange: (v) => patch({ r: v }) }),
  };
  if (el.t === 'text') geom.h.querySelector('input').disabled = true;
  const body = [row(geom.x, geom.y), row(geom.w, geom.h), row(geom.r)];
  if (S.dev === 'm' && !el.f.m) body.push(hint('Este elemento ainda segue o layout do PC. Mexer nele aqui cria o ajuste do celular.'));
  return section('Posição e tamanho', body);
}
function refreshGeom() {
  const el = selEls()[0];
  if (!el || S.sel.length !== 1 || !geom.x) return;
  const fr = boxNow(el);
  geom.x.set(fr.x); geom.y.set(fr.y); geom.w.set(fr.w); geom.h.set(fr.h); geom.r.set(fr.r);
}

// ---------- alinhar ----------
function secAlign() {
  const multi = S.sel.length > 1;
  const b = (ic, title, fn) => btn({ ic, title, onClick: fn, cls: 'icon' });
  const body = [
    h('div', { class: 'btnrow' },
      b('alignL', multi ? 'Alinhar à esquerda' : 'Encostar à esquerda da página', () => alignSel('left')),
      b('alignCH', multi ? 'Centralizar horizontalmente' : 'Centralizar na página (horizontal)', () => alignSel('center')),
      b('alignR', multi ? 'Alinhar à direita' : 'Encostar à direita da página', () => alignSel('right')),
      b('alignT', 'Alinhar ao topo', () => alignSel('top')),
      b('alignCV', multi ? 'Centralizar verticalmente' : 'Centralizar na página (vertical)', () => alignSel('middle')),
      b('alignB', 'Alinhar embaixo', () => alignSel('bottom'))),
  ];
  if (multi) body.push(h('div', { class: 'btnrow' }, b('distH', 'Distribuir na horizontal', () => distribute('h')), b('distV', 'Distribuir na vertical', () => distribute('v')), hint(S.sel.length < 3 ? 'Distribuir pede 3+ itens' : '')));
  return section(multi ? 'Alinhar entre si' : 'Alinhar na página', body);
}

// ---------- texto ----------
const WEIGHTS = [[300, 'Leve'], [400, 'Normal'], [500, 'Médio'], [600, 'Semi-negrito'], [700, 'Negrito'], [800, 'Extra-negrito']];
function secText() {
  const fo = (g) => val((e) => g(e.s));
  const mk = (k) => (v) => set((e) => { e.s[k] = v; });
  const fsNow = val((e) => round(frameOf(e, S.dev).fs, 1));
  const body = [];
  if (S.sel.length === 1) body.push(textInput({ label: 'Texto', value: selEls()[0].text, multiline: true, rows: 3, onChange: (v) => set((e) => { e.text = v; }) }));
  body.push(
    select({ label: 'Fonte', value: fo((s) => s.fontFamily), options: FONTS.map((f) => [f.name, f.name, fontStack(f.name)]), onChange: mk('fontFamily') }),
    row(num({ label: 'Tam', value: fsNow, min: 6, max: 600, onChange: (v) => set((e) => setFrame(e, S.dev, { fs: v })) }),
      select({ value: fo((s) => s.fontWeight), options: WEIGHTS, onChange: (v) => set((e) => { e.s.fontWeight = +v; }) })),
    row(
      h('div', { class: 'seg' },
        ...[['italic', 'I', 'Itálico', 'font-style:italic'], ['underline', 'U', 'Sublinhado', 'text-decoration:underline'], ['upper', 'Aa', 'Maiúsculas', '']].map(([k, l, t, st]) =>
          h('button', { type: 'button', title: t, class: fo((s) => s[k]) ? 'on' : '', style: st, onclick: (ev) => { const on_ = !ev.currentTarget.classList.contains('on'); ev.currentTarget.classList.toggle('on', on_); set((e) => { e.s[k] = on_; }); } }, l))),
      seg({ value: fo((s) => s.align), options: [['left', icon('tL'), 'Esquerda'], ['center', icon('tC'), 'Centro'], ['right', icon('tR'), 'Direita']], onChange: mk('align') })),
    colorField({ label: 'Cor', value: fo((s) => s.color), onChange: mk('color') }),
    range({ label: 'Entrelinha', value: fo((s) => s.lh), min: 0.8, max: 2.6, step: 0.05, onChange: mk('lh') }),
    range({ label: 'Espaçamento', value: fo((s) => s.ls), min: -0.1, max: 0.6, step: 0.01, onChange: mk('ls') }),
  );
  return section('Texto', body);
}

// ---------- forma ----------
function secShape() {
  const body = [];
  const first = selEls()[0];
  const lineLike = val((e) => e.shape === 'line' || e.shape === 'arrow');
  body.push(select({ label: 'Forma', value: val((e) => e.shape), options: SHAPE_LIST, onChange: (v) => { set((e) => { e.shape = v; }); build(); } }));
  if (!lineLike) {
    const mode = val((e) => (e.s.grad ? 'grad' : e.s.fill ? 'solid' : 'none'));
    body.push(seg({ value: mode, options: [['solid', 'Cor'], ['grad', 'Degradê'], ['none', 'Sem']], onChange: (v) => {
      set((e) => {
        if (v === 'solid') { e.s.grad = null; e.s.fill = e.s.fill || e.s.grad?.c1 || '#e4572e'; }
        else if (v === 'grad') e.s.grad = e.s.grad || { a: 135, c1: e.s.fill || '#e4572e', c2: '#7b5cff' };
        else { e.s.grad = null; e.s.fill = null; }
      });
      build();
    } }));
    if (mode === 'solid') body.push(colorField({ label: 'Preenchimento', value: val((e) => e.s.fill), onChange: (v) => set((e) => { e.s.fill = v; }) }));
    if (mode === 'grad') {
      const g = (k) => (v) => set((e) => { if (e.s.grad) e.s.grad[k] = v; });
      body.push(row(colorField({ label: 'De', value: first.s.grad?.c1, onChange: g('c1') }), colorField({ label: 'Até', value: first.s.grad?.c2, onChange: g('c2') })),
        range({ label: 'Ângulo', value: first.s.grad?.a, min: 0, max: 360, step: 1, fmt: (v) => v + '°', onChange: g('a') }));
    }
  }
  body.push(row(colorField({ label: 'Contorno', value: val((e) => e.s.stroke), onChange: (v) => set((e) => { e.s.stroke = v; }) }),
    num({ label: 'Esp.', value: val((e) => e.s.sw), min: 0, max: 80, onChange: (v) => set((e) => { e.s.sw = v; }) })));
  body.push(seg({ value: val((e) => e.s.dash), options: [[0, 'Sólido'], [1, 'Tracejado'], [2, 'Pontilhado']], onChange: (v) => set((e) => { e.s.dash = +v; }) }));
  if (all('shape') && val((e) => e.shape) === 'rect') {
    body.push(range({ label: 'Cantos', value: val((e) => e.s.radius), min: 0, max: 300, onChange: (v) => set((e) => { e.s.radius = v; }), fmt: (v) => v + 'px' }),
      btn({ label: 'Pílula', onClick: () => { set((e) => { e.s.radius = 9999; }); build(); } }));
  }
  const kind = val((e) => e.shape);
  if (kind === 'polygon' || kind === 'star') body.push(num({ label: kind === 'star' ? 'Pontas' : 'Lados', value: val((e) => e.s.sides), min: 3, max: 16, onChange: (v) => set((e) => { e.s.sides = Math.round(v); }) }));
  if (kind === 'star') body.push(range({ label: 'Pontas finas', value: val((e) => e.s.inner), min: 0.1, max: 0.9, step: 0.02, onChange: (v) => set((e) => { e.s.inner = v; }) }));
  const out = [section('Forma', body)];
  if (!lineLike) {
    const lb = textInput({ label: 'Texto dentro (vira botão se tiver link)', value: val((e) => e.label), onChange: (v) => set((e) => { e.label = v; }) });
    lb.input.id = 'lbl-input';
    out.push(section('Texto na forma', [lb,
      row(colorField({ label: 'Cor', value: val((e) => e.ls.color), onChange: (v) => set((e) => { e.ls.color = v; }) }),
        num({ label: 'Tam', value: val((e) => round(frameOf(e, S.dev).fs, 1)), min: 6, max: 300, onChange: (v) => set((e) => setFrame(e, S.dev, { fs: v })) })),
      select({ label: 'Fonte', value: val((e) => e.ls.fontFamily), options: FONTS.map((f) => [f.name, f.name, fontStack(f.name)]), onChange: (v) => set((e) => { e.ls.fontFamily = v; }) }),
    ], { open: !!first.label }));
  }
  return out;
}

function secPath() {
  return section('Desenho', [
    row(colorField({ label: 'Traço', value: val((e) => e.s.stroke), onChange: (v) => set((e) => { e.s.stroke = v; }) }),
      num({ label: 'Esp.', value: val((e) => e.s.sw), min: 1, max: 120, onChange: (v) => set((e) => { e.s.sw = v; }) })),
    colorField({ label: 'Preenchimento', value: val((e) => e.s.fill), nullable: true, onChange: (v) => set((e) => { e.s.fill = v; }) }),
  ]);
}

function secImage() {
  const el = selEls()[0];
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { if (file.files[0] && el) await replaceImage(el, file.files[0]); } });
  return section('Imagem', [
    seg({ value: val((e) => e.s.fit), options: [['cover', 'Preencher'], ['contain', 'Conter'], ['fill', 'Esticar']], onChange: (v) => set((e) => { e.s.fit = v; }) }),
    range({ label: 'Cantos', value: val((e) => e.s.radius), min: 0, max: 600, onChange: (v) => set((e) => { e.s.radius = v; }), fmt: (v) => v + 'px' }),
    h('div', { class: 'btnrow' }, btn({ label: 'Círculo', onClick: () => { set((e) => { e.s.radius = 9999; e.s.fit = 'cover'; }); build(); } }),
      S.sel.length === 1 ? btn({ label: 'Trocar imagem', ic: 'upload', onClick: () => file.click() }) : null, file),
  ]);
}

function secSvg() {
  const el = selEls()[0];
  const status = h('p', { class: 'hint' }, 'Cole ou edite o código; a pré-visualização é imediata.');
  const apply = debounce((code) => {
    const r = sanitizeSvg(code, 'svg-check');
    status.textContent = r.ok ? 'Código válido ✓' : r.error;
    status.classList.toggle('bad', !r.ok);
    if (r.ok) set((e) => { e.code = code; });
  }, 350);
  const ta = textInput({ label: 'Código SVG', value: el.code, multiline: true, mono: true, rows: 12, onChange: apply });
  ta.input.id = 'svg-code';
  return section('SVG', [ta, status, hint('Animações CSS (@keyframes) e SMIL (<animate>) funcionam. Scripts e links externos são removidos.')]);
}

// ---------- aparência ----------
function secAppearance() {
  const body = [];
  body.push(range({ label: 'Opacidade', value: val((e) => Math.round((e.s.opacity ?? 1) * 100)), min: 0, max: 100, fmt: (v) => v + '%', onChange: (v) => set((e) => { e.s.opacity = v / 100; }) }));
  const sh = val((e) => !!e.s.shadow);
  body.push(toggle({ label: 'Sombra', value: sh, onChange: (v) => { set((e) => { e.s.shadow = v ? (e.s.shadow || { x: 0, y: 10, b: 24, c: '#00000055' }) : null; }); build(); } }));
  if (sh) {
    const g = (k) => (v) => set((e) => { if (e.s.shadow) e.s.shadow[k] = v; });
    const s0 = selEls()[0].s.shadow;
    body.push(row(num({ label: 'X', value: s0.x, onChange: g('x') }), num({ label: 'Y', value: s0.y, onChange: g('y') })), row(num({ label: 'Desf.', value: s0.b, min: 0, onChange: g('b') }), colorField({ value: s0.c.slice(0, 7), onChange: (v) => g('c')(v + '88') })));
  }
  body.push(range({ label: 'Desfoque', value: val((e) => e.s.blur || 0), min: 0, max: 40, fmt: (v) => v + 'px', onChange: (v) => set((e) => { e.s.blur = v; }) }));
  body.push(select({ label: 'Mistura', value: val((e) => e.s.blend || 'normal'), options: [['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Clarear'], ['overlay', 'Sobrepor'], ['difference', 'Diferença'], ['soft-light', 'Luz suave']], onChange: (v) => set((e) => { e.s.blend = v; }) }));
  return section('Aparência', body, { open: false });
}

// ---------- link ----------
function secLink() {
  const body = [textInput({ label: 'Endereço (https://…, mailto:…, #seção)', value: val((e) => e.link?.href || ''), placeholder: 'https://', onChange: (v) => set((e) => { e.link = v.trim() ? { ...(e.link || {}), href: v.trim() } : null; }) }),
    toggle({ label: 'Abrir em nova aba', value: val((e) => !!e.link?.blank), onChange: (v) => set((e) => { if (e.link) e.link.blank = v; }) })];
  return section('Link', body, { open: !!val((e) => e.link?.href) });
}

// ---------- animação ----------
const IN = [['', 'Nenhuma'], ['fade', 'Aparecer'], ['fade-up', 'Subir'], ['fade-down', 'Descer'], ['fade-left', 'Vir da esquerda'], ['fade-right', 'Vir da direita'], ['zoom-in', 'Zoom (crescer)'], ['zoom-out', 'Zoom (reduzir)'], ['bounce-in', 'Salto'], ['rotate-in', 'Girar'], ['flip', 'Virar'], ['blur-in', 'Desfocar'], ['reveal', 'Revelar (cortina)'], ['draw', 'Desenhar o traço']];
const LOOP = [['', 'Nenhuma'], ['float', 'Flutuar'], ['pulse', 'Pulsar'], ['spin', 'Girar'], ['wiggle', 'Balançar'], ['bounce', 'Quicar'], ['swing', 'Pêndulo'], ['glow', 'Brilhar'], ['blink', 'Piscar']];
const HOVER = [['', 'Nenhum'], ['grow', 'Crescer'], ['shrink', 'Encolher'], ['tilt', 'Inclinar'], ['lift', 'Levantar'], ['spin', 'Girar'], ['glow', 'Brilhar']];
const EASE = [['ease-out', 'Suave (saída)'], ['ease', 'Padrão'], ['ease-in-out', 'Suave (ambos)'], ['linear', 'Linear'], ['cubic-bezier(.34,1.56,.64,1)', 'Elástico']];

function setAn(group, patch) {
  set((e) => {
    e.an = e.an || {};
    if (patch === null) delete e.an[group];
    else e.an[group] = { ...(e.an[group] || {}), ...patch };
    if (!Object.keys(e.an).length) e.an = null;
  });
}
function secAnim() {
  const first = selEls()[0];
  const canDraw = selEls().every((e) => ['shape', 'path', 'svg'].includes(e.t));
  const a = (g) => val((e) => e.an?.[g]?.k || '');
  const body = [];

  const inK = a('in');
  body.push(h('div', { class: 'ah' }, 'Entrada ', hint('(quando aparece na tela)')),
    select({ value: inK, options: IN.filter(([k]) => k !== 'draw' || canDraw), onChange: (v) => { setAn('in', v ? { k: v, dur: first.an?.in?.dur ?? 0.8, delay: first.an?.in?.delay ?? 0, ease: first.an?.in?.ease ?? 'ease-out' } : null); build(); if (v) setTimeout(() => playEntrance(S.sel), 60); } }));
  if (inK) {
    body.push(row(num({ label: 'Dur', unit: 's', value: first.an.in.dur, min: 0.1, max: 10, step: 0.1, onChange: (v) => setAn('in', { dur: v }) }), num({ label: 'Atraso', unit: 's', value: first.an.in.delay, min: 0, max: 10, step: 0.1, onChange: (v) => setAn('in', { delay: v }) })),
      select({ value: first.an.in.ease, options: EASE, onChange: (v) => setAn('in', { ease: v }) }),
      btn({ label: 'Testar entrada', ic: 'play', onClick: () => playEntrance(S.sel) }));
  }

  const lk = a('loop');
  body.push(h('div', { class: 'ah' }, 'Contínua'), select({ value: lk, options: LOOP, onChange: (v) => { setAn('loop', v ? { k: v, dur: first.an?.loop?.dur ?? 3 } : null); build(); } }));
  if (lk) body.push(range({ label: 'Duração do ciclo', value: first.an.loop.dur, min: 0.4, max: 12, step: 0.1, fmt: (v) => v + 's', onChange: (v) => setAn('loop', { dur: v }) }));

  body.push(h('div', { class: 'ah' }, 'Ao passar o mouse'), select({ value: a('hover'), options: HOVER, onChange: (v) => setAn('hover', v ? { k: v } : null) }));
  const open = !!(inK || lk || a('hover'));
  return section('Animação', body, { open });
}

// ---------- página ----------
function pagePanel() {
  const bg = S.doc.page.bg;
  const out = [];
  out.push(section('Página', [
    textInput({ label: 'Título', value: S.doc.title, onChange: (v) => { S.doc.title = v; touch(); emit('title'); } }),
    seg({ value: bg.g ? 'g' : 'c', options: [['c', 'Cor'], ['g', 'Degradê']], onChange: (v) => { setPage((p) => { if (v === 'g') p.bg.g = p.bg.g || { a: 160, c1: p.bg.c, c2: '#7b5cff' }; else p.bg.g = null; }); build(); } }),
    bg.g
      ? [row(colorField({ label: 'De', value: bg.g.c1, onChange: (v) => setPage((p) => { p.bg.g.c1 = v; }) }), colorField({ label: 'Até', value: bg.g.c2, onChange: (v) => setPage((p) => { p.bg.g.c2 = v; }) })),
        range({ label: 'Ângulo', value: bg.g.a, min: 0, max: 360, fmt: (v) => v + '°', onChange: (v) => setPage((p) => { p.bg.g.a = v; }) })]
      : colorField({ label: 'Cor de fundo', value: bg.c, onChange: (v) => setPage((p) => { p.bg.c = v; }) }),
    row(num({ label: 'Altura', value: pageH(S.doc, S.dev), min: 300, max: 12000, step: 10, unit: 'px', onChange: (v) => setPage((p) => { p.h[S.dev] = Math.round(v); }) }),
      btn({ label: 'Ajustar', title: 'Ajustar a altura ao conteúdo', ic: 'fit', onClick: () => { fitPageHeight(); build(); } })),
    hint('Dica: fundos animados ficam na aba SVG animado, em “Fundos”.'),
  ]));

  if (S.tool === 'pencil') {
    out.unshift(section('Lápis', [
      row(colorField({ label: 'Cor', value: S.pen.stroke || inkColor(), onChange: (v) => { S.pen.stroke = v; } }), num({ label: 'Esp.', value: S.pen.sw, min: 1, max: 80, onChange: (v) => { S.pen.sw = v; } })),
      hint('Desenhe à mão livre — o traço é suavizado sozinho. Dica: depois dá para usar a animação “Desenhar o traço”.'),
    ]));
  }

  const derived = S.doc.elements.filter((e) => !e.f.m).length;
  out.push(section('Celular', S.dev === 'm'
    ? [hint(derived ? `${derived} de ${S.doc.elements.length} elementos ainda seguem o layout do PC (proporcional).` : 'Todos os elementos têm ajuste próprio para celular.'),
      btn({ label: 'Empilhar elementos', ic: 'stack', title: 'Monta uma coluna única a partir do PC', onClick: () => { autoStack(measureAll); build(); } }),
      btn({ label: 'Voltar ao automático', ic: 'reset', onClick: () => { if (confirm('Descartar todos os ajustes do celular?')) { resetMobile(); build(); } } })]
    : [hint('Para ajustar a versão de celular, mude para “Celular” no topo. Quem abrir pelo telefone vê aquela versão.'),
      btn({ label: 'Gerar layout do celular', ic: 'stack', title: 'Monta uma coluna única a partir do PC', onClick: () => { autoStack(measureAll); build(); } })]));

  out.push(section('Animações', [btn({ label: 'Tocar todas as entradas', ic: 'play', onClick: () => playEntrance() })], { open: false }));
  out.push(section('Atalhos', [h('ul', { class: 'keys' },
    ...[['V', 'Selecionar'], ['T', 'Texto'], ['R', 'Forma'], ['P', 'Lápis'], ['Espaço + arrastar', 'Mover a tela'], ['Ctrl + roda', 'Zoom'], ['Shift', 'Manter proporção / eixo'], ['Alt', 'Sem ímã'], ['Setas', 'Mover (Shift = 10)'], ['Ctrl+D', 'Duplicar'], ['Ctrl+C / V', 'Copiar / colar'], ['Ctrl+Z / Y', 'Desfazer / refazer'], ['[  ]', 'Atrás / frente'], ['Del', 'Excluir'], ['Dois cliques', 'Editar texto / SVG']].map(([k, d]) => h('li', {}, h('kbd', {}, k), d)))
  ], { open: false }));
  return out;
}

// ---------- montagem ----------
export function build() {
  if (!root || !S.doc) return;
  root.scrollTop = root.scrollTop;
  const top = root.scrollTop;
  root.innerHTML = '';
  geom = {};
  const els = selEls();
  if (!els.length) { root.append(...pagePanel().flat()); return; }

  const types = new Set(els.map((e) => e.t));
  const t0 = els[0].t;
  const head = h('div', { class: 'ph' },
    h('span', { class: 'ph-ic', html: icon(TYPE_ICON[t0] || 'square', 16) }),
    els.length === 1
      ? h('input', { class: 'ph-name', value: els[0].name || '', placeholder: TYPE_LABEL[t0], onchange: (ev) => { set((e) => { e.name = ev.target.value; }); emit('struct-lite'); emit('layers'); } })
      : h('b', {}, `${els.length} itens selecionados`));
  root.append(head);

  if (els.length === 1) root.append(secGeom(els[0]));
  root.append(secAlign());
  if (types.size === 1) {
    if (t0 === 'text') root.append(secText());
    if (t0 === 'shape') root.append(...secShape());
    if (t0 === 'path') root.append(secPath());
    if (t0 === 'image') root.append(secImage());
    if (t0 === 'svg' && els.length === 1) root.append(secSvg());
  }
  root.append(secAppearance(), secAnim(), secLink());
  root.scrollTop = top;
}

export function initPanel(el) {
  root = el;
  for (const ev of ['select', 'struct', 'device', 'tool']) on(ev, build);
  on('page', () => { if (!S.sel.length && !root.contains(root.ownerDocument.activeElement)) build(); });
  on('geom', refreshGeom);
  on('el', ({ src }) => { if (src === 'canvas') refreshGeom(); });
  on('focuslabel', () => setTimeout(() => root.querySelector('#lbl-input')?.focus(), 30));
  on('editsvg', () => setTimeout(() => { const t = root.querySelector('#svg-code'); t?.scrollIntoView({ block: 'center' }); t?.focus(); }, 30));
  build();
}
