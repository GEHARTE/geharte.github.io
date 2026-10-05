// Modelo puro (sem DOM) do layout dos painéis do editor: o que está onde.
//
// Cada painel está em exatamente UM destes lugares:
//   docks.left / docks.right  colunas encaixadas nas laterais (cada coluna empilha painéis)
//   floats                    janelinha solta sobre o canvas
//   windows                   outra janela do navegador (só existe enquanto a janela está aberta)
//   hidden                    escondido (volta pelo menu Painéis)
// O DOM (dock.js) só desenha o que este módulo decide; assim dá para testar sem navegador.

export const SIDES = ['left', 'right'];
export const MIN_COL = 48, MAX_COL = 560, MIN_CENTER = 360, MIN_FLOAT_W = 150, MIN_FLOAT_H = 90;

// Padrão = o editor de sempre: ferramentas + biblioteca à esquerda, propriedades à direita.
const DEFAULTS = {
  rail:   { title: 'Ferramentas',   side: 'left',  w: 52,  box: { w: 56, h: 290 } },
  lib:    { title: 'Biblioteca',    side: 'left',  w: 272, box: { w: 290, h: 520 } },
  props:  { title: 'Propriedades',  side: 'right', w: 292, box: { w: 300, h: 560 } },
  layers: { title: 'Camadas',       side: 'right', w: 260, box: { w: 270, h: 360 } },
};
export const PANEL_IDS = Object.keys(DEFAULTS);
export const panelTitle = (id) => DEFAULTS[id]?.title || id;

const num = (v, d, lo = -1e6, hi = 1e6) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function defaultLayout(ids = PANEL_IDS) {
  const L = { v: 1, docks: { left: [], right: [] }, floats: [], windows: [], hidden: [], panels: {} };
  for (const id of ids) {
    L.panels[id] = { flex: 1, collapsed: false, home: null, box: { ...(DEFAULTS[id]?.box || { w: 300, h: 400 }) } };
    // "Camadas" já existe como aba da biblioteca: o painel solto começa escondido para não duplicar
    if (id === 'layers') { L.hidden.push(id); continue; }
    const d = DEFAULTS[id] || { side: 'right', w: 280 };
    L.docks[d.side].push({ w: d.w, ids: [id] });
  }
  return L;
}

export function locate(L, id) {
  for (const side of SIDES) {
    const cols = L.docks[side];
    for (let c = 0; c < cols.length; c++) {
      const i = cols[c].ids.indexOf(id);
      if (i >= 0) return { zone: 'dock', side, col: c, idx: i };
    }
  }
  if (L.floats.some((f) => f.id === id)) return { zone: 'float' };
  if (L.windows.some((f) => f.id === id)) return { zone: 'window' };
  if (L.hidden.includes(id)) return { zone: 'hidden' };
  return null;
}
export const isVisible = (L, id) => { const z = locate(L, id)?.zone; return !!z && z !== 'hidden'; };
export const allIds = (L) => Object.keys(L.panels);
export const dockWidth = (L, side) => L.docks[side].reduce((s, c) => s + c.w, 0);

// Tira o painel de onde está. Se estava encaixado, guarda a posição como "casa" (para voltar depois).
export function lift(L, id) {
  const at = locate(L, id);
  if (!at) return;
  if (at.zone === 'dock') {
    const col = L.docks[at.side][at.col];
    L.panels[id].home = { side: at.side, col: at.col, idx: at.idx, w: col.w };
    col.ids.splice(at.idx, 1);
    if (!col.ids.length) L.docks[at.side].splice(at.col, 1);
  }
  L.floats = L.floats.filter((f) => f.id !== id);
  L.windows = L.windows.filter((f) => f.id !== id);
  L.hidden = L.hidden.filter((x) => x !== id);
}

