// Alvos de tela (RG-09) — lógica PURA: o que se vê "sem rolar" em cada tela de referência (celular, tablet, notebook, desktop,
// Full HD). Segue as regras do visualizador (perfil.js): abaixo de 720 px de largura usa o layout de CELULAR, acima o de PC; a página
// é ampliada para caber na largura da tela (no máximo 1,5× no PC e 2× no celular) e centralizada. Documentos de formato único
// (ehUnico) só têm o layout de PC. Papel não tem alvo de tela.
import { ALVOS, faixaDeLargura } from './medidas.js';
import { pageW, pageH, ehUnico, ehFixa } from './model.js';

export const LARGURA_CELULAR = 720;                    // visualizador: matchMedia('(max-width:720px)')
export const ESCALA_MAX = { d: 1.5, m: 2 };
export const alvoValido = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ALVOS, id);
export const temAlvos = (doc) => !!doc && !ehFixa(doc);
export const layoutDaTela = (doc, largura) => (ehUnico(doc) || largura > LARGURA_CELULAR ? 'd' : 'm');

// Lista para o menu: [{ id, rotulo, w, h, tipo, layout }] na ordem de ALVOS.
export const listaDeAlvos = (doc) => (temAlvos(doc) ? Object.entries(ALVOS).map(([id, a]) => ({ id, ...a, layout: layoutDaTela(doc, a.w) })) : []);

// A área da página que a tela mostra ao abrir, em px do documento. `area.x` fica negativo quando a tela é mais larga que a página
// (sobram faixas dos lados); `dobra` é a altura visível: o que passa daí só aparece rolando.
export function vistaDoAlvo(doc, id) {
  if (!temAlvos(doc) || !alvoValido(id)) return null;
  const a = ALVOS[id], dev = layoutDaTela(doc, a.w), base = pageW(doc, dev);
  const escala = Math.min(a.w / base, ESCALA_MAX[dev]);
  const w = a.w / escala, h = a.h / escala, r2 = (n) => Math.round(n * 100) / 100;
  return {
    id, rotulo: a.rotulo, tipo: a.tipo, dev, escala: Math.round(escala * 1e4) / 1e4, tela: { w: a.w, h: a.h }, faixa: faixaDeLargura(a.w),
    area: { x: r2((base - w) / 2), y: 0, w: r2(w), h: r2(h) }, dobra: r2(h), paginaAltura: pageH(doc, dev), temDobra: pageH(doc, dev) > h,
  };
}

// Texto curto da moldura: "Notebook 1366 × 768 · 114%".
export const rotuloDoAlvo = (v) => `${v.rotulo} ${v.tela.w} × ${v.tela.h} · ${Math.round(v.escala * 100)}%`;
