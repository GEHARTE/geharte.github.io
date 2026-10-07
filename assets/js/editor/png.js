// Exportar → Imagem PNG/JPEG (RG-14): a página INTEIRA (o que está na tela, publicada ou não) numa imagem na escala escolhida.
// Como: abre o visualizador em modo "estado final" (o do PDF) num iframe escondido, embute CSS, fontes e imagens num SVG com
// <foreignObject> e pinta esse SVG num canvas. As contas e a reescrita de CSS estão em core/exportar-png.js (puras e testadas).
import { h } from '../core/dom.js';
import { BASE, downloadBlob } from '../core/util.js';
import { viewerQuery, ehFixa, ehUnico } from '../core/model.js';
import { urlImpressao, tamanhoPagina, folhaPdf } from '../core/pdf.js';
import { sangriaMm } from '../core/gabarito.js';
import { rotuloDaPagina } from '../core/formatos.js';
import { ESCALAS_TELA, PPIS_PAPEL, FORMATOS, escalaDePpi, escalaSegura, nomeDoArquivo, filtrarFontFaces, embutirUrlsDoCss, reescreverRaiz, semImport, CSS_ESTATICO, montarSvg } from '../core/exportar-png.js';
import { S, saveNow } from './state.js';
import { modal, seg, toast, btn, toggle } from './ui.js';
import { icon } from './icons.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const lerArquivo = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });

// Baixa um recurso e devolve um data: URI (null se não der). Guarda o resultado: a mesma fonte/imagem aparece várias vezes.
function criarObtentor() {
  const cache = new Map();
  return (url) => {
    if (!cache.has(url)) cache.set(url, (async () => { try { const r = await fetch(url); return r.ok ? await lerArquivo(await r.blob()) : null; } catch { return null; } })());
    return cache.get(url);
  };
}

async function coletarCss(d, obter) {
  let css = '';
  for (const sh of d.styleSheets) {
    let txt = '';
    try { txt = [...sh.cssRules].map((r) => r.cssText).join('\n'); }
    catch { if (sh.href) { try { txt = await (await fetch(sh.href)).text(); } catch { /* sem essa folha */ } } }   // folha de outro site (Google Fonts): o texto vem pela rede
    css += '\n' + (await embutirUrlsDoCss(semImport(txt), sh.href || d.baseURI, obter));
  }
  return css;
}

// Grava no clone o estado FINAL de cada animação (o que ela deixou nos estilos) e solta a animação: dentro do SVG nada anima.
function assarAnimacoes(vivo, clone) {
  const a = [vivo, ...vivo.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
  a.forEach((el, i) => {
    const anims = el.getAnimations?.() || [];
    if (!anims.length) return;
    const cs = getComputedStyle(el), props = new Set();
    for (const an of anims) for (const kf of an.effect?.getKeyframes?.() || []) for (const k of Object.keys(kf)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) props.add(k);
    for (const p of props) { const v = cs[p]; if (v != null && v !== '') b[i].style[p] = v; }
  });
}

async function embutirImagens(clone, obter) {
  const trabalhos = [];
  for (const img of clone.querySelectorAll('img')) { const src = img.currentSrc || img.src; if (src && !src.startsWith('data:')) trabalhos.push(Promise.resolve(obter(src)).then((d) => { if (d) img.setAttribute('src', d); })); }
  for (const im of clone.querySelectorAll('image')) {
    const k = im.hasAttribute('href') ? 'href' : 'xlink:href', src = im.getAttribute(k);
    if (src && !src.startsWith('data:')) trabalhos.push(Promise.resolve(obter(new URL(src, clone.ownerDocument.baseURI).href)).then((d) => { if (d) im.setAttribute(k, d); }));
  }
  for (const el of clone.querySelectorAll('[style*="url("]')) trabalhos.push(embutirUrlsDoCss(el.getAttribute('style'), clone.ownerDocument.baseURI, obter).then((s) => el.setAttribute('style', s)));
  await Promise.all(trabalhos);
}

// Pinta o elemento `alvo` (de um documento já pronto) num canvas, na escala dada.
export async function elementoParaCanvas(alvo, { escala = 1, transparente = false, jpeg = false } = {}) {
  const d = alvo.ownerDocument, w3 = d.defaultView, obter = criarObtentor();
  const r = alvo.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * 100) / 100), hh = Math.max(1, Math.round(r.height * 100) / 100);   // sem arredondar para inteiro: A5 a 300 ppi tem de dar 1748 × 2480
  const texto = alvo.textContent || '';
  let css = await coletarCss(d, obter);
  css = reescreverRaiz(filtrarFontFaces(css, texto)) + CSS_ESTATICO;
  const clone = alvo.cloneNode(true);
  assarAnimacoes(alvo, clone);
  clone.querySelectorAll('animate,animateTransform,animateMotion,set').forEach((n) => n.remove());   // SVG com SMIL sai no quadro inicial
  await embutirImagens(clone, obter);
  // o "chão": fundo e tipografia que no site vêm do <body>
  const cb = w3.getComputedStyle(d.body), fundo = transparente && !jpeg ? 'none' : (d.body.style.background || cb.background);
  const chao = d.createElement('div');
  chao.className = '__raiz print-mode viewer';
  chao.setAttribute('style', `position:relative;overflow:hidden;width:${w}px;height:${hh}px;margin:0;background:${fundo};font:${cb.font};color:${cb.color}`);
  const estilo = d.createElement('style'); estilo.textContent = css;
  chao.append(estilo, clone);
  clone.style.margin = '0';
  // fundo transparente: além do "chão", a própria página (artboard) e a folha de papel pintam a cor de fundo
  if (transparente && !jpeg) for (const e of [clone, ...clone.querySelectorAll('.artboard')]) e.style.setProperty('background', 'none', 'important');
  const svg = montarSvg({ w, h: hh, corpoXhtml: new w3.XMLSerializer().serializeToString(chao) });
  // data: e não blob: — com blob: o navegador marca o canvas como "contaminado" e não deixa exportar
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('O navegador não conseguiu desenhar a página como imagem.')); img.src = url; });
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * escala); cv.height = Math.round(hh * escala);
    const c = cv.getContext('2d');
    if (jpeg) { c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); }
    c.drawImage(img, 0, 0, cv.width, cv.height);
    return { canvas: cv, w, h: hh };
  } finally { /* nada a soltar */ }
}

