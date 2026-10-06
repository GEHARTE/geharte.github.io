// Formatos de página para "Novo arquivo em branco": telas (PC e celular juntos, só PC, tablet, celular) e papel (A6…A3, Carta, cartão…).
// Lógica PURA. O documento guarda o formato em `doc.page`:
//   (sem `w`)   página para site: versão de PC (1200 px) e de celular (390 px), como sempre foi;
//   `w` (px)    formato ÚNICO: uma só versão, nessa largura (sem versão de celular);
//   `fixa`      a altura é fixa (papel): a página não cresce nem é "ajustada" ao conteúdo;
//   `fmt`       o id do formato (para mostrar "A4 · 21 × 29,7 cm" e reabrir o diálogo igual).
import { tamanhoPagina, tamanhoPersonalizado, ALVOS, dePx, formatar } from './medidas.js';

export const FORMATO_PADRAO = 'web';

// grupo → itens. `tela` usa ALVOS (px de CSS); `papel` usa FORMATOS (mm) via medidas.js.
export const GRUPOS_FORMATO = [
  { id: 'site', rotulo: 'Página para site', itens: [{ id: 'web', rotulo: 'PC e celular', desc: 'Versão de PC (1200 px) e de celular (390 px)', dual: true }] },
  { id: 'tela', rotulo: 'Uma tela só', itens: [
    { id: 'pc', rotulo: 'PC', tela: { w: 1200, h: 800 } }, { id: 'tablet', rotulo: 'Tablet', tela: { w: ALVOS.tablet.w, h: ALVOS.tablet.h } },
    { id: 'celular', rotulo: 'Celular', tela: { w: ALVOS.celular.w, h: ALVOS.celular.h } }] },
  { id: 'papel', rotulo: 'Papel', itens: ['A6', 'A5', 'A4', 'A3', 'carta', 'oficio-br', 'cartao-visita'].map((id) => ({ id: id.toLowerCase(), papel: id })) },
  { id: 'outro', rotulo: 'Outro', itens: [{ id: 'personalizado', rotulo: 'Tamanho personalizado', personalizado: true }] },
];
export const TODOS_FORMATOS = GRUPOS_FORMATO.flatMap((g) => g.itens);
export const formatoPorId = (id) => TODOS_FORMATOS.find((f) => f.id === id) || null;

const ROTULO_PAPEL = { A6: 'A6', A5: 'A5', A4: 'A4', A3: 'A3', carta: 'Carta', 'oficio-br': 'Ofício', 'cartao-visita': 'Cartão de visita' };
// Orientação com que cada formato "nasce": PC e cartão de visita são deitados; o resto, em pé.
export const orientacaoNatural = (f) => (f?.id === 'pc' || f?.id === 'cartao-visita' ? 'paisagem' : 'retrato');
export const rotuloDoItem = (f) => f.rotulo || ROTULO_PAPEL[f.papel] || f.id;

const BG = { c: '#ffffff', g: null };
const int = (n) => Math.max(1, Math.round(n));

// Página (doc.page) de um formato. `opcoes`: { orientacao:'retrato'|'paisagem', w, h, unidade } (w/h/unidade só no personalizado).
// Lança Error com mensagem para a pessoa se o tamanho personalizado for inválido.
export function paginaDoFormato(id, { orientacao, w, h, unidade = 'cm' } = {}) {
  const f = formatoPorId(id);
  if (!f) throw new Error(`Formato desconhecido: ${id}`);
  orientacao ||= orientacaoNatural(f);   // sem orientação explícita, vale a natural do formato
  if (f.dual) return { bg: { ...BG }, h: { d: 900, m: 1400 }, fmt: 'web' };
  let pw, ph, fixa = false;
  if (f.tela) { const lo = Math.min(f.tela.w, f.tela.h), hi = Math.max(f.tela.w, f.tela.h); [pw, ph] = orientacao === 'paisagem' ? [hi, lo] : [lo, hi]; }
  else if (f.papel) { const t = tamanhoPagina(f.papel, { orientacao }); pw = t.px.w; ph = t.px.h; fixa = true; }
  else {
    const W_ = Number(String(w).replace(',', '.')), H_ = Number(String(h).replace(',', '.'));
    if (!(W_ > 0) || !(H_ > 0)) throw new Error('Informe a largura e a altura do tamanho personalizado.');
    const t = tamanhoPersonalizado(W_, H_, unidade);
    pw = t.px.w; ph = t.px.h; fixa = unidade !== 'px';
    if (pw < 100 || ph < 100 || pw > 6000 || ph > 12000) throw new Error('O tamanho personalizado deve ficar entre 100 px e 6000 × 12000 px (aprox. 2,6 cm a 159 cm de largura).');
  }
  return { bg: { ...BG }, w: int(pw), h: { d: int(ph) }, fixa, fmt: id, ...(orientacao === 'paisagem' ? { orient: 'paisagem' } : {}) };
}

// Medidas de um item da lista, para mostrar ao lado do nome: "14,8 × 21 cm", "390 × 844 px".
export function medidasDoItem(f, orientacao) {
  if (f.dual) return f.desc;
  if (f.personalizado) return 'Você escolhe';
  const p = paginaDoFormato(f.id, { orientacao });
  return p.fixa ? `${formatar(dePx(p.w, 'cm'), 'cm', { comUnidade: false, casas: 1 })} × ${formatar(dePx(p.h.d, 'cm'), 'cm', { comUnidade: false, casas: 1 })} cm` : `${p.w} × ${p.h.d} px`;
}

// "A4 · 21 × 29,7 cm", "Celular · 390 × 844 px", "PC e celular". Só para mostrar.
export function rotuloDaPagina(page) {
  if (!page?.w) return 'PC e celular';
  const f = formatoPorId(page.fmt);
  const nome = f ? rotuloDoItem(f) : 'Tamanho personalizado';
  const alt = page.h.d;
  return page.fixa
    ? `${nome} · ${formatar(dePx(page.w, 'cm'), 'cm', { comUnidade: false, casas: 1 })} × ${formatar(dePx(alt, 'cm'), 'cm', { comUnidade: false, casas: 1 })} cm`
    : `${nome} · ${page.w} px`;
}
