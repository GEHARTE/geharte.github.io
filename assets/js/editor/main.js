import { h, $, $$ } from '../core/dom.js';
import { session, logout } from '../core/auth.js';
import { Store } from '../core/store.js';
import { loadAllFonts } from '../core/fonts.js';
import { newDoc, normalizeDoc, DEV_LABEL, KINDS, PROFILE_ID, STATE_LABEL, docState, publishDir, viewerQuery } from '../core/model.js';
import { BASE } from '../core/util.js';
import { S, on, emit, touch, loadDoc, setDevice, setTool, undo, redo, canUndo, canRedo, select, selEls, removeEls, duplicate, copy, paste, reorder, saveNow, commit } from './state.js';
import { initStage, fit, setZoom, nudge, editText, applyAnimState } from './stage.js';
import { initPanel } from './panels.js';
import { initLibrary } from './library.js';
import { insertImageFile, insertSvg } from './tools.js';
import { exportProject, importProject, openPublish, openPreview } from './publish.js';
import { openInventory, docPath, rememberDoc, lastDocId } from './inventory.js';
import { toast } from './ui.js';
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

async function main() {
  const sess = session();
  if (!sess) { location.replace('../login.html?next=editor/'); return; }
  S.user = sess; S.slug = sess.slug;
  $('#who').textContent = sess.nome;
  loadAllFonts();

  // qual página abrir: ?doc=<id>  >  a última editada (localStorage)  >  a mais recente do inventário
  //  >  (inventário vazio) o perfil publicado, ou uma página nova
  const want = new URLSearchParams(location.search).get('doc');
  const docs = await Store.listDocs(S.slug);
  let rec = docs.find((d) => d.id === want) || docs.find((d) => d.id === lastDocId(S.slug)) || docs[0];
  let doc = rec?.doc, updatedAt = rec?.updatedAt || 0, fresh = false;
  if (want && !docs.some((d) => d.id === want)) toast('Não achei essa página no seu inventário; abri outra.', 'err');
  if (!doc) {
    try {
      const r = await fetch(`${BASE}perfis/${S.slug}/page.json`, { cache: 'no-cache' });
      if (r.ok) { doc = normalizeDoc(await r.json(), S.slug); updatedAt = doc.publishedAt ? Date.parse(doc.publishedAt) : Date.now(); await Store.saveDoc(S.slug, doc, { updatedAt }); }
    } catch { /* sem publicado */ }
  }
  if (!doc) { doc = newDoc(S.slug, `Página de ${sess.nome}`); fresh = true; }
  normalizeDoc(doc, S.slug);
  rememberDoc(S.slug, doc.id);
  await loadAssetsFor(doc);
  S.doc = doc;

  initStage({ vp: $('#viewport'), stage: $('#stage'), holder: $('#holder'), overlay: $('#overlay') });
  initPanel($('#props'));
  const lib = initLibrary($('#lib'));
  loadDoc(doc, updatedAt);
  fit();
  wireTop();
  wireKeys();
  emit('zoom');   // o fit() inicial rodou antes do rótulo de zoom estar ligado
  on('fit', fit);
  if (fresh) { lib.show('tpl'); toast('Bem-vindo! Escolha um modelo ou comece do zero.'); }
  emit('history');
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
    $('#pb-dev').textContent = 'editando: ' + DEV_LABEL[S.dev === 'm' ? 'm' : 'd'];
  };
  paintPath();
  on('struct', paintPath); on('device', paintPath); on('saved', paintPath); on('dirty', paintPath); on('published', paintPath);
  $('#btn-inventory').onclick = () => openInventory();
  title.addEventListener('input', () => { S.doc.title = title.value; paintPath(); touch(); });
  on('struct', () => { if (document.activeElement !== title) title.value = S.doc.title; });

  $$('#devseg button').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.dev)));
  const syncDev = () => $$('#devseg button').forEach((b) => b.classList.toggle('on', b.dataset.dev === S.dev));
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
  // modo teste (config.json: "publicar": false): nada vai para o GitHub, tudo fica neste computador
  fetch(BASE + 'config.json', { cache: 'no-cache' }).then((r) => r.json()).then((c) => {
    if (c.publicar === false) { $('#btn-publish').hidden = true; $('#btn-savefile').hidden = false; }
  }).catch(() => {});

  const st = $('#savestate');
  on('dirty', () => { st.textContent = 'Salvando…'; st.className = 'busy'; });
  on('saved', (t) => { st.textContent = 'Salvo neste computador'; st.title = 'Rascunho guardado neste navegador, às ' + new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. Use “Salvar arquivo” para ter uma cópia.'; st.className = 'ok'; });
  on('saveerror', () => { st.textContent = 'Erro ao salvar!'; st.className = 'err'; });

  // ferramentas
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => { for (const f of file.files) await insertImageFile(f); file.value = ''; } });
  document.body.append(file);
  $$('#rail [data-tool]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'image') return file.click();
    setTool(S.tool === t && t !== 'select' ? 'select' : t);
  }));
  const syncTool = () => $$('#rail [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === S.tool));
  on('tool', syncTool); syncTool();

  // menu ⋯
  $('#btn-more').onclick = (e) => {
    const old = $('#menu'); if (old) { old.remove(); return; }
    const imp = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => imp.files[0] && importProject(imp.files[0]) });
    const item = (ic, label, fn) => h('button', { html: icon(ic) + `<span>${label}</span>`, onclick: () => { m.remove(); fn(); } });
    const m = h('div', { id: 'menu', class: 'popover menu' },
      item('eye', 'Ver página publicada', () => (S.doc.publishedAt ? window.open(`${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}`, '_blank') : toast('Esta página ainda não foi publicada.', 'err'))),
      item('stack', 'Meu inventário', () => openInventory()),
      item('download', 'Exportar projeto (.json)', exportProject),
      item('upload', 'Importar projeto…', () => imp.click()), imp,
      h('hr'),
      item('x', 'Sair', () => { logout(); location.href = '../'; }));
    document.body.append(m);
    const r = e.currentTarget.getBoundingClientRect();
    Object.assign(m.style, { top: r.bottom + 6 + 'px', right: innerWidth - r.right + 'px' });
    setTimeout(() => document.addEventListener('pointerdown', function away(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
  };
}

// ---------- atalhos ----------
const typing = (t) => t && (t.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]'));

function wireKeys() {
  const vp = $('#viewport');
  document.addEventListener('keydown', (e) => {
    if (typing(e.target) || S.editing) return;
    if (document.querySelector('.modal-back,.pv-back')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

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
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; vp.classList.remove('panning'); } });

  // colar: imagem, código SVG ou elementos copiados
  document.addEventListener('paste', async (e) => {
    if (typing(e.target) || S.editing) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain') || '';
    if (files.length) { e.preventDefault(); for (const f of files) await insertImageFile(f); }
    else if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) { e.preventDefault(); insertSvg(text, 'SVG colado'); }
    else if (paste()) e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && S.doc) saveNow(); });
}

main().catch((e) => { console.error(e); document.body.prepend(h('pre', { style: { color: '#f66', padding: '16px', whiteSpace: 'pre-wrap' } }, 'Erro ao iniciar o editor:\n' + (e?.stack || e))); });
