// Controles de interface reutilizáveis (painel direito, popovers, avisos).
import { h } from '../core/dom.js';
import { clamp, round } from '../core/util.js';
import { docColors, harmonies } from '../core/model.js';
import { lerCampo, ehSoNumero } from '../core/medidas.js';
import { S } from './state.js';
import { icon } from './icons.js';
import { activeDoc, winOf } from './docs.js';
import { ancorar, caixaVisivel } from '../core/janelas.js';

export function toast(msg, kind = '') {
  const doc = activeDoc();
  let box = doc.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); doc.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const btn = ({ label, ic, title, onClick, cls = '', active = false, disabled = false }) =>
  h('button', { class: `btn ${cls}${active ? ' on' : ''}`, title: title || label || '', type: 'button', disabled, onclick: onClick, html: (ic ? icon(ic) : '') + (label ? `<span>${label}</span>` : '') });

// Seções do painel de propriedades: FECHADAS por padrão (abertas demais confundiam); a escolha da pessoa é lembrada por seção, neste navegador.
const CHAVE_SECOES = 'artatk.secoes';
const lerSecoes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_SECOES) || '{}') || {}; } catch { return {}; } };
const guardarSecao = (titulo, aberta) => { try { localStorage.setItem(CHAVE_SECOES, JSON.stringify({ ...lerSecoes(), [titulo]: aberta })); } catch { /* sem armazenamento */ } };
export function section(title, body) {
  const aberta = lerSecoes()[title] === true;
  const wrap = h('section', { class: 'sec' + (aberta ? ' open' : '') });
  const head = h('button', { class: 'sec-h', type: 'button', 'aria-expanded': String(aberta), onclick: () => { const on = wrap.classList.toggle('open'); head.setAttribute('aria-expanded', String(on)); guardarSecao(title, on); } }, h('span', { html: icon('chevR', 12) }), title);
  wrap.append(head, h('div', { class: 'sec-b' }, body));
  return wrap;
}
export const row = (...k) => h('div', { class: 'row' }, ...k);
export const hint = (t) => h('p', { class: 'hint' }, t);

// Campo numérico. Com `medida: 'px'|'mm'` aceita unidade ("2,5cm", "12pt", "1,5rem"): o número sem unidade vale na unidade do campo,
// com unidade o valor é convertido ao concluir (Enter ou sair do campo) e o campo volta a mostrar a unidade dele.
const DICA_MEDIDA = 'Aceita unidade: 40, 2,5cm, 10mm, 12pt, 1,5rem, 1pol';
export function num({ label, value, min = -99999, max = 99999, step = 1, unit = '', medida = null, onChange, cls = '' }) {
  const fmt = (v) => (v == null ? '' : String(round(v, 2)));
  const inp = h('input', { type: medida ? 'text' : 'number', inputmode: medida ? 'decimal' : null, step: medida ? null : step, class: 'num-in', value: fmt(value), placeholder: value == null ? '—' : null });
  let ultimo = value;                                                    // último valor bom, para voltar se a pessoa digitar bobagem
  const aplicar = (v) => { ultimo = round(clamp(v, min, max), 2); onChange(ultimo); return ultimo; };
  if (!medida) {
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) onChange(clamp(v, min, max)); });
  } else {
    inp.title = DICA_MEDIDA;
    inp.addEventListener('input', () => { if (ehSoNumero(inp.value)) aplicar(parseFloat(inp.value.replace(',', '.'))); });   // só número: aplica na hora, como sempre
    const concluir = () => {
      const v = lerCampo(inp.value, medida);
      if (v == null) { if (inp.value.trim() !== '') toast('Não entendi a medida. Exemplos: 40, 2,5cm, 10mm, 12pt.', 'err'); inp.value = fmt(ultimo); return; }
      const c = round(clamp(v, min, max), 2);
      if (c !== ultimo) aplicar(c);
      inp.value = fmt(c);
    };
    inp.addEventListener('change', concluir);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); concluir(); inp.select(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {                   // o campo é de texto: as setas fazem o papel do "spinner"
        e.preventDefault();
        const base = lerCampo(inp.value, medida) ?? ultimo ?? 0;
        inp.value = fmt(aplicar(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
      }
    });
  }
  inp.addEventListener('focus', () => inp.select());
  const lab = h('span', { class: 'num-lab' }, label);
  // arrastar o rótulo muda o valor (como em editores de design)
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const v0 = parseFloat(inp.value.replace(',', '.')) || 0, x0 = e.clientX;
    const mv = (ev) => { const v = clamp(round(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 5 : 1), 2), min, max); inp.value = fmt(v); ultimo = v; onChange(v); };
    // o campo pode estar num painel em outra janela: os eventos de ponteiro chegam na janela dele
    const win = winOf(lab), body = lab.ownerDocument.body;
    const up = () => { win.removeEventListener('pointermove', mv); body.classList.remove('scrubbing'); };
    body.classList.add('scrubbing');
    win.addEventListener('pointermove', mv);
    win.addEventListener('pointerup', up, { once: true });
  });
  const w = h('label', { class: 'num ' + cls }, lab, inp, unit ? h('em', {}, unit) : null);
  w.set = (v) => { ultimo = v; if (inp.ownerDocument.activeElement !== inp) inp.value = fmt(v); };
  return w;
}

