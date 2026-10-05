// Cliente do PUBLICADOR (publicador/): o editor manda a página para o servidor, que grava no GitHub no lugar da pessoa.
// A pessoa só confirma com o Google (token de acesso "openid email", ~1 h, guardado só na aba); nada de token do GitHub.
// O corpo vai como text/plain (pedido "simples": sem preflight de CORS, e é o que o Google Apps Script aceita).
import { gsiRequestToken } from './drive.js';

export const PUB_SCOPE = 'openid email';
const REFAZER = ['token_invalido', 'token_expirado', 'sem_token', 'token_de_outro_app'];

export class PublicadorErro extends Error {
  constructor(message, codigo = '', extra = {}) { super(message); this.name = 'PublicadorErro'; this.codigo = codigo; this.extra = extra; }
}

const safe = (get) => { try { return get(); } catch { return null; } };
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

export function createPublicador({
  url, clientId, slug = '',
  requestToken = gsiRequestToken,
  fetchImpl = (...a) => fetch(...a),
  session = safe(() => sessionStorage) || memStore(),
  now = () => Date.now(),
} = {}) {
  const K = `geharte.pub.token.${slug}`;
  let tok = safe(() => JSON.parse(session.getItem(K) || 'null'));
  const valido = () => !!tok && tok.exp > now() + 60e3;
  const guarda = (t) => { tok = t; if (t) session.setItem(K, JSON.stringify(t)); else session.removeItem(K); };

  // Pede a confirmação ao Google se ainda não houver uma válida. Chame de um CLIQUE (abre a janelinha do Google).
  async function confirmar() {
    if (valido()) return tok.access_token;
    if (!url) throw new PublicadorErro('O publicador ainda não foi configurado neste site.', 'sem_url');
    const r = await requestToken({ clientId, scope: PUB_SCOPE });
    guarda({ access_token: r.access_token, exp: now() + (Number(r.expires_in) || 3600) * 1000 });
    return tok.access_token;
  }

  async function chamar(corpo) {
    const accessToken = await confirmar();
    let r;
    try { r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...corpo, accessToken }) }); }
    catch { throw new PublicadorErro('Não consegui falar com o publicador. Verifique a conexão e tente de novo.', 'rede'); }
    let j;
    try { j = await r.json(); } catch { throw new PublicadorErro('O publicador respondeu algo inesperado. Tente de novo em instantes.', 'resposta'); }
    if (!j || j.ok !== true) {
      if (REFAZER.includes(j?.codigo)) guarda(null);
      throw new PublicadorErro(j?.erro || 'O publicador recusou o pedido.', j?.codigo || 'erro', j || {});
    }
    return j;
  }

  return {
    confirmar,
    esquecer: () => guarda(null),
    isConfirmado: valido,
    // alvo = { kind, id? (artigo), pageId? (página do site) } → { usuario, dir, atual, existentes }
    preparar: (alvo) => chamar({ ...alvo, acao: 'preparar' }),
    // { ...alvo, page, assets: {id:{ext,data}}, baseAt, force } → { commit, publishedAt, publishedBy, ... }
    publicar: (pedido) => chamar({ ...pedido, acao: 'publicar' }),
  };
}
