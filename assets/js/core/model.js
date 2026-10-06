// Modelo do documento de página.
//
// doc = { v, owner, title, page:{bg:{c,g}, h:{d,m}}, elements:[...], assets:{id:{ext,mime,w,h}} }
// Dispositivos: 'd' (PC, 1200 de largura) e 'm' (celular, 390).
// Cada elemento tem frame de PC (f.d, sempre) e frame de celular (f.m, opcional).
// Sem f.m, o celular usa uma versão proporcional derivada do PC (frameOf devolve derived:true).
import { uid, clone, clamp } from './util.js';

export const W = { d: 1200, m: 390 };
export const K = W.m / W.d;
export const DEV_LABEL = { d: 'PC', m: 'Celular' };

// Tipos de página: 'perfil' (uma por usuário, id fixo 'perfil'), 'artigo' (quantas quiser) e
// 'pagina' (página do SITE: landing, home… — uma só para a equipe toda, definidas em paginas.json).
// Páginas do site têm id "site-<pagina>" (ex.: site-landing) para nunca colidir com o id de um artigo.
// 'site' = PROJETO DE SITE: um site inteiro (várias abas/páginas navegáveis, topo e rodapé compartilhados) dentro de um só documento;
// é o tipo que o MUVVI usa. A lógica das abas fica em core/sites.js.
// 'arquivo' = arquivo em branco criado pela pessoa (qualquer tamanho: página, tela, papel); fica no navegador e sai por exportar/ações do host.
// 'artigo' = texto para o blog (publicável). Os dois têm o mesmo tratamento de id.
export const KINDS = { perfil: 'Página de perfil', artigo: 'Artigo', arquivo: 'Arquivo', pagina: 'Página do site', site: 'Projeto de site' };
// Tipos que o Publicador do Gehrarte NÃO publica (saem por exportar ou pelas ações do host).
export const NAO_PUBLICAVEIS = ['site', 'arquivo'];
export const PROFILE_ID = 'perfil';
export const SITE_PREFIX = 'site-';
export const siteDocId = (pageId) => SITE_PREFIX + pageId;
export const isSiteId = (id) => typeof id === 'string' && id.startsWith(SITE_PREFIX);
export const sitePageId = (id) => (isSiteId(id) ? id.slice(SITE_PREFIX.length) : null);
const cleanId = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');

export function newDoc(owner = '', title = 'Minha página', kind = 'perfil', id = null) {
  return { v: 1, id: id || (kind === 'perfil' ? PROFILE_ID : 'pagina'), kind, owner, title, page: { bg: { c: '#ffffff', g: null }, h: { d: 900, m: 1400 } }, elements: [], assets: {} };
}

// Documentos antigos não têm id/kind: viram a página de perfil.
export function normalizeDoc(doc, owner = '') {
  if (!doc) return doc;
  if (!KINDS[doc.kind]) doc.kind = 'perfil';
  if (!doc.id) doc.id = PROFILE_ID;
  if (doc.kind === 'perfil') doc.id = PROFILE_ID;
  // o id vira parte do caminho publicado (artigos/<usuario>/<id>/ ou paginas/<pagina>/): só letras minúsculas, números e hífen (nada de "../")
  else if (doc.kind === 'pagina') doc.id = SITE_PREFIX + (cleanId(isSiteId(doc.id) ? sitePageId(doc.id) : doc.id).slice(0, 40) || 'pagina');
  else {
    doc.id = cleanId(doc.id).slice(0, 60) || 'pagina';
    if (isSiteId(doc.id)) doc.id = 'artigo-' + doc.id;   // o prefixo "site-" é reservado às páginas do site
  }
  if (owner && !doc.owner) doc.owner = owner;
  doc.assets ||= {};
  if (doc.kind === 'site') garantirSite(doc);
  return doc;
}

