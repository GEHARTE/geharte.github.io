// Migração das chaves do navegador do nome antigo ("geharte.*") para o oficial ("gehrarte.*") — requisito RN-04.
// Regras: copia a chave antiga para a nova SÓ se a nova ainda não existe (nunca sobrescreve) e só então apaga a antiga.
// As chaves do token do GitHub (ghtoken/repo/branch) morreram com o Publicador sem token: são apagadas, não copiadas.
// Roda uma vez por página ao importar este módulo; é idempotente e nunca lança (sem armazenamento = não faz nada).
// O banco do IndexedDB ("geharte-v1", core/store.js) NÃO é renomeado de propósito: não existe "renomear" em IndexedDB e
// recriar exigiria copiar todas as páginas e imagens; o nome é interno e invisível.
export const PREFIXO_ANTIGO = 'geharte.';
export const PREFIXO_NOVO = 'gehrarte.';
const MORTAS = ['ghtoken', 'repo', 'branch'].map((k) => PREFIXO_ANTIGO + k);

export function migrarStorage(storage) {
  const r = { copiadas: 0, apagadas: 0 };
  try {
    const chaves = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIXO_ANTIGO)) chaves.push(k); }
    for (const k of chaves) {
      const nova = PREFIXO_NOVO + k.slice(PREFIXO_ANTIGO.length);
      if (!MORTAS.includes(k) && storage.getItem(nova) === null) { storage.setItem(nova, storage.getItem(k)); r.copiadas++; }
      storage.removeItem(k); r.apagadas++;
    }
  } catch { /* cheio, bloqueado ou indisponível: segue sem migrar */ }
  return r;
}

export function migrarChaves() {
  const out = [];
  for (const nome of ['localStorage', 'sessionStorage']) { let s = null; try { s = globalThis[nome]; } catch { /* bloqueado */ } if (s) out.push(migrarStorage(s)); }
  return out;
}

migrarChaves();
