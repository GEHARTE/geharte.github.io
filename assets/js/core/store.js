// Rascunhos locais (IndexedDB): o inventário do usuário (várias páginas) e as imagens enviadas.
//
// Registro de documento: { slug: "<dono>:<id>", owner, id, doc, updatedAt }
//   (o campo "slug" é o keyPath do banco; o nome ficou do esquema original, quando havia 1 doc por usuário)
// Registro legado (1 doc por usuário): chave só "<dono>" — é migrado para "<dono>:perfil" no primeiro acesso.
import { normalizeDoc, PROFILE_ID } from './model.js';

const DB = 'geharte-v1';
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('docs', { keyPath: 'slug' });
      db.createObjectStore('assets', { keyPath: 'key' }).createIndex('slug', 'slug');
    };
    r.onsuccess = () => res(r.result);
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
