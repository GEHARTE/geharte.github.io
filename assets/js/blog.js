// Home do blog: monta Artigos, Páginas da equipe e Exposições a partir de
//   content/artigos.json, content/exposicoes.json (curadoria da equipe) e indice.json (gerado: o que está publicado).
// Sem conteúdo ainda, mostra estruturas-modelo (lorem ipsum, marcadas como provisórias).
import { h } from './core/dom.js';
import { BASE } from './core/util.js';
import { mountPublished } from './core/embed.js';

const getJson = async (p) => { try { const r = await fetch(BASE + p, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataExtenso = (v) => { const d = new Date(v); return Number.isNaN(+d) ? '' : `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };
// só http(s) ou caminho relativo ao site (nada de javascript:, data:, // etc.)
function seguro(u) {
  if (typeof u !== 'string' || !u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null;
  return BASE + u.replace(/^\/+/, '');
}
const aviso = () => h('span', { class: 'modelo-aviso' }, 'Modelo provisório — aguardando o material');

// ---------- Artigos ----------
function artigoCard(a, i) {
  const href = a.href ? seguro(a.href) : null;
  const titulo = a.modelo ? h('span', {}, a.titulo) : href ? h('a', { href }, a.titulo) : h('span', {}, a.titulo);
  return h('article', { class: 'art' + (a.modelo ? ' modelo' : '') },
    a.tags?.length ? h('p', { class: 'kicker' }, a.tags.join(' · ')) : h('p', { class: 'kicker' }, i === 0 ? 'Destaque' : 'Artigo'),
    h('h3', {}, titulo),
    h('p', { class: 'meta' }, [a.autor, a.data ? dataExtenso(a.data) : ''].filter(Boolean).join(' · ')),
    a.resumo ? h('p', { class: 'resumo' }, a.resumo) : null);
}

function listaArtigos(curados, indice) {
  const itens = [];
  const citados = new Set();
  for (const a of curados || []) {
    const pg = a.pagina && /^[a-z0-9-]+$/.test(a.pagina.slug || '') && /^[a-z0-9-]+$/.test(a.pagina.id || '') ? a.pagina : null;
    if (pg) citados.add(`${pg.slug}/${pg.id}`);
    itens.push({ titulo: a.titulo, autor: a.autor, data: a.data, resumo: a.resumo, tags: a.tags,
      href: pg ? `perfil.html?u=${pg.slug}&a=${pg.id}` : a.url || null, destaque: !!a.destaque });
  }
  for (const a of indice?.artigos || []) {                  // artigos feitos no editor e já publicados
    if (citados.has(`${a.slug}/${a.id}`)) continue;
    itens.push({ titulo: a.title, autor: a.autor, data: a.publishedAt, href: `perfil.html?u=${a.slug}&a=${a.id}`, tags: ['Artigo'] });
  }
  itens.sort((a, b) => (b.destaque - a.destaque) || String(b.data || '').localeCompare(String(a.data || '')));
  return itens;
}

// ---------- Páginas da equipe ----------
function pessoaCard(p) {
  const href = `${BASE}perfil.html?u=${encodeURIComponent(p.slug)}`;
  return h(p.modelo ? 'div' : 'a', { class: 'pessoa' + (p.modelo ? ' modelo' : ''), href: p.modelo ? null : href },
    h('span', { class: 'ini', 'aria-hidden': 'true' }, (p.nome || '?').trim()[0]),
    h('b', {}, p.nome),
    h('small', {}, p.title || 'Página em construção'),
    p.modelo ? null : h('span', { class: 'ir' }, 'Ler a página →'));
}

// ---------- Exposições ----------
let figN = 0;
function figura(f, vazia) {
  figN += 1;
  const src = f.src ? seguro(f.src) : null;
  return h('figure', {},
    h('div', { class: 'foto' + (src ? '' : ' vazia') }, src ? h('img', { src, alt: f.alt || f.legenda || '', loading: 'lazy' }) : 'Foto'),
    h('figcaption', {}, h('b', {}, `Fig. ${figN} —`), f.legenda || 'Legenda provisória.', f.credito ? h('small', {}, f.credito) : null));
}
function exposicao(e, modelo) {
  return h('article', { class: 'expo' },
    modelo ? aviso() : null,
    h('div', { class: 'expo-cab' }, h('h3', {}, e.titulo), (e.local || e.periodo) ? h('span', { class: 'quando' }, [e.local, e.periodo].filter(Boolean).join(' · ')) : null),
    e.descricao ? h('p', { class: 'desc' }, e.descricao) : null,
    h('div', { class: 'fotos' }, (e.fotos || []).map((f) => figura(f, modelo))));
}

// ---------- faixa de destaque (feita no editor) ----------
const destaque = document.getElementById('destaque-home');
if (destaque) mountPublished(destaque, 'home', { modo: 'largura', onBg: (bg) => { destaque.style.background = bg; } }).catch(() => {});

// ---------- montagem ----------
const [artigosJson, exposJson, indice] = await Promise.all([getJson('content/artigos.json'), getJson('content/exposicoes.json'), getJson('indice.json')]);

const boxArt = document.getElementById('lista-artigos');
const arts = listaArtigos(artigosJson?.artigos, indice);
if (arts.length) boxArt.append(...arts.map(artigoCard));
else {
  boxArt.before(aviso());
  boxArt.append(
    ...[
      ['Título do artigo em destaque', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet, maecenas faucibus mollis interdum.'],
      ['Segundo artigo, de título um pouco mais longo', 'Cras mattis consectetur purus sit amet fermentum. Donec ullamcorper nulla non metus auctor fringilla.'],
      ['Terceiro artigo', 'Vestibulum id ligula porta felis euismod semper. Aenean lacinia bibendum nulla sed consectetur.'],
    ].map(([titulo, resumo], i) => artigoCard({ titulo, resumo, autor: 'Nome da autora ou autor', tags: ['Tema', 'Período'], modelo: true }, i)));
}

const boxPag = document.getElementById('lista-paginas');
if (indice?.perfis?.length) boxPag.append(...indice.perfis.map(pessoaCard));
else boxPag.append(...['Nome da integrante', 'Nome do integrante', 'Nome da pesquisadora'].map((nome) => pessoaCard({ nome, slug: 'x', modelo: true })));

const boxExp = document.getElementById('lista-expos');
const expos = exposJson?.exposicoes || [];
if (expos.length) boxExp.append(...expos.map((e) => exposicao(e, false)));
else boxExp.append(exposicao({ titulo: 'Título da exposição', local: 'Local', periodo: 'Mês – mês de 2026', descricao: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed posuere consectetur est at lobortis.', fotos: [{}, {}, {}] }, true));
