// Exportar a página como PDF pelo navegador (REQ-AK, AK-40 e AK-42): o visualizador abre num "modo de impressão" (perfil.html?print=1)
// que mostra o ESTADO FINAL da página — sem esperar rolagem, sem animação em andamento — numa única página de PDF do tamanho da página.
// Este módulo é a parte sem DOM (testável em Node) mais dois ajudantes que só rodam no navegador.
import { pageW, pageH, ehUnico, ehFixa } from './model.js';
import { paraPx, dePx, formatar } from './medidas.js';
import { sangriaMm, sangriaPx, larguraFinal, alturaFinal } from './gabarito.js';
import { rotuloDaPagina } from './formatos.js';

// 200 polegadas (14 400 pt) é o teto de página de PDF que leitores como o Acrobat aceitam; acima disso o conteúdo segue em outra página.
export const ALTURA_MAX = 19200;

// Estado final de TODA animação CSS: dura 1 ms, sem atraso, uma só volta, e fica onde terminou. Efeitos de entrada ("de" → base) acabam na
// posição natural; contínuos (flutuar, girar…) acabam no quadro base; o desenho de traço termina desenhado.
export const CSS_FINAL = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;animation-iteration-count:1!important;'
  + 'animation-fill-mode:forwards!important;transition:none!important}';

/** Tamanho do papel em px CSS (1 px = 1/96 pol): a largura do dispositivo e a altura da página, com teto. Formato único (A4, tablet…) só tem 'd'. */
export function tamanhoPagina(doc, dev) {
  const d = dev === 'm' && !ehUnico(doc) ? 'm' : 'd';
  const h = Math.min(Math.max(Math.round(pageH(doc, d)), 1), ALTURA_MAX);
  return { w: pageW(doc, d), h };
}

/** Regra @page do tamanho exato da página, sem margem (sem margem o Chromium também não imprime cabeçalho e rodapé). */
export const cssPagina = ({ w, h }) => `@page{size:${w}px ${h}px;margin:0}`;

/**
 * Endereço do visualizador em modo de impressão. `query` vem de viewerQuery() (u=…&p=…/a=…); `rascunho` usa o que está salvo no navegador
 * (é o caso do editor); `auto` chama a janela de impressão sozinha quando tudo carregou.
 */
export function urlImpressao({ base = '', query, dev = 'd', rascunho = false, auto = false, sangria = false, marcas = false, aba = null }) {
  const p = new URLSearchParams(query);
  if (rascunho) p.set('src', 'draft');
  p.set('device', dev === 'm' ? 'm' : 'd');
  p.set('print', auto ? 'auto' : '1');
  if (sangria) p.set('sangria', '1');          // papel: inclui a sangria (a folha cresce além do corte)
  if (marcas) p.set('marcas', '1');            // papel: marcas de corte nos cantos
  return `${base}perfil.html?${p}${aba ? `#/${aba}` : ''}`;
}

// ---------- papel para gráfica: sangria e marcas de corte ----------
// Medidas das marcas (mm): começam a `sangria` (no mínimo 3 mm) + 1 mm do corte, têm 5 mm de comprimento e deixam 1 mm até a borda da folha.
export const MARCA_COMPRIMENTO_MM = 5;
export const MARCA_FOLGA_MM = 1;
export const MARCA_AFASTAMENTO_MIN_MM = 3;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Folha do PDF de um arquivo de PAPEL (altura fixa), em px CSS. Opções:
 *   sangria  inclui a sangria do arquivo (a área além do corte); sem ela, o PDF é só a página final (recortada no corte);
 *   marcas   acrescenta uma faixa em volta com as marcas de corte nos 4 cantos (a folha fica maior que o papel).
 * Devolve { folha:{w,h}, caixa:{x,y,w,h,sangria}, corte:{x,y,w,h}, marcas:[{x1,y1,x2,y2}], rotulo }:
 *   `caixa` é onde o conteúdo vai (com sangria: a página inteira; sem: só a página final) e `corte` é a página final dentro da folha.
 */