// Empilha na coluna `col` do lado `side`, na posição `idx` (contada SEM o próprio painel).
export function dockStack(L, id, side, col, idx) {
  const target = L.docks[side][col];
  lift(L, id);
  if (!target) return dockNewCol(L, id, side, L.docks[side].length);
  if (!L.docks[side].includes(target)) {          // a coluna só existia por causa dele: continua no lugar
    return dockNewCol(L, id, side, Math.min(col, L.docks[side].length), L.panels[id].home?.w);
  }
  target.ids.splice(Math.max(0, Math.min(idx, target.ids.length)), 0, id);
  L.panels[id].collapsed = false;
  return L;
}

// Cria uma coluna nova na posição `at` (0..n) do lado `side`.
export function dockNewCol(L, id, side, at, w) {
  const before = L.docks[side][at];
  const keepW = w ?? L.panels[id]?.home?.w ?? DEFAULTS[id]?.w ?? 280;
  lift(L, id);
  const pos = before && L.docks[side].includes(before) ? L.docks[side].indexOf(before) : (before ? Math.min(at, L.docks[side].length) : L.docks[side].length);
  L.docks[side].splice(pos, 0, { w: num(keepW, 280, MIN_COL, MAX_COL), ids: [id] });
  L.panels[id].collapsed = false;
  return L;
}

export function floatPanel(L, id, rect = {}) {
  lift(L, id);
  const b = L.panels[id].box;
  const f = { id, x: num(rect.x, 80), y: num(rect.y, 80), w: num(rect.w, b.w, MIN_FLOAT_W, 1600), h: num(rect.h, b.h, MIN_FLOAT_H, 1600) };
  L.floats.push(f);
  L.panels[id].collapsed = false;
  return f;
}
export function raiseFloat(L, id) {
  const i = L.floats.findIndex((f) => f.id === id);
  if (i >= 0 && i < L.floats.length - 1) L.floats.push(...L.floats.splice(i, 1));
}
export function windowPanel(L, id, size = {}) {
  lift(L, id);
  const b = L.panels[id].box;
  L.windows.push({ id, w: num(size.w, b.w, 200, 3000), h: num(size.h, b.h, 160, 3000) });
}
export function hidePanel(L, id) { lift(L, id); L.hidden.push(id); }

// Volta ao lugar de antes (a "casa"); sem casa, vai para o lado padrão do painel.
export function showPanel(L, id) {
  const at = locate(L, id);
  if (at && at.zone !== 'hidden' && at.zone !== 'window') return L;
  const home = L.panels[id]?.home;
  const side = home?.side || DEFAULTS[id]?.side || 'right';
  const cols = L.docks[side];
  if (home && home.col < cols.length) return dockStack(L, id, side, home.col, home.idx);
  return dockNewCol(L, id, side, cols.length, home?.w);
}
// Volta para a coluna de origem, mesmo vindo de flutuante ou de outra janela.
export function dockBack(L, id) {
  if (locate(L, id)?.zone === 'dock') return L;
  lift(L, id);
  return showPanel(L, id);
}
export const redock = dockBack;

export function toggleCollapsed(L, id) { L.panels[id].collapsed = !L.panels[id].collapsed; }
export function setColWidth(L, side, col, w) {
  const c = L.docks[side][col];
  if (c) c.w = Math.round(num(w, c.w, MIN_COL, MAX_COL));
}
export function setFlex(L, pairs) { for (const [id, f] of pairs) if (L.panels[id]) L.panels[id].flex = Math.max(0.12, +f || 1); }

// Esconde/mostra todos de uma vez (Ctrl+\). Lembra quem estava visível para voltar igual.
export function toggleAll(L) {
  const vis = allIds(L).filter((id) => isVisible(L, id) && locate(L, id).zone !== 'window');
  if (vis.length) {
    L.stash = vis.map((id) => ({ id, ...clone(locate(L, id)), rect: clone(L.floats.find((f) => f.id === id) || null) }));
    for (const id of vis) hidePanel(L, id);
    return false;
  }
  for (const s of L.stash || []) {
    if (s.zone === 'float' && s.rect) { floatPanel(L, s.id, s.rect); } else showPanel(L, s.id);
  }
  L.stash = null;
  return true;
}

