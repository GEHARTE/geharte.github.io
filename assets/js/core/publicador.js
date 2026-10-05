// Cliente do PUBLICADOR (publicador/): o editor manda a página para o servidor, que grava no GitHub no lugar da pessoa.
// A pessoa só confirma com o Google (token de acesso "openid email", ~1 h, guardado só na aba); nada de token do GitHub.
// O corpo vai como text/plain (pedido "simples": sem preflight de CORS, e é o que o Google Apps Script aceita).
import { gsiRequestToken } from './drive.js';

export const PUB_SCOPE = 'openid email';
const REFAZER = ['token_invalido', 'token_expirado', 'sem_token', 'token_de_outro_app'];
// Falhas de TRANSPORTE (sem resposta legível). O Google Apps Script, de vez em quando, executa o pedido e devolve uma página de erro
// no lugar do JSON; por isso o cliente tenta de novo — e o servidor reconhece o reenvio pelo mesmo `pedidoId` (não commita duas vezes).
const TRANSPORTE = ['rede', 'resposta'];
const PAUSAS = [600, 1500, 3000];   // 4 tentativas: com ~30% de falha por chamada (medido), a chance de falhar em todas é ~1%
const novoId = () => (globalThis.crypto?.randomUUID?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

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
  espera = (ms) => new Promise((r) => setTimeout(r, ms)),
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

  // tenta de novo só em falha de transporte (3 tentativas); erro de regra do servidor (401, 403, 409…) sobe na hora
  async function comRetentativa(corpo) {
    let ultimo;
    for (let i = 0; i <= PAUSAS.length; i++) {
      try { return await chamar(corpo); }
      catch (e) { if (!TRANSPORTE.includes(e.codigo)) throw e; ultimo = e; if (i < PAUSAS.length) await espera(PAUSAS[i]); }
    }
    throw ultimo;
  }

  return {
    confirmar,
    esquecer: () => guarda(null),
    isConfirmado: valido,
    // alvo = { kind, id? (artigo), pageId? (página do site) } → { usuario, dir, atual, existentes }
    preparar: (alvo) => comRetentativa({ ...alvo, acao: 'preparar' }),
    // { ...alvo, page, assets: {id:{ext,data}}, baseAt, force } → { commit, publishedAt, publishedBy, ... }
    // O mesmo `pedidoId` vai em todas as tentativas: se a 1ª foi executada e só a resposta se perdeu, o servidor devolve o resultado (repetido:true).
    publicar: (pedido) => comRetentativa({ ...pedido, acao: 'publicar', pedidoId: novoId() }),
  };
}
