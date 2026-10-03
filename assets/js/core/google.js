// Verificação de um ID token do "Entrar com Google" (Google Identity Services).
// Confere assinatura (RS256 contra as chaves públicas do Google), emissor, público (nosso Client ID),
// validade e e-mail verificado. Roda no navegador — ver aviso em auth.js: é a "porta" da interface;
// a verificação de verdade, que não dá para burlar, virá do servidor (VPS) mais adiante.
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const parse = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

let jwksCache = null;
async function defaultJwks() {
  if (jwksCache && jwksCache.t > Date.now() - 36e5) return jwksCache.v;
  const r = await fetch(GOOGLE_JWKS_URL);
  if (!r.ok) throw new Error('Não consegui buscar as chaves do Google.');
  jwksCache = { v: await r.json(), t: Date.now() };
  return jwksCache.v;
}

export async function verifyGoogleIdToken(token, clientId, { getJwks = defaultJwks, now = Date.now() } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('Login com Google exige https (ou localhost).');
  if (!clientId) throw new Error('Login com Google ainda não foi configurado.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Token inválido.');
  const [h, p, sig] = parts;
  let header, pl;
  try { header = parse(h); pl = parse(p); } catch { throw new Error('Token inválido.'); }
  if (header.alg !== 'RS256') throw new Error('Algoritmo de token não aceito.');
  if (!ISSUERS.includes(pl.iss)) throw new Error('Token de emissor desconhecido.');
  if (pl.aud !== clientId) throw new Error('Token emitido para outro aplicativo.');
  if (!(pl.exp * 1000 > now - 60e3)) throw new Error('Token expirado. Tente entrar de novo.');
  if (pl.email_verified !== true) throw new Error('O e-mail do Google não está verificado.');
  const jwk = (await getJwks()).keys?.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Chave de assinatura desconhecida.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Assinatura do token inválida.');
  return pl;   // { email, name, sub, ... }
}
