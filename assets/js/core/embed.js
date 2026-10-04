// Mostra, dentro de uma página do site, uma página feita no editor (paginas/<id>/page.json).
// Só entra se alguém já PUBLICOU a página (publishedAt): enquanto isso, vale o que o código do site já mostra.
//   modo 'tela'    a página inteira cabe na janela, centralizada (landing: sem rolagem)
//   modo 'largura' ocupa a largura do contêiner e cresce em altura (faixa de destaque da home)
import { renderArtboard, observeEntrances, usedFonts } from './render.js';
import { loadFonts } from './fonts.js';
import { W, pageH, bgCss } from './model.js';
import { BASE } from './util.js';
import { fetchPublished, pageDir } from './site.js';

export async function mountPublished(host, pageId, { modo = 'largura', onBg } = {}) {
  const doc = await fetchPublished(pageId);
  if (!doc) return null;
  const dir = `${BASE}${pageDir(pageId)}`;
  const assetUrl = (id) => { const a = doc.assets?.[id]; return a ? `${dir}assets/${id}.${a.ext}` : null; };
  loadFonts(usedFonts(doc));
  document.documentElement.classList.add('js-anim');
  if (!document.querySelector('link[data-embed-anim]')) {   // estilos base dos elementos (a landing e a home não carregam anim.css)
    const l = document.createElement('link');
    Object.assign(l, { rel: 'stylesheet', href: `${BASE}assets/css/anim.css` });
    l.dataset.embedAnim = '1';
    document.head.append(l);
  }

  const draw = () => {
    const dev = matchMedia('(max-width:720px)').matches ? 'm' : 'd';
    const cw = host.clientWidth || document.documentElement.clientWidth, ch = host.clientHeight || innerHeight;
    const s = modo === 'tela' ? Math.min(cw / W[dev], ch / pageH(doc, dev)) : Math.min(cw / W[dev], dev === 'd' ? 1.5 : 2);
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.cssText = `position:relative;margin:0 auto;overflow:hidden;width:${W[dev] * s}px;height:${pageH(doc, dev) * s}px`;
    const ab = renderArtboard(doc, { dev, assetUrl, editing: false });
    ab.style.transform = `scale(${s})`;
    Object.assign(ab.style, { position: 'absolute', left: '0', top: '0', overflow: 'hidden', transformOrigin: '0 0' });
    stage.append(ab);
    host.replaceChildren(stage);
    observeEntrances(host);
  };
  host.classList.add('pagina-publicada');
  onBg?.(bgCss(doc.page.bg));
  draw();
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 120); });
  return doc;
}