export function folhaPdf(doc, { sangria = false, marcas = false } = {}) {
  const b = sangriaPx(doc), incluida = sangria && b > 0 ? b : 0;
  const tw = larguraFinal(doc, 'd'), th = alturaFinal(doc, 'd');
  const afast = paraPx(Math.max(sangriaMm(doc), MARCA_AFASTAMENTO_MIN_MM) + MARCA_FOLGA_MM, 'mm'), comp = paraPx(MARCA_COMPRIMENTO_MM, 'mm');
  const m = marcas ? r2(afast + comp + paraPx(MARCA_FOLGA_MM, 'mm')) : incluida;        // da borda da folha até o corte
  const folha = { w: r2(tw + 2 * m), h: r2(th + 2 * m) };
  const corte = { x: r2(m), y: r2(m), w: tw, h: th };
  const caixa = { x: r2(m - incluida), y: r2(m - incluida), w: r2(tw + 2 * incluida), h: r2(th + 2 * incluida), sangria: incluida > 0 };
  const linhas = [];
  if (marcas) {
    const a = r2(afast), c = r2(comp), x0 = corte.x, x1 = corte.x + tw, y0 = corte.y, y1 = corte.y + th;
    for (const y of [y0, y1]) { linhas.push({ x1: r2(x0 - a - c), y1: y, x2: r2(x0 - a), y2: y }, { x1: r2(x1 + a), y1: y, x2: r2(x1 + a + c), y2: y }); }
    for (const x of [x0, x1]) { linhas.push({ x1: x, y1: r2(y0 - a - c), x2: x, y2: r2(y0 - a) }, { x1: x, y1: r2(y1 + a), x2: x, y2: r2(y1 + a + c) }); }
  }
  const mm = (px) => formatar(dePx(px, 'mm'), 'mm', { comUnidade: false, casas: 1 });
  const rotulo = `${doc.title || 'Arquivo'} · ${rotuloDaPagina(doc.page)}${marcas ? ' · marcas de corte' : ''}${incluida ? '' : ''}`;
  return { folha, caixa, corte, marcas: linhas, rotulo, folhaMm: { w: mm(folha.w), h: mm(folha.h) } };
}

/** Acrescenta ao texto de um SVG a regra que leva todas as animações dele ao estado final (para SVG carregado como <img>). */
export function congelarSvg(texto) {
  const i = texto.lastIndexOf('</svg>');
  if (i < 0) return texto;
  return `${texto.slice(0, i)}<style>${CSS_FINAL}</style>${texto.slice(i)}`;
}

const dataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * (navegador) SVG dentro de <img> é um documento à parte: o CSS da página não chega nele, e `@media print` também não vale ali
 * (medido em 2026-10-06). Então busca o texto de cada SVG, congela as animações e troca o endereço da imagem.
 */
export async function congelarSvgsDasImagens(root, { buscar = fetch } = {}) {
  const imgs = [...root.querySelectorAll('img')].filter((i) => /\.svg(\?|#|$)|^data:image\/svg|^blob:/i.test(i.getAttribute('src') || ''));
  await Promise.all(imgs.map(async (img) => {
    try {
      const r = await buscar(img.src);
      const t = await r.text();
      if (!/<svg[\s>]/i.test(t)) return;            // blob que não é SVG
      img.src = dataUrl(congelarSvg(t));
    } catch { /* fica como está */ }
  }));
}

/**
 * (navegador) Espera o que muda o desenho: fontes, imagens (inclusive SVGs já congelados) e dois quadros de pintura.
 * Nunca espera para sempre: passado `limite` ms, segue (melhor um PDF com a fonte de reserva do que nenhum).
 */
export async function esperarPronto(root, { limite = 10000 } = {}) {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const tudo = (async () => {
    await frame(); await frame();
    await document.fonts?.ready;
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    await frame();
  })();
  await Promise.race([tudo, espera(limite)]);
}
