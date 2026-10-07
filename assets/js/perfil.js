// Visualizador da página de um participante.
//   perfil.html?u=<slug>                     página de perfil publicada
//   perfil.html?u=<slug>&a=<id>              artigo publicado (artigos/<slug>/<id>/)
//   perfil.html?u=<slug>&p=<pagina>          página do site publicada (paginas/<pagina>/); só faz sentido com &src=draft (a pública é o próprio site)
//   &src=draft                               rascunho local (mesmo navegador do editor; com &a=<id> abre o artigo, com &p=<pagina> a página do site)
//   &device=d|m                              força PC ou celular (senão decide pela largura da tela)
//   &embed=1 / &toolbar=1                    sem selo / com botões PC·Celular
//   &print=1 / &print=auto                   modo PDF: estado final, escala 1, papel do tamanho da página (auto = já abre a janela de impressão)
//   &sangria=1 &marcas=1                     (PDF de papel) inclui a sangria e/ou as marcas de corte; a folha cresce em volta da página final
import { renderArtboard, renderArtboardRecortado, observeEntrances, usedFonts } from './core/render.js';
import { larguraFinal, alturaFinal } from './core/gabarito.js';
import { loadFonts } from './core/fonts.js';
import { W, pageH, pageW, ehUnico, ehFixa, bgCss } from './core/model.js';
import { Store } from './core/store.js';
import { docDeAba, abaDoHash } from './core/sites.js';
import { BASE } from './core/util.js';
import { tamanhoPagina, cssPagina, folhaPdf, congelarSvgsDasImagens, esperarPronto } from './core/pdf.js';
import { iniciarRolagem, iniciarLeitura } from './core/anim-runtime.js';

const q = new URLSearchParams(location.search);
const slug = q.get('u') || '';
const artId = q.get('a') || '';
const pageId = q.get('p') || '';
const root = document.getElementById('root');
const msg = (t) => { root.innerHTML = ''; const p = document.createElement('p'); p.className = 'msg'; p.textContent = t; root.append(p); };

// Modo PDF: nada de "esperar aparecer" (js-anim esconde o que ainda não rolou) e tudo no estado final.
const modoPdf = q.get('print') || '';
document.documentElement.classList.add(modoPdf ? 'print-mode' : 'js-anim');
if (q.get('embed')) document.body.classList.add('embed');

let doc = null, assetUrl = () => null;
const objUrls = [];

