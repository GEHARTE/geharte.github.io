// Inventário: a pasta pessoal de páginas do usuário no editor (guardadas neste navegador).
// Cada página tem um tipo (perfil | artigo) e um estado (só no inventário | publicada | publicada com alterações).
import { h } from '../core/dom.js';
import { Store } from '../core/store.js';
import { makeElement, newDoc, KINDS, PROFILE_ID, STATE_LABEL, docState, publishDir, slugify } from '../core/model.js';
import { clone } from '../core/util.js';
import { S, saveNow } from './state.js';
import { btn, modal, toast } from './ui.js';

const lastKey = (slug) => `geharte.lastdoc.${slug}`;
export const rememberDoc = (slug, id) => { try { localStorage.setItem(lastKey(slug), id); } catch { /* sem storage */ } };
export const lastDocId = (slug) => { try { return localStorage.getItem(lastKey(slug)); } catch { return null; } };

// Caminho que o usuário vê na barra de arquivo: o publicado, ou "inventário/<id>" quando só local.
export const docPath = (slug, doc) => (doc.publishedAt ? `${publishDir(slug, doc)}page.json` : `inventário/${doc.id}`);

// Troca de página = recarrega o editor com ?doc=<id> (estado limpo, histórico novo).
export async function goToDoc(id) {
  try { await saveNow(); } catch { /* segue mesmo assim */ }
  rememberDoc(S.slug, id);
  location.href = `${location.pathname}?doc=${encodeURIComponent(id)}`;
}

// ---------- modelo inicial de artigo ----------
function T(name, text, s, d, m) {
  const e = makeElement('text', { name, text, s }, { x: d[0], y: d[1], w: d[2], h: d[3] });
  e.f.m = { x: m[0], y: m[1], w: m[2], h: m[3], r: 0, fs: m[4] };
  return e;
}
export function starterArticle(doc) {
  doc.page = { bg: { c: '#f6f1e6', g: null }, h: { d: 1300, m: 1500 } };
  doc.elements = [
    T('Rótulo', 'ARTIGO', { fontFamily: 'Inter', fontSize: 14, fontWeight: 700, upper: true, ls: 0.22, color: '#8a4b2a', lh: 1.2 }, [250, 110, 700, 18], [24, 60, 342, 16, 12]),
    T('Título', doc.title, { fontFamily: 'Playfair Display', fontSize: 58, fontWeight: 700, color: '#1c1a17', lh: 1.08, ls: -0.01 }, [250, 140, 700, 130], [24, 86, 342, 100, 34]),
    T('Autoria', 'por [seu nome] · [data]', { fontFamily: 'Inter', fontSize: 16, color: '#6a6458', lh: 1.4 }, [250, 300, 700, 24], [24, 200, 342, 20, 14]),
    T('Resumo', 'Escreva aqui um resumo de duas ou três linhas: o que este artigo discute e por que importa.', { fontFamily: 'Lora', fontSize: 24, italic: true, color: '#3a362e', lh: 1.5 }, [250, 360, 700, 120], [24, 250, 342, 140, 18]),
    T('Texto', 'Comece o texto aqui. Clique duas vezes para editar, arraste as bordas para mudar a largura e use o painel da direita para fonte, tamanho e cor.', { fontFamily: 'Lora', fontSize: 20, color: '#1c1a17', lh: 1.75 }, [250, 520, 700, 400], [24, 420, 342, 500, 16]),
  ];
  return doc;
}

const freeId = (base, docs) => {
  const taken = new Set(docs.map((d) => d.id));
  let id = base;
  for (let i = 2; taken.has(id) || id === PROFILE_ID; i++) id = `${base}-${i}`;
  return id;
};

// Cria uma página nova no inventário e abre.
export async function createDoc(kind, title) {
  const owner = S.slug;
  const docs = await Store.listDocs(owner);
  if (kind === 'perfil' && docs.some((d) => d.id === PROFILE_ID)) throw new Error('Você já tem uma página de perfil no inventário.');
  const id = kind === 'perfil' ? PROFILE_ID : freeId(slugify(title), docs);
  const doc = newDoc(owner, title, kind, id);
  if (kind === 'artigo') starterArticle(doc);
  await Store.saveDoc(owner, doc);
  await goToDoc(id);
}

async function duplicate(rec) {
  const docs = await Store.listDocs(S.slug);
  const copy = clone(rec.doc);
  copy.kind = 'artigo';                          // só pode haver uma página de perfil; cópias viram artigos
  copy.id = freeId(slugify(`${rec.doc.title} copia`), docs);
  copy.title = `${rec.doc.title} (cópia)`;
  delete copy.publishedAt;
  await Store.saveDoc(S.slug, copy);
  toast('Página duplicada como artigo.', 'ok');
}

// ---------- chips ----------
export const kindChip = (kind) => h('span', { class: `chip kind-${kind}` }, KINDS[kind]);
export const stateChip = (state) => h('span', { class: `chip st-${state}` }, STATE_LABEL[state]);

