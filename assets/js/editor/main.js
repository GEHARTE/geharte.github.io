import '../core/migracao.js';
import { h, $, $$ } from '../core/dom.js';
import { loadConfig } from '../core/auth.js';
import { carregarHost, identidadeValida } from '../core/host.js';
import { Store } from '../core/store.js';
import { loadAllFonts } from '../core/fonts.js';
import { newDoc, normalizeDoc, DEV_LABEL, KINDS, PROFILE_ID, STATE_LABEL, docState, publishDir, viewerQuery, isSiteId, sitePageId, publisherName, ehUnico, NAO_PUBLICAVEIS } from '../core/model.js';
import { docPath, prepareSiteDoc } from '../core/docs.js';
import { canEditSite, registryEntry } from '../core/site.js';
import { BASE } from '../core/util.js';
import { S, on, emit, touch, loadDoc, setDevice, setTool, undo, redo, canUndo, canRedo, select, selEls, removeEls, duplicate, copy, paste, reorder, saveNow, commit } from './state.js';
import { initStage, fit, setZoom, nudge, editText, applyAnimState } from './stage.js';
import { initPanel } from './panels.js';
import { initLibraryPanels } from './library.js';
import { renderLayers } from './layers.js';
import { initDock } from './dock.js';
import { instalar as vigiarAreaVisivel } from '../core/janelas.js';
import { trava, retomar, aplicarNoAr } from './publicacao.js';
import { insertImageFile, insertSvg } from './tools.js';
import { exportProject, exportHtml, buildProject, importProject, openPublish, openPreview } from './publish.js';
import { goToDocuments } from './nav.js';
import { saveCopyToDrive } from './drive.js';
import { initAbas } from './abas.js';
import { openExportPdf } from './pdf.js';
import { initReguas, alternarReguas, reguasVisiveis, alternarGrade, gradeAtual } from './reguas.js';
import { rotuloDaPagina } from '../core/formatos.js';
import { toast, modal, btn } from './ui.js';
import { icon } from './icons.js';

async function loadAssetsFor(doc) {
  for (const a of await Store.listAssets(S.slug)) {
    S.assets.set(a.id, { ...a.meta, blob: a.blob, url: URL.createObjectURL(a.blob) });
    doc.assets[a.id] ||= a.meta;
  }
  // imagens publicadas que ainda não estão neste navegador
  for (const [id, m] of Object.entries(doc.assets)) {
    if (S.assets.has(id)) continue;
    try {
      const r = await fetch(`${BASE}${publishDir(S.slug, doc)}assets/${id}.${m.ext}`);
      if (!r.ok) continue;
      const blob = await r.blob();
      await Store.putAsset(S.slug, id, blob, m);
      S.assets.set(id, { ...m, blob, url: URL.createObjectURL(blob) });
    } catch { /* offline: imagem aparece como placeholder */ }
  }
}

// Publicaram uma versão mais nova desta página do site e há edições locais: a pessoa escolhe o que fazer.
// Devolve true (manter o rascunho), false (abrir a versão publicada) ou null (voltar aos documentos).
// Camadas como painel próprio (a mesma lista que a aba da biblioteca, mas solta ou encaixada onde a pessoa quiser).
function initLayersPanel(el) {
  el.classList.add('lib-body');
  const paint = () => { if (el.isConnected) renderLayers(el); };
  for (const ev of ['struct', 'select', 'struct-lite', 'layers']) on(ev, paint);
  paint();
}

function askConflict({ remote }) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; m.close(); res(v); };
    const quem = publisherName(remote) ? `por ${publisherName(remote)} ` : '';
    const m = modal({ title: 'O site mudou desde a sua última edição', body: [
      h('p', {}, `Esta página foi publicada ${quem}em ${new Date(remote.publishedAt).toLocaleString('pt-BR')}, depois da versão em que você estava trabalhando — e você tem alterações que ainda não foram publicadas.`),
      h('p', { class: 'hint' }, 'Abrir a versão publicada descarta o seu rascunho neste navegador. Manter o rascunho preserva o seu trabalho, mas, ao publicar, ele substitui o que a outra pessoa fez (o editor avisa antes).'),
    ], actions: [
      btn({ label: 'Voltar aos documentos', onClick: () => fin(null) }),
      btn({ label: 'Abrir a versão publicada', onClick: () => fin(false) }),
      btn({ label: 'Manter o meu rascunho', cls: 'primary', onClick: () => fin(true) }),
    ], onClose: () => fin(null) });
  });
}

let dock = null;

