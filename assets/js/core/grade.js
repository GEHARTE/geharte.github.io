// Grade do ArtAtk (RG-08) — lógica PURA. Linhas de apoio em múltiplos de um passo, para alinhar e para "grudar":
//   · telas (páginas para site): 4, 8 ou 16 px;   · papel: 1, 5 ou 10 mm.
// A origem da grade é o 0 das réguas: o canto da página, ou o CORTE quando há sangria (assim os mm batem com a régua).
import { paraPx } from './medidas.js';

export const familiaDaMedida = (doc) => (doc?.page?.fixa ? 'papel' : 'tela');
export const PASSOS = { tela: [4, 8, 16], papel: [1, 5, 10] };
export const PASSO_PADRAO = { tela: 8, papel: 5 };
export const unidadeDaGrade = (familia) => (familia === 'papel' ? 'mm' : 'px');
export const rotuloDoPasso = (familia, passo) => `${passo} ${unidadeDaGrade(familia)}`;
export const passoValido = (familia, passo) => (PASSOS[familia] || []).includes(Number(passo));

// Passo em px do documento.
export const passoEmPx = (familia, passo) => paraPx(passo, unidadeDaGrade(familia));
// Abaixo disto (px de tela) as linhas viram uma mancha: a grade não é desenhada, mas o ímã continua valendo.
export const MIN_PX_DE_TELA = 5;
export const cabeNaTela = (passoPx, zoom) => passoPx * zoom >= MIN_PX_DE_TELA;

export const linhaMaisProxima = (v, passoPx, origemPx = 0) => origemPx + Math.round((v - origemPx) / passoPx) * passoPx;

// Quanto mover uma caixa { x, y, w, h } para uma das bordas (esquerda/direita; topo/base) cair numa linha da grade:
// vale a borda que está mais perto de uma linha. `ox`/`oy` = origem da grade em cada eixo.
export function ajustarNaGrade(box, passoPx, ox = 0, oy = 0) {
  if (!(passoPx > 0)) return { dx: 0, dy: 0 };
  const menor = (bordas, o) => bordas.map((b) => linhaMaisProxima(b, passoPx, o) - b).reduce((a, d) => (Math.abs(d) < Math.abs(a) ? d : a));
  return { dx: menor([box.x, box.x + box.w], ox), dy: menor([box.y, box.y + box.h], oy) };
}
