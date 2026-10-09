// Painel de arquivos (o "início" do editor, no estilo da tela inicial do Google Docs):
//   · Recentes — da esquerda para a direita: "Novo arquivo em branco" e os 3 últimos arquivos editados (de qualquer tipo).
//   · Páginas do site — o que já está postado: cartões FIXOS (landing, home…, definidas em paginas.json). Abrir = editar a versão no ar.
//   · Meu espaço — o cartão fixo do perfil de cada pessoa e os materiais no Drive.
//   · Todos os meus arquivos — o que a pessoa criou (arquivos em branco, projetos de site, artigos): o inventário local, guardado neste navegador.
//   · Perfis da equipe — as páginas das outras pessoas, só para ver.
// Cada cartão diz o que a página é, onde está publicada, quem publicou e qual é o arquivo.
import { h } from './core/dom.js';
import { loadUsers, loadConfig } from './core/auth.js';
import { carregarHost } from './core/host.js';
import { permissao, resumoDaPlataforma } from './core/permissoes.js';
import { Store } from './core/store.js';
import { renderArtboardRecortado, usedFonts } from './core/render.js';
import { larguraFinal } from './core/gabarito.js';
import { loadFonts } from './core/fonts.js';
import { pageW, KINDS, STATE_LABEL, PROFILE_ID, docState, siteDocId, publisherName, publishDir, bgCss } from './core/model.js';
import { BASE } from './core/util.js';
import { CHAVE_TEMA, temaEfetivo, alternarTema } from './core/tema.js';
import { loadRegistry, canEditSite, fetchPublished, fetchModel, getJson, pageDir, publicUrl, publishedUrl, siteHost } from './core/site.js';
import { createDoc, createArquivoEmBranco, createDocFromModelo, duplicateDoc, docPath } from './core/docs.js';
import { GRUPOS_FORMATO, FORMATO_PADRAO, formatoPorId, orientacaoNatural, rotuloDoItem, medidasDoItem, rotuloDaPagina } from './core/formatos.js';
import { montarGaleria } from './core/galeria.js';
import { abrirGerador } from './core/gerador-ui.js';
import { criarMeusModelos, carregarCatalogo } from './core/modelos.js';
import { getDrive, uploadAll } from './core/drive-ui.js';
import { FOLDER_NAME, folderUrl, humanSize } from './core/drive.js';