// Projeto de site: garante a estrutura de abas. Uma aba = { id, nome, titulo, page:{bg,h}, elements }. A aba aberta no editor vive em
// doc.page/doc.elements (o conjunto de trabalho, junto com os elementos compartilhados marcados com `comum`); as outras ficam em doc.abas.
// doc.comum = { hRef:{d,m}, elements } guarda o topo e o rodapé compartilhados; `hRef` é a altura de página contra a qual o rodapé foi desenhado.
export function garantirSite(doc) {
  if (!Array.isArray(doc.abas) || !doc.abas.length) doc.abas = [{ id: 'inicio', nome: 'Início', titulo: 'Início', page: JSON.parse(JSON.stringify(doc.page)), elements: [] }];
  for (const a of doc.abas) { a.id = cleanId(a.id) || 'aba'; a.nome ||= a.id; a.titulo ||= a.nome; a.page ||= { bg: { c: '#ffffff', g: null }, h: { d: 900, m: 1400 } }; a.elements ||= []; }
  if (!doc.abas.some((a) => a.id === doc.abaAtiva)) doc.abaAtiva = doc.abas[0].id;
  doc.comum ||= { hRef: { d: doc.page.h.d, m: doc.page.h.m ?? Math.round(doc.page.h.d * K) }, elements: [] };
  doc.comum.elements ||= [];
  return doc;
}

// Caminho público de uma página (relativo à raiz do site) e URL do visualizador.
export const publishDir = (slug, doc) => (doc.kind === 'site' ? `projetos/${slug}/${doc.id}/` : doc.kind === 'arquivo' ? `arquivos/${slug}/${doc.id}/` : doc.kind === 'pagina' ? `paginas/${sitePageId(doc.id)}/` : doc.kind === 'artigo' ? `artigos/${slug}/${doc.id}/` : `perfis/${slug}/`);
export const viewerQuery = (slug, doc) => (doc.kind === 'pagina'
  ? `u=${encodeURIComponent(slug)}&p=${encodeURIComponent(sitePageId(doc.id))}`
  : `u=${encodeURIComponent(slug)}${doc.kind === 'artigo' ? `&a=${encodeURIComponent(doc.id)}` : ''}`);

// Estado: 'inventario' (nunca publicada) | 'publicada' | 'alterada' (publicada, com alterações locais).
// updatedAt = quando o rascunho local foi salvo pela última vez (ms); changed = há edição ainda não salva.
export function docState(doc, updatedAt = 0, changed = false) {
  if (!doc?.publishedAt) return 'inventario';
  return changed || updatedAt > Date.parse(doc.publishedAt) ? 'alterada' : 'publicada';
}
export const STATE_LABEL = { inventario: 'Ainda não publicada', publicada: 'Publicada', alterada: 'Publicada · com alterações locais', original: 'Versão original do site' };

// Quem publicou: { slug, nome } gravado no page.json ao publicar (não é segurança, é informação para a equipe).
export const publisherName = (doc) => doc?.publishedBy?.nome || doc?.publishedBy?.slug || '';

// "Meu artigo novo!" -> "meu-artigo-novo"
export const slugify = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artigo';

export const TEXT_DEFAULTS = { fontFamily: 'Inter', fontSize: 32, fontWeight: 400, italic: false, underline: false, upper: false, align: 'left', color: '#17161d', lh: 1.25, ls: 0 };

export function makeElement(t, props = {}, frame = {}) {
  const base = { id: uid(), t, name: '', lock: false, hide: false, f: { d: { x: 100, y: 100, w: 200, h: 200, r: 0, ...frame } }, s: {}, an: null, link: null };
  if (t === 'text') Object.assign(base, { text: 'Digite seu texto', ah: true, s: { ...TEXT_DEFAULTS } });
  if (t === 'shape') Object.assign(base, { shape: 'rect', label: '', ls: { fontFamily: 'Inter', fontSize: 24, fontWeight: 600, color: '#ffffff' }, s: { fill: '#e4572e', grad: null, stroke: '#17161d', sw: 0, dash: 0, radius: 0, sides: 5, inner: 0.45 } });
  if (t === 'path') Object.assign(base, { d: '', vb: [100, 100], s: { stroke: '#17161d', sw: 6, fill: null, cap: 'round' } });
  if (t === 'image') Object.assign(base, { asset: '', s: { fit: 'cover', radius: 0 } });
  if (t === 'svg') Object.assign(base, { code: '' });
  // 'abas' = barra de abas FUNCIONAL: lista as abas do projeto de site e leva de uma a outra (no editor só mostra; na página publicada navega)
  if (t === 'abas') Object.assign(base, { name: 'Barra de abas', ls: { fontFamily: 'Inter', fontSize: 16, fontWeight: 600, color: '#17161d' }, abas: { ...ABAS_PADRAO } });
  // props sobrescreve o padrão (merge raso de s / ls / f)
  for (const [k, v] of Object.entries(props)) {
    if (k === 's' || k === 'ls') base[k] = { ...base[k], ...v };
    else base[k] = v;
  }
  return base;
}

