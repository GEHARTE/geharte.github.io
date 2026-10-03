// Utilitários pequenos compartilhados por site, viewer e editor.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, n = 1) => { const p = 10 ** n; return Math.round(v * p) / p; };
export const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
export const clone = (o) => JSON.parse(JSON.stringify(o));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// Só deixa passar links http(s), mailto, tel, âncora e relativos.
export function safeHref(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (/^(https?:|mailto:|tel:|#)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return s;
}

export function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

export async function sha256Hex(buf) {
  const h = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', buf)) : (await import('./sha.js')).sha256(new Uint8Array(buf));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Caminho base do site, a partir de qualquer página (editor/ está um nível abaixo).
export const BASE = new URL('../../../', import.meta.url).href;
