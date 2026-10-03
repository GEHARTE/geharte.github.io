// Login estático. IMPORTANTE: isto é uma "porta" de interface, não segurança real.
// users.json é público (só guarda hashes PBKDF2). Quem de fato protege a publicação
// é a permissão de escrita no repositório (token do GitHub) — ver README.
import { BASE } from './util.js';
import { pbkdf2Sha256 } from './sha.js';
import { verifyGoogleIdToken } from './google.js';
import { sha256Hex } from './util.js';

const SKEY = 'geharte.session';
const DAYS = 7;
const enc = new TextEncoder();
const b64ToBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function loadUsers() {
  const r = await fetch(BASE + 'users.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Não consegui carregar a lista de usuários.');
  return r.json();
}

export async function hashPassword(password, saltB64, iterations) {
  // crypto.subtle só existe em contexto seguro (https/localhost); fora dele usa o fallback em JS
  if (globalThis.crypto?.subtle) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64), iterations }, key, 256);
    return hex(bits);
  }
  await new Promise((r) => setTimeout(r, 30)); // deixa o botão "Entrando…" aparecer antes de ocupar a thread
  return hex(pbkdf2Sha256(enc.encode(password), b64ToBytes(saltB64), iterations));
}

export async function login(slug, password) {
  const users = await loadUsers();
  const u = users.find((x) => x.slug.toLowerCase() === slug.trim().toLowerCase());
  // login por senha só existe para quem tem hash em users.json (hoje ninguém: o acesso é pelo Google)
  const bad = new Error('Usuário ou senha incorretos.');
  if (!u?.hash || !u.salt) { await hashPassword(password, 'AAAAAAAAAAAAAAAAAAAAAA==', 120000); throw bad; }
  const hash = await hashPassword(password, u.salt, u.it || 120000);
  if (hash !== u.hash) throw bad;
  const s = { slug: u.slug, nome: u.nome, exp: Date.now() + DAYS * 864e5 };
  localStorage.setItem(SKEY, JSON.stringify(s));
  return s;
}

// ---------- Entrar com Google ----------
export async function loadConfig() {
  try { return await (await fetch(BASE + 'config.json', { cache: 'no-cache' })).json(); } catch { return {}; }
}

// SHA-256 do e-mail em minúsculas: users.json é público, então não guarda e-mails em claro.
export const hashEmail = async (email) => sha256Hex(new TextEncoder().encode(String(email).trim().toLowerCase()));

export async function loginWithGoogle(credential, clientId, verify = verifyGoogleIdToken) {
  const pl = await verify(credential, clientId);
  const h = await hashEmail(pl.email);
  const u = (await loadUsers()).find((x) => x.emailHash === h);
  if (!u) throw new Error('Este e-mail do Google não está liberado no Geharte. Fale com o administrador.');
  const s = { slug: u.slug, nome: u.nome, via: 'google', exp: Date.now() + DAYS * 864e5 };
  localStorage.setItem(SKEY, JSON.stringify(s));
  return s;
}

export function session() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || 'null');
    if (s && s.exp > Date.now()) return s;
  } catch { /* ignora */ }
  localStorage.removeItem(SKEY);
  return null;
}

export const logout = () => localStorage.removeItem(SKEY);