const $ = (s) => document.querySelector(s);
const fmtWhen = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
// quantos arquivos aparecem ao lado do "Novo arquivo em branco"
const MAX_RECENTES = 3;
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
  const ab = renderArtboardRecortado(doc, { dev: 'd', assetUrl: c.assetUrl, editing: false });
  ab.querySelectorAll('.an-pre').forEach((n) => n.classList.remove('an-pre'));
  Object.assign(ab.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' });
  box.append(ab);
  const fit = () => { const w = box.clientWidth; if (w) ab.style.transform = `scale(${w / larguraFinal(doc, 'd')})`; };
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

  const el = h('article', { class: `cartao tipo-${c.tipo}${c.destaque ? ' destaque' : ''}${c.compacto ? ' compacto' : ''}`, 'data-busca': semAcento([c.titulo, c.funcao, c.arquivo, c.quem, STATE_LABEL[c.estado], KINDS[c.tipo]].join(' ')) },
    capa,
    h('div', { class: 'corpo' },
      h('div', { class: 'tit' }, h('h3', {}, abrir ? h('a', { href: abrir }, c.titulo) : c.titulo), mais),
      h('div', { class: 'chips' }, h('span', { class: `chip tipo-${c.tipo}` }, KINDS[c.tipo]), h('span', { class: `chip st-${c.estado}` }, STATE_LABEL[c.estado]),
        c.somenteLeitura ? h('span', { class: 'chip so-ler', title: c.motivo || '' }, 'Só leitura') : null),
      h('dl', {},
        c.funcao ? linha('O que é', c.funcao) : null,
        c.somenteLeitura && c.motivo ? linha('Quem edita', c.motivo) : null,
        linha('Publicada em', onde),
        linha('Publicada por', por),
        linha('Arquivo', h('code', {}, c.arquivo), c.fonte ? h('code', { class: 'fonte', title: 'Onde ficam os dados editáveis' }, c.fonte) : null))),
    h('footer', {},
      abrir ? h('a', { class: 'dbtn primario', href: abrir }, c.destaque ? 'Abrir o meu espaço' : 'Abrir no editor') : null,
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
  const H = await carregarHost({ carregarConfig: loadConfig });
  const sess = await H.identidade();
  if (!sess) { H.entrar('arquivos/'); return; }
  const slug = sess.slug;
  meuSlug = slug;
  const cap = H.capacidades;
  $('#quem').textContent = sess.nome;
  if (H.sair) $('#sair').onclick = () => H.sair(); else $('#sair').hidden = true;
  document.addEventListener('scroll', fechaMenu, { passive: true });

  // o que existe depende do host: páginas do site, perfis da equipe e Drive são do Gehrarte; o host local só tem os arquivos da pessoa
  const [users, cfg, reg, locais, imagens, indice] = await Promise.all([
    cap.perfisDaEquipe ? loadUsers().catch(() => []) : [], loadConfig(), cap.paginasDoSite ? loadRegistry() : [], Store.listDocs(slug), carregaImagensLocais(slug), cap.perfisDaEquipe ? getJson('indice.json') : null,
  ]);
  const host = siteHost(cfg) || location.host;
  const urlTexto = (u) => u.replace(/^https?:\/\//, '');
  // A tela tem três partes: a FAIXA de começar (o meu espaço, um arquivo novo e os recentes, numa linha só),
  // o que está NO COMPUTADOR e o que está PUBLICADO nesta plataforma (com quem pode editar o quê).
  const secoes = { espaco: [], recentes: [], computador: [], publicadas: [] };
  const marca = H.marca?.nome || '';
  // a regra de edição vive em core/permissoes.js; aqui só se pergunta a ela
  const podeMexer = (tipo, dono, donoNome) => permissao({ tipo, dono, donoNome }, sess, cap);

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
    const perm = podeMexer('pagina');
    secoes.publicadas.push({ ordem: reg.indexOf(p), c: {
      id, tipo: 'pagina', titulo: p.titulo, funcao: p.funcao, arquivo: p.caminho, fonte: `${dir}page.json`, host,
      ...pub, doc, assetUrl: (a) => (local?.doc?.assets?.[a] ? imagens.get(a) : null) || remotoUrl(dir, remote || modelo)(a) || imagens.get(a),
      verUrl, urlTexto: urlTexto(publicUrl(cfg, p.caminho)),
      editor: perm.pode ? `../editor/?doc=${id}` : null, somenteLeitura: !perm.pode, motivo: perm.motivo,
      menu: [
        ...(perm.pode ? [{ label: 'Abrir no editor', fn: () => { location.href = `../editor/?doc=${id}`; } }] : []),
        { label: 'Ver no site', href: verUrl },
        { label: 'Copiar endereço', fn: () => navigator.clipboard?.writeText(publishedUrl(cfg, slug, fake, p)) },
        ...(local && perm.pode ? [{ label: 'Descartar o meu rascunho local', perigo: true, fn: () => descartar(local, `o seu rascunho local de “${p.titulo}”`, 'A versão no ar não é afetada; da próxima vez você começa dela.') }] : []),
      ],
    } });
  }));


  // ----- meu perfil -----
  const meuLocal = locais.find((d) => d.id === PROFILE_ID) || null;
  const meuRemoto = cap.perfisDaEquipe ? await getJson(`perfis/${slug}/page.json`) : null;
  if (cap.perfisDaEquipe) {
    const fake = { kind: 'perfil', id: PROFILE_ID };
    const dir = publishDir(slug, fake);
    const pub = publicacao({ local: meuLocal, remote: meuRemoto?.publishedAt ? meuRemoto : null });
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(slug)}`);
    secoes.espaco.push({ ordem: 0, c: {
      destaque: true,
      id: PROFILE_ID, tipo: 'perfil', titulo: meuLocal?.doc?.title || meuRemoto?.title || `Página de ${sess.nome}`, arquivo: `${dir}page.json`, host,
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

  // ----- meus arquivos (locais + artigos publicados por mim em outro navegador) -----
  const artigosLocais = locais.filter((d) => d.doc.kind === 'artigo' || d.doc.kind === 'site' || d.doc.kind === 'arquivo');
  const idsLocais = new Set(artigosLocais.map((d) => d.id));
  const publicadosFora = (indice?.artigos || []).filter((a) => a.slug === slug && !idsLocais.has(a.id));
  const remotosArt = await Promise.all(publicadosFora.map((a) => getJson(`artigos/${slug}/${a.id}/page.json`).then((doc) => ({ a, doc }))));
  const artigoCartao = ({ id, local, remote }) => {
    const kind = local?.doc?.kind === 'site' || local?.doc?.kind === 'arquivo' ? local.doc.kind : 'artigo';
    const fake = { kind, id };
    const dir = publishDir(slug, fake);
    const pub = publicacao({ local, remote: remote?.publishedAt ? remote : null });
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(slug)}&a=${encodeURIComponent(id)}`);
    return { id, tipo: kind, titulo: local?.doc?.title || remote?.title || id, arquivo: docPath(slug, { ...(local?.doc || remote), id, kind }), host,
      funcao: kind === 'site' ? 'Projeto de site: várias abas navegáveis, com topo e rodapé compartilhados. Fica neste navegador; saia por “Exportar projeto” ou pelas ações do host.'
        : kind === 'arquivo' ? `Arquivo seu (${rotuloDaPagina(local?.doc?.page || {})}). Fica neste navegador; saia por “Exportar projeto” ou pelas ações do host.`
        : 'Artigo seu, publicado na seção Artigos da home do blog.',
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
  artigosLocais.forEach((l, i) => secoes.computador.push({ ordem: i, c: artigoCartao({ id: l.id, local: l, remote: null }) }));
  // artigos meus publicados noutro navegador: estão no ar, não neste computador
  remotosArt.forEach(({ a, doc }, i) => doc && secoes.publicadas.push({ ordem: 500 + i, c: artigoCartao({ id: a.id, local: null, remote: doc }) }));

  // ----- perfis da equipe (só ver) -----
  await Promise.all(users.filter((u) => u.slug !== slug).map(async (u) => {
    const doc = await getJson(`perfis/${u.slug}/page.json`);
    if (!doc?.publishedAt) return;
    const dir = `perfis/${u.slug}/`;
    const verUrl = aberto(`perfil.html?u=${encodeURIComponent(u.slug)}`);
    const perm = podeMexer('perfil', u.slug, u.nome);
    secoes.publicadas.push({ ordem: `z-${u.nome}`, c: {
      tipo: 'perfil', titulo: doc.title || `Página de ${u.nome}`, arquivo: `${dir}page.json`, host, funcao: `Página de perfil de ${u.nome}.`,
      ...publicacao({ local: null, remote: doc }), doc, assetUrl: remotoUrl(dir, doc), verUrl, urlTexto: urlTexto(publicUrl(cfg, `perfil.html?u=${u.slug}`)),
      editor: null, somenteLeitura: true, motivo: perm.motivo, menu: [{ label: 'Ver no site', href: verUrl }],
    } });
  }));
  secoes.publicadas.sort((a, b) => String(a.ordem).padStart(6, '0').localeCompare(String(b.ordem).padStart(6, '0'), 'pt-BR'));

  // ----- recentes: os últimos arquivos editados (rascunhos deste navegador), de qualquer tipo -----
  // É um atalho: o mesmo arquivo continua na sua seção (páginas do site, meu espaço, todos os meus arquivos).
  const cartaoDoId = new Map([...secoes.publicadas, ...secoes.espaco, ...secoes.computador].map((x) => [x.c.id, x.c]));
  [...locais].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((l) => cartaoDoId.get(l.id)).filter(Boolean)
    .slice(0, MAX_RECENTES).forEach((c) => secoes.recentes.push({ c }));

  // ----- desenhar -----
  const pinta = (chave, grid, extra = [], antes = []) => {
    const itens = secoes[chave].map((x) => cartao(x.c));
    $(grid).replaceChildren(...antes, ...itens, ...extra);
    $(`#sec-${chave}`).hidden = !(itens.length || extra.length || antes.length);
  };

  // A faixa de começar, numa linha só: o meu espaço primeiro (em destaque), depois o arquivo novo, depois os recentes.
  const faixa = [
    ...secoes.espaco.map((x) => cartao(x.c)),
    azulejoNovoArquivo(slug),
    ...secoes.recentes.map((x) => cartao({ ...x.c, destaque: false, compacto: true })),
  ];
  $('#g-comecar').replaceChildren(...faixa);
  $('#sub-comecar').textContent = secoes.espaco.length
    ? 'O seu espaço, um arquivo novo e o que você editou por último.'
    : 'Comece um arquivo em branco ou continue de onde parou.';

  pinta('computador', '#g-computador', cap.drive ? [cartaoDrive(slug, cfg)] : []);
  pinta('publicadas', '#g-publicadas');
  $('#sub-pub').textContent = resumoDaPlataforma(marca, sess, cap);

  // vindo do editor (Opções › Novo arquivo): já abre o diálogo
  if (new URLSearchParams(location.search).has('novo')) { history.replaceState(null, '', location.pathname); abrirNovoArquivo(slug); }
  $('#carregando').hidden = true;
  filtra();
}