export function range({ label, value, min = 0, max = 100, step = 1, onChange, fmt = (v) => v }) {
  const out = h('output', {}, value == null ? '—' : fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value: value ?? min });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onChange(v); });
  return h('label', { class: 'rng' }, h('span', { class: 'fl' }, label), inp, out);
}

export function select({ label, value, options, onChange, cls = '' }) {
  const s = h('select', { class: 'sel ' + cls });
  for (const o of options) {
    const [v, l, style] = Array.isArray(o) ? o : [o, o];
    const op = h('option', { value: v }, l);
    if (style) op.style.fontFamily = style;
    s.append(op);
  }
  s.value = value ?? '';
  if (value == null) s.insertAdjacentHTML('afterbegin', '<option value="" selected>—</option>');
  s.addEventListener('change', () => onChange(s.value));
  return label ? h('label', { class: 'fld' }, h('span', { class: 'fl' }, label), s) : s;
}

export function seg({ value, options, onChange }) {
  const wrap = h('div', { class: 'seg' });
  for (const [v, l, title] of options) {
    wrap.append(h('button', { type: 'button', class: v === value ? 'on' : '', title: title || '', html: l, onclick: (e) => {
      wrap.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      onChange(v);
    } }));
  }
  return wrap;
}

export function toggle({ label, value, onChange }) {
  const cb = h('input', { type: 'checkbox' });
  cb.checked = !!value;
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: 'tgl' }, cb, h('i'), h('span', {}, label));
}

export function textInput({ label, value, placeholder, onChange, multiline = false, mono = false, rows = 3 }) {
  const i = multiline ? h('textarea', { rows, class: mono ? 'mono' : '', spellcheck: 'false' }) : h('input', { type: 'text' });
  i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder;
  i.addEventListener('input', () => onChange(i.value));
  const w = h('label', { class: 'fld' }, label ? h('span', { class: 'fl' }, label) : null, i);
  w.input = i;
  return w;
}

