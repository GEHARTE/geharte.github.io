// Resolução da imagem no papel (RG-13) — lógica PURA. Uma foto é uma grade de pixels; a resolução é quantos cabem em cada
// polegada do papel, no tamanho em que a imagem aparece. Falta pixel = imagem esticada, borrada. Só vale para arquivos de
// papel e para imagens de pixels (SVG não tem resolução). Faixas e limites: artatk-reguas-e-medidas.md §7.2.
import { ehFixa } from './model.js';
import { PX_POR_POL, dePx } from './medidas.js';

export const FAIXAS = [
  { id: 'otima', min: 300, rotulo: 'Ótima', texto: 'Nítida no papel.' },
  { id: 'boa', min: 200, rotulo: 'Boa', texto: 'Boa para a maioria dos usos.' },
  { id: 'regular', min: 150, rotulo: 'Regular', texto: 'Serve para leitura de perto; detalhes podem perder nitidez.' },
  { id: 'baixa', min: 0, rotulo: 'Baixa', texto: 'Pode sair borrada. Use uma imagem maior ou diminua este espaço.' },
];
export const faixaDaResolucao = (ppi) => (Number.isFinite(ppi) ? FAIXAS.find((f) => ppi >= f.min) : null);

// Pixels da imagem por polegada do papel. `nat` = { w, h } da imagem (px); `caixa` = { w, h } do elemento (px do documento,
// 1 px = 1/96 pol); `fit` = como a imagem preenche a caixa. A escala (px de documento por pixel da imagem) depende do ajuste:
//   preencher (cover) → a maior das duas;  conter (contain) → a menor;  esticar (fill) → cada eixo com a sua, e a pior limita.
export function resolucaoEfetiva(nat, caixa, fit = 'cover') {
  if (!(nat?.w > 0 && nat?.h > 0 && caixa?.w > 0 && caixa?.h > 0)) return NaN;
  const sx = caixa.w / nat.w, sy = caixa.h / nat.h;
  const escala = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  return PX_POR_POL / escala;
}

const r1 = (n) => Math.round(n * 10) / 10;
// Tudo o que o painel mostra de uma imagem, ou null se não há o que dizer (não é imagem de pixels, sem tamanho conhecido).
export function infoDaImagem(doc, el) {
  if (!el || el.t !== 'image') return null;
  const a = doc?.assets?.[el.asset];
  if (!a || /svg/i.test(a.mime || a.ext || '') || !(a.w > 0 && a.h > 0)) return null;
  const f = el.f?.d;
  if (!f) return null;
  const ppi = resolucaoEfetiva({ w: a.w, h: a.h }, f, el.s?.fit || 'cover');
  if (!Number.isFinite(ppi)) return null;
  return { ppi: Math.round(ppi), faixa: faixaDaResolucao(ppi), px: { w: a.w, h: a.h }, cm: { w: r1(dePx(f.w, 'cm')), h: r1(dePx(f.h, 'cm')) } };
}

// Imagens do arquivo de papel com resolução baixa (ids), para a conferência da página e do PDF.
export function imagensDeBaixaResolucao(doc) {
  if (!ehFixa(doc)) return [];
  return (doc.elements || []).filter((e) => !e.hide && infoDaImagem(doc, e)?.faixa.id === 'baixa').map((e) => e.id);
}