// Aceita lixo (localStorage velho/adulterado): devolve sempre um layout íntegro com cada painel uma vez só.
export function normalize(raw, ids = PANEL_IDS) {
  const L = defaultLayout(ids);
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return L;
  const known = new Set(ids), seen = new Set();
  const take = (id) => (typeof id === 'string' && known.has(id) && !seen.has(id) && seen.add(id));
  const out = { v: 1, docks: { left: [], right: [] }, floats: [], windows: [], hidden: [], panels: L.panels };

  for (const id of ids) {
    const p = raw.panels?.[id];
    if (!p || typeof p !== 'object') continue;
    const d = L.panels[id];
    d.flex = num(p.flex, 1, 0.12, 20);
    d.collapsed = !!p.collapsed;
    d.box = { w: num(p.box?.w, d.box.w, MIN_FLOAT_W, 1600), h: num(p.box?.h, d.box.h, MIN_FLOAT_H, 1600) };
    const h = p.home;
    if (h && SIDES.includes(h.side)) d.home = { side: h.side, col: Math.max(0, num(h.col, 0, 0, 9) | 0), idx: Math.max(0, num(h.idx, 0, 0, 9) | 0), w: num(h.w, 280, MIN_COL, MAX_COL) };
  }
  for (const side of SIDES) {
    for (const c of Array.isArray(raw.docks?.[side]) ? raw.docks[side] : []) {
      const list = (Array.isArray(c?.ids) ? c.ids : []).filter(take);
      if (list.length) out.docks[side].push({ w: num(c.w, 280, MIN_COL, MAX_COL), ids: list });
    }
  }
  for (const f of Array.isArray(raw.floats) ? raw.floats : []) {
    if (!take(f?.id)) continue;
    out.floats.push({ id: f.id, x: num(f.x, 80), y: num(f.y, 80), w: num(f.w, 300, MIN_FLOAT_W, 1600), h: num(f.h, 400, MIN_FLOAT_H, 1600) });
  }
  for (const id of Array.isArray(raw.hidden) ? raw.hidden : []) if (take(id)) out.hidden.push(id);
  // janelas separadas não sobrevivem ao recarregar (o navegador não deixa reabrir sem um clique): voltam para casa
  const orphans = (Array.isArray(raw.windows) ? raw.windows : []).map((w) => w?.id).filter(take);
  for (const id of ids) if (take(id)) { if (id === 'layers') out.hidden.push(id); else orphans.push(id); }
  for (const id of orphans) showPanel(out, id);
  return out;
}

// O que vai para o localStorage: janelas separadas contam como encaixadas na casa delas.
export function serialize(L) {
  const c = clone(L);
  c.stash = undefined;
  for (const w of [...c.windows]) showPanel(c, w.id);
  c.windows = [];
  return c;
}

// Cabe tudo na janela atual? Encolhe colunas até sobrar espaço para o canvas e traz flutuantes para dentro.
export function clampToViewport(L, vw, vh, topY = 0) {
  const total = () => dockWidth(L, 'left') + dockWidth(L, 'right');
  let guard = 200;
  while (total() > vw - MIN_CENTER && guard--) {
    let widest = null;
    for (const side of SIDES) for (const c of L.docks[side]) if (c.w > MIN_COL && (!widest || c.w > widest.w)) widest = c;
    if (!widest) break;
    widest.w = Math.max(MIN_COL, widest.w - Math.min(20, total() - (vw - MIN_CENTER)));
  }
  for (const f of L.floats) {
    f.w = Math.min(f.w, Math.max(MIN_FLOAT_W, vw - 16)); f.h = Math.min(f.h, Math.max(MIN_FLOAT_H, vh - topY - 16));
    // o painel solto fica INTEIRO dentro da área visível (nada de janela cortada pela borda de baixo)
    f.x = Math.min(Math.max(f.x, 8), Math.max(8, vw - f.w - 8));
    f.y = Math.min(Math.max(f.y, topY), Math.max(topY, vh - f.h - 8));
  }
  return L;
}
