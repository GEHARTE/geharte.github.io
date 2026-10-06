// Unidades, formatos e réguas do ArtAtk — lógica PURA (sem DOM), usada pelas réguas do editor, pelo tamanho da página
// e pelas exportações. Cobre dois mundos:
//   · FÍSICO (material impresso): mm, cm, pol, pt, paica; formatos A4, Carta etc.; resolução de impressão (dpi);
//   · INTERFACE (telas): px (px de CSS), rem; alvos de tela (celular, tablet, desktop) e grade em múltiplos de 4/8.
// O documento continua em px de design (1 px = 1/96 de polegada, a definição de px do CSS); este módulo só converte e
// escolhe as marcas da régua. Assim um A4 é 793,7 × 1122,5 px e 1 cm = 37,795 px — e a página impressa sai no tamanho certo.

export const PX_POR_POL = 96;
export const REM_PADRAO = 16;

// fator de cada unidade em px de CSS (rem depende da base e é tratado à parte)
const PX_DE = { px: 1, pol: PX_POR_POL, cm: PX_POR_POL / 2.54, mm: PX_POR_POL / 25.4, pt: PX_POR_POL / 72, pc: PX_POR_POL / 6 };
export const UNIDADES = {
  px: { rotulo: 'px', nome: 'Pixels de tela', familia: 'interface', casas: 0 },
  rem: { rotulo: 'rem', nome: 'rem (relativo ao texto base)', familia: 'interface', casas: 2 },
  mm: { rotulo: 'mm', nome: 'Milímetros', familia: 'fisico', casas: 1 },
  cm: { rotulo: 'cm', nome: 'Centímetros', familia: 'fisico', casas: 2 },
  pol: { rotulo: 'pol', nome: 'Polegadas', familia: 'fisico', casas: 3 },
  pt: { rotulo: 'pt', nome: 'Pontos (tipografia)', familia: 'fisico', casas: 1 },
  pc: { rotulo: 'pc', nome: 'Paicas', familia: 'fisico', casas: 2 },
};
const ALIAS = { in: 'pol', '"': 'pol', polegada: 'pol', polegadas: 'pol', pica: 'pc', paica: 'pc', milimetro: 'mm', milimetros: 'mm', centimetro: 'cm', centimetros: 'cm', pixel: 'px', pixels: 'px', ponto: 'pt', pontos: 'pt' };
export const unidadeValida = (u) => Object.prototype.hasOwnProperty.call(UNIDADES, u);

const r6 = (n) => Math.round(n * 1e6) / 1e6;

export function paraPx(valor, unidade, { rem = REM_PADRAO } = {}) {
  if (!Number.isFinite(valor)) return NaN;
  if (unidade === 'rem') return r6(valor * rem);
  if (!(unidade in PX_DE)) throw new Error(`Unidade desconhecida: ${unidade}`);
  return r6(valor * PX_DE[unidade]);
}
export function dePx(px, unidade, { rem = REM_PADRAO } = {}) {
  if (!Number.isFinite(px)) return NaN;
  if (unidade === 'rem') return r6(px / rem);
  if (!(unidade in PX_DE)) throw new Error(`Unidade desconhecida: ${unidade}`);
  return r6(px / PX_DE[unidade]);
}
export const converter = (valor, de, para, opts) => dePx(paraPx(valor, de, opts), para, opts);

// "21,0 cm", "793 px", "1,5 rem" — vírgula decimal, número de casas da unidade (sem zeros à direita desnecessários).
export function formatar(valor, unidade, { casas, comUnidade = true } = {}) {
  if (!Number.isFinite(valor)) return '—';
  const c = casas ?? UNIDADES[unidade]?.casas ?? 2;
  const n = Number(valor.toFixed(c)).toLocaleString('pt-BR', { maximumFractionDigits: c });
  return comUnidade ? `${n} ${UNIDADES[unidade]?.rotulo ?? unidade}` : n;
}