// Abre a página no visualizador (iframe escondido), espera ficar pronta e devolve { quadro, remover }.
async function abrirVisualizador({ dev, sangria }) {
  const t = S.doc.kind === 'site' ? S.doc.abas.find((a) => a.id === S.doc.abaAtiva)?.id : null;
  const src = urlImpressao({ base: new URL(BASE, location.href).href, query: viewerQuery(S.slug, S.doc), dev, rascunho: true, auto: false, sangria, marcas: false, aba: t });
  const ifr = document.createElement('iframe');
  Object.assign(ifr.style, { position: 'fixed', left: '-30000px', top: '0', width: '1280px', height: '800px', border: '0', visibility: 'hidden' });
  ifr.setAttribute('aria-hidden', 'true');
  document.body.append(ifr);
  const remover = () => ifr.remove();
  try {
    await new Promise((res, rej) => { ifr.onload = res; ifr.onerror = rej; ifr.src = src; });
    const d = ifr.contentDocument;
    for (let i = 0; i < 100 && d.documentElement.dataset.pdfPronto !== '1'; i++) await espera(250);      // até 25 s
    if (d.documentElement.dataset.pdfPronto !== '1') throw new Error('A página demorou demais para ficar pronta.');
    const alvo = d.querySelector('.stage');
    if (!alvo) throw new Error('Não achei a página para exportar.');
    await espera(150);
    return { alvo, remover };
  } catch (e) { remover(); throw e; }
}

export async function exportarImagem(opcoes) {
  await saveNow();
  const { alvo, remover } = await abrirVisualizador(opcoes);
  try {
    const { canvas } = await elementoParaCanvas(alvo, { escala: opcoes.escala, transparente: opcoes.transparente, jpeg: opcoes.formato === 'jpeg' });
    const f = FORMATOS[opcoes.formato] || FORMATOS.png;
    const blob = await new Promise((r) => canvas.toBlob(r, f.mime, 0.92));
    if (!blob) throw new Error('O navegador não conseguiu gerar o arquivo (imagem grande demais?).');
    downloadBlob(nomeDoArquivo(S.doc.title, { sufixo: opcoes.sufixo, formato: opcoes.formato }), blob);
    return { px: { w: canvas.width, h: canvas.height }, bytes: blob.size };
  } finally { remover(); }
}

