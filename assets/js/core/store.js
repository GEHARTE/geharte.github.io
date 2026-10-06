// Rascunhos locais (IndexedDB): o inventário do usuário (várias páginas) e as imagens enviadas.
//
// Registro de documento: { slug: "<dono>:<id>", owner, id, doc, updatedAt }
//   (o campo "slug" é o keyPath do banco; o nome ficou do esquema original, quando havia 1 doc por usuário)
// Registro legado (1 doc por usuário): chave só "<dono>" — é migrado para "<dono>:perfil" no primeiro acesso.
import { normalizeDoc, PROFILE_ID } from './model.js';

const DB = 'gehrarte-v1';
// Nome antigo do banco (antes da renomeação para Gehrarte, REQ-RN). Se ele existir, seu conteúdo é copiado para o novo
// na abertura e só então o antigo é apagado; se a cópia falhar o antigo fica intacto e a cópia é tentada de novo.
const DB_ANTIGO = 'geharte-v1';
let dbp;

// Lê tudo do banco antigo. Devolve null se ele não existe (abrir um banco inexistente dispara onupgradeneeded: aborta,
// o que desfaz a criação) ou se não dá para lê-lo.
function lerAntigo() {
  return new Promise((res) => {
    let r;
    try { r = indexedDB.open(DB_ANTIGO); } catch { res(null); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch { /* sem transação */ } };
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs') || !db.objectStoreNames.contains('assets')) { db.close(); res(null); return; }
      const t = db.transaction(['docs', 'assets'], 'readonly');
      const docs = t.objectStore('docs').getAll();
      const assets = t.objectStore('assets').getAll();
      t.oncomplete = () => { db.close(); res({ docs: docs.result, assets: assets.result }); };
      t.onerror = t.onabort = () => { db.close(); res(null); };
    };
  });
}

// Copia o que ainda não existe no banco novo (nunca sobrescreve) e confere a contagem antes de apagar o antigo.
async function copiarDoAntigo(db) {
  const antigo = await lerAntigo();
  if (!antigo) return;
  await new Promise((res, rej) => {
    const t = db.transaction(['docs', 'assets'], 'readwrite');
    const poe = (nome, regs, chave) => {
      const s = t.objectStore(nome);
      for (const rec of regs) { const g = s.getKey(rec[chave]); g.onsuccess = () => { if (g.result === undefined) s.put(rec); }; }
    };
    poe('docs', antigo.docs, 'slug');
    poe('assets', antigo.assets, 'key');
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error);
  });
  const conta = (nome) => new Promise((res, rej) => { const q = db.transaction(nome, 'readonly').objectStore(nome).count(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  if ((await conta('docs')) < antigo.docs.length || (await conta('assets')) < antigo.assets.length) throw new Error('cópia incompleta');
  indexedDB.deleteDatabase(DB_ANTIGO);
}

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('docs', { keyPath: 'slug' });
      db.createObjectStore('assets', { keyPath: 'key' }).createIndex('slug', 'slug');
    };
    r.onsuccess = async () => {
      try { await copiarDoAntigo(r.result); } catch { /* o banco antigo fica onde está; tenta de novo na próxima abertura */ }
      res(r.result);
    };
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const tx = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

const key = (owner, id) => `${owner}:${id}`;
const fromRecord = (r) => ({ owner: r.owner, id: r.id, doc: r.doc, updatedAt: r.updatedAt });

// Migra o registro legado do dono (chave sem ":") para "<dono>:perfil". Idempotente.
const migrated = new Set();
async function migrate(owner) {
  if (migrated.has(owner)) return;
  const old = await tx('docs', 'readonly', (s) => s.get(owner));
  if (old && old.doc) {
    const doc = normalizeDoc(old.doc, owner);
    await tx('docs', 'readwrite', (s) => {
      const k = key(owner, PROFILE_ID);
      const g = s.get(k);
      g.onsuccess = () => { if (!g.result) s.put({ slug: k, owner, id: PROFILE_ID, doc, updatedAt: old.updatedAt || Date.now() }); };
      s.delete(owner);
    });
  }
  migrated.add(owner);
}

export const Store = {
  // Grava o documento (usa doc.id). opts.updatedAt força o carimbo (ex.: logo após publicar). Devolve o carimbo gravado.
  async saveDoc(owner, doc, opts = {}) {
    await migrate(owner);
    normalizeDoc(doc, owner);
    const updatedAt = opts.updatedAt ?? Date.now();
    await tx('docs', 'readwrite', (s) => s.put({ slug: key(owner, doc.id), owner, id: doc.id, doc, updatedAt }));
    return updatedAt;
  },
  async loadDoc(owner, id = PROFILE_ID) {
    await migrate(owner);
    const r = await tx('docs', 'readonly', (s) => s.get(key(owner, id)));
    return r?.doc ? normalizeDoc(r.doc, owner) : null;
  },
  async docMeta(owner, id = PROFILE_ID) {
    await migrate(owner);
    const r = await tx('docs', 'readonly', (s) => s.get(key(owner, id)));
    return r ? { updatedAt: r.updatedAt } : null;
  },
  // Inventário: todos os documentos do dono, mais recentes primeiro.
  async listDocs(owner) {
    await migrate(owner);
    const all = await tx('docs', 'readonly', (s) => s.getAll());
    return all.filter((r) => r.owner === owner && r.doc).map(fromRecord).map((r) => ({ ...r, doc: normalizeDoc(r.doc, owner) })).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async deleteDoc(owner, id) {
    await migrate(owner);
    await tx('docs', 'readwrite', (s) => s.delete(key(owner, id)));
  },
  putAsset: (slug, id, blob, meta) => tx('assets', 'readwrite', (s) => s.put({ key: `${slug}/${id}`, slug, id, blob, meta })),
  getAsset: (slug, id) => tx('assets', 'readonly', (s) => s.get(`${slug}/${id}`)),
  listAssets: (slug) => tx('assets', 'readonly', (s) => s.index('slug').getAll(slug)),
};