// Entende o que a pessoa digita: "2,5cm", "10 mm", "12pt", "1.5 in", "40" (usa a unidade padrão). Devolve { valor, unidade, px } ou null.
export function interpretar(texto, unidadePadrao = 'px', opts) {
  const m = String(texto ?? '').trim().toLowerCase().match(/^(-?\d+(?:[.,]\d+)?)\s*([a-zç"]*)$/);
  if (!m) return null;
  const valor = Number(m[1].replace(',', '.'));
  let u = m[2] || unidadePadrao;
  u = ALIAS[u] || u;
  if (!unidadeValida(u)) return null;
  return { valor, unidade: u, px: paraPx(valor, u, opts) };
}

// Campo numérico do painel que aceita unidade: "2,5cm", "12pt", "40" (sem unidade = a própria unidade do campo, `saida`).
// Devolve o número NA unidade do campo (px no X/Y/L/A, mm na sangria) ou null se não entender.
export function lerCampo(texto, saida = 'px', opts) {
  const r = interpretar(texto, saida, opts);
  return r ? dePx(r.px, saida, opts) : null;
}
// Só dígitos (sem unidade): enquanto a pessoa digita assim, o campo aplica na hora; com unidade, espera Enter ou sair do campo.
export const ehSoNumero = (texto) => /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(String(texto ?? ''));

// ---------- formatos de papel (em mm, retrato: largura × altura) ----------
export const FORMATOS = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
  B4: [250, 353], B5: [176, 250],
  carta: [215.9, 279.4], oficio: [215.9, 355.6], 'oficio-br': [216, 330], tabloide: [279.4, 431.8],
  'cartao-visita': [90, 50], 'cartao-postal': [148, 105], quadrado: [210, 210],
};
export const ROTULO_FORMATO = { carta: 'Carta (EUA)', oficio: 'Ofício (EUA)', 'oficio-br': 'Ofício (Brasil)', tabloide: 'Tabloide', 'cartao-visita': 'Cartão de visita (BR)', 'cartao-postal': 'Cartão-postal', quadrado: 'Quadrado 21 cm' };
export const nomeFormato = (id) => ROTULO_FORMATO[id] || id;

// Tamanho de uma página: { mm:{w,h}, px:{w,h} }. O formato "cartao-visita" e "cartao-postal" já nascem em paisagem.
export function tamanhoPagina(id, { orientacao = 'retrato' } = {}) {
  const f = FORMATOS[id];
  if (!f) throw new Error(`Formato desconhecido: ${id}`);
  let [w, h] = f;
  if (orientacao === 'paisagem' ? w < h : w > h) [w, h] = [h, w];
  return { mm: { w, h }, px: { w: paraPx(w, 'mm'), h: paraPx(h, 'mm') } };
}
// Tamanho personalizado em qualquer unidade.
export const tamanhoPersonalizado = (w, h, unidade) => ({ mm: { w: converter(w, unidade, 'mm'), h: converter(h, unidade, 'mm') }, px: { w: paraPx(w, unidade), h: paraPx(h, unidade) } });

// Pixels de uma imagem exportada para impressão: A4 a 300 dpi = 2480 × 3508.
export const pixelsParaImpressao = (mm, dpi = 300) => Math.round((mm / 25.4) * dpi);
export const DPI_COMUNS = [72, 150, 300, 600];

// Sangria e margem de segurança (mm) sugeridas para gráfica; a página "com sangria" é a final + sangria dos 4 lados.
export const SANGRIA_PADRAO_MM = 3;
export const MARGEM_SEGURA_PADRAO_MM = 5;
export const comSangria = (tam, sangriaMm = SANGRIA_PADRAO_MM) => tamanhoPersonalizado(tam.mm.w + 2 * sangriaMm, tam.mm.h + 2 * sangriaMm, 'mm');

// ---------- alvos de interface (px de CSS) ----------
export const ALVOS = {
  'celular-pequeno': { rotulo: 'Celular pequeno', w: 360, h: 640, tipo: 'celular' },
  celular: { rotulo: 'Celular', w: 390, h: 844, tipo: 'celular' },
  'celular-grande': { rotulo: 'Celular grande', w: 430, h: 932, tipo: 'celular' },
  tablet: { rotulo: 'Tablet', w: 768, h: 1024, tipo: 'tablet' },
  'tablet-grande': { rotulo: 'Tablet grande', w: 1024, h: 1366, tipo: 'tablet' },
  notebook: { rotulo: 'Notebook', w: 1366, h: 768, tipo: 'desktop' },
  desktop: { rotulo: 'Desktop', w: 1440, h: 900, tipo: 'desktop' },
  'full-hd': { rotulo: 'Full HD', w: 1920, h: 1080, tipo: 'desktop' },
  'pc-artatk': { rotulo: 'Quadro de PC do ArtAtk', w: 1200, h: 900, tipo: 'desktop' },
};
// Faixas de largura usadas por sites responsivos (ponto de corte = início da faixa).
export const PONTOS_DE_CORTE = [{ id: 'celular', de: 0 }, { id: 'tablet', de: 768 }, { id: 'desktop', de: 1024 }, { id: 'largo', de: 1440 }];
export const faixaDeLargura = (w) => [...PONTOS_DE_CORTE].reverse().find((p) => w >= p.de).id;
export const arredondarPara = (v, passo) => (passo > 0 ? Math.round(v / passo) * passo : v);
export const GRADES = { '4': 4, '8': 8, '16': 16 };

// ---------- régua ----------
// Escolhe o passo das marcas para a unidade e o zoom: marca "maior" a cada passo (em 1, 2 ou 5 × 10^n unidades) com
// pelo menos `minPx` px de tela entre elas; marcas "menores" subdividem (1→5 partes, 2→4, 5→5) se couberem (≥ `minMenorPx`).
export function passoDaRegua(zoom, unidade, { minPx = 64, minMenorPx = 7, rem = REM_PADRAO } = {}) {
  const pxPorUnidade = paraPx(1, unidade, { rem }) * zoom;
  if (!(pxPorUnidade > 0)) throw new Error('Zoom ou unidade inválidos.');
  const minimo = minPx / pxPorUnidade;                               // em unidades
  const exp = Math.floor(Math.log10(minimo));
  let passo = null, mant = 1;
  for (const e of [exp, exp + 1]) for (const m of [1, 2, 5]) { const p = m * 10 ** e; if (passo === null && p >= minimo - 1e-12) { passo = p; mant = m; } }
  const partes = mant === 2 ? 4 : 5;
  const menor = passo / partes;
  return { maior: r6(passo), menor: menor * pxPorUnidade >= minMenorPx ? r6(menor) : null, pxPorUnidade };
}

// Marcas da régua entre `inicioPx` e `fimPx` (px de design, coordenadas do documento). `origemPx` é onde fica o 0 da régua.
// Devolve [{ px, valor, nivel:'maior'|'menor', rotulo }] — `px` é a posição no documento; `valor` já está na unidade da régua.
export function marcasDaRegua(inicioPx, fimPx, zoom, unidade, { origemPx = 0, ...opts } = {}) {
  const { maior, menor } = passoDaRegua(zoom, unidade, opts);
  const passo = menor ?? maior;
  const u2px = paraPx(1, unidade, opts);
  const a = Math.ceil(r6((inicioPx - origemPx) / u2px / passo)), b = Math.floor(r6((fimPx - origemPx) / u2px / passo));
  const fator = Math.round(maior / passo);
  const out = [];
  for (let k = a; k <= b; k++) {
    const valor = r6(k * passo), eMaior = k % fator === 0;
    out.push({ px: r6(origemPx + valor * u2px), valor, nivel: eMaior ? 'maior' : 'menor', rotulo: eMaior ? formatar(valor, unidade, { comUnidade: false, casas: UNIDADES[unidade].casas }) : '' });
  }
  return out;
}
