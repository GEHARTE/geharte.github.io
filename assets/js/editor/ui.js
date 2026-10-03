// Controles de interface reutilizáveis (painel direito, popovers, avisos).
import { h } from '../core/dom.js';
import { clamp, round } from '../core/util.js';
import { docColors, harmonies } from '../core/model.js';
import { S } from './state.js';
import { icon } from './icons.js';

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const btn = ({ label, ic, title, onClick, cls = '', active = false, disabled = false }) =>
  h('button', { class: `btn ${cls}${active ? ' on' : ''}`, title: title || label || '', type: 'button', disabled, onclick: onClick, html: (ic ? icon(ic) : '') + (label ? `<span>${label}</span>` : '') });

export function section(title, body, { open = true } = {}) {
  const wrap = h('section', { class: 'sec' + (open ? ' open' : '') });
  const head = h('button', { class: 'sec-h', type: 'button', onclick: () => wrap.classList.toggle('open') }, h('span', { html: icon('chevR', 12) }), title);
  wrap.append(head, h('div', { class: 'sec-b' }, body));
  return wrap;
}
export const row = (...k) => h('div', { class: 'row' }, ...k);
export const hint = (t) => h('p', { class: 'hint' }, t);

export function num({ label, value, min = -99999, max = 99999, step = 1, unit = '', onChange, cls = '' }) {
  const fmt = (v) => (v == null ? '' : String(round(v, 2)));
  const inp = h('input', { type: 'number', class: 'num-in', step, value: fmt(value), placeholder: value == null ? '—' : null });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) onChange(clamp(v, min, max)); });
  inp.addEventListener('focus', () => inp.select());
  const lab = h('span', { class: 'num-lab' }, label);
  // arrastar o rótulo muda o valor (como em editores de design)
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const v0 = parseFloat(inp.value) || 0, x0 = e.clientX;
    const mv = (ev) => { const v = clamp(round(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 5 : 1), 2), min, max); inp.value = fmt(v); onChange(v); };
    const up = () => { removeEventListener('pointermove', mv); document.body.classList.remove('scrubbing'); };
    document.body.classList.add('scrubbing');
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up, { once: true });
  });
  const w = h('label', { class: 'num ' + cls }, lab, inp, unit ? h('em', {}, unit) : null);
  w.set = (v) => { if (document.activeElement !== inp) inp.value = fmt(v); };
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
  document.body.append(pop);
  paint();
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = clamp(r.left - pw - 10, 8, innerWidth - pw - 8) + 'px';
  pop.style.top = clamp(r.top - 10, 8, innerHeight - ph - 8) + 'px';
  const away = (e) => { if (!pop?.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const esc = (e) => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => document.addEventListener('pointerdown', away, true));
  document.addEventListener('keydown', esc);
  popOff = () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
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
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('header', {}, h('b', {}, title), btn({ ic: 'x', title: 'Fechar', onClick: close, cls: 'icon' })),
      h('div', { class: 'modal-b' }, body),
      actions.length ? h('footer', {}, actions) : null));
  document.body.append(back);
  document.addEventListener('keydown', esc);
  return { close, el: back };
}
