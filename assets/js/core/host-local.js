// Host LOCAL: o ArtAtk sozinho. Sem login, sem Google, sem GitHub: os documentos e as imagens ficam neste navegador
// e saem por "Exportar projeto (.json)". É o modo para desenvolver, testar e usar o editor antes de qualquer integração.
// Ativa-se com "host": "local" no config.json do site.
import { BASE } from './util.js';

export function criarHostLocal(cfg = {}) {
  return {
    id: 'local',
    marca: { nome: cfg.marca?.nome || 'ArtAtk', editor: 'ArtAtk' },
    capacidades: { drive: false, publicar: false, paginasDoSite: false, perfisDaEquipe: false, modelos: true },
    identidade: async () => ({ slug: 'local', nome: cfg.nomeLocal || 'Você', perfil: 'completo', podeSite: false }),
    entrar() { /* sempre "logado" */ },
    sair: null,
    urls: { documentos: BASE + 'arquivos/', inicio: BASE + 'arquivos/' },
  };
}
