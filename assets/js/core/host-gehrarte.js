// Host do GEHRARTE: o comportamento que o editor sempre teve (login Google + users.json, Publicar pelo Publicador,
// Drive, páginas do site, perfis da equipe), agora atrás do contrato `host` (core/host.js).
import { BASE } from './util.js';
import { session, logout, loadUsers } from './auth.js';
import { canEditSite } from './site.js';

export function criarHostGehrarte(cfg = {}) {
  return {
    id: 'gehrarte',
    marca: { nome: 'Gehrarte', editor: 'ArtAtk' },
    // config.json "publicar": false = modo teste (nada vai ao GitHub; tudo fica neste computador)
    capacidades: { drive: true, publicar: cfg.publicar !== false, paginasDoSite: true, perfisDaEquipe: true, modelos: true },
    async identidade() {
      const s = session();
      if (!s) return null;
      const u = (await loadUsers().catch(() => [])).find((x) => x.slug === s.slug);
      return { slug: s.slug, nome: s.nome, perfil: 'completo', podeSite: canEditSite(u) };
    },
    entrar(proximo = 'documentos/') { location.replace(`${BASE}login.html?next=${proximo}`); },
    sair() { logout(); location.href = BASE; },
    urls: { documentos: BASE + 'documentos/', inicio: BASE },
  };
}