// Configuração padrão da barra de abas. estilo: 'sublinhado' | 'pilula' | 'texto'; mostrar: null (todas) ou lista de ids; rotulos: { idDaAba: 'texto' }.
export const ABAS_PADRAO = { estilo: 'sublinhado', alinhar: 'left', corAtiva: '#e4572e', corFundoAtivo: '#e4572e', corTextoAtivo: '#ffffff', gap: 22, mostrar: null, rotulos: {} };

export const fontOwner = (el) => (el.t === 'text' ? el.s : el.t === 'shape' || el.t === 'abas' ? el.ls : null);

// Frame efetivo (em px de design) do elemento no dispositivo dado.
export function frameOf(el, dev) {
  const fs0 = fontOwner(el)?.fontSize ?? 0;
  if (dev === 'd') return { ...el.f.d, r: el.f.d.r || 0, fs: fs0 };
  const m = el.f.m;
  if (m) return { x: m.x, y: m.y, w: m.w, h: m.h, r: m.r || 0, fs: m.fs ?? fs0 * K };
  const d = el.f.d;
  return { x: d.x * K, y: d.y * K, w: d.w * K, h: d.h * K, r: d.r || 0, fs: fs0 * K, derived: true };
}

// Grava no frame do dispositivo; no celular, "materializa" o frame derivado antes.
export function setFrame(el, dev, patch) {
  if (dev === 'd') {
    const { fs, ...rest } = patch;
    Object.assign(el.f.d, rest);
    if (fs != null && fontOwner(el)) fontOwner(el).fontSize = Math.max(1, fs);
    return;
  }
  if (!el.f.m) { const { derived, ...fr } = frameOf(el, 'm'); el.f.m = fr; }
  Object.assign(el.f.m, patch);
}

// Largura da página no dispositivo: formato único (page.w) ou as larguras de sempre (1200 / 390).
export const pageW = (doc, dev) => (dev === 'd' && doc?.page?.w > 0 ? doc.page.w : W[dev]);
export const ehUnico = (doc) => doc?.page?.w > 0;     // só uma versão (sem celular)
export const ehFixa = (doc) => !!doc?.page?.fixa;      // altura fixa (papel)
export const pageH = (doc, dev) => (dev === 'd' ? doc.page.h.d : doc.page.h.m ?? doc.page.h.d * K);

// Caixa envolvente (alinhada aos eixos) de um frame rotacionado.
export function aabb(fr) {
  if (!fr.r) return { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
  const a = (fr.r * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = fr.w * c + fr.h * s, h = fr.w * s + fr.h * c;
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionBox(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function cloneElement(el, offset = 24) {
  const c = clone(el);
  c.id = uid();
  c.f.d.x += offset; c.f.d.y += offset;
  if (c.f.m) { c.f.m.x += offset; c.f.m.y += offset; }
  if (c.name) c.name += ' cópia';
  return c;
}

// Cores usadas no documento (para a paleta "Do documento").
export function docColors(doc) {
  const set = new Set();
  const add = (c) => { if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) set.add(c.toLowerCase()); };
  add(doc.page.bg.c);
  if (doc.page.bg.g) { add(doc.page.bg.g.c1); add(doc.page.bg.g.c2); }
  for (const e of doc.elements) {
    add(e.s?.color); add(e.s?.fill); add(e.s?.stroke); add(e.ls?.color);
    if (e.s?.grad) { add(e.s.grad.c1); add(e.s.grad.c2); }
    if (e.s?.shadow) add(e.s.shadow.c);
  }
  return [...set].slice(0, 18);
}

export const bgCss = (bg) => (bg.g ? `linear-gradient(${bg.g.a}deg, ${bg.g.c1}, ${bg.g.c2})` : bg.c);

// Harmonias de cor a partir de uma cor base (para as ferramentas inteligentes).
export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
export function hslToHex(hh, s, l) {
  hh = ((hh % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function harmonies(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return {};
  const [hh, s, l] = hexToHsl(hex);
  return {
    'Complementar': [hslToHex(hh + 180, s, l)],
    'Análogas': [hslToHex(hh - 30, s, l), hslToHex(hh + 30, s, l)],
    'Tríade': [hslToHex(hh + 120, s, l), hslToHex(hh + 240, s, l)],
    'Tons': [hslToHex(hh, s, l - 25), hslToHex(hh, s, l - 12), hslToHex(hh, s, l + 12), hslToHex(hh, s, l + 25)],
  };
}