const fmtDate = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- diálogos ----------
let known = [];   // documentos do inventário na última renderização

function askNew() {
  const hasProfile = known.some((d) => d.id === PROFILE_ID);
  let kind = 'artigo';
  const title = h('input', { type: 'text', value: 'Novo artigo', maxlength: 80, 'aria-label': 'Título da página' });
  const opt = (k, desc, disabled) => {
    const r = h('input', { type: 'radio', name: 'kind', value: k, checked: k === kind, disabled, onchange: () => { kind = k; title.value = k === 'artigo' ? 'Novo artigo' : 'Minha página'; } });
    return h('label', { class: 'kindopt' + (disabled ? ' off' : '') }, r, h('span', {}, h('b', {}, KINDS[k]), h('small', {}, desc)));
  };
  const go = btn({ label: 'Criar e abrir', cls: 'primary', onClick: async () => {
    const t = title.value.trim() || (kind === 'artigo' ? 'Novo artigo' : 'Minha página');
    go.disabled = true;
    try { await createDoc(kind, t); } catch (e) { toast(e.message, 'err'); go.disabled = false; }
  } });
  const m = modal({ title: 'Nova página', body: [
    h('div', { class: 'kindopts' },
      opt('artigo', 'Texto, imagens e animações — vai para a seção Artigos do blog.', false),
      opt('perfil', hasProfile ? 'Você já tem uma página de perfil.' : 'A página do seu perfil na equipe (só uma por pessoa).', hasProfile)),
    h('label', { class: 'fld' }, h('span', { class: 'fl' }, 'Título'), title),
  ], actions: [go] });
  setTimeout(() => { title.focus(); title.select(); }, 30);
  return m;
}

function askDelete(rec, done) {
  const m = modal({ title: 'Excluir página?', body: [
    h('p', {}, `“${rec.doc.title || 'sem título'}” será removida do seu inventário, neste navegador.`),
    h('p', { class: 'hint' }, rec.doc.publishedAt ? 'A versão publicada no site não é afetada. Isto não pode ser desfeito.' : 'Esta página nunca foi publicada: não há outra cópia. Isto não pode ser desfeito.'),
  ], actions: [
    btn({ label: 'Cancelar', onClick: () => m.close() }),
    btn({ label: 'Excluir', cls: 'danger', onClick: async () => { if (rec.id === S.doc.id) S.deleted = true; await Store.deleteDoc(S.slug, rec.id); m.close(); done(); } }),
  ] });
}

// ---------- inventário ----------
export async function openInventory() {
  await saveNow();                                   // o cartão da página aberta reflete o que está na tela
  const grid = h('div', { class: 'inv-grid' });
  const info = h('p', { class: 'hint' });
  const m = modal({ title: 'Meu inventário', wide: true, body: [
    h('p', { class: 'hint' }, 'Todas as páginas que você criou aqui ficam guardadas neste navegador. “Publicar” leva uma delas ao site.'),
    grid, info,
  ], actions: [btn({ label: '+ Nova página', cls: 'primary', onClick: () => askNew() })] });
  m.el.querySelector('.modal').classList.add('inv');

  async function render() {
    const docs = await Store.listDocs(S.slug);
    known = docs;
    grid.innerHTML = '';
    info.textContent = docs.length ? `${docs.length} página${docs.length > 1 ? 's' : ''} no inventário.` : 'Seu inventário está vazio.';
    for (const rec of docs) {
      const cur = rec.id === S.doc.id;
      const state = docState(rec.doc, rec.updatedAt, cur && S.changed);
      grid.append(h('article', { class: 'inv-card' + (cur ? ' cur' : ''), 'data-id': rec.id },
        h('header', {}, h('h3', {}, rec.doc.title?.trim() || 'sem título'), cur ? h('span', { class: 'now' }, 'aberta agora') : null),
        h('div', { class: 'chips' }, kindChip(rec.doc.kind), stateChip(state)),
        h('p', { class: 'meta' }, `Editada em ${fmtDate(rec.updatedAt)}`),
        h('p', { class: 'path' }, docPath(S.slug, rec.doc)),
        h('footer', {},
          btn({ label: 'Abrir', ic: 'chevR', cls: 'sm', disabled: cur, onClick: () => goToDoc(rec.id) }),
          btn({ label: 'Duplicar', ic: 'copy', cls: 'sm', onClick: async () => { await duplicate(rec); render(); } }),
          btn({ label: 'Excluir', ic: 'trash', cls: 'sm', onClick: () => askDelete(rec, async () => {
            if (!cur) { render(); return; }
            const rest = await Store.listDocs(S.slug);
            rememberDoc(S.slug, rest[0]?.id || '');
            location.href = rest[0] ? `${location.pathname}?doc=${encodeURIComponent(rest[0].id)}` : location.pathname;
          }) }))));
    }
  }
  await render();
  return m;
}
