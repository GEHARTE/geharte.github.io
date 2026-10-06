// Barra de abas do EDITOR de um projeto de site: troca a aba em edição, adiciona, renomeia, duplica, move e exclui abas.
// (A barra de abas que aparece NA PÁGINA é o objeto "Barra de abas"; esta aqui é só do editor.) A lógica está em core/sites.js.
import { h } from '../core/dom.js';
import { S, on, emit, loadDoc, saveNow, commit } from './state.js';
import { abrirAba, adicionarAba, renomearAba, removerAba, moverAba, duplicarAba } from '../core/sites.js';
import { btn, modal, toast } from './ui.js';

let bar;

async function trocar(id) {
  if (!S.doc || id === S.doc.abaAtiva) return;
  try { await saveNow(); } catch { /* segue */ }
  if (!abrirAba(S.doc, id)) return;
  loadDoc(S.doc, S.updatedAt);   // zera seleção e histórico: desfazer não atravessa abas
  commit();
  emit('fit');
}

function pedirNomes(titulo, aba, ok) {
  const nome = h('input', { type: 'text', value: aba?.nome || '', maxlength: '60', 'aria-label': 'Nome na barra de abas' });
  const tit = h('input', { type: 'text', value: aba?.titulo || '', maxlength: '120', 'aria-label': 'Título da página' });
  const fim = () => { const n = nome.value.trim(); if (!n) { nome.focus(); return; } m.close(); ok(n, tit.value.trim() || n); };
  const m = modal({ title: titulo, body: [h('label', { class: 'fld' }, 'Nome na barra de abas', nome), h('label', { class: 'fld' }, 'Título da página (aparece na aba do navegador)', tit)],
    actions: [btn({ label: 'Salvar', cls: 'primary', onClick: fim })] });
  nome.addEventListener('keydown', (e) => { if (e.key === 'Enter') fim(); });
  nome.select();
}

function menuDaAba(ancora) {
  const old = document.querySelector('#menu-aba'); if (old) { old.remove(); return; }
  const id = S.doc.abaAtiva, aba = S.doc.abas.find((a) => a.id === id), i = S.doc.abas.findIndex((a) => a.id === id);
  const item = (rot, fn, off) => h('button', { disabled: off || null, onclick: () => { m.remove(); fn(); } }, h('span', {}, rot));
  const depoisDe = async (fn) => { await saveNow(); fn(); emit('struct'); loadDoc(S.doc, S.updatedAt); commit(); emit('fit'); };
  const m = h('div', { id: 'menu-aba', class: 'popover menu' },
    item('Renomear…', () => pedirNomes('Renomear aba', aba, (n, t) => { renomearAba(S.doc, id, n, t); emit('struct'); commit(); render(); })),
    item('Duplicar', () => depoisDe(() => { const novo = duplicarAba(S.doc, id); if (novo) abrirAba(S.doc, novo); })),
    item('Mover para a esquerda', () => { moverAba(S.doc, id, -1); emit('struct'); commit(); render(); }, i === 0),
    item('Mover para a direita', () => { moverAba(S.doc, id, 1); emit('struct'); commit(); render(); }, i === S.doc.abas.length - 1),
    h('hr'),
    item('Excluir esta aba', () => modal({ title: 'Excluir aba?', body: h('p', {}, `A aba “${aba.nome}” e tudo o que está só nela serão removidos. O topo e o rodapé compartilhados continuam nas outras abas.`),
      actions: [btn({ label: 'Excluir', cls: 'primary', onClick: (e) => { e.target.closest('.modal-back').remove(); depoisDe(() => { if (!removerAba(S.doc, id)) toast('Um projeto precisa ter pelo menos uma aba.', 'err'); }); } })] }), S.doc.abas.length <= 1));
  document.body.append(m);
  const r = ancora.getBoundingClientRect();
  Object.assign(m.style, { top: r.bottom + 6 + 'px', left: Math.max(8, r.right - 200) + 'px' });
  setTimeout(() => document.addEventListener('pointerdown', function away(ev) { if (!m.contains(ev.target) && ev.target !== ancora) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
}

function render() {
  if (!bar || !S.doc) return;
  bar.hidden = S.doc.kind !== 'site';
  if (bar.hidden) return;
  const mais = h('button', { class: 'ab ab-mais', title: 'Opções da aba aberta', 'aria-label': 'Opções da aba aberta', onclick: (e) => menuDaAba(e.currentTarget) }, '⋯');
  bar.replaceChildren(
    h('span', { class: 'ab-rot' }, 'Abas'),
    ...S.doc.abas.map((a) => h('button', { class: 'ab' + (a.id === S.doc.abaAtiva ? ' on' : ''), role: 'tab', 'aria-selected': String(a.id === S.doc.abaAtiva), title: a.titulo, onclick: () => trocar(a.id) }, a.nome)),
    h('button', { class: 'ab', title: 'Nova aba', 'aria-label': 'Nova aba', onclick: () => pedirNomes('Nova aba', null, async (n, t) => { await saveNow(); const id = adicionarAba(S.doc, n, { depoisDe: S.doc.abaAtiva }); renomearAba(S.doc, id, n, t); abrirAba(S.doc, id); loadDoc(S.doc, S.updatedAt); commit(); emit('fit'); }) }, '＋'),
    mais);
}

export function initAbas(el) {
  bar = el;
  for (const ev of ['struct', 'page', 'saved']) on(ev, render);
  render();
}
