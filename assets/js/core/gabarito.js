// Gabarito de impressão: SANGRIA e MARGEM SEGURA de um arquivo de papel. Lógica PURA.
//   · `page.w/h` incluem a sangria dos 4 lados (o que vai para a gráfica); a página FINAL (depois do corte) é a "caixa de corte".
//   · sangria (mm): área além do corte que o fundo e as imagens de borda devem cobrir, para não sobrar fio branco depois do corte;
//   · margem segura (mm): faixa dentro do corte onde NADA importante (texto, logotipo) deve ficar, porque o corte tem folga.
//   · As réguas medem a partir do canto da página FINAL (o 0 fica no corte), então a sangria aparece como medida negativa.
import { pageW, pageH, ehFixa } from './model.js';
import { paraPx } from './medidas.js';

export const SANGRIA_GRAFICA_MM = 3;
export const MARGEM_SEGURA_MM = 5;
export const SANGRIA_MAX_MM = 10;
export const MARGEM_MAX_MM = 30;
const r2 = (n) => Math.round(n * 100) / 100;

export const sangriaMm = (doc) => (ehFixa(doc) && doc.page.sangria > 0 ? doc.page.sangria : 0);
export const margemMm = (doc) => (ehFixa(doc) && doc.page.margem > 0 ? doc.page.margem : 0);
export const sangriaPx = (doc) => r2(paraPx(sangriaMm(doc), 'mm'));
export const margemPx = (doc) => r2(paraPx(margemMm(doc), 'mm'));
export const temGabarito = (doc) => sangriaMm(doc) > 0 || margemMm(doc) > 0;

// Tamanho da página FINAL (depois do corte) no dispositivo: é o que a pessoa vê no visualizador e na exportação.
export const larguraFinal = (doc, dev) => r2(pageW(doc, dev) - 2 * sangriaPx(doc));
export const alturaFinal = (doc, dev) => r2(pageH(doc, dev) - 2 * sangriaPx(doc));

// Caixa de corte (página final) e caixa segura, em px da página (com sangria).
export function caixaDeCorte(doc, dev = 'd') {
  const b = sangriaPx(doc);
  return { x: b, y: b, w: larguraFinal(doc, dev), h: alturaFinal(doc, dev) };
}
export function caixaSegura(doc, dev = 'd') {
  const c = caixaDeCorte(doc, dev), m = margemPx(doc);
  return { x: c.x + m, y: c.y + m, w: Math.max(0, c.w - 2 * m), h: Math.max(0, c.h - 2 * m) };
}

// Posições em que os elementos "grudam": corte e margem segura (além das bordas da página, que o palco já conhece).
export function candidatosDeGabarito(doc, dev = 'd') {
  if (!temGabarito(doc)) return { xs: [], ys: [] };
  const c = caixaDeCorte(doc, dev), s = caixaSegura(doc, dev);
  const xs = [c.x, c.x + c.w], ys = [c.y, c.y + c.h];
  if (margemMm(doc) > 0) { xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h); }
  return { xs, ys };
}
// Medida a partir do canto da página final (o 0 das réguas): px da página → px "de corte".
export const aPartirDoCorte = (doc, px) => r2(px - sangriaPx(doc));
export const daPartirDoCorte = (doc, px) => r2(px + sangriaPx(doc));

// ---------- mudar a sangria / a margem de um arquivo que já existe ----------
// Muda a sangria mantendo cada elemento no mesmo lugar RELATIVO ao corte: a página cresce (ou encolhe) dos 4 lados e tudo é deslocado.
// Só vale para papel (altura fixa). Devolve { ok, motivo? }.
export function aplicarSangria(doc, mm) {
  if (!ehFixa(doc)) return { ok: false, motivo: 'A sangria é só para arquivos de papel (tamanho fixo).' };
  const novo = Number(mm);
  if (!Number.isFinite(novo) || novo < 0 || novo > SANGRIA_MAX_MM) return { ok: false, motivo: `A sangria deve ficar entre 0 e ${SANGRIA_MAX_MM} mm.` };
  const antes = sangriaPx(doc), depois = r2(paraPx(novo, 'mm')), d = r2(depois - antes);
  doc.page.w = r2(doc.page.w + 2 * d);
  doc.page.h.d = r2(doc.page.h.d + 2 * d);
  if (novo > 0) doc.page.sangria = novo; else delete doc.page.sangria;
  for (const e of doc.elements || []) { e.f.d.x = r2(e.f.d.x + d); e.f.d.y = r2(e.f.d.y + d); }
  if (doc.guias?.d) { doc.guias.d.x = doc.guias.d.x.map((v) => r2(v + d)); doc.guias.d.y = doc.guias.d.y.map((v) => r2(v + d)); }
  return { ok: true };
}
export function aplicarMargem(doc, mm) {
  if (!ehFixa(doc)) return { ok: false, motivo: 'A margem segura é só para arquivos de papel (tamanho fixo).' };
  const novo = Number(mm);
  if (!Number.isFinite(novo) || novo < 0 || novo > MARGEM_MAX_MM) return { ok: false, motivo: `A margem segura deve ficar entre 0 e ${MARGEM_MAX_MM} mm.` };
  if (novo > 0) doc.page.margem = novo; else delete doc.page.margem;
  return { ok: true };
}

// ---------- conferência para a gráfica ----------
// Devolve listas de ids:
//   foraDaMargem  texto (ou forma com texto) que invade a margem segura — pode ser cortado;
//   semSangria    elemento que encosta no corte sem avançar pela sangria — pode sobrar um fio branco;
//   foraDaPagina  elemento inteiramente fora da página (não sai na impressão).
const TOL = 0.75;
export function avisosDeImpressao(doc) {
  const r = { foraDaMargem: [], semSangria: [], foraDaPagina: [] };
  if (!ehFixa(doc) || !temGabarito(doc)) return r;
  const w = pageW(doc, 'd'), h = pageH(doc, 'd'), c = caixaDeCorte(doc), s = caixaSegura(doc), b = sangriaPx(doc), m = margemMm(doc) > 0;
  for (const e of doc.elements || []) {
    if (e.hide) continue;
    const f = e.f.d, x1 = f.x + f.w, y1 = f.y + f.h;
    if (x1 <= 0 || y1 <= 0 || f.x >= w || f.y >= h) { r.foraDaPagina.push(e.id); continue; }
    const temTexto = e.t === 'text' || (e.t === 'shape' && e.label);
    if (m && temTexto && (f.x < s.x - TOL || f.y < s.y - TOL || x1 > s.x + s.w + TOL || y1 > s.y + s.h + TOL)) r.foraDaMargem.push(e.id);
    if (b > 0 && !temTexto) {
      const encosta = (Math.abs(f.x - c.x) <= TOL && f.x >= c.x - TOL) || (Math.abs(x1 - (c.x + c.w)) <= TOL) || (Math.abs(f.y - c.y) <= TOL) || (Math.abs(y1 - (c.y + c.h)) <= TOL);
      const largo = f.w >= c.w * 0.5 || f.h >= c.h * 0.5;       // fundos e faixas, não ícones pequenos
      if (encosta && largo) r.semSangria.push(e.id);
    }
  }
  return r;
}