// ---------- excluir / descartar ----------
let meuSlug = '';
function descartar(rec, quem, nota) {
  const slug = meuSlug;
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

// ---------- novo arquivo em branco ----------
// Janela de confirmação antes de abrir o editor: à esquerda, o MODELO (uma tela em branco, um projeto de site, um artigo para o blog
// ou um modelo da galeria); à direita, o TAMANHO (PC e celular, só PC, tablet, celular, A6…A3, Carta, personalizado) e a orientação.
// Modelos da galeria trazem o próprio tamanho; só "Em branco" usa o tamanho escolhido.
const EXTRAS_NOVO = [
  { id: '__branco', nome: 'Em branco', descricao: 'Uma tela em branco, no tamanho que você escolher ao lado.', categoria: 'Começar', glifo: '▢' },
  { id: '__site', nome: 'Projeto de site em branco', descricao: 'Várias abas navegáveis, com topo e rodapé compartilhados.', categoria: 'Começar', glifo: '▤' },
  { id: '__artigo', nome: 'Artigo para o blog', descricao: 'Texto com título, autoria e resumo, para publicar na seção Artigos.', categoria: 'Começar', glifo: '¶' },
];

function abrirNovoArquivo(slug) {
  const meus = criarMeusModelos();
  let escolhido = EXTRAS_NOVO[0], formato = FORMATO_PADRAO, orientacao = 'retrato', sangria = 0, margem = 0;
  const titulo = h('input', { type: 'text', value: '', placeholder: 'Nome do arquivo (opcional)', maxlength: '80', 'aria-label': 'Nome do arquivo' });
  const lugar = h('div'), lado = h('div', { class: 'na-lado' }), erro = h('p', { class: 'gal-msg erro', hidden: true, role: 'alert' });
  const pers = { w: h('input', { type: 'text', inputmode: 'decimal', value: '21', 'aria-label': 'Largura' }), h: h('input', { type: 'text', inputmode: 'decimal', value: '29,7', 'aria-label': 'Altura' }),
    u: h('select', { 'aria-label': 'Unidade' }, ['cm', 'mm', 'px', 'pol'].map((u) => h('option', { value: u }, u))) };
  const proprio = () => escolhido.id === '__branco';      // só "Em branco" usa o tamanho escolhido

  function pintaLado() {
    if (!proprio()) {
      const fm = escolhido.id === '__site' || escolhido.id === '__artigo' ? 'PC e celular' : rotuloDaPagina(escolhido.doc?.page || {});
      lado.replaceChildren(h('h3', {}, 'Tamanho'), h('p', { class: 'fraco' }, `Este modelo já define o tamanho: ${escolhido.doc?.kind === 'site' ? 'projeto de site (PC e celular)' : fm}. Para escolher o tamanho, use “Em branco”.`));
      return;
    }
    const ehDual = formatoPorId(formato)?.dual, ehPers = formatoPorId(formato)?.personalizado;
    lado.replaceChildren(h('h3', {}, 'Tamanho'),
      ...GRUPOS_FORMATO.map((g) => h('fieldset', { class: 'na-grupo' }, h('legend', {}, g.rotulo),
        ...g.itens.map((f) => h('label', { class: 'na-op' + (formato === f.id ? ' on' : '') },
          h('input', { type: 'radio', name: 'formato', value: f.id, checked: formato === f.id, onchange: () => { formato = f.id; orientacao = orientacaoNatural(f); pintaLado(); } }),
          h('span', { class: 'na-nome' }, rotuloDoItem(f)), h('small', {}, medidasDoItem(f, orientacao)))))),
      ehDual ? null : h('div', { class: 'na-orient', role: 'group', 'aria-label': 'Orientação' },
        ...[['retrato', 'Em pé'], ['paisagem', 'Deitado']].map(([v, r]) => h('button', { type: 'button', class: 'gal-btn', 'aria-pressed': String(orientacao === v), onclick: () => { orientacao = v; pintaLado(); } }, r))),
      ehPers ? h('div', { class: 'na-pers' }, h('label', {}, 'Largura', pers.w), h('label', {}, 'Altura', pers.h), h('label', {}, 'Unidade', pers.u)) : null,
      // papel: sangria e margem segura para gráfica (a página inclui a sangria; as réguas medem a partir do corte)
      (formatoPorId(formato)?.papel || ehPers) ? h('fieldset', { class: 'na-grupo' }, h('legend', {}, 'Para gráfica (opcional)'),
        h('label', { class: 'na-sel' }, 'Sangria', h('select', { 'aria-label': 'Sangria', onchange: (e) => { sangria = Number(e.target.value); } }, [[0, 'Sem sangria'], [3, '3 mm (padrão das gráficas)'], [5, '5 mm']].map(([v, r]) => h('option', { value: v, selected: sangria === v }, r)))),
        h('label', { class: 'na-sel' }, 'Margem segura', h('select', { 'aria-label': 'Margem segura', onchange: (e) => { margem = Number(e.target.value); } }, [[0, 'Sem margem'], [5, '5 mm'], [10, '10 mm']].map(([v, r]) => h('option', { value: v, selected: margem === v }, r)))),
        h('small', { class: 'fraco' }, ehPers ? 'Vale para tamanhos em cm, mm ou polegadas.' : 'A página inclui a sangria; a margem segura aparece como guia.')) : null);
  }

  async function criar(modeloEscolhido) {
    erro.hidden = true;
    const nome = titulo.value.trim();
    try {
      let id;
      const m = modeloEscolhido || escolhido;
      if (m.id === '__branco') id = await createArquivoEmBranco(slug, nome || 'Novo arquivo', formato, { orientacao, w: pers.w.value, h: pers.h.value, unidade: pers.u.value, sangria, margem });
      else if (m.id === '__site') id = await createDoc(slug, 'site', nome || 'Meu site');
      else if (m.id === '__artigo') id = await createDoc(slug, 'artigo', nome || 'Novo artigo');
      else id = await createDocFromModelo(slug, m, nome);
      location.href = `../editor/?doc=${encodeURIComponent(id)}`;
    } catch (e) { erro.textContent = e.message || String(e); erro.hidden = false; }
  }

  const dlg = h('dialog', { class: 'gal-dlg larga novo-arq', 'aria-label': 'Novo arquivo em branco' },
    h('div', { class: 'gal-dlg-c' },
      h('h2', {}, 'Novo arquivo em branco'),
      h('p', { class: 'fraco' }, 'Escolha por onde começar e o tamanho. Tudo pode ser mudado depois, no editor.'),
      h('label', { class: 'campo' }, 'Nome', titulo),
      h('div', { class: 'na-corpo' }, h('section', { class: 'na-esq', 'aria-label': 'Modelo' }, h('h3', {}, 'Modelo'), lugar), lado),
      erro,
      h('div', { class: 'gal-dlg-rodape' },
        h('button', { class: 'gal-btn', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
        h('button', { class: 'gal-btn primario', type: 'button', onclick: (e) => { e.target.disabled = true; criar().finally(() => { e.target.disabled = false; }); } }, 'Criar e abrir'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  montarGaleria(lugar, {
    catalogo: () => carregarCatalogo(getJson), meus, extras: EXTRAS_NOVO, selecionavel: true, selecionado: '__branco', compacta: true,
    onSelecionar: (m) => { escolhido = m; pintaLado(); },
    onGerar: (recarregar) => abrirGerador({ meus, aoSalvar: recarregar, onUsar: (m) => criar(m) }),
  });
  pintaLado();
  dlg.showModal();
  titulo.focus();
}

function azulejoNovoArquivo(slug) {
  return h('button', { class: 'cartao novo', type: 'button', onclick: () => abrirNovoArquivo(slug), 'data-busca': 'novo arquivo em branco criar modelo tamanho a4 a5 celular pc tablet site artigo' },
    h('span', { class: 'mais-grande', 'aria-hidden': 'true' }, '+'), h('b', {}, 'Novo arquivo em branco'), h('small', {}, 'Escolha o modelo e o tamanho'));
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
          conectado ? null : linha('Privacidade', 'O Gehrarte só enxerga o que for enviado por aqui — o resto do seu Drive continua invisível.')),
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

main().catch((e) => { console.error(e); $('#carregando').textContent = 'Não consegui carregar os arquivos: ' + (e?.message || e); });

// ---------- modo noturno ----------
// A escolha da pessoa vale; sem escolha segue o sistema (e acompanha quando ele muda). O <head> já aplicou a escolha guardada.
(() => {
  const btn = document.getElementById('tema'), raiz = document.documentElement, mq = matchMedia('(prefers-color-scheme: dark)');
  const guardado = () => { try { return localStorage.getItem(CHAVE_TEMA); } catch { return null; } };
  const mostrar = () => {
    const t = temaEfetivo(guardado(), mq.matches);
    raiz.dataset.tema = t;
    if (btn) { btn.setAttribute('aria-pressed', String(t === 'escuro')); btn.title = btn.ariaLabel = t === 'escuro' ? 'Voltar ao modo claro' : 'Modo noturno'; }
  };
  btn?.addEventListener('click', () => { const novo = alternarTema(raiz.dataset.tema); try { localStorage.setItem(CHAVE_TEMA, novo); } catch { /* sem armazenamento: vale só agora */ } raiz.dataset.tema = novo; mostrar(); });
  mq.addEventListener?.('change', () => { if (!guardado()) mostrar(); });
  mostrar();
})();
