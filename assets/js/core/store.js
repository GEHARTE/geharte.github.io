// Rascunhos locais (IndexedDB): o documento e as imagens enviadas, por usuário.
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
  });
};

export const Store = {
  saveDoc: (slug, doc) => tx('docs', 'readwrite', (s) => s.put({ slug, doc, updatedAt: Date.now() })),
  loadDoc: async (slug) => (await tx('docs', 'readonly', (s) => s.get(slug)))?.doc || null,
  docMeta: async (slug) => { const r = await tx('docs', 'readonly', (s) => s.get(slug)); return r ? { updatedAt: r.updatedAt } : null; },
  putAsset: (slug, id, blob, meta) => tx('assets', 'readwrite', (s) => s.put({ key: `${slug}/${id}`, slug, id, blob, meta })),
  getAsset: (slug, id) => tx('assets', 'readonly', (s) => s.get(`${slug}/${id}`)),
  listAssets: (slug) => tx('assets', 'readonly', (s) => s.index('slug').getAll(slug)),
};
