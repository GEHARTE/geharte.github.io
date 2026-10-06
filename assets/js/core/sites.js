// Projeto de site (kind 'site'): várias ABAS navegáveis num só documento, com topo e rodapé COMPARTILHADOS. Lógica pura.
//
// Persistência (ver garantirSite em model.js):
//   doc.abas[i]   = { id, nome, titulo, page:{bg,h}, elements }       as abas que NÃO estão abertas
//   doc.abaAtiva  = id da aba aberta no editor
//   doc.page / doc.elements = o CONJUNTO DE TRABALHO: a página da aba aberta + os elementos compartilhados (marcados com `comum`)
//   doc.comum     = { hRef:{d,m}, elements }                        topo e rodapé guardados (o conjunto de trabalho é a cópia viva)
// O resto do editor continua trabalhando só com doc.elements; esta camada concilia o conjunto de trabalho com as abas ao trocar de
// aba, ao exportar e ao visualizar.
//
// Elementos compartilhados: `comum: 'topo'` (fica onde está, em todas as abas) ou `comum: 'rodape'` (acompanha o fim da página:
// em abas mais altas ou mais baixas que a de referência `hRef`, desloca-se junto com o fim). O rodapé guardado é sempre relativo a hRef.
import { K, garantirSite, makeElement } from './model.js';
import { uid, clone } from './util.js';

export const GRUPOS_COMUNS = ['topo', 'rodape'];
const alturaM = (page) => page.h.m ?? Math.round(page.h.d * K);

export const abaDe = (doc, id) => doc.abas.find((a) => a.id === id) || null;
export const listaDeAbas = (doc) => doc.abas.map(({ id, nome, titulo }) => ({ id, nome, titulo }));

// O frame de celular existe sempre nos compartilhados (o deslocamento do rodapé é por dispositivo).
function materializar(el) {
  if (!el.f.m) { const d = el.f.d, fs0 = (el.t === 'text' ? el.s : el.ls)?.fontSize; el.f.m = { x: d.x * K, y: d.y * K, w: d.w * K, h: d.h * K, r: d.r || 0, ...(fs0 ? { fs: fs0 * K } : {}) }; }
}
function deslocar(elements, dd, dm) {
  for (const e of elements) if (e.comum === 'rodape') { materializar(e); e.f.d.y += dd; e.f.m.y += dm; }
}
const novoId = (doc, base) => {
  const usados = new Set(doc.abas.map((a) => a.id));
  const b = String(base || 'aba').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'aba';
  let id = b; for (let i = 2; usados.has(id); i++) id = `${b}-${i}`;
  return id;
};

// Grava o conjunto de trabalho na aba aberta e nos compartilhados (idempotente).
export function guardarAbaAtual(doc) {
  garantirSite(doc);
  const aba = abaDe(doc, doc.abaAtiva);
  const comuns = doc.elements.filter((e) => e.comum), proprios = doc.elements.filter((e) => !e.comum);
  const guardados = clone(comuns);
  deslocar(guardados, -(doc.page.h.d - doc.comum.hRef.d), -(alturaM(doc.page) - doc.comum.hRef.m));
  doc.comum.elements = guardados;
  aba.elements = clone(proprios);
  aba.page = clone(doc.page);
  return doc;
}

function carregar(doc, aba) {
  doc.abaAtiva = aba.id;
  doc.page = clone(aba.page);
  const comuns = clone(doc.comum.elements);
  deslocar(comuns, doc.page.h.d - doc.comum.hRef.d, alturaM(doc.page) - doc.comum.hRef.m);
  doc.elements = [...clone(aba.elements), ...comuns];
}

// Monta o conjunto de trabalho a partir da aba ativa e dos compartilhados (para um documento recém-criado a partir de um modelo).
export function carregarAbaAtiva(doc) {
  garantirSite(doc);
  carregar(doc, abaDe(doc, doc.abaAtiva));
  return doc;
}

// Abre outra aba no editor (guarda a atual antes). Devolve false se o id não existe.
export function abrirAba(doc, id) {
  garantirSite(doc);
  const alvo = abaDe(doc, id);
  if (!alvo) return false;
  if (id === doc.abaAtiva) return true;
  guardarAbaAtual(doc);
  carregar(doc, alvo);
  return true;
}

