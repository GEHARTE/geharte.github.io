// Painel de camadas: ordem (arrastar), visibilidade, trava, renomear.
import { h } from '../core/dom.js';
import { S, on, select, mutate, commit, moveLayer, selEls } from './state.js';
import { icon } from './icons.js';

const TYPE_ICON = { text: 'text', shape: 'square', path: 'pencil', image: 'image', svg: 'burst' };
const label = (e) => e.name || (e.t === 'text' ? e.text.split('\n')[0].slice(0, 28) : e.t === 'shape' ? (e.label || 'Forma') : { path: 'Desenho', image: 'Imagem', svg: 'SVG' }[e.t]);

export function renderLayers(root) {
  root.innerHTML = '';
  const list = h('ul', { class: 'layers' });
  const els = [...S.doc.elements].reverse();
  if (!els.length) root.append(h('p', { class: 'hint pad' }, 'Nenhum elemento ainda. Adicione formas, textos, imagens ou SVGs.'));
  let dragId = null;
  for (const el of els) {
    const li = h('li', { class: 'layer' + (S.sel.includes(el.id) ? ' on' : '') + (el.hide ? ' dim' : ''), draggable: 'true', 'data-id': el.id });
    li.append(
      h('span', { class: 'l-ic', html: icon(TYPE_ICON[el.t] || 'square', 14) }),
      h('span', { class: 'l-name', title: 'Duplo clique para renomear' }, label(el)),
      h('button', { class: 'l-b', title: el.hide ? 'Mostrar' : 'Ocultar', html: icon(el.hide ? 'eyeoff' : 'eye', 14), onclick: (ev) => { ev.stopPropagation(); mutate([el.id], (e) => { e.hide = !e.hide; }, 'struct'); commit(); renderLayers(root); } }),
      h('button', { class: 'l-b' + (el.lock ? ' act' : ''), title: el.lock ? 'Destravar' : 'Travar', html: icon(el.lock ? 'lock' : 'unlock', 14), onclick: (ev) => { ev.stopPropagation(); mutate([el.id], (e) => { e.lock = !e.lock; }, 'struct'); commit(); renderLayers(root); } }),
    );
    li.addEventListener('click', (ev) => select([el.id], ev.shiftKey || ev.ctrlKey || ev.metaKey ? 'toggle' : 'set'));
    li.querySelector('.l-name').addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const inp = h('input', { class: 'l-edit', value: el.name || label(el) });
      ev.target.replaceWith(inp); inp.focus(); inp.select();
      const done = () => { mutate([el.id], (e) => { e.name = inp.value.trim(); }, 'struct'); commit(); renderLayers(root); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = el.name || ''; inp.blur(); } });
    });
    li.addEventListener('dragstart', (ev) => { dragId = el.id; ev.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', (ev) => { if (dragId && dragId !== el.id) { ev.preventDefault(); li.classList.add('drop'); } });
    li.addEventListener('dragleave', () => li.classList.remove('drop'));
    li.addEventListener('drop', (ev) => {
      ev.preventDefault(); li.classList.remove('drop');
      if (!dragId || dragId === el.id) return;
      const arr = S.doc.elements.filter((e) => e.id !== dragId);
      moveLayer(dragId, arr.findIndex((e) => e.id === el.id) + 1);
      dragId = null;
    });
    list.append(li);
  }
  root.append(list);
}

export function initLayers(root) {
  const r = () => { if (root.isConnected && root.offsetParent !== null) renderLayers(root); };
  for (const ev of ['struct', 'select', 'struct-lite', 'layers']) on(ev, r);
  r();
}
export const refreshLayers = (root) => renderLayers(root);
