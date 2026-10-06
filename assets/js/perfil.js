// Visualizador da página de um participante.
//   perfil.html?u=<slug>                     página de perfil publicada
//   perfil.html?u=<slug>&a=<id>              artigo publicado (artigos/<slug>/<id>/)
//   perfil.html?u=<slug>&p=<pagina>          página do site publicada (paginas/<pagina>/); só faz sentido com &src=draft (a pública é o próprio site)
//   &src=draft                               rascunho local (mesmo navegador do editor; com &a=<id> abre o artigo, com &p=<pagina> a página do site)
//   &device=d|m                              força PC ou celular (senão decide pela largura da tela)
//   &embed=1 / &toolbar=1                    sem selo / com botões PC·Celular
import { renderArtboard, observeEntrances, usedFonts } from './core/render.js';
import { loadFonts } from './core/fonts.js';
import { W, pageH, pageW, ehUnico, bgCss } from './core/model.js';
import { Store } from './core/store.js';
import { docDeAba, abaDoHash } from './core/sites.js';
import { BASE } from './core/util.js';

const q = new URLSearchParams(location.search);
const slug = q.get('u') || '';
const artId = q.get('a') || '';
const pageId = q.get('p') || '';
const root = document.getElementById('root');
const msg = (t) => { root.innerHTML = ''; const p = document.createElement('p'); p.className = 'msg'; p.textContent = t; root.append(p); };

document.documentElement.classList.add('js-anim');
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

let lastVw = 0;
function draw() {
  const view = vista();
  const forced = q.get('device') === 'm' || q.get('device') === 'd' ? q.get('device') : null;
  const dev = ehUnico(view) ? 'd' : forced || (matchMedia('(max-width:720px)').matches ? 'm' : 'd');
  const framed = !ehUnico(view) && forced === 'm' && innerWidth > 520;
  document.body.classList.toggle('framed', framed);
  document.body.style.background = framed ? '' : bgCss(view.page.bg);

  const vw = lastVw = document.documentElement.clientWidth;
  const s = framed ? 1 : Math.min(vw / pageW(view, dev), dev === 'd' ? 1.5 : 2);
  const stage = document.createElement('div');
  stage.className = 'stage' + (framed ? ' phone' : '');
  stage.style.width = pageW(view, dev) * s + 'px';
  stage.style.height = pageH(view, dev) * s + 'px';
  const ab = renderArtboard(view, { dev, assetUrl, editing: false });
  ab.style.transform = `scale(${s})`;
  stage.append(ab);
  root.innerHTML = '';
  root.append(stage);
  observeEntrances(root);
  const aba = view.kind === 'site' ? view.abas.find((a) => a.id === view.abaAtiva) : null;
  document.title = aba ? `${aba.titulo} — ${doc.title || 'Site'}` : `${doc.title || 'Página'} — Gehrarte`;
  loadFonts(usedFonts(view));
  return dev;
}

function toolbar(dev) {
  if (!q.get('toolbar')) return;
  const tb = document.getElementById('toolbar');
  tb.hidden = false;
  const link = (d, label) => { const u = new URLSearchParams(q); u.set('device', d); return `<a href="?${u}" class="${dev === d ? 'on' : ''}">${label}</a>`; };
  tb.innerHTML = link('d', 'PC') + link('m', 'Celular');
}

try {
  await load();
  loadFonts(usedFonts(doc));
  let dev = draw();
  // a barra de rolagem aparece depois que o conteúdo entra: se a largura útil mudou, redesenha (senão 15px da direita ficam cortados)
  for (let i = 0; i < 2 && lastVw !== document.documentElement.clientWidth; i++) dev = draw();
  toolbar(dev);
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { dev = draw(); toolbar(dev); }, 120); });
  // navegação entre abas do projeto de site
  addEventListener('hashchange', () => { if (doc.kind === 'site') { dev = draw(); toolbar(dev); scrollTo(0, 0); } });
} catch (e) {
  msg(e.message);
}