async function load() {
  if (!/^[a-z0-9-]+$/.test(slug) || (artId && !/^[a-z0-9-]+$/.test(artId)) || (pageId && !/^[a-z0-9-]+$/.test(pageId))) throw new Error('Página não encontrada.');
  if (q.get('src') === 'draft') {
    doc = await Store.loadDoc(slug, pageId ? `site-${pageId}` : artId || 'perfil');
    if (!doc) throw new Error('Não há rascunho salvo neste navegador.');
    const map = new Map();
    for (const a of await Store.listAssets(slug)) { const u = URL.createObjectURL(a.blob); objUrls.push(u); map.set(a.id, u); }
    assetUrl = (id) => map.get(id) || null;
  } else {
    // as imagens ficam na pasta ao lado do page.json
    const dir = pageId ? `${BASE}paginas/${pageId}/` : artId ? `${BASE}artigos/${slug}/${artId}/` : `${BASE}perfis/${slug}/`;
    const r = await fetch(`${dir}page.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Esta página ainda não foi publicada.');
    doc = await r.json();
    assetUrl = (id) => { const a = doc.assets?.[id]; return a ? `${dir}assets/${id}.${a.ext}` : null; };
  }
}

// Projeto de site: a página exibida é a aba do endereço (#/<aba>; sem hash, a primeira) + o topo e o rodapé compartilhados.
function vista() {
  if (doc.kind !== 'site') return doc;
  const id = abaDoHash(location.hash, doc) || doc.abas[0].id;
  return docDeAba(doc, id);
}

// PDF de PAPEL (A5, A4…): uma folha do tamanho do papel (ou maior, com sangria e marcas de corte). Geometria em core/pdf.js › folhaPdf.
function desenharFolha(view) {
  const f = folhaPdf(view, { sangria: q.get('sangria') === '1', marcas: q.get('marcas') === '1' });
  const ctx = { dev: 'd', assetUrl, editing: false };
  document.body.style.background = '#fff';
  const stage = document.createElement('div');
  stage.className = 'stage folha';
  Object.assign(stage.style, { width: f.folha.w + 'px', height: f.folha.h + 'px', background: '#fff', position: 'relative', overflow: 'hidden', margin: '0' });
  const caixa = document.createElement('div');
  Object.assign(caixa.style, { position: 'absolute', left: f.caixa.x + 'px', top: f.caixa.y + 'px', width: f.caixa.w + 'px', height: f.caixa.h + 'px', overflow: 'hidden' });
  caixa.append(f.caixa.sangria ? renderArtboard(view, ctx) : renderArtboardRecortado(view, ctx));   // com sangria: a página inteira; sem: só a página final
  stage.append(caixa);
  if (f.marcas.length) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'marcas'); svg.setAttribute('width', f.folha.w); svg.setAttribute('height', f.folha.h); svg.setAttribute('viewBox', `0 0 ${f.folha.w} ${f.folha.h}`);
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
    for (const l of f.marcas) {
      const ln = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, stroke: '#000', 'stroke-width': 0.5 })) ln.setAttribute(k, v);
      svg.append(ln);
    }
    const t = document.createElementNS(NS, 'text');
    for (const [k, v] of Object.entries({ x: f.folha.w / 2, y: f.folha.h - 6, 'text-anchor': 'middle', 'font-size': 8, fill: '#555', 'font-family': 'system-ui, sans-serif' })) t.setAttribute(k, v);
    t.textContent = f.rotulo;
    svg.append(t);
    stage.append(svg);
  }
  root.innerHTML = '';
  root.append(stage);
  let pg = document.getElementById('pg'); if (!pg) { pg = document.createElement('style'); pg.id = 'pg'; document.head.append(pg); }
  pg.textContent = cssPagina(f.folha);
  document.title = `${doc.title || 'Arquivo'} — Gehrarte`;
  return 'd';
}

let lastVw = 0;
function draw() {
  const view = vista();
  if (modoPdf && ehFixa(view)) { loadFonts(usedFonts(view)); return desenharFolha(view); }
  const forced = q.get('device') === 'm' || q.get('device') === 'd' ? q.get('device') : null;
  const dev = ehUnico(view) ? 'd' : modoPdf ? (forced || 'd') : forced || (matchMedia('(max-width:720px)').matches ? 'm' : 'd');
  const framed = !modoPdf && !ehUnico(view) && forced === 'm' && innerWidth > 520;
  document.body.classList.toggle('framed', framed);
  document.body.style.background = framed ? '' : bgCss(view.page.bg);

  const vw = lastVw = document.documentElement.clientWidth;
  const s = framed || modoPdf ? 1 : Math.min(vw / larguraFinal(view, dev), dev === 'd' ? 1.5 : 2);   // PDF: escala 1, o papel é que tem o tamanho da página
  const stage = document.createElement('div');
  stage.className = 'stage' + (framed ? ' phone' : '');
  stage.style.width = larguraFinal(view, dev) * s + 'px';
  stage.style.height = alturaFinal(view, dev) * s + 'px';
  const ab = renderArtboardRecortado(view, { dev, assetUrl, editing: false });
  ab.style.transform = `scale(${s})`;
  stage.append(ab);
  root.innerHTML = '';
  root.append(stage);
  observeEntrances(root);
  const aba = view.kind === 'site' ? view.abas.find((a) => a.id === view.abaAtiva) : null;
  document.title = aba ? `${aba.titulo} — ${doc.title || 'Site'}` : `${doc.title || 'Página'} — Gehrarte`;
  loadFonts(usedFonts(view));
  if (modoPdf) {
    let pg = document.getElementById('pg'); if (!pg) { pg = document.createElement('style'); pg.id = 'pg'; document.head.append(pg); }
    pg.textContent = cssPagina(tamanhoPagina(view, dev));
  }
  return dev;
}

// Barra só da tela (some na impressão): explica o que fazer e repete o botão.
function barraPdf(dev) {
  const b = document.createElement('div'); b.id = 'pdfbar';
  const t = document.createElement('span');
  const papel = q.get('marcas') === '1' || q.get('sangria') === '1';
  t.textContent = `PDF${papel ? ' para gráfica' : dev === 'm' ? ' do celular' : ' do computador'} — na janela de impressão escolha “Salvar como PDF” e desligue “Cabeçalhos e rodapés” e as margens.`;
  const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = 'Salvar como PDF'; bt.onclick = () => print();
  b.append(t, bt); document.body.prepend(b);
}

function toolbar(dev) {
  if (!q.get('toolbar')) return;
  const tb = document.getElementById('toolbar');
  tb.hidden = false;
  const link = (d, label) => { const u = new URLSearchParams(q); u.set('device', d); return `<a href="?${u}" class="${dev === d ? 'on' : ''}">${label}</a>`; };
  tb.innerHTML = link('d', 'PC') + link('m', 'Celular');
}

// Controladores de animação (rolagem e tempo em tela). Cada vez que a página é redesenhada (largura, aba) os elementos são NOVOS: religa tudo.
//   · ?leitura=1  teste do autor (painel ao vivo, sem enviar nada);
//   · visitantes: só com destino em config.json › medicao.url, fora do rascunho, do embutido e do "não rastrear".
let controladores = [], configSite = null;
async function ligarControladores(dev) {
  controladores.forEach((c) => c.parar()); controladores = [];
  const view = vista(), teste = q.get('leitura') === '1', publico = !teste && q.get('src') !== 'draft' && !q.get('embed');
  if (publico && configSite === null) configSite = await fetch(`${BASE}config.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const destino = publico ? configSite?.medicao?.url || null : null;
  controladores.push(iniciarRolagem(root, view, { dev }));
  if (teste || destino) controladores.push(iniciarLeitura(root, view, { modo: teste ? 'teste' : 'visitante', dev, destino, pagina: { id: doc.id, kind: doc.kind } }));
}

try {
  await load();
  loadFonts(usedFonts(doc));
  let dev = draw();
  if (modoPdf) {
    // PDF: tamanho fixo (sem resize nem toolbar); congela SVGs de <img>, espera fontes e imagens, e só então libera a impressão
    await congelarSvgsDasImagens(root);
    await esperarPronto(root);
    document.documentElement.dataset.pdfPronto = '1';   // sinal para testes e automações
    barraPdf(dev);
    if (modoPdf === 'auto') setTimeout(() => print(), 150);
  } else {
    // a barra de rolagem aparece depois que o conteúdo entra: se a largura útil mudou, redesenha (senão 15px da direita ficam cortados)
    for (let i = 0; i < 2 && lastVw !== document.documentElement.clientWidth; i++) dev = draw();
    toolbar(dev);
    await ligarControladores(dev);
    let t;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { dev = draw(); toolbar(dev); ligarControladores(dev); }, 120); });
    // navegação entre abas do projeto de site
    addEventListener('hashchange', () => { if (doc.kind === 'site') { dev = draw(); toolbar(dev); scrollTo(0, 0); ligarControladores(dev); } });
  }
} catch (e) {
  msg(e.message);
}
