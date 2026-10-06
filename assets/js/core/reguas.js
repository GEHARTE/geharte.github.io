// Réguas do ArtAtk — lógica PURA: unidade padrão do documento, conversão tela ↔ documento, guias (por dispositivo) e as medidas
// de um elemento na unidade da régua. O desenho (canvas) e os gestos ficam em editor/reguas.js; as marcas vêm de medidas.js.
import { pageW, pageH } from './model.js';
import { UNIDADES, paraPx, dePx, formatar, interpretar } from './medidas.js';

// Unidades oferecidas na régua (a paica fica de fora: ninguém pede).
export const UNIDADES_REGUA = ['px', 'rem', 'mm', 'cm', 'pol', 'pt'].filter((u) => u in UNIDADES);
// Papel (altura fixa) mede-se em cm; o resto (telas, páginas para site) em px.
export const unidadePadrao = (doc) => (doc?.page?.fixa ? 'cm' : 'px');
export const MAX_GUIAS = 40;
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- tela ↔ documento (px) ----------
// `origem` = onde o 0 do documento está na tela (px), `zoom` = ampliação.
export const posNaTela = (docPx, origem, zoom) => origem + docPx * zoom;
export const posNoDoc = (telaPx, origem, zoom) => (telaPx - origem) / zoom;
// Faixa do documento visível numa régua de `tamanho` px de tela.
export const faixaVisivel = (origem, tamanho, zoom) => ({ inicio: posNoDoc(0, origem, zoom), fim: posNoDoc(tamanho, origem, zoom) });

// ---------- guias ----------
// doc.guias = { d: { x:[…], y:[…] }, m: { x:[…], y:[…] } } em px do documento. `x` = linha vertical; `y` = linha horizontal.
export const guiasDe = (doc, dev) => ({ x: [...(doc?.guias?.[dev]?.x || [])], y: [...(doc?.guias?.[dev]?.y || [])] });
const limite = (doc, dev, eixo) => (eixo === 'x' ? pageW(doc, dev) : pageH(doc, dev));
const lista = (doc, dev, eixo) => { doc.guias ||= {}; doc.guias[dev] ||= { x: [], y: [] }; return doc.guias[dev][eixo]; };

// Acrescenta uma guia. Devolve false se está fora da página, já existe ou passou do limite.
export function adicionarGuia(doc, dev, eixo, pos) {
  if (!Number.isFinite(pos) || (eixo !== 'x' && eixo !== 'y')) return false;
  const p = r2(pos);
  if (p < 0 || p > limite(doc, dev, eixo)) return false;
  const l = lista(doc, dev, eixo);
  if (l.includes(p) || l.length >= MAX_GUIAS) return false;
  l.push(p); l.sort((a, b) => a - b);
  return true;
}
export function moverGuia(doc, dev, eixo, de, para) {
  const l = lista(doc, dev, eixo), i = l.indexOf(r2(de));
  if (i < 0) return false;
  const p = r2(para);
  if (p < 0 || p > limite(doc, dev, eixo) || (p !== l[i] && l.includes(p))) return false;
  l[i] = p; l.sort((a, b) => a - b);
  return true;
}
export function removerGuia(doc, dev, eixo, pos) {
  const l = lista(doc, dev, eixo), i = l.indexOf(r2(pos));
  if (i < 0) return false;
  l.splice(i, 1);
  return true;
}
export function limparGuias(doc, dev = null) {
  if (!doc.guias) return 0;
  const n = (dev ? [dev] : Object.keys(doc.guias)).reduce((s, d) => s + (doc.guias[d]?.x.length || 0) + (doc.guias[d]?.y.length || 0), 0);
  if (dev) delete doc.guias[dev]; else delete doc.guias;
  if (doc.guias && !Object.keys(doc.guias).length) delete doc.guias;
  return n;
}
// Posições em que os elementos "grudam" ao serem arrastados (somadas às da página e dos vizinhos).
export const candidatosDeGuias = (doc, dev) => { const g = guiasDe(doc, dev); return { xs: g.x, ys: g.y }; };
export const totalDeGuias = (doc) => Object.values(doc?.guias || {}).reduce((s, g) => s + g.x.length + g.y.length, 0);

// ---------- medidas na unidade da régua ----------
// Frame { x, y, w, h } (px) → textos "5,3 cm". `rem` = tamanho do rem do documento.
export function medidasDoFrame(fr, unidade, opts) {
  const f = (v) => formatar(dePx(v, unidade, opts), unidade, { comUnidade: false });
  return { x: f(fr.x), y: f(fr.y), w: f(fr.w), h: f(fr.h), unidade: UNIDADES[unidade]?.rotulo || unidade };
}
// O que a pessoa digita ("2,5cm", "40", "10 mm") → px, usando a unidade da régua quando não vem unidade. null se não entender.
export function textoParaPx(texto, unidade, opts) {
  const r = interpretar(texto, unidade, opts);
  return r ? r.px : null;
}
export { paraPx, dePx };
