// Estado do editor: documento, seleção, histórico (desfazer/refazer) e autosave.
import { clone, debounce, uid } from '../core/util.js';
import { Store } from '../core/store.js';
import { cloneElement } from '../core/model.js';

const handlers = {};
export const on = (ev, fn) => { (handlers[ev] ||= []).push(fn); };
export const emit = (ev, d) => (handlers[ev] || []).forEach((fn) => fn(d));

export const S = {
  slug: '', user: null, doc: null, dev: 'd',
  canSite: false, siteEntry: null,   // pode editar páginas do site / entrada de paginas.json da página aberta (só kind 'pagina')
  updatedAt: 0, changed: false,   // carimbo do último rascunho salvo / há edição ainda não salva
  sel: [], tool: 'select', shapeKind: 'rect',
  pen: { stroke: null, sw: 6 },   // stroke null = automático (contrasta com o fundo)
  zoom: 1, anim: true, editing: null,
  assets: new Map(),       // id -> { url, blob, ext, mime, w, h }
  clipboard: [],
};

export const byId = (id) => S.doc.elements.find((e) => e.id === id);
export const selEls = () => S.doc.elements.filter((e) => S.sel.includes(e.id));
export const assetUrl = (id) => S.assets.get(id)?.url || null;

// ---------- histórico ----------
let hist = [], hi = -1;
const snap = () => JSON.stringify(S.doc);
function pushSnapshot() {
  const s = snap();
  if (hist[hi] === s) return;
  hist = hist.slice(0, hi + 1);
  hist.push(s);
  if (hist.length > 120) hist.shift();
  hi = hist.length - 1;
  emit('history');
}
const snapSoon = debounce(pushSnapshot, 450);

async function persist(opts) {
  if (S.deleted) return;   // a página aberta foi excluída do inventário: não recriar
  // sem edição e sem carimbo forçado, não regrava: senão só abrir e sair faria uma página publicada parecer "com alterações locais"
  if (!S.changed && opts?.updatedAt == null && S.updatedAt) return;
  const t = await Store.saveDoc(S.slug, S.doc, opts);
  S.updatedAt = t; S.changed = false;
  emit('saved', t);
}
export const save = debounce(async () => {
  try { await persist(); } catch (e) { emit('saveerror', e); }
}, 700);

export function touch() { S.changed = true; snapSoon(); save(); emit('dirty'); }

export function commit() { S.changed = true; snapSoon.cancel(); pushSnapshot(); save(); emit('dirty'); }

export async function saveNow(opts) { snapSoon.flush(); save.cancel(); await persist(opts); }

function restore(s) {
  // desfazer/refazer não mexe na identidade da página: id, tipo, dono e data de publicação continuam os atuais
  const keep = { id: S.doc.id, kind: S.doc.kind, owner: S.doc.owner };
  if (S.doc.publishedAt) keep.publishedAt = S.doc.publishedAt;
  S.doc = Object.assign(JSON.parse(s), keep);
  S.changed = true;
  S.sel = S.sel.filter((id) => byId(id));
  emit('struct');
  emit('select');
  emit('page');
  emit('history');
  save();
}
export function undo() { snapSoon.flush(); if (hi > 0) { hi--; restore(hist[hi]); } }
export function redo() { if (hi < hist.length - 1) { hi++; restore(hist[hi]); } }
export const canUndo = () => hi > 0;
export const canRedo = () => hi < hist.length - 1;

export function loadDoc(doc, updatedAt = 0) {
  S.doc = doc;
  S.updatedAt = updatedAt; S.changed = false;
  S.sel = [];
  hist = []; hi = -1;
  pushSnapshot();
  emit('struct'); emit('select'); emit('page');
}

// ---------- seleção / dispositivo ----------
export function select(ids, mode = 'set') {
  const valid = ids.filter((id) => byId(id));
  if (mode === 'set') S.sel = valid;
  else if (mode === 'add') S.sel = [...new Set([...S.sel, ...valid])];
  else if (mode === 'toggle') for (const id of valid) S.sel = S.sel.includes(id) ? S.sel.filter((x) => x !== id) : [...S.sel, id];
  emit('select');
}
export function setDevice(d) { if (S.dev === d) return; S.dev = d; emit('device'); }
export function setTool(t, kind) { S.tool = t; if (kind) S.shapeKind = kind; emit('tool'); }

// ---------- mutações ----------
// src: 'panel' (painel já está atualizado), 'canvas' (painel precisa atualizar números), 'struct'
export function mutate(ids, fn, src = 'panel') {
  for (const id of ids) { const el = byId(id); if (el) fn(el); }
  emit('el', { ids, src });
  touch();
}
export function mutateGeom(ids, fn) {
  for (const id of ids) { const el = byId(id); if (el) fn(el); }
  emit('geom', { ids });
  save(); // histórico só é gravado ao fim do gesto (commit)
}
export function setPage(fn) { fn(S.doc.page); emit('page'); touch(); }

export function addEls(els, { select: sel = true } = {}) {
  S.doc.elements.push(...els);
  emit('struct');
  if (sel) select(els.map((e) => e.id));
  commit();
}
export function removeEls(ids) {
  S.doc.elements = S.doc.elements.filter((e) => !ids.includes(e.id));
  S.sel = S.sel.filter((id) => !ids.includes(id));
  emit('struct'); emit('select');
  commit();
}
export function duplicate(ids = S.sel) {
  const copies = S.doc.elements.filter((e) => ids.includes(e.id)).map((e) => cloneElement(e));
  if (copies.length) addEls(copies);
}
export function reorder(ids, mode) {
  const a = S.doc.elements;
  const picked = a.filter((e) => ids.includes(e.id)), rest = a.filter((e) => !ids.includes(e.id));
  if (mode === 'front') S.doc.elements = [...rest, ...picked];
  else if (mode === 'back') S.doc.elements = [...picked, ...rest];
  else {
    const dir = mode === 'up' ? 1 : -1;
    const idx = a.map((e, i) => (ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
    for (const i of dir > 0 ? idx.reverse() : idx) {
      const j = i + dir;
      if (j < 0 || j >= a.length || ids.includes(a[j].id)) continue;
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  emit('struct'); commit();
}
export function moveLayer(id, toIndex) {
  const a = S.doc.elements, i = a.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [el] = a.splice(i, 1);
  a.splice(Math.max(0, Math.min(a.length, toIndex)), 0, el);
  emit('struct'); commit();
}

export function copy() {
  S.clipboard = clone(selEls());
}
export function paste() {
  if (!S.clipboard.length) return false;
  const els = clone(S.clipboard).map((e) => { e.id = uid(); e.f.d.x += 24; e.f.d.y += 24; if (e.f.m) { e.f.m.x += 24; e.f.m.y += 24; } return e; });
  S.clipboard = clone(els); // próximos colar vão deslocando
  addEls(els);
  return true;
}