export function openExportPng() {
  const papel = ehFixa(S.doc), unico = ehUnico(S.doc);
  let dev = !unico && S.dev === 'm' ? 'm' : 'd', formato = 'png', transparente = false, sangria = false;
  let escala = papel ? escalaDePpi(300) : 2, ppi = 300;
  const info = h('p', { class: 'hint' }), aviso = h('p', { class: 'hint bad', hidden: true });
  const corpoEscala = h('div'), corpoOpc = h('div');

  const tamanhoBase = () => (papel ? (() => { const f = folhaPdf(S.doc, { sangria, marcas: false }); return { w: f.folha.w, h: f.folha.h }; })() : tamanhoPagina(S.doc, dev));
  const atualiza = () => {
    const base = tamanhoBase(), r = escalaSegura(base, escala);
    info.textContent = `${papel ? `Papel: ${rotuloDaPagina(S.doc.page)}${sangria ? ', com sangria' : ' (página final)'}. ` : ''}Página de ${Math.round(base.w)} × ${Math.round(base.h)} px → imagem de ${r.px.w} × ${r.px.h} px${papel ? ` (${ppi} ppi)` : ` (${escala}×)`}.`;
    aviso.hidden = !r.limitada;
    aviso.textContent = r.limitada ? `Esse tamanho passa do que o navegador consegue desenhar: a imagem sai reduzida para ${r.px.w} × ${r.px.h} px.` : '';
  };
  const desenhaEscala = () => {
    corpoEscala.replaceChildren(papel
      ? seg({ value: String(ppi), options: PPIS_PAPEL.map((p) => [String(p), `${p} ppi`, p === 300 ? 'Qualidade de gráfica' : p === 72 ? 'Tela' : '']), onChange: (v) => { ppi = Number(v); escala = escalaDePpi(ppi); atualiza(); } })
      : seg({ value: String(escala), options: ESCALAS_TELA.map((e) => [String(e), `${e}×`, e === 1 ? 'Tamanho da página' : e === 2 ? 'Nítido em telas de alta densidade' : 'Máximo de detalhe']), onChange: (v) => { escala = Number(v); atualiza(); } }));
  };
  const desenhaOpc = () => {
    corpoOpc.replaceChildren(
      seg({ value: formato, options: [['png', 'PNG', 'Sem perdas; aceita fundo transparente'], ['jpeg', 'JPEG', 'Menor, sem transparência']], onChange: (v) => { formato = v; desenhaOpc(); } }),
      formato === 'png' ? toggle({ label: 'Fundo transparente (sem a cor da página)', value: transparente, onChange: (v) => { transparente = v; } }) : null);
  };

  const corpo = [];
  if (papel) {
    const temSangria = sangriaMm(S.doc) > 0;
    corpo.push(seg({ value: sangria ? 's' : 'f', options: [['f', 'Página final', 'Só o papel, recortado no corte'], ['s', 'Com sangria', 'Inclui a área além do corte']], onChange: (v) => { sangria = v === 's' && temSangria; if (v === 's' && !temSangria) toast('Este arquivo não tem sangria: defina no painel da página.', 'err'); desenhaOpc(); atualiza(); } }));
  } else if (!unico) {
    corpo.push(h('p', { class: 'hint' }, 'Versão da página:'), seg({ value: dev, options: [['d', icon('monitor') + ' Computador', 'Layout de PC (1200 px)'], ['m', icon('phone') + ' Celular', 'Layout de celular (390 px)']], onChange: (v) => { dev = v; atualiza(); } }));
  }
  corpo.push(h('p', { class: 'hint' }, papel ? 'Resolução:' : 'Tamanho:'), corpoEscala, corpoOpc, info, aviso);
  if (S.doc.kind === 'site') corpo.push(h('p', { class: 'hint' }, `Projeto de site: sai a aba aberta (“${S.doc.abas.find((a) => a.id === S.doc.abaAtiva)?.nome || ''}”).`));
  desenhaEscala(); desenhaOpc(); atualiza();

  const gerar = async (e) => {
    const b = e.currentTarget; b.disabled = true; const rot = b.textContent; b.textContent = 'Gerando…';
    try {
      const r = await exportarImagem({ dev, escala, formato, transparente: transparente && formato === 'png', sangria: papel && sangria, sufixo: !papel && !unico && dev === 'm' ? 'celular' : '' });
      toast(`Imagem salva na pasta de Downloads (${r.px.w} × ${r.px.h} px, ${(r.bytes / 1048576).toFixed(1).replace('.', ',')} MB).`, 'ok');
      m.close();
    } catch (err) { b.disabled = false; b.textContent = rot; toast('Não consegui gerar a imagem: ' + (err?.message || err), 'err'); }
  };
  const m = modal({
    title: 'Exportar como imagem',
    body: [...corpo, h('ul', { class: 'hint' },
      h('li', {}, 'Mostra a página como ela fica depois que tudo apareceu (animações no quadro final).'),
      h('li', {}, 'SVG animado sai no primeiro quadro. Fontes e imagens vão embutidas, sem depender da internet.'))],
    actions: [btn({ label: 'Cancelar', onClick: () => m.close() }), btn({ label: 'Gerar imagem', ic: 'download', cls: 'primary', onClick: gerar })],
  });
}