// Documento de UMA página (para exibir, exportar ou fazer miniatura): a aba pedida + os compartilhados, sem alterar `doc`.
// Mantém `abas` e `abaAtiva` para a barra de abas e os links entre abas.
export function docDeAba(doc, id) {
  const c = clone(doc);
  garantirSite(c);
  guardarAbaAtual(c);
  const aba = abaDe(c, id) || abaDe(c, c.abaAtiva);
  carregar(c, aba);
  return c;
}

// Todas as abas "achatadas" em documentos de uma página (para exportar o site inteiro).
export const todasAsPaginas = (doc) => listaDeAbas(doc).map((a) => ({ ...a, doc: docDeAba(doc, a.id) }));

// ---------- gerenciar abas ----------
export function adicionarAba(doc, nome = 'Nova aba', { depoisDe } = {}) {
  garantirSite(doc); guardarAbaAtual(doc);
  const id = novoId(doc, nome);
  const aba = { id, nome, titulo: nome, page: { bg: clone(doc.abas[0].page.bg), h: { d: 900, m: 1400 } }, elements: [] };
  const i = depoisDe ? doc.abas.findIndex((a) => a.id === depoisDe) : doc.abas.length - 1;
  doc.abas.splice(i + 1, 0, aba);
  return id;
}
export function renomearAba(doc, id, nome, titulo) {
  const a = abaDe(doc, id); if (!a) return false;
  if (nome != null && String(nome).trim()) a.nome = String(nome).trim().slice(0, 60);
  if (titulo != null && String(titulo).trim()) a.titulo = String(titulo).trim().slice(0, 120);
  return true;
}
export function removerAba(doc, id) {
  garantirSite(doc);
  if (doc.abas.length <= 1) return false;
  guardarAbaAtual(doc);
  const i = doc.abas.findIndex((a) => a.id === id); if (i < 0) return false;
  const eraAtiva = doc.abaAtiva === id;
  doc.abas.splice(i, 1);
  if (eraAtiva) carregar(doc, doc.abas[Math.min(i, doc.abas.length - 1)]);
  return true;
}
export function moverAba(doc, id, delta) {
  const i = doc.abas.findIndex((a) => a.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= doc.abas.length) return false;
  [doc.abas[i], doc.abas[j]] = [doc.abas[j], doc.abas[i]];
  return true;
}
export function duplicarAba(doc, id) {
  garantirSite(doc); guardarAbaAtual(doc);
  const o = abaDe(doc, id); if (!o) return null;
  const novo = clone(o); novo.id = novoId(doc, `${o.nome} copia`); novo.nome = `${o.nome} (cópia)`; novo.titulo = `${o.titulo} (cópia)`;
  for (const e of novo.elements) e.id = uid();
  doc.abas.splice(doc.abas.indexOf(o) + 1, 0, novo);
  return novo.id;
}

// Marca elementos (do conjunto de trabalho) como compartilhados — 'topo', 'rodape' — ou devolve à aba (grupo = null).
export function marcarComum(doc, ids, grupo) {
  for (const e of doc.elements) {
    if (!ids.includes(e.id)) continue;
    if (grupo) { materializar(e); e.comum = grupo; } else delete e.comum;
  }
}

// ---------- links entre abas ----------
// Um elemento pode apontar para uma aba (link.aba) e a barra de abas navega por elas; o endereço é `#/<id>`.
export const hrefDaAba = (id) => `#/${id}`;
export const abaDoHash = (hash, doc) => { const m = String(hash || '').match(/^#\/([a-z0-9-]+)/); return m && abaDe(doc, m[1]) ? m[1] : null; };

// Rótulos exibidos pela barra de abas (respeita `mostrar` e `rotulos`).
export function abasDaBarra(doc, cfg = {}) {
  const ids = Array.isArray(cfg.mostrar) && cfg.mostrar.length ? cfg.mostrar : doc.abas.map((a) => a.id);
  return ids.map((id) => abaDe(doc, id)).filter(Boolean).map((a) => ({ id: a.id, rotulo: cfg.rotulos?.[a.id] || a.nome, ativa: a.id === doc.abaAtiva }));
}

// Todos os elementos de todas as abas (para ver imagens e fontes usadas pelo site inteiro).
export function todosOsElementos(doc) {
  const c = clone(doc); guardarAbaAtual(c);
  return [...c.comum.elements, ...c.abas.flatMap((a) => a.elements)];
}
export const novaBarraDeAbas = (frame = { x: 100, y: 80, w: 1000, h: 44 }) => makeElement('abas', {}, frame);
