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

// Padrão: ferramentas e a pilha da biblioteca (Elementos aberto; SVG animado, Mídia, Drive e Modelos recolhidos, um clique abre)
// à esquerda; Propriedades com as Camadas logo abaixo, à direita. Cada ferramenta é um painel: dá para recolher, empilhar onde quiser,
// soltar sobre o canvas ou levar para outra janela. `col` agrupa os painéis que nascem na mesma coluna.
const BOX = { w: 290, h: 420 };
const DEFAULTS = {
  rail:   { title: 'Ferramentas',  side: 'left',  col: 'rail',  w: 52,  box: { w: 150, h: 290 } },
  els:    { title: 'Elementos',    side: 'left',  col: 'lib',   w: 272, box: { w: 290, h: 520 } },
  svg:    { title: 'SVG animado',  side: 'left',  col: 'lib',   w: 272, collapsed: true, box: BOX },
  media:  { title: 'Mídia',        side: 'left',  col: 'lib',   w: 272, collapsed: true, box: BOX },
  drive:  { title: 'Drive',        side: 'left',  col: 'lib',   w: 272, collapsed: true, box: BOX },
  tpl:    { title: 'Modelos',      side: 'left',  col: 'lib',   w: 272, collapsed: true, box: { w: 320, h: 520 } },
  props:  { title: 'Propriedades', side: 'right', col: 'right', w: 292, flex: 2, box: { w: 300, h: 560 } },
  layers: { title: 'Camadas',      side: 'right', col: 'right', w: 292, flex: 1, box: { w: 270, h: 360 } },
};
export const PANEL_IDS = Object.keys(DEFAULTS);
export const panelTitle = (id) => DEFAULTS[id]?.title || id;
export const LAYOUT_V = 2;
// Onde a disposição fica no navegador (e a chave que liga a sincronização com a conta): uma por pessoa, nunca por arquivo.
export const chaveLayout = (slug) => `gehrarte.layout.${slug}`;
export const chaveSync = (slug) => `gehrarte.layout.sync.${slug}`;
// Painéis que antes eram abas da "Biblioteca" (layout v1 guardava o painel único `lib`)
export const LIB_IDS = ['els', 'svg', 'media', 'drive', 'tpl'];
// Celular: cada botão da gaveta mostra um grupo (a biblioteca vira uma sanfona)
export const DRAWER_GROUPS = { lib: LIB_IDS, layers: ['layers'], props: ['props'] };
const orderOf = (id) => { const i = PANEL_IDS.indexOf(id); return i < 0 ? 999 : i; };

