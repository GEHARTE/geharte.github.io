// Painel de documentos (o "início" do editor, no estilo da tela inicial do Google Docs):
//   · Páginas do site — cartões FIXOS (landing, home…, definidas em paginas.json). Abrir = editar a versão no ar.
//   · Meu espaço — o cartão fixo do perfil de cada pessoa e os materiais no Drive.
//   · Meus artigos e rascunhos — o inventário local (guardado neste navegador).
//   · Perfis da equipe — as páginas das outras pessoas, só para ver.
// Cada cartão diz o que a página é, onde está publicada, quem publicou e qual é o arquivo.
import { h } from './core/dom.js';
import { session, logout, loadUsers, loadConfig } from './core/auth.js';
import { Store } from './core/store.js';
import { renderArtboard, usedFonts } from './core/render.js';
import { loadFonts } from './core/fonts.js';
import { W, KINDS, STATE_LABEL, PROFILE_ID, docState, siteDocId, publisherName, publishDir, bgCss } from './core/model.js';
import { BASE } from './core/util.js';
import { loadRegistry, canEditSite, fetchPublished, fetchModel, getJson, pageDir, publicUrl, publishedUrl, siteHost } from './core/site.js';
import { createDoc, duplicateDoc, docPath } from './core/docs.js';
import { getDrive, uploadAll } from './core/drive-ui.js';
import { FOLDER_NAME, folderUrl, humanSize } from './core/drive.js';

const $ = (s) => document.querySelector(s);
const fmtWhen = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ms = (iso) => Date.parse(iso || '') || 0;

// ---------- estado e "quem publicou" de um cartão ----------
// local = rascunho deste navegador { doc, updatedAt }; remote = a versão no ar (page.json do site).
// A publicação mais recente vale — se foi feita daqui e o site ainda não mostra (o deploy leva 1–2 min), avisa.
function publicacao({ local, remote, original }) {
  const doc = ms(local?.doc?.publishedAt) > ms(remote?.publishedAt) ? local.doc : remote || null;
  const pubAt = doc?.publishedAt || null;
  const estado = pubAt ? docState({ publishedAt: pubAt }, local?.updatedAt || 0) : original ? 'original' : 'inventario';
  const emBreve = !!pubAt && ms(local?.doc?.publishedAt) > ms(remote?.publishedAt);
  return { estado, quando: pubAt, quem: doc ? publisherName(doc) : '', emBreve };
}