async function main() {
  const host = await carregarHost({ carregarConfig: loadConfig });
  S.host = host;
  const sess = await host.identidade();
  if (!sess) { host.entrar('documentos/'); return; }
  if (!identidadeValida(sess)) { alert('O host devolveu uma identidade inválida.'); return; }
  S.user = sess; S.slug = sess.slug;
  $('#who').textContent = sess.nome;
  loadAllFonts();
  // o Publicar não usa mais token do GitHub: apaga o que versões antigas deixaram guardado neste navegador
  try { for (const k of ['gehrarte.ghtoken', 'gehrarte.repo', 'gehrarte.branch']) localStorage.removeItem(k); } catch { /* sem armazenamento */ }
  vigiarAreaVisivel(window);   // --vv-*: área visível real, usada por diálogos e menus (core/janelas.js)

  // o editor abre sempre uma página escolhida no painel de documentos: ?doc=<id> (perfil, artigo ou site-<pagina>)
  const want = new URLSearchParams(location.search).get('doc');
  if (!want) { location.replace(host.urls.documentos); return; }
  S.canSite = !!sess.podeSite && host.capacidades.paginasDoSite;

  let doc = null, updatedAt = 0, fresh = false;
  if (isSiteId(want)) {
    // página do SITE (landing, home…): só quem organiza o site; vem da versão publicada, do rascunho ou do modelo
    const entry = S.canSite ? await registryEntry(sitePageId(want)) : null;
    if (!entry) { alert(S.canSite ? 'Essa página do site não existe.' : 'Só quem organiza o site pode editar as páginas do site.'); location.replace(host.urls.documentos); return; }
    S.siteEntry = entry;
    let r = await prepareSiteDoc(S.slug, entry.id);
    if (r.conflict) {
      // publicação em andamento: o "conflito" é a nossa própria publicação chegando; não perguntar (o editor está travado de qualquer jeito)
      const keep = trava.estado(S.slug, want).estado === 'travado' ? true : await askConflict(r.conflict);
      if (keep === null) { location.replace(host.urls.documentos); return; }
      r = await prepareSiteDoc(S.slug, entry.id, { keepLocal: keep });
    }
    ({ doc, updatedAt } = r);
    if (r.origem === 'publicada') toast(`Abri a versão publicada${publisherName(doc) ? ' por ' + publisherName(doc) : ''}.`);
    else if (r.origem === 'modelo') toast('Esta página ainda não foi publicada pelo editor: abri o modelo inicial.');
  } else {
    const rec = (await Store.listDocs(S.slug)).find((d) => d.id === want);
    doc = rec?.doc; updatedAt = rec?.updatedAt || 0;
    if (!doc && want === PROFILE_ID) {
      // primeira vez no perfil: traz o publicado (as boas-vindas) ou começa uma página nova
      try {
        const r = await fetch(`${BASE}perfis/${S.slug}/page.json`, { cache: 'no-cache' });
        if (r.ok) { doc = normalizeDoc(await r.json(), S.slug); updatedAt = doc.publishedAt ? Date.parse(doc.publishedAt) : Date.now(); await Store.saveDoc(S.slug, doc, { updatedAt }); }
      } catch { /* sem publicado */ }
      if (!doc) { doc = newDoc(S.slug, `Página de ${sess.nome}`); fresh = true; }
    }
    if (!doc) { alert('Não achei essa página nos seus documentos.'); location.replace(host.urls.documentos); return; }
  }
  normalizeDoc(doc, S.slug);
  await loadAssetsFor(doc);
  S.doc = doc;

  initStage({ vp: $('#viewport'), stage: $('#stage'), holder: $('#holder'), overlay: $('#overlay') });
  initPanel($('#props'));
  // cada ferramenta da biblioteca é um painel (o Drive só existe nos hosts que o oferecem)
  const libRoots = { els: $('#p-els'), svg: $('#p-svg'), media: $('#p-media'), tpl: $('#p-tpl') };
  if (S.host?.capacidades.drive) libRoots.drive = $('#p-drive');
  const lib = initLibraryPanels(libRoots);
  initLayersPanel($('#layerspane'));
  loadDoc(doc, updatedAt);
  initAbas($('#abas-bar'));   // só aparece em projetos de site
  initReguas({ wrap: $('#vpwrap'), canto: $('#reg-canto'), ch: $('#reg-h'), cv: $('#reg-v'), vp: $('#viewport'), holder: $('#holder'), overlay: $('#overlay') });
  // painéis reorganizáveis (docks, soltos, outra janela; no celular, gavetas): ver dock.js
  dock = initDock({
    app: $('#app'), slug: S.slug, rotateEl: $('#rotate'),
    preferencias: S.host?.preferencias || null,     // a conta da pessoa (hoje: Google Drive no Gehrarte); sem isto a disposição fica só neste navegador
    panels: {
      rail: { el: $('#rail'), title: 'Ferramentas' },
      els: { el: libRoots.els, title: 'Elementos' }, svg: { el: libRoots.svg, title: 'SVG animado' }, media: { el: libRoots.media, title: 'Mídia' },
      ...(libRoots.drive ? { drive: { el: libRoots.drive, title: 'Drive' } } : {}),
      tpl: { el: libRoots.tpl, title: 'Modelos' },
      props: { el: $('#props'), title: 'Propriedades' }, layers: { el: $('#layerspane'), title: 'Camadas' },
    },
    onDocument: bindKeys,
    onMode: () => fit(),
    // as ferramentas da biblioteca montam o conteúdo quando abrem (à vista e não recolhidas); Camadas se refaz ao aparecer
    onVisible: (id, vis, open) => { lib.setOpen(id, open); if (id === 'layers' && vis) emit('layers'); },
  });
  S.dock = dock;
  fit();
  wireTop();
  await retomarPublicacao(doc);
  emit('zoom');   // o fit() inicial rodou antes do rótulo de zoom estar ligado
  on('fit', fit);
  if (fresh) { dock.reveal('tpl', { exclusive: true }); toast('Bem-vindo! Escolha um modelo ou comece do zero.'); }
  emit('history');
}

