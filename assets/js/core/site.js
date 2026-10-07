// Páginas do SITE (landing, home…): o registro em paginas.json, quem pode mexer nelas e a versão publicada.
// Compartilhado pelo painel de arquivos, pelo editor e pelas páginas públicas que mostram o que foi publicado.
import { BASE } from './util.js';
import { siteDocId, viewerQuery } from './model.js';

export const getJson = async (p) => {
  try { const r = await fetch(BASE + p, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
};

// paginas.json: [{ id, titulo, funcao, caminho, modelo }]. "caminho" é o arquivo do site que o artista vê no cartão;
// os dados editáveis ficam em paginas/<id>/page.json (publicado) e paginas/<id>/modelo.json (ponto de partida).
export async function loadRegistry() {
  const j = await getJson('paginas.json');
  return (j?.paginas || []).filter((p) => /^[a-z0-9-]+$/.test(p.id || ''));
}
export const registryEntry = async (pageId) => (await loadRegistry()).find((p) => p.id === pageId) || null;

export const pageDir = (pageId) => `paginas/${pageId}/`;
export const pageDocId = siteDocId;

// Quem pode editar as páginas do site: usuários com "site" em `funcoes` no users.json.
// É só a porta da interface (users.json é público): quem realmente pode publicar é quem tem o token do repositório.
export const canEditSite = (user) => !!user?.funcoes?.includes('site');

// Versão publicada (a que o site está mostrando) e o modelo inicial. null se não existir.
export async function fetchPublished(pageId) {
  const doc = await getJson(`${pageDir(pageId)}page.json`);
  return doc?.publishedAt ? doc : null;
}
export const fetchModel = (pageId) => getJson(`${pageDir(pageId)}modelo.json`);

// URL pública de um caminho do site ("home/", "index.html"…), a partir do config.json (siteUrl).
export function publicUrl(cfg, caminho = '') {
  const base = String(cfg?.siteUrl || BASE).replace(/\/+$/, '');
  const c = String(caminho).replace(/^\/+/, '').replace(/index\.html$/, '');
  return c ? `${base}/${c}` : `${base}/`;
}
export const siteHost = (cfg) => { try { return new URL(cfg?.siteUrl || BASE).host; } catch { return ''; } };

// Endereço público de uma página publicada: perfil/artigo pelo visualizador, página do site no caminho dela.
export function publishedUrl(cfg, slug, doc, entry) {
  if (doc.kind === 'pagina') return publicUrl(cfg, entry?.caminho || '');
  return publicUrl(cfg, `perfil.html?${viewerQuery(slug, doc)}`);
}
