// Sanitização de SVG colado pelo usuário, e isolamento do que ele traz (CSS, ids).
// O SVG é inserido inline (para as animações CSS/SMIL funcionarem), então:
//  - remove script, foreignObject, handlers on*, hrefs externos;
//  - prefixa ids e nomes de @keyframes e escopa os seletores do <style> ao elemento.
const BAD_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base']);
const UNWRAP = new Set(['a']);
const SVG_NS = 'http://www.w3.org/2000/svg';

const stripUrls = (v) => v.replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, 'none').replace(/javascript:/gi, '');

function scopeCss(css, scope, idMap) {
  let sheet;
  try { sheet = new CSSStyleSheet(); sheet.replaceSync(css.replace(/@import[^;]*;/gi, '')); } catch { return ''; }
  const kf = new Map();
  const collect = (rules) => { for (const r of rules) { if (r instanceof CSSKeyframesRule) kf.set(r.name, `${scope}-${r.name}`); else if (r.cssRules) collect(r.cssRules); } };
  collect(sheet.cssRules);

  const selector = (sel) => {
    sel = sel.trim().replace(/#([\w-]+)/g, (m, id) => '#' + (idMap.get(id) || id));
    if (/^(:root|svg)\b/.test(sel)) return sel.replace(/^(:root|svg)/, `.${scope} svg`);
    return `.${scope} ${sel}`;
  };
  const decls = (style) => {
    let out = '';
    for (let i = 0; i < style.length; i++) {
      const p = style[i];
      let v = style.getPropertyValue(p);
      if (p === 'animation-name') v = v.split(',').map((n) => kf.get(n.trim()) || n.trim()).join(',');
      out += `${p}:${stripUrls(v)}${style.getPropertyPriority(p) ? ' !important' : ''};`;
    }
    return out;
  };
  const walk = (rules) => {
    let out = '';
    for (const r of rules) {
      if (r instanceof CSSStyleRule) out += `${r.selectorText.split(',').map(selector).join(',')}{${decls(r.style)}}`;
      else if (r instanceof CSSKeyframesRule) out += `@keyframes ${kf.get(r.name)}{${[...r.cssRules].map((k) => `${k.keyText}{${decls(k.style)}}`).join('')}}`;
      else if (r instanceof CSSMediaRule) out += `@media ${r.conditionText}{${walk(r.cssRules)}}`;
    }
    return out;
  };
  return walk(sheet.cssRules);
}

// Devolve { ok:true, svg } ou { ok:false, error }.
export function sanitizeSvg(code, scope = 'svg-x') {
  let src = String(code || '').trim();
  if (!src) return { ok: false, error: 'Código vazio.' };
  src = src.replace(/<\?xml[^>]*\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim();
  if (!/<svg[\s>]/i.test(src)) return { ok: false, error: 'Não encontrei uma tag <svg>.' };
  if (!/<svg[^>]*xmlns=/i.test(src)) src = src.replace(/<svg/i, `<svg xmlns="${SVG_NS}"`);
  if (/xlink:/.test(src) && !/xmlns:xlink/.test(src)) src = src.replace(/<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');

  const xml = new DOMParser().parseFromString(src, 'image/svg+xml');
  const err = xml.querySelector('parsererror');
  if (err) return { ok: false, error: 'SVG inválido: ' + err.textContent.split('\n')[0].slice(0, 160) };
  const root = xml.documentElement;
  if (root.localName !== 'svg') return { ok: false, error: 'O elemento raiz precisa ser <svg>.' };

  // 1) mapa de ids -> ids com prefixo
  const idMap = new Map();
  root.querySelectorAll('[id]').forEach((n) => idMap.set(n.getAttribute('id'), `${scope}-${n.getAttribute('id')}`));
  if (root.hasAttribute('id')) idMap.set(root.getAttribute('id'), `${scope}-${root.getAttribute('id')}`);
  const rewrite = (v) => v.replace(/url\(\s*['"]?#([\w.-]+)['"]?\s*\)/g, (m, id) => `url(#${idMap.get(id) || id})`);

  // 2) pré-passo: desembrulha <a> (antes da varredura, para os filhos movidos também serem limpos)
  for (const a of [...root.querySelectorAll('*')].filter((n) => UNWRAP.has(n.localName.toLowerCase()))) {
    while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
    a.remove();
  }

  // 3) varre a árvore
  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.localName.toLowerCase();
      if (BAD_TAGS.has(tag)) { child.remove(); continue; }
      // animação SMIL não pode reescrever links
      if (/^(animate|set)$/.test(tag) && /href/i.test(child.getAttribute('attributeName') || '')) { child.remove(); continue; }
      if (tag === 'style') { child.textContent = scopeCss(child.textContent, scope, idMap); continue; }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        let v = a.value;
        if (n.startsWith('on')) { child.removeAttribute(a.name); continue; }
        if (n === 'href' || n === 'xlink:href') {
          if (v.startsWith('#')) child.setAttribute(a.name, '#' + (idMap.get(v.slice(1)) || v.slice(1)));
          else if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v)) child.removeAttribute(a.name);
          continue;
        }
        if (n === 'id') { child.setAttribute('id', idMap.get(v) || v); continue; }
        if (/url\(|javascript:/i.test(v)) { v = stripUrls(rewrite(v)); child.setAttribute(a.name, v); }
      }
      walk(child);
    }
  };
  walk(root);
  for (const a of [...root.attributes]) if (a.name.toLowerCase().startsWith('on')) root.removeAttribute(a.name);

  // 4) o svg preenche a caixa do elemento
  if (!root.hasAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
    if (w > 0 && h > 0) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  root.setAttribute('width', '100%');
  root.setAttribute('height', '100%');
  if (!root.hasAttribute('preserveAspectRatio')) root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  root.removeAttribute('id');
  return { ok: true, svg: new XMLSerializer().serializeToString(root) };
}

// Proporção natural (largura/altura) de um SVG, para criar o elemento com o tamanho certo.
export function svgNaturalSize(code) {
  const m = String(code).match(/viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  if (m) return { w: +m[1], h: +m[2] };
  const w = String(code).match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i), h = String(code).match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
  return w && h ? { w: +w[1], h: +h[1] } : { w: 300, h: 300 };
}
