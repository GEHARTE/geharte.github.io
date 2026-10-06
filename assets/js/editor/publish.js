// Salvar fora do navegador: exportar/importar projeto, publicar (Publicador + trava do editor), preview PC/celular.
import { h } from '../core/dom.js';
import { BASE, blobToDataURL, dataURLToBlob, downloadBlob } from '../core/util.js';
import { todosOsElementos, todasAsPaginas, guardarAbaAtual } from '../core/sites.js';
import { renderArtboard, usedFonts } from '../core/render.js';
import { urlDasFontes } from '../core/fonts.js';
import { montarHtml, nomeDoArquivoHtml } from '../core/exportar-html.js';
import { Store } from '../core/store.js';
import { S, saveNow, emit } from './state.js';
import { normalizeDoc, PROFILE_ID, publishDir, viewerQuery, publisherName, KINDS, NAO_PUBLICAVEIS, pageW, pageH, bgCss, ehUnico } from '../core/model.js';
import { goToDoc } from './nav.js';
import { publishedUrl, siteHost } from '../core/site.js';
import { createPublicador } from '../core/publicador.js';
import { ate } from '../core/vigia.js';
import { trava, travar, acompanhar, cancelar, aplicarNoAr, diagramaSvg, bloqueado } from './publicacao.js';
import { btn, modal, toast } from './ui.js';
import { icon } from './icons.js';

// imagens usadas pelo documento (num projeto de site, por todas as abas e pelos compartilhados)
const usedAssetIds = () => [...new Set((S.doc.kind === 'site' ? todosOsElementos(S.doc) : S.doc.elements).filter((e) => e.t === 'image' && e.asset).map((e) => e.asset))];

// ---------- exportar / importar (backup) ----------
export async function buildProject() {
  const assets = {};
  for (const id of usedAssetIds()) {
    const a = S.assets.get(id);
    if (a) assets[id] = { ext: a.ext, mime: a.mime, w: a.w, h: a.h, data: await blobToDataURL(a.blob) };
  }
  let doc = S.doc;
  if (doc.kind === 'site') { doc = JSON.parse(JSON.stringify(doc)); guardarAbaAtual(doc); }   // abas e compartilhados em dia
  return { format: 'gehrarte-projeto', v: 2, slug: S.slug, id: S.doc.id, kind: S.doc.kind, doc, assets };
}