// ---------- miniatura (a própria página, renderizada pequena) ----------
function miniatura(c) {
  const box = h('div', { class: 'thumb' });
  const doc = c.doc;
  if (!doc) { box.append(h('div', { class: 'thumb-vazio' }, 'Sem prévia ainda')); return box; }
  box.style.background = bgCss(doc.page.bg);
  loadFonts(usedFonts(doc));
  const ab = renderArtboard(doc, { dev: 'd', assetUrl: c.assetUrl, editing: false });
  ab.querySelectorAll('.an-pre').forEach((n) => n.classList.remove('an-pre'));
  Object.assign(ab.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' });
  box.append(ab);
  const fit = () => { const w = box.clientWidth; if (w) ab.style.transform = `scale(${w / W.d})`; };
  new ResizeObserver(fit).observe(box);
  fit();
  return box;
}

// ---------- cartão ----------
let menuAberto = null;
function fechaMenu() { menuAberto?.(); menuAberto = null; const m = $('#menu-pop'); m.hidden = true; m.replaceChildren(); }
function abreMenu(ancora, itens) {
  fechaMenu();
  const m = $('#menu-pop');
  m.replaceChildren(...itens.map((i) => (i.href
    ? h('a', { role: 'menuitem', href: i.href, target: '_blank', rel: 'noopener', onclick: fechaMenu }, i.label)
    : h('button', { type: 'button', role: 'menuitem', class: i.perigo ? 'perigo' : '', onclick: () => { fechaMenu(); i.fn(); } }, i.label))));
  m.hidden = false;
  const r = ancora.getBoundingClientRect();
  m.style.top = `${r.bottom + scrollY + 4}px`;
  m.style.left = `${Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth))}px`;
  const fora = (e) => { if (!m.contains(e.target) && !ancora.contains(e.target)) fechaMenu(); };
  const esc = (e) => { if (e.key === 'Escape') { fechaMenu(); ancora.focus(); } };
  setTimeout(() => document.addEventListener('pointerdown', fora, true));
  document.addEventListener('keydown', esc);
  menuAberto = () => { document.removeEventListener('pointerdown', fora, true); document.removeEventListener('keydown', esc); };
  m.querySelector('a,button')?.focus();
}

const linha = (rotulo, ...conteudo) => h('div', { class: 'row' }, h('dt', {}, rotulo), h('dd', {}, ...conteudo));

function cartao(c) {
  const abrir = c.editor || null;                          // href do editor, ou null (só leitura)
  const thumb = miniatura(c);
  const capa = abrir
    ? h('a', { class: 'capa', href: abrir, 'aria-label': `Abrir “${c.titulo}” no editor`, tabindex: '-1' }, thumb)
    : h('a', { class: 'capa', href: c.verUrl || null, target: '_blank', rel: 'noopener', tabindex: '-1', 'aria-label': `Ver “${c.titulo}” no site` }, thumb);

  const mais = h('button', { class: 'mais', type: 'button', title: 'Mais opções', 'aria-label': `Mais opções de ${c.titulo}`, 'aria-haspopup': 'menu', onclick: (e) => abreMenu(e.currentTarget, c.menu) },
    h('span', { 'aria-hidden': 'true' }, '⋮'));

  const onde = c.estado === 'original' || c.estado === 'inventario'
    ? h('span', { class: 'fraco' }, c.estado === 'original' ? `${c.host} · versão original do site (ainda sem edição pelo editor)` : 'Ainda não publicada — só existe neste navegador')
    : [h('a', { href: c.verUrl, target: '_blank', rel: 'noopener' }, c.urlTexto), c.emBreve ? h('span', { class: 'fraco' }, ' · o site mostra a mudança em 1–2 minutos') : null];
  const por = c.quando
    ? `${c.quem ? c.quem + ' · ' : ''}${fmtWhen(c.quando)}`
    : c.estado === 'original' ? 'Código do site — ninguém publicou pelo editor' : '—';

  const el = h('article', { class: `cartao tipo-${c.tipo}`, 'data-busca': semAcento([c.titulo, c.funcao, c.arquivo, c.quem, STATE_LABEL[c.estado], KINDS[c.tipo]].join(' ')) },
    capa,
    h('div', { class: 'corpo' },
      h('div', { class: 'tit' }, h('h3', {}, abrir ? h('a', { href: abrir }, c.titulo) : c.titulo), mais),
      h('div', { class: 'chips' }, h('span', { class: `chip tipo-${c.tipo}` }, KINDS[c.tipo]), h('span', { class: `chip st-${c.estado}` }, STATE_LABEL[c.estado]),
        c.somenteLeitura ? h('span', { class: 'chip so-ler' }, 'Só leitura') : null),
      h('dl', {},
        c.funcao ? linha('O que é', c.funcao) : null,
        linha('Publicada em', onde),
        linha('Publicada por', por),
        linha('Arquivo', h('code', {}, c.arquivo), c.fonte ? h('code', { class: 'fonte', title: 'Onde ficam os dados editáveis' }, c.fonte) : null))),
    h('footer', {},
      abrir ? h('a', { class: 'dbtn primario', href: abrir }, 'Abrir no editor') : null,
      c.verUrl && c.estado !== 'inventario' ? h('a', { class: 'dbtn', href: c.verUrl, target: '_blank', rel: 'noopener' }, 'Ver no site ↗') : null));
  return el;
}

// ---------- montagem dos cartões ----------
async function carregaImagensLocais(slug) {
  const m = new Map();
  for (const a of await Store.listAssets(slug)) m.set(a.id, URL.createObjectURL(a.blob));
  return m;
}
const remotoUrl = (dir, doc) => (id) => { const a = doc?.assets?.[id]; return a ? `${BASE}${dir}assets/${id}.${a.ext}` : null; };
const aberto = (path) => BASE + path;   // endereço "de verdade" deste ambiente (em produção é o próprio site)

async function main() {
  const sess = session();
  if (!sess) { location.replace('../login.html?next=documentos/'); return; }
  const slug = sess.slug;
  $('#quem').textContent = sess.nome;
  $('#sair').onclick = () => { logout(); location.href = '../'; };
  document.addEventListener('scroll', fechaMenu, { passive: true });

  const [users, cfg, reg, locais, imagens, indice] = await Promise.all([
    loadUsers().catch(() => []), loadConfig(), loadRegistry(), Store.listDocs(slug), carregaImagensLocais(slug), getJson('indice.json'),
  ]);
  const eu = users.find((u) => u.slug === slug);
  const podeSite = canEditSite(eu);
  const host = siteHost(cfg) || location.host;
  const urlTexto = (u) => u.replace(/^https?:\/\//, '');
  const secoes = { site: [], meu: [], artigos: [], equipe: [] };

  // ----- páginas do site -----
  await Promise.all(reg.map(async (p) => {
    const id = siteDocId(p.id);
    const local = locais.find((d) => d.id === id) || null;
    const [remote, modelo] = await Promise.all([fetchPublished(p.id), fetchModel(p.id)]);
    const pub = publicacao({ local, remote, original: true });
    const doc = local?.doc || remote || modelo;
    const dir = pageDir(p.id);
    const fake = { kind: 'pagina', id };
    const verUrl = aberto(p.caminho.replace(/index\.html$/, ''));
    secoes.site.push({ ordem: reg.indexOf(p), c: {
      tipo: 'pagina', titulo: p.titulo, funcao: p.funcao, arquivo: p.caminho, fonte: `${dir}page.json`, host,
      ...pub, doc, assetUrl: (a) => (local?.doc?.assets?.[a] ? imagens.get(a) : null) || remotoUrl(dir, remote || modelo)(a) || imagens.get(a),
      verUrl, urlTexto: urlTexto(publicUrl(cfg, p.caminho)),
      editor: podeSite ? `../editor/?doc=${id}` : null, somenteLeitura: !podeSite,
      menu: [
        ...(podeSite ? [{ label: 'Abrir no editor', fn: () => { location.href = `../editor/?doc=${id}`; } }] : []),
        { label: 'Ver no site', href: verUrl },
        { label: 'Copiar endereço', fn: () => navigator.clipboard?.writeText(publishedUrl(cfg, slug, fake, p)) },
        ...(local && podeSite ? [{ label: 'Descartar o meu rascunho local', perigo: true, fn: () => descartar(local, `o seu rascunho local de “${p.titulo}”`, 'A versão no ar não é afetada; da próxima vez você começa dela.') }] : []),
      ],
    } });
  }));
  secoes.site.sort((a, b) => a.ordem - b.ordem);

  // ----- meu perfil -----
  const meuLocal = locais.find((d) => d.id === PROFILE_ID) || null;
  const meuRemoto = await getJson(`perfis/${slug}/page.json`);
  {
    const fake = { kind: 'perfil', id: PROFILE_ID };
    const dir = publishDir(slug, fake);
    const pub = publicacao({ local: meuLocal, remote: meuRemoto?.publishedAt ? meuRemoto : null });
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(slug)}`);
    secoes.meu.push({ ordem: 0, c: {
      tipo: 'perfil', titulo: meuLocal?.doc?.title || meuRemoto?.title || `Página de ${sess.nome}`, arquivo: `${dir}page.json`, host,
      funcao: 'A sua página pessoal na equipe, montada do jeito que você quiser: texto, imagem, desenho e animação. Aparece em “Páginas da equipe” na home do blog.',
      ...pub, doc: meuLocal?.doc || meuRemoto, assetUrl: (a) => (meuLocal?.doc?.assets?.[a] ? imagens.get(a) : null) || remotoUrl(dir, meuRemoto)(a) || imagens.get(a),
      verUrl, urlTexto: urlTexto(publicUrl(cfg, `perfil.html?u=${slug}`)),
      editor: `../editor/?doc=${PROFILE_ID}`,
      menu: [
        { label: 'Abrir no editor', fn: () => { location.href = `../editor/?doc=${PROFILE_ID}`; } },
        { label: 'Ver no site', href: verUrl },
        { label: 'Copiar endereço', fn: () => navigator.clipboard?.writeText(publishedUrl(cfg, slug, fake)) },
        ...(meuLocal ? [{ label: 'Descartar o meu rascunho local', perigo: true, fn: () => descartar(meuLocal, 'o seu rascunho local do perfil', 'A página publicada não é afetada.') }] : []),
      ],
    } });
  }

  // ----- artigos e rascunhos (locais + publicados por mim em outro navegador) -----
  const artigosLocais = locais.filter((d) => d.doc.kind === 'artigo');
  const idsLocais = new Set(artigosLocais.map((d) => d.id));
  const publicadosFora = (indice?.artigos || []).filter((a) => a.slug === slug && !idsLocais.has(a.id));
  const remotosArt = await Promise.all(publicadosFora.map((a) => getJson(`artigos/${slug}/${a.id}/page.json`).then((doc) => ({ a, doc }))));
  const artigoCartao = ({ id, local, remote }) => {
    const fake = { kind: 'artigo', id };
    const dir = publishDir(slug, fake);
    const pub = publicacao({ local, remote: remote?.publishedAt ? remote : null });
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(slug)}&a=${encodeURIComponent(id)}`);
    return { tipo: 'artigo', titulo: local?.doc?.title || remote?.title || id, arquivo: docPath(slug, { ...(local?.doc || remote), id, kind: 'artigo' }), host,
      funcao: 'Texto seu, publicado na seção Artigos da home do blog.',
      ...pub, doc: local?.doc || remote, assetUrl: (a) => (local?.doc?.assets?.[a] ? imagens.get(a) : null) || remotoUrl(dir, remote)(a) || imagens.get(a),
      verUrl, urlTexto: urlTexto(publicUrl(cfg, `perfil.html?u=${slug}&a=${id}`)),
      editor: `../editor/?doc=${encodeURIComponent(id)}`,
      menu: [
        { label: 'Abrir no editor', fn: () => { location.href = `../editor/?doc=${encodeURIComponent(id)}`; } },
        ...(pub.quando ? [{ label: 'Ver no site', href: verUrl }, { label: 'Copiar endereço', fn: () => navigator.clipboard?.writeText(publishedUrl(cfg, slug, fake)) }] : []),
        ...(local ? [{ label: 'Duplicar', fn: async () => { await duplicateDoc(slug, local); location.reload(); } },
          { label: 'Excluir do meu navegador', perigo: true, fn: () => descartar(local, `“${local.doc.title || 'sem título'}”`, pub.quando ? 'A versão publicada no site não é afetada.' : 'Ela nunca foi publicada: não existe outra cópia. Isto não pode ser desfeito.') }] : []),
      ] };
  };
  artigosLocais.forEach((l, i) => secoes.artigos.push({ ordem: i, c: artigoCartao({ id: l.id, local: l, remote: null }) }));
  remotosArt.forEach(({ a, doc }, i) => doc && secoes.artigos.push({ ordem: 1000 + i, c: artigoCartao({ id: a.id, local: null, remote: doc }) }));

  // ----- perfis da equipe (só ver) -----
  await Promise.all(users.filter((u) => u.slug !== slug).map(async (u) => {
    const doc = await getJson(`perfis/${u.slug}/page.json`);
    if (!doc?.publishedAt) return;
    const dir = `perfis/${u.slug}/`;
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(u.slug)}`);
    secoes.equipe.push({ ordem: u.nome, c: {
      tipo: 'perfil', titulo: doc.title || `Página de ${u.nome}`, arquivo: `${dir}page.json`, host, funcao: `Página de perfil de ${u.nome}.`,
      ...publicacao({ local: null, remote: doc }), doc, assetUrl: remotoUrl(dir, doc), verUrl, urlTexto: urlTexto(publicUrl(cfg, `perfil.html?u=${u.slug}`)),
      editor: null, somenteLeitura: true, menu: [{ label: 'Ver no site', href: verUrl }],
    } });
  }));
  secoes.equipe.sort((a, b) => String(a.ordem).localeCompare(String(b.ordem), 'pt-BR'));

  // ----- desenhar -----
  const pinta = (chave, grid, extra = []) => {
    const itens = secoes[chave].map((x) => cartao(x.c));
    $(grid).replaceChildren(...itens, ...extra);
    $(`#sec-${chave}`).hidden = !(itens.length || extra.length);
  };
  pinta('site', '#g-site');
  $('#sub-site').textContent = podeSite
    ? $('#sub-site').textContent
    : 'Estas são as páginas que fazem o site funcionar. Só quem organiza o site pode editá-las; você pode ver como cada uma está.';
  pinta('meu', '#g-meu', [cartaoDrive(slug, cfg)]);
  pinta('artigos', '#g-artigos', [azulejoNovo(slug)]);
  pinta('equipe', '#g-equipe');
  $('#carregando').hidden = true;
  filtra();
}

// ---------- excluir / descartar ----------
function descartar(rec, quem, nota) {
  const slug = session().slug;
  const dlg = h('dialog', { class: 'dlg' },
    h('h2', {}, 'Tem certeza?'),
    h('p', {}, `Vamos remover ${quem} deste navegador.`),
    h('p', { class: 'fraco' }, nota),
    h('div', { class: 'acoes' },
      h('button', { class: 'dbtn', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
      h('button', { class: 'dbtn perigo', type: 'button', onclick: async () => { await Store.deleteDoc(slug, rec.id); location.reload(); } }, 'Remover')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- novo artigo ----------
function azulejoNovo(slug) {
  const abre = () => {
    const titulo = h('input', { type: 'text', value: 'Novo artigo', maxlength: '80', 'aria-label': 'Título do artigo' });
    const dlg = h('dialog', { class: 'dlg' },
      h('h2', {}, 'Novo artigo'),
      h('p', { class: 'fraco' }, 'Começa com um modelo de texto (rótulo, título, autoria, resumo e corpo). Vai para a seção Artigos do blog quando você publicar.'),
      h('label', { class: 'campo' }, 'Título', titulo),
      h('div', { class: 'acoes' },
        h('button', { class: 'dbtn', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
        h('button', { class: 'dbtn primario', type: 'button', onclick: async (e) => { e.target.disabled = true; try { location.href = `../editor/?doc=${encodeURIComponent(await createDoc(slug, 'artigo', titulo.value.trim() || 'Novo artigo'))}`; } catch (er) { alert(er.message); e.target.disabled = false; } } }, 'Criar e abrir')));
    dlg.addEventListener('close', () => dlg.remove());
    titulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.querySelector('.primario').click(); });
    document.body.append(dlg);
    dlg.showModal();
    titulo.select();
  };
  return h('button', { class: 'cartao novo', type: 'button', onclick: abre, 'data-busca': 'novo artigo criar' },
    h('span', { class: 'mais-grande', 'aria-hidden': 'true' }, '+'), h('b', {}, 'Novo artigo'), h('small', {}, 'Comece com um modelo de texto'));
}

// ---------- materiais no Drive ----------
function cartaoDrive(slug) {
  const raiz = h('article', { class: 'cartao drive', 'data-busca': 'materiais drive google arquivos imagens' });
  let drive = null, info = null, pasta = null;
  const msg = h('p', { class: 'erro', hidden: true });
  const progresso = h('div', { class: 'ups' });
  const erro = (e) => { msg.textContent = e?.message || String(e); msg.hidden = false; };

  async function conectar() {
    msg.hidden = true;
    try { info = await drive.connectAs(); pasta = await drive.ensureFolder(); pinta(); } catch (e) { erro(e); }
  }
  async function enviar(files) {
    if (!files.length) return;
    const linhas = new Map();
    const ok = await uploadAll(drive, files, (i, st) => {
      linhas.set(i, st);
      progresso.replaceChildren(...[...linhas.values()].map((u) => h('div', { class: `up ${u.estado}` }, h('span', {}, u.nome), u.estado === 'erro' ? h('em', {}, u.erro) : h('i', { style: { width: Math.round(u.progresso * 100) + '%' } }))));
    });
    if (ok.length) progresso.append(h('p', { class: 'ok' }, `${ok.length} arquivo${ok.length > 1 ? 's' : ''} no Drive. Já aparece na aba Drive do editor.`));
  }
  function pinta() {
    const conectado = drive?.isConnected() && info;
    const pick = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { enviar([...pick.files]); pick.value = ''; } });
    raiz.replaceChildren(
      h('div', { class: 'capa drive-capa', 'aria-hidden': 'true', html: '<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.6 4.2 4.2 0 0 1 17.5 18z"/></svg>' }),
      h('div', { class: 'corpo' },
        h('div', { class: 'tit' }, h('h3', {}, 'Materiais no Drive')),
        h('div', { class: 'chips' }, h('span', { class: 'chip tipo-drive' }, 'Google Drive'), h('span', { class: `chip ${conectado ? 'st-publicada' : 'st-inventario'}` }, conectado ? 'Conectado' : 'Não conectado')),
        h('dl', {},
          linha('O que é', `Imagens, fontes, PSD e PDF que você vai usar nas páginas. Ficam no seu Drive institucional, na pasta “${FOLDER_NAME}”, e aparecem na aba Drive do editor.`),
          conectado ? linha('Conta', info.email) : null,
          conectado ? linha('Espaço', info.cota.limite ? `${humanSize(info.cota.usado)} de ${humanSize(info.cota.limite)} usados` : `${humanSize(info.cota.usado)} usados no seu Drive`) : null,
          conectado ? null : linha('Privacidade', 'O Geharte só enxerga o que for enviado por aqui — o resto do seu Drive continua invisível.')),
        msg, progresso),
      h('footer', {},
        conectado
          ? [h('button', { class: 'dbtn primario', type: 'button', onclick: () => pick.click() }, 'Enviar arquivos'), pick, h('a', { class: 'dbtn', href: folderUrl(pasta), target: '_blank', rel: 'noopener' }, 'Abrir a pasta ↗')]
          : h('button', { class: 'dbtn primario', type: 'button', onclick: conectar }, drive?.wasConnected() ? 'Reconectar ao Drive' : 'Conectar ao Google Drive')));
  }
  getDrive(slug).then((d) => { drive = d; pinta(); }).catch(erro);
  pinta();
  return raiz;
}

// ---------- busca ----------
function filtra() {
  const t = semAcento($('#busca').value.trim());
  let total = 0;
  for (const sec of document.querySelectorAll('.dsec')) {
    let visiveis = 0;
    sec.querySelectorAll('.cartao').forEach((c) => { const ok = !t || (c.dataset.busca || '').includes(t); c.hidden = !ok; if (ok) visiveis++; });
    sec.classList.toggle('sem-resultado', !!t && !visiveis);
    total += visiveis;
  }
  $('#vazio').hidden = !t || total > 0;
}
$('#busca').addEventListener('input', filtra);

main().catch((e) => { console.error(e); $('#carregando').textContent = 'Não consegui carregar os documentos: ' + (e?.message || e); });
