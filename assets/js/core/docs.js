// Operações sobre os documentos do usuário (o "inventário" no navegador), sem depender do estado do editor:
// usadas pelo painel de documentos e pelo editor. Criar, duplicar, achar id livre e preparar as páginas do site.
import { Store } from './store.js';
import { makeElement, newDoc, normalizeDoc, PROFILE_ID, SITE_PREFIX, isSiteId, siteDocId, publishDir, slugify } from './model.js';
import { clone } from './util.js';
import { fetchPublished, fetchModel } from './site.js';

// Caminho que o usuário vê: o publicado, ou "inventário/<id>" quando só local.
export const docPath = (slug, doc) => (doc.publishedAt ? `${publishDir(slug, doc)}page.json` : `inventário/${doc.id}`);

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

// id livre para um artigo novo (nunca "perfil" nem começando com "site-", reservados)
export const freeId = (base, docs) => {
  const taken = new Set(docs.map((d) => d.id));
  const b = isSiteId(base) ? `artigo-${base}` : base;
  let id = b;
  for (let i = 2; taken.has(id) || id === PROFILE_ID; i++) id = `${b}-${i}`;
  return id;
};

// Cria uma página (perfil ou artigo) no inventário e devolve o id. Páginas do site vêm de prepareSiteDoc.
export async function createDoc(owner, kind, title) {
  const docs = await Store.listDocs(owner);
  if (kind === 'perfil' && docs.some((d) => d.id === PROFILE_ID)) throw new Error('Você já tem uma página de perfil.');
  const id = kind === 'perfil' ? PROFILE_ID : freeId(slugify(title), docs);
  const doc = newDoc(owner, title, kind, id);
  if (kind === 'artigo') starterArticle(doc);
  await Store.saveDoc(owner, doc);
  return id;
}

// A cópia vira sempre artigo: só pode haver um perfil por pessoa e as páginas do site são únicas.
export async function duplicateDoc(owner, rec) {
  const docs = await Store.listDocs(owner);
  const copy = clone(rec.doc);
  copy.kind = 'artigo';
  copy.id = freeId(slugify(`${rec.doc.title} copia`), docs);
  copy.title = `${rec.doc.title} (cópia)`;
  delete copy.publishedAt; delete copy.publishedBy;
  await Store.saveDoc(owner, copy);
  return copy.id;
}

// ---------- páginas do site ----------
// Escolhe o que abrir no editor para uma página do site, comparando o rascunho local com a versão publicada:
//   sem rascunho            → a versão publicada, ou (nunca publicada) o modelo inicial
//   rascunho em dia          → o rascunho
//   publicaram algo mais novo e o rascunho não tem edições → a versão publicada (atualiza em silêncio)
//   publicaram algo mais novo e há edições locais → { conflict } (o editor pergunta; depois chama de novo com keepLocal)
export async function prepareSiteDoc(owner, pageId, { keepLocal } = {}) {
  const id = siteDocId(pageId);
  const [local, remote] = await Promise.all([Store.listDocs(owner).then((l) => l.find((d) => d.id === id) || null), fetchPublished(pageId)]);

  const fromRemote = async () => {
    const doc = normalizeDoc(clone(remote), owner);
    Object.assign(doc, { kind: 'pagina', id, owner });
    const updatedAt = Date.parse(remote.publishedAt) || Date.now();
    await Store.saveDoc(owner, doc, { updatedAt });
    return { doc, updatedAt, origem: 'publicada' };
  };

  if (!local) {
    if (remote) return fromRemote();
    const model = await fetchModel(pageId);
    const doc = normalizeDoc(model ? clone(model) : newDoc(owner, 'Página do site', 'pagina', id), owner);
    Object.assign(doc, { kind: 'pagina', id, owner });
    const updatedAt = await Store.saveDoc(owner, doc);
    return { doc, updatedAt, origem: 'modelo' };
  }

  const pubAt = (d) => Date.parse(d?.publishedAt || '') || 0;
  const newer = remote && pubAt(remote) > pubAt(local.doc);
  if (!newer) return { doc: local.doc, updatedAt: local.updatedAt, origem: 'rascunho' };
  const dirty = local.updatedAt > pubAt(local.doc);
  if (!dirty || keepLocal === false) return fromRemote();
  if (keepLocal === true) return { doc: local.doc, updatedAt: local.updatedAt, origem: 'rascunho' };
  return { conflict: { local, remote } };
}