export async function exportProject() {
  const out = await buildProject();
  downloadBlob(`gehrarte-${S.slug}-${S.doc.id}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
}

// Exporta a página (ou o projeto de site inteiro) como UM arquivo .html autônomo: abre com duplo clique, sem o editor nem servidor.
export async function exportHtml() {
  await saveNow();
  const doc = S.doc;
  const paginas0 = doc.kind === 'site' ? todasAsPaginas(doc) : [{ id: 'pagina', titulo: doc.title || 'Página', doc }];
  const urls = new Map();                                            // imagens embutidas (data:), de todas as abas
  for (const id of usedAssetIds()) { const a = S.assets.get(id); if (a) urls.set(id, await blobToDataURL(a.blob)); }
  const assetUrl = (id) => urls.get(id) || null;
  const nomes = new Set();
  const paginas = paginas0.map(({ id, titulo, doc: d }) => {
    const dispositivos = {};
    for (const dev of ehUnico(d) ? ['d'] : ['d', 'm']) {
      const ab = renderArtboard(d, { dev, assetUrl, editing: false });
      dispositivos[dev] = { w: pageW(d, dev), h: pageH(d, dev), html: ab.outerHTML };
    }
    usedFonts(d).forEach((n) => nomes.add(n));
    return { id, titulo, bg: bgCss(d.page.bg), dispositivos };
  });
  const css = (await Promise.all(['anim.css', 'viewer.css'].map((f) => fetch(`${BASE}assets/css/${f}`).then((r) => (r.ok ? r.text() : '')).catch(() => '')))).join('\n');
  const html = montarHtml({ titulo: doc.title || 'Página', nome: doc.kind === 'site' ? doc.title || '' : '', paginas, css, fontes: urlDasFontes([...nomes]) });
  downloadBlob(nomeDoArquivoHtml(S.slug, doc), new Blob([html], { type: 'text/html;charset=utf-8' }));
  return { paginas: paginas.length, bytes: html.length };
}

export async function importProject(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Esse arquivo não é um projeto válido.', 'err'); return; }
  if (!['gehrarte-projeto', 'geharte-projeto'].includes(data.format) || !data.doc) { toast('Esse arquivo não é um projeto do ArtAtk.', 'err'); return; }
  for (const [id, a] of Object.entries(data.assets || {})) {
    const blob = await dataURLToBlob(a.data);
    const meta = { ext: a.ext, mime: a.mime, w: a.w, h: a.h };
    await Store.putAsset(S.slug, id, blob, meta);
    S.assets.set(id, { ...meta, blob, url: URL.createObjectURL(blob) });
  }
  const doc = normalizeDoc(data.doc, S.slug);
  doc.owner = S.slug;
  if (data.kind && KINDS[data.kind]) doc.kind = data.kind;
  if (doc.kind === 'pagina' && !S.canSite) { toast('Só quem organiza o site pode importar páginas do site.', 'err'); return; }
  if (data.id && (doc.kind === 'artigo' || doc.kind === 'site')) doc.id = String(data.id).replace(/[^a-z0-9-]/g, '') || doc.id;
  if (doc.kind === 'perfil') doc.id = PROFILE_ID;
  normalizeDoc(doc, S.slug);
  await saveNow();                                   // não perder o que está aberto agora
  const existing = await Store.loadDoc(S.slug, doc.id);
  if (existing && !confirm(`Já existe “${existing.title || doc.id}” no seu inventário com este mesmo identificador. Substituir pela página importada?`)) return;
  if (doc.id === S.doc.id) S.deleted = true;           // o que está na tela vai ser substituído: não regravar por cima
  await Store.saveDoc(S.slug, doc);
  toast('Projeto importado para o seu inventário.', 'ok');
  await goToDoc(doc.id);
}

// ---------- publicar ----------
// Sem token do GitHub: a pessoa confirma com o Google e o Publicador (servidor) grava. Do clique até o site mostrar a mudança o editor
// dessa página fica travado, com o diagrama do caminho na tela (publicacao.js).
async function siteConfig() {
  try { return await (await fetch(BASE + 'config.json', { cache: 'no-cache' })).json(); } catch { return {}; }
}

const fmtWhen = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const row = (k, ...v) => h('div', { class: 'pub-row' }, h('span', {}, k), h('div', {}, ...v));

export async function openPublish() {
  if (bloqueado()) return;
  if (NAO_PUBLICAVEIS.includes(S.doc.kind)) { toast('Este tipo de arquivo não é publicado pelo Gehrarte. Use “Exportar projeto” ou as ações do host (ex.: MUVVI). Para publicar um texto no blog, crie um Artigo.', 'err'); return; }
  await saveNow();
  const cfg = await siteConfig();
  const pagina = S.doc.kind === 'pagina';
  if (pagina && !S.canSite) { toast('Só quem organiza o site pode publicar páginas do site.', 'err'); return; }
  const derived = S.doc.elements.filter((e) => !e.f.m).length;
  const empty = !S.doc.elements.length;
  const dir = publishDir(S.slug, S.doc);
  const host = siteHost(cfg) || 'o site do Gehrarte';
  const url = publishedUrl(cfg, S.slug, S.doc, S.siteEntry);
  // config.json "googleFake": só o ambiente de homologação (tools/homologacao) usa — pula a janelinha do Google; o Publicador de verdade recusaria o token
  const pub = cfg.publicador ? createPublicador({ url: cfg.publicador, clientId: cfg.googleClientId, slug: S.slug, ...(cfg.googleFake ? { requestToken: async () => ({ access_token: 'homologacao', expires_in: 3600 }) } : {}) }) : null;

  const warn = [];
  if (empty) warn.push('A página está vazia.');
  if (derived && S.doc.elements.length) warn.push(`${derived} elemento(s) ainda seguem o layout do PC no celular. Confira na aba “Celular” (ou use “Empilhar elementos”).`);

  // quem publicou por último (a cópia local é a que esta pessoa abriu; o conflito de verdade é checado pelo Publicador)
  const last = S.doc.publishedAt
    ? `${publisherName(S.doc) ? 'por ' + publisherName(S.doc) + ' · ' : ''}${fmtWhen(S.doc.publishedAt)}`
    : pagina ? 'ainda não — hoje o site mostra a versão original' : 'ainda não foi publicada';

  const destino = h('div', { class: 'pubbox' },
    h('p', { class: 'pub-head', html: icon('upload', 15) + `<span>Esta publicação vai para <b>${host}</b> — o site público do Gehrarte.</span>` }),
    h('p', { class: 'pub-sub' }, pagina ? 'Qualquer pessoa na internet verá a mudança, não só a equipe.' : 'Qualquer pessoa na internet poderá ver esta página, não só a equipe.'),
    row('Onde', h('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace(/^https?:\/\//, ''))),
    pagina && S.siteEntry ? row('O que é', S.siteEntry.funcao) : null,
    row('Última publicação', last));

  const caminho = h('div', { class: 'pv-diagram mini', html: diagramaSvg() });
  const caminhoSvg = caminho.firstChild;
  caminhoSvg.querySelectorAll('.pd-node').forEach((g) => g.setAttribute('class', g.getAttribute('class').replace('st-pend', 'st-previa')));
  const caminhoTxt = h('p', { class: 'hint' }, 'Este é o caminho que a página percorre. Leva cerca de 1 a 2 minutos; enquanto isso o editor desta página fica travado e você acompanha o andamento. Se algo travar, ele é liberado sozinho em 2 minutos.');

  const clash = h('div', { class: 'warnbox', hidden: true });
  const erro = h('div', { class: 'warnbox erro', hidden: true });
  let confirmedClash = false, m = null;

  const mostraConflito = (atual) => {
    clash.replaceChildren(
      h('p', {}, h('b', {}, '⚠ Outra versão foi publicada depois da que você abriu.')),
      h('p', {}, `${publisherName(atual || {}) ? publisherName(atual) + ' publicou' : 'Alguém publicou'} esta página${atual?.publishedAt ? ' em ' + fmtWhen(atual.publishedAt) : ''}. Publicar agora substitui o trabalho dessa pessoa. Para ver a versão dela antes, exporte o seu projeto (menu ⋯), descarte o seu rascunho local no painel de documentos e abra a página de novo.`));
    clash.hidden = false; confirmedClash = true;
    go.querySelector('span').textContent = 'Publicar mesmo assim';
  };

  async function publicar() {
    go.disabled = true; erro.hidden = true;
    const alvo = { kind: S.doc.kind, ...(S.doc.kind === 'artigo' ? { id: S.doc.id } : {}), ...(S.doc.kind === 'pagina' ? { pageId: S.doc.id.replace(/^site-/, '') } : {}) };
    try {
      await pub.confirmar();                                    // clique do usuário: pode abrir a janelinha do Google
      // daqui até o site mostrar a mudança, a página fica travada
      const rec = trava.iniciar(S.slug, S.doc.id, { dir, baseAt: S.doc.publishedAt || null, url, titulo: S.doc.title });
      const tela = travar({ rec, cfg });
      tela.etapas(ate('google'));
      const prep = await pub.preparar(alvo);
      const meta = {}, novas = {};
      for (const id of usedAssetIds()) {
        const a = S.assets.get(id), mt = a || S.doc.assets[id];
        if (!mt) continue;
        meta[id] = { ext: mt.ext, mime: mt.mime, w: mt.w, h: mt.h };
        if (a && !prep.existentes.includes(id)) { tela.texto(`Enviando a imagem ${id}.${a.ext}…`); novas[id] = { ext: a.ext, data: (await blobToDataURL(a.blob)).split(',')[1] }; }
      }
      tela.texto('O Publicador está gravando a página no GitHub…');
      const r = await pub.publicar({ ...alvo, page: { ...S.doc, assets: meta }, assets: novas, baseAt: S.doc.publishedAt || null, force: confirmedClash });
      // o commit existe: a página passa a "Publicada" (carimbo local = o do servidor, para não parecer alterada)
      S.doc.publishedAt = r.publishedAt; S.doc.publishedBy = r.publishedBy;
      await saveNow({ updatedAt: Date.parse(r.publishedAt) });
      emit('published');
      const rec2 = trava.marcar(S.slug, S.doc.id, { fase: 'no-github', esperado: r.publishedAt, commit: r.commit || null }) || { ...rec, esperado: r.publishedAt };
      m?.close();
      acompanhar({ rec: rec2, cfg, onNoAr: aplicarNoAr });
    } catch (e) {
      cancelar();                                               // erro antes do commit: solta a trava e volta para esta caixa
      if (e.codigo === 'conflito') mostraConflito(e.extra?.atual);
      else { erro.replaceChildren(h('p', {}, '✗ ' + e.message)); erro.hidden = false; }
    } finally { go.disabled = false; }
  }

  const go = btn({ label: 'Publicar agora', cls: 'primary', ic: 'upload', disabled: !pub, onClick: publicar });

  m = modal({ title: pagina ? 'Publicar página do site' : 'Publicar página', wide: true, body: [
    destino,
    caminho, caminhoTxt,
    warn.length ? h('div', { class: 'warnbox' }, warn.map((w) => h('p', {}, '⚠ ' + w))) : null,
    !pub ? h('div', { class: 'warnbox erro' }, h('p', {}, 'O publicador ainda não foi configurado neste site (config.json). Use “Exportar projeto” no menu ⋯ e envie o arquivo para quem administra o site.')) : null,
    clash, erro,
  ], actions: [go] });
}

// ---------- preview PC / celular ----------
export async function openPreview(startDev = S.dev) {
  await saveNow();
  let dev = startDev;
  const url = () => `${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}&src=draft&embed=1&t=${Date.now()}`;
  const area = h('div', { class: 'pv-area' });
  const mk = (d, label, ic) => btn({ label, ic, cls: d === dev ? 'on' : '', onClick: () => { dev = d; draw(); bar.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === dev)); } });
  const bd = mk('d', 'PC', 'monitor'), bm = mk('m', 'Celular', 'phone');
  bd.dataset.d = 'd'; bm.dataset.d = 'm';
  const close = () => { back.remove(); removeEventListener('keydown', esc); removeEventListener('resize', draw); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const bar = h('div', { class: 'pv-bar' }, h('b', {}, 'Visualização'), h('div', { class: 'seg2' }, bd, bm),
    h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: `${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}&src=draft&toolbar=1`, html: icon('link') + '<span>Abrir em outra aba</span>' }),
    h('span', { class: 'spacer' }), btn({ label: 'Fechar', ic: 'x', onClick: close }));
  const back = h('div', { class: 'pv-back' }, bar, area);
  document.body.append(back);
  addEventListener('keydown', esc);

  function draw() {
    area.innerHTML = '';
    const aw = area.clientWidth - 32, ah = area.clientHeight - 32;
    if (dev === 'd') {
      const w = 1280, s = Math.min(1, aw / w), hh = ah / s;
      const fr = h('iframe', { src: url(), title: 'Preview PC', style: { width: w + 'px', height: hh + 'px', transform: `scale(${s})`, transformOrigin: '0 0' } });
      area.append(h('div', { class: 'pv-pc', style: { width: w * s + 'px', height: ah + 'px' } }, fr));
    } else {
      const w = 390, hh = Math.min(844, ah - 20), s = 1;
      area.append(h('div', { class: 'pv-phone', style: { width: w + 'px', height: hh + 'px' } }, h('iframe', { src: url(), title: 'Preview celular', style: { width: w + 'px', height: hh + 'px' } })));
    }
  }
  addEventListener('resize', draw);
  draw();
}
