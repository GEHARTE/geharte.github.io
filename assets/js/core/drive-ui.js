// Liga o cliente do Drive (core/drive.js) ao resto do site: Client ID do config.json e conferência da conta
// com o e-mail liberado em users.json. Compartilhado pelo editor (aba Drive) e pelo painel de documentos.
import { createDrive } from './drive.js';
import { loadConfig, loadUsers, hashEmail } from './auth.js';

const cache = new Map();

// Devolve o cliente do Drive da pessoa (um por slug). drive.connectAs() abre a janela do Google — chame de um clique.
export function getDrive(slug) {
  if (!cache.has(slug)) {
    cache.set(slug, (async () => {
      const [cfg, users] = await Promise.all([loadConfig(), loadUsers()]);
      const drive = createDrive({ clientId: cfg.googleClientId, slug });
      const expectedHash = users.find((u) => u.slug === slug)?.emailHash;
      drive.connectAs = () => {
        if (!window.isSecureContext) throw new Error('O Drive só funciona em https (ou localhost).');
        return drive.connect({ expectedHash, hashEmail });
      };
      return drive;
    })());
  }
  return cache.get(slug);
}

// Envia vários arquivos em sequência. onItem(i, { nome, progresso, estado: 'enviando'|'ok'|'erro', erro }) a cada mudança.
export async function uploadAll(drive, files, onItem = () => {}) {
  const ok = [];
  for (const [i, f] of [...files].entries()) {
    onItem(i, { nome: f.name, progresso: 0, estado: 'enviando' });
    try {
      const r = await drive.upload(f, { onProgress: (p) => onItem(i, { nome: f.name, progresso: p, estado: 'enviando' }) });
      onItem(i, { nome: f.name, progresso: 1, estado: 'ok' });
      ok.push(r);
    } catch (e) { onItem(i, { nome: f.name, progresso: 0, estado: 'erro', erro: e.message }); }
  }
  return ok;
}