// ---------- seletor de cor ----------
const hsv2hex = (hh, s, v) => {
  const f = (n, k = (n + hh / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
};
const hex2hsv = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [hh, mx ? d / mx : 0, mx];
};
const BASICS = ['#17161d', '#ffffff', '#e4572e', '#ffb703', '#2e6be4', '#1f9d8b', '#7b5cff', '#d6336c', '#f6f1e9', '#8a8799', '#ff6b6b', '#51cf66', '#4dabf7', '#f783ac', '#ffd43b', '#c9c5d6'];

let pop = null, popOff = null;
export function closePop() { pop?.remove(); pop = null; popOff?.(); popOff = null; }

export function openColorPop(anchor, value, onChange, { nullable = false } = {}) {
  closePop();
  const doc = anchor.ownerDocument, win = winOf(anchor);
  let cur = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#e4572e';
  let [hh, ss, vv] = hex2hsv(cur);
  const sv = h('div', { class: 'cp-sv' }, h('i', { class: 'cp-knob' }));
  const hue = h('input', { type: 'range', min: 0, max: 360, class: 'cp-hue', value: hh });
  const hex = h('input', { class: 'cp-hex', maxlength: 7, spellcheck: 'false' });
  const sw = h('i', { class: 'cp-cur' });

  const paint = () => {
    sv.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hh},100%,50%))`;
    sv.firstChild.style.left = ss * 100 + '%'; sv.firstChild.style.top = (1 - vv) * 100 + '%';
    sw.style.background = cur; hex.value = cur; hue.value = hh;
  };
  const emitHsv = () => { cur = hsv2hex(hh, ss, vv); paint(); onChange(cur); };
  const setHex = (v) => { cur = v; [hh, ss, vv] = hex2hsv(v); paint(); onChange(v); };

  sv.addEventListener('pointerdown', (e) => {
    sv.setPointerCapture(e.pointerId);
    const mv = (ev) => { const r = sv.getBoundingClientRect(); ss = clamp((ev.clientX - r.left) / r.width, 0, 1); vv = 1 - clamp((ev.clientY - r.top) / r.height, 0, 1); emitHsv(); };
    mv(e);
    sv.addEventListener('pointermove', mv);
    sv.addEventListener('pointerup', () => sv.removeEventListener('pointermove', mv), { once: true });
  });
  hue.addEventListener('input', () => { hh = +hue.value; emitHsv(); });
  hex.addEventListener('input', () => { let v = hex.value.trim(); if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) setHex(v.toLowerCase()); });

  const swatches = (list) => h('div', { class: 'cp-sw' }, list.map((c) => h('button', { type: 'button', class: 'cp-s', style: { background: c }, title: c, onclick: () => setHex(c) })));
  const harm = harmonies(cur);
  const body = [
    sv, h('div', { class: 'cp-row' }, sw, hue),
    h('div', { class: 'cp-row' }, hex,
      'EyeDropper' in window ? btn({ ic: 'eyedrop', title: 'Conta-gotas (pegar cor da tela)', onClick: async () => { try { const r = await new EyeDropper().open(); setHex(r.sRGBHex.toLowerCase()); } catch { /* cancelado */ } } }) : null,
      nullable ? btn({ label: 'Sem cor', onClick: () => { onChange(null); closePop(); } }) : null),
  ];
  const dc = docColors(S.doc);
  if (dc.length) body.push(h('div', { class: 'cp-t' }, 'Cores da página'), swatches(dc));
  body.push(h('div', { class: 'cp-t' }, 'Básicas'), swatches(BASICS));
  for (const [name, list] of Object.entries(harm)) body.push(h('div', { class: 'cp-t' }, name), swatches(list));

  pop = h('div', { class: 'popover cp' }, body);
  doc.body.append(pop);
  paint();
  // posição lida da área VISÍVEL de verdade (teclado virtual, zoom, janela separada): abre ao lado do campo, no lado onde cabe inteiro
  const caixa = caixaVisivel(win);
  pop.style.maxHeight = caixa.h - 16 + 'px';
  const p = ancorar(anchor.getBoundingClientRect(), { w: pop.offsetWidth, h: pop.offsetHeight }, caixa, { prefer: ['esquerda', 'direita', 'baixo', 'cima'], folga: 10 });
  pop.style.left = p.x + 'px'; pop.style.top = p.y + 'px';
  const away = (e) => { if (!pop?.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const esc = (e) => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => doc.addEventListener('pointerdown', away, true));
  doc.addEventListener('keydown', esc);
  popOff = () => { doc.removeEventListener('pointerdown', away, true); doc.removeEventListener('keydown', esc); };
}

export function colorField({ label, value, nullable = false, onChange }) {
  const sw = h('button', { type: 'button', class: 'swatch' + (value ? '' : ' none'), title: value || 'Sem cor' });
  if (value) sw.style.background = value;
  const set = (v) => { sw.classList.toggle('none', !v); sw.style.background = v || ''; sw.title = v || 'Sem cor'; };
  sw.addEventListener('click', () => openColorPop(sw, value, (v) => { value = v; set(v); onChange(v); }, { nullable }));
  const w = h('label', { class: 'clr' }, label ? h('span', { class: 'fl' }, label) : null, sw);
  return w;
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const doc = activeDoc();
  const close = () => { back.remove(); doc.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('header', {}, h('b', {}, title), btn({ ic: 'x', title: 'Fechar', onClick: close, cls: 'icon' })),
      h('div', { class: 'modal-b' }, body),
      actions.length ? h('footer', {}, actions) : null));
  doc.body.append(back);
  doc.addEventListener('keydown', esc);
  return { close, el: back };
}