// Se esta página estava sendo publicada quando a pessoa saiu: só o diagrama, até o site responder (ou 2 min — a salvaguarda).
async function retomarPublicacao(doc) {
  const est = trava.estado(S.slug, doc.id);
  if (est.estado === 'travado') retomar({ rec: est.rec, restanteMs: est.restanteMs, cfg: await loadConfig(), onNoAr: aplicarNoAr });
  else if (est.estado === 'expirou') toast('A última publicação desta página passou de 2 minutos sem confirmação: liberei o editor. Confira se o site já mostra a mudança.');
}

// ---------- barra superior ----------
function wireTop() {
  const title = $('#title');
  title.value = S.doc.title;
  // barra discreta acima do canvas: tipo, estado e arquivo da página que está sendo editada
  const paintPath = () => {
    const d = S.doc, state = docState(d, S.updatedAt, S.changed);
    const k = $('#pb-kind'), st = $('#pb-state');
    k.textContent = KINDS[d.kind]; k.className = `chip kind-${d.kind}`;
    st.textContent = STATE_LABEL[state]; st.className = `chip st-${state}`;
    $('#pb-path').textContent = docPath(S.slug, d);
    $('#pb-name').textContent = d.title?.trim() || 'sem título';
    $('#pb-dev').textContent = ehUnico(d) ? rotuloDaPagina(d.page) : 'editando: ' + DEV_LABEL[S.dev === 'm' ? 'm' : 'd'];
  };
  paintPath();
  on('struct', paintPath); on('device', paintPath); on('saved', paintPath); on('dirty', paintPath); on('published', paintPath);
  $('#btn-inventory').onclick = () => goToDocuments();
  for (const [id, ic, label] of [['lib', 'square', 'Biblioteca'], ['layers', 'layers', 'Camadas'], ['props', 'wand', 'Propriedades']]) {
    const b = $(`#drawerseg [data-drawer="${id}"]`);
    b.innerHTML = icon(ic, 18); b.title = b.ariaLabel = label;
  }
  title.addEventListener('input', () => { S.doc.title = title.value; paintPath(); touch(); });
  on('struct', () => { if (document.activeElement !== title) title.value = S.doc.title; });

  $$('#devseg button').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.dev)));
  const syncDev = () => { $('#devseg').hidden = ehUnico(S.doc); $$('#devseg button').forEach((b) => b.classList.toggle('on', b.dataset.dev === S.dev)); };
  on('device', syncDev); syncDev();

  $('#zin').onclick = () => setZoom(S.zoom * 1.2);
  $('#zout').onclick = () => setZoom(S.zoom / 1.2);
  $('#zfit').onclick = fit;
  on('zoom', () => { $('#zval').textContent = Math.round(S.zoom * 100) + '%'; });

  $('#undo').onclick = undo; $('#redo').onclick = redo;
  on('history', () => { $('#undo').disabled = !canUndo(); $('#redo').disabled = !canRedo(); });

  const ab = $('#btn-anim');
  const syncAnim = () => { ab.classList.toggle('on', S.anim); ab.innerHTML = icon(S.anim ? 'pause' : 'play') + `<span>Animações ${S.anim ? 'ligadas' : 'pausadas'}</span>`; };
  ab.onclick = () => { S.anim = !S.anim; applyAnimState(); syncAnim(); };
  syncAnim();

  $('#btn-preview').onclick = () => openPreview();
  $('#btn-publish').onclick = () => openPublish();
  $('#btn-savefile').onclick = async () => { await exportProject(); toast('Arquivo salvo na sua pasta de Downloads.', 'ok'); };
  // o que a saída oferece depende do host: Publicar (Gehrarte), botões próprios do host (ex.: MUVVI) ou só salvar arquivo
  // (modo teste e host local: nada vai para a internet, tudo fica neste computador)
  const H = S.host;
  // projeto de site e arquivo em branco não vão pelo Publicador do Gehrarte: só arquivo ou ações do host
  const syncSaida = () => { const pub = H.capacidades.publicar && !NAO_PUBLICAVEIS.includes(S.doc.kind); $('#btn-publish').hidden = !pub; $('#btn-savefile').hidden = pub || !!H.acoes.length; };
  syncSaida(); on('struct', syncSaida); on('struct', () => { $('#devseg').hidden = ehUnico(S.doc); });
  for (const a of [...H.acoes].reverse()) {
    const b = h('button', { class: `btn${a.principal ? ' primary' : ''}`, id: `btn-acao-${a.id}`, title: a.rotulo,
      onclick: async () => { try { await saveNow(); await a.executar({ doc: S.doc, slug: S.slug, salvar: saveNow }); } catch (e) { toast(e.message || String(e), 'err'); } } }, a.icone ? [h('span', { html: icon(a.icone) }), a.rotulo] : a.rotulo);
    $('#btn-publish').after(b);
  }

  const st = $('#savestate');
  on('dirty', () => { st.textContent = 'Salvando…'; st.className = 'busy'; });
  on('saved', (t) => { st.textContent = 'Salvo neste computador'; st.title = 'Rascunho guardado neste navegador, às ' + new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. Use “Salvar arquivo” para ter uma cópia.'; st.className = 'ok'; });
  on('saveerror', () => { st.textContent = 'Erro ao salvar!'; st.className = 'err'; });

  // ferramentas
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => { for (const f of file.files) await insertImageFile(f); file.value = ''; } });
  $('#rail').append(file);   // dentro do painel: o seletor de arquivos abre na janela onde o painel estiver
  const toolBtns = $$('#rail [data-tool]');
  toolBtns.forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'image') return file.click();
    setTool(S.tool === t && t !== 'select' ? 'select' : t);
  }));
  const syncTool = () => toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === S.tool));
  on('tool', syncTool); syncTool();

  // menu ⋯
  $('#btn-more').onclick = (e) => {
    const old = $('#menu'); if (old) { old.remove(); return; }
    const imp = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => imp.files[0] && importProject(imp.files[0]) });
    const item = (ic, label, fn) => h('button', { html: icon(ic) + `<span>${label}</span>`, onclick: () => { m.remove(); fn(); } });
    const verPublicada = async () => {
      if (!S.doc.publishedAt) return toast('Esta página ainda não foi publicada.', 'err');
      // página do site: o próprio caminho dela; perfil/artigo: o visualizador
      window.open(S.doc.kind === 'pagina' ? BASE + S.siteEntry.caminho.replace(/index\.html$/, '') : `${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}`, '_blank');
    };
    const m = h('div', { id: 'menu', class: 'popover menu' },
      S.host.capacidades.publicar ? item('eye', 'Ver página publicada', verPublicada) : null,
      item('stack', 'Documentos', () => goToDocuments()),
      item('layers', reguasVisiveis() ? 'Ocultar réguas (Alt+R)' : 'Mostrar réguas (Alt+R)', () => alternarReguas()),
      item('layers', gradeAtual().visivel ? 'Ocultar grade (Alt+G)' : 'Mostrar grade (Alt+G)', () => alternarGrade()),
      item('download', 'Exportar PDF…', openExportPdf),
      item('download', 'Exportar projeto (.json)', exportProject),
      item('code', S.doc.kind === 'site' ? 'Exportar site em HTML (.html)' : 'Exportar página em HTML (.html)', async () => { try { toast('Montando o arquivo HTML…'); const r = await exportHtml(); toast(`HTML salvo na pasta de Downloads (${r.paginas} ${r.paginas > 1 ? 'páginas' : 'página'}, ${(r.bytes / 1024).toFixed(0)} KB).`, 'ok'); } catch (e) { toast(e.message || String(e), 'err'); } }),
      item('upload', 'Importar projeto…', () => imp.click()), imp,
      S.host.capacidades.drive ? item('cloud', 'Salvar cópia no Drive', async () => {
        try { toast('Salvando no seu Drive…'); const nome = await saveCopyToDrive(await buildProject()); toast(`Cópia salva no Drive: ${nome}`, 'ok'); } catch (e) { toast(e.message, 'err'); }
      }) : null,
      S.host.sair ? [h('hr'), item('x', 'Sair', () => S.host.sair())] : null);
    document.body.append(m);
    const r = e.currentTarget.getBoundingClientRect();
    Object.assign(m.style, { top: r.bottom + 6 + 'px', right: innerWidth - r.right + 'px' });
    setTimeout(() => document.addEventListener('pointerdown', function away(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
  };
}

// ---------- atalhos ----------
const typing = (t) => t && (t.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]'));

// Liga os atalhos num document: o principal e o de cada painel separado em outra janela.
const keyBound = new WeakSet();
function bindKeys(doc) {
  if (keyBound.has(doc)) return;
  keyBound.add(doc);
  const vp = $('#viewport');
  doc.addEventListener('keydown', (e) => {
    if (S.locked || typing(e.target) || S.editing) return;
    if (doc.querySelector('.modal-back,.pv-back')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

    if (mod && k === '\\') { e.preventDefault(); dock?.toggleAll(); return; }

    if (k === ' ') { S.space = true; vp.classList.add('panning'); e.preventDefault(); return; }
    if (mod) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'd') { e.preventDefault(); duplicate(); }
      else if (k === 'c') { copy(); }
      else if (k === 'x') { copy(); removeEls(S.sel.filter((id) => !selEls().find((x) => x.id === id)?.lock)); }
      else if (k === 'a') { e.preventDefault(); select(S.doc.elements.filter((x) => !x.lock && !x.hide).map((x) => x.id)); }
      else if (k === 's') { e.preventDefault(); saveNow().then(() => toast('Rascunho salvo.', 'ok')); }
      else if (k === '0') { e.preventDefault(); fit(); }
      else if (k === '=' || k === '+') { e.preventDefault(); setZoom(S.zoom * 1.2); }
      else if (k === '-') { e.preventDefault(); setZoom(S.zoom / 1.2); }
      return;
    }
    if (e.altKey && k === 'r') { e.preventDefault(); alternarReguas(); return; }
    if (e.altKey && k === 'g') { e.preventDefault(); alternarGrade(); return; }
    if (k === 'escape') { if (S.tool !== 'select') setTool('select'); else select([]); return; }
    if (k === 'delete' || k === 'backspace') { const ids = selEls().filter((x) => !x.lock).map((x) => x.id); if (ids.length) { e.preventDefault(); removeEls(ids); } return; }
    if (k.startsWith('arrow')) {
      if (!S.sel.length) return;
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      nudge(k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0, k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0);
      return;
    }
    if (k === 'enter') { const el = selEls()[0]; if (el?.t === 'text' && S.sel.length === 1) { e.preventDefault(); editText(el.id); } return; }
    if (k === ']') return reorder(S.sel, e.shiftKey ? 'front' : 'up');
    if (k === '[') return reorder(S.sel, e.shiftKey ? 'back' : 'down');
    if (k === 'v') setTool('select');
    else if (k === 't') setTool('text');
    else if (k === 'r') setTool('shape');
    else if (k === 'p') setTool('pencil');
    else if (k === 'h') setTool('hand');
    else if (k === 'w') setTool('wand');
  });
  doc.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; vp.classList.remove('panning'); } });

  // colar: imagem, código SVG ou elementos copiados
  doc.addEventListener('paste', async (e) => {
    if (S.locked || typing(e.target) || S.editing) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain') || '';
    if (files.length) { e.preventDefault(); for (const f of files) await insertImageFile(f); }
    else if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) { e.preventDefault(); insertSvg(text, 'SVG colado'); }
    else if (paste()) e.preventDefault();
  });

  if (doc === document) document.addEventListener('visibilitychange', () => { if (document.hidden && S.doc) saveNow(); });
}

main().catch((e) => { console.error(e); document.body.prepend(h('pre', { style: { color: '#f66', padding: '16px', whiteSpace: 'pre-wrap' } }, 'Erro ao iniciar o editor:\n' + (e?.stack || e))); });