const num = (v, d, lo = -1e6, hi = 1e6) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function defaultLayout(ids = PANEL_IDS) {
  const L = { v: LAYOUT_V, docks: { left: [], right: [] }, floats: [], windows: [], hidden: [], panels: {} };
  const cols = {};                                   // "lado:grupo" → coluna
  for (const id of [...ids].sort((a, b) => orderOf(a) - orderOf(b))) {
    const d = DEFAULTS[id] || { side: 'right', col: id, w: 280 };
    L.panels[id] = { flex: d.flex ?? 1, collapsed: !!d.collapsed, home: null, box: { ...(d.box || { w: 300, h: 400 }) } };
    const k = `${d.side}:${d.col || id}`;
    if (cols[k]) cols[k].ids.push(id);
    else { cols[k] = { w: d.w, ids: [id] }; L.docks[d.side].push(cols[k]); }
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
  // sem casa: entra na coluna de quem nasce com ele (Camadas embaixo das Propriedades), onde quer que esse alguém esteja agora
  const grupo = DEFAULTS[id]?.col;
  if (!home && grupo) {
    for (const sd of SIDES) {
      const ci = L.docks[sd].findIndex((c) => c.ids.some((o) => o !== id && DEFAULTS[o]?.col === grupo));
      if (ci >= 0) return dockStack(L, id, sd, ci, L.docks[sd][ci].ids.length);
    }
  }
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
// Abre o painel e recolhe os que dividem a coluna com ele (sanfona).
export function expandOnly(L, id) {
  const at = locate(L, id);
  L.panels[id].collapsed = false;
  if (at?.zone === 'dock') for (const o of L.docks[at.side][at.col].ids) if (o !== id) L.panels[o].collapsed = true;
}
// Sobe (-1) ou desce (+1) o painel dentro da coluna. Devolve false se não dá (sozinho, já no topo/fim, fora de coluna).
export function movePanel(L, id, dir) {
  const at = locate(L, id);
  if (at?.zone !== 'dock') return false;
  const ids = L.docks[at.side][at.col].ids, j = at.idx + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= ids.length) return false;
  [ids[at.idx], ids[j]] = [ids[j], ids[at.idx]];
  return true;
}
// Empilha no FIM da coluna mais larga do lado (a das ferramentas, de 52 px, não conta). Sem coluna, cria uma.
export function dockInSide(L, id, side) {
  lift(L, id);
  const cols = L.docks[side];
  let best = -1;
  cols.forEach((c, i) => { if (c.w > 60 && (best < 0 || c.w > cols[best].w)) best = i; });
  if (best < 0) return dockNewCol(L, id, side, cols.length);
  return dockStack(L, id, side, best, cols[best].ids.length);
}
export function setColWidth(L, side, col, w) {
  const c = L.docks[side][col];
  if (c) c.w = Math.round(num(w, c.w, MIN_COL, MAX_COL));
}
export function setFlex(L, pairs) { for (const [id, f] of pairs) if (L.panels[id]) L.panels[id].flex = Math.max(0.12, +f || 1); }

// Esconde/mostra todos de uma vez (Ctrl+\). Lembra quem estava visível para voltar igual.
export function toggleAll(L) {
  const vis = allIds(L).filter((id) => isVisible(L, id) && locate(L, id).zone !== 'window');
  if (vis.length) {
    L.stash = vis.map((id) => ({ id, zone: locate(L, id).zone, rect: (({ x, y, w, h } = {}) => (x === undefined ? null : { x, y, w, h }))(L.floats.find((f) => f.id === id)) }));   // forma que o disco guarda e `normalize` devolve igual
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
// Layout v1 tinha um painel único "lib" (Biblioteca, com abas) e Camadas escondido. Vira os painéis novos no mesmo lugar;
// Camadas, se estava escondido (o padrão antigo), volta ao padrão novo: embaixo das Propriedades.
export function migrarV1(raw) {
  const r = clone(raw);
  const tem = (x) => Array.isArray(x);
  for (const side of SIDES) for (const c of tem(r.docks?.[side]) ? r.docks[side] : []) if (tem(c?.ids)) c.ids = c.ids.flatMap((id) => (id === 'lib' ? LIB_IDS : [id]));
  if (tem(r.floats)) r.floats = r.floats.map((f) => (f?.id === 'lib' ? { ...f, id: 'els' } : f));
  if (tem(r.hidden)) r.hidden = r.hidden.flatMap((id) => (id === 'lib' ? LIB_IDS : id === 'layers' ? [] : [id]));
  if (tem(r.windows)) r.windows = r.windows.map((w) => (w?.id === 'lib' ? { ...w, id: 'els' } : w));
  if (r.panels?.lib && typeof r.panels.lib === 'object') {
    const { flex, collapsed, home, box } = r.panels.lib;
    r.panels.els = { flex, collapsed, home, box };                        // as outras nascem com o padrão
  }
  delete r.panels?.lib;
  r.v = LAYOUT_V;
  return r;
}

export function normalize(raw, ids = PANEL_IDS) {
  const L = defaultLayout(ids);
  if (raw && typeof raw === 'object' && raw.v === 1) raw = migrarV1(raw);
  if (!raw || typeof raw !== 'object' || !(raw.v >= LAYOUT_V)) return L;   // versões futuras são lidas do jeito que dá, nunca jogadas fora
  const known = new Set(ids), seen = new Set();
  const take = (id) => (typeof id === 'string' && known.has(id) && !seen.has(id) && seen.add(id));
  const out = { v: LAYOUT_V, docks: { left: [], right: [] }, floats: [], windows: [], hidden: [], panels: L.panels };

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
  for (const id of ids) if (take(id)) orphans.push(id);
  for (const id of orphans) { const c = out.panels[id].collapsed; showPanel(out, id); out.panels[id].collapsed = c; }   // showPanel abre; aqui vale o que estava guardado (ou o padrão)
  const stash = (Array.isArray(raw.stash) ? raw.stash : []).filter((x) => x && known.has(x.id) && (x.zone === 'dock' || x.zone === 'float'))
    .map((x) => ({ id: x.id, zone: x.zone, rect: x.zone === 'float' && x.rect && typeof x.rect === 'object' ? { x: num(x.rect.x, 80), y: num(x.rect.y, 80), w: num(x.rect.w, 300, MIN_FLOAT_W, 1600), h: num(x.rect.h, 400, MIN_FLOAT_H, 1600) } : null }));
  if (stash.length && !ids.some((id) => isVisible(out, id))) out.stash = stash;   // só faz sentido enquanto tudo está escondido
  return out;
}

// O que vai para o localStorage: janelas separadas contam como encaixadas na casa delas.
export function serialize(L) {
  const c = clone(L);
  if (!c.stash) delete c.stash;       // quem estava visível antes do Ctrl+\ também é guardado: esconder tudo e recarregar não perde o caminho de volta
  for (const w of [...c.windows]) showPanel(c, w.id);
  c.windows = [];
  if (c.stash && allIds(c).some((id) => isVisible(c, id))) delete c.stash;   // já tem painel à vista: o "voltar" do Ctrl+\ ficou velho
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
