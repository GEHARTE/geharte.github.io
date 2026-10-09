// Matrizes 2D do SVG, num lugar só — PURO (sem DOM, sem rede).
//
// Até aqui `core/puppet.js` e `core/pinos.js` tinham cada um a sua cópia da mesma álgebra, e pior: os dois exportavam
// `aplicarMatriz` querendo dizer **coisas diferentes** (num, aplicar a matriz a um PONTO; no outro, a uma lista de
// SEGMENTOS de caminho). Aqui as duas operações têm nomes próprios — `pontoPorMatriz` e `segmentosPorMatriz` — e a
// composição, a leitura de `transform="…"` e a inversa existem uma vez.
//
// Convenção, a mesma do `matrix()` do SVG: [a, b, c, d, e, f] = [[a c e], [b d f], [0 0 1]], isto é
//   x' = a·x + c·y + e        y' = b·x + d·y + f

const finito = (v) => Number.isFinite(v);

export const IDENTIDADE = Object.freeze([1, 0, 0, 1, 0, 0]);

export const multiplicar = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

export const translacao = (x, y) => [1, 0, 0, 1, x, y];
export const rotacao = (graus) => { const a = (graus * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
export const escalar = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];

// A matriz aplicada a um PONTO.
export const pontoPorMatriz = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

// A matriz aplicada a uma lista de SEGMENTOS de caminho no formato { c, p: [x, y, x, y, …] } (core/pinos.js).
// A identidade devolve a mesma lista: não há o que transformar, e evita cópia à toa.
export const segmentosPorMatriz = (segs, m) => (m === IDENTIDADE ? segs : segs.map((g) => {
  const p = [];
  for (let k = 0; k < g.p.length; k += 2) p.push(m[0] * g.p[k] + m[2] * g.p[k + 1] + m[4], m[1] * g.p[k] + m[3] * g.p[k + 1] + m[5]);
  return { c: g.c, p };
}));

export function inverterMatriz(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!finito(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const RE_NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
export const numerosDe = (s) => (String(s ?? '').match(RE_NUM) || []).map(Number).filter(finito);

// transform="translate(10 5) rotate(30) scale(2)…" → matriz. Função desconhecida ou malformada é ignorada (vale a
// identidade), como fazem os navegadores. O nome é lido sem diferenciar maiúsculas: SVG de fora nem sempre vem certinho.
export function lerTransform(texto) {
  let m = IDENTIDADE;
  for (const mt of String(texto || '').matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const a = numerosDe(mt[2]);
    let t = null;
    switch (mt[1].toLowerCase()) {
      case 'matrix': if (a.length >= 6) t = a.slice(0, 6); break;
      case 'translate': if (a.length) t = translacao(a[0] ?? 0, a[1] ?? 0); break;
      case 'scale': if (a.length) t = escalar(a[0] ?? 1, a[1] ?? a[0] ?? 1); break;
      case 'rotate': if (a.length) { const r = rotacao(a[0]); t = a.length >= 3 ? multiplicar(multiplicar(translacao(a[1], a[2]), r), translacao(-a[1], -a[2])) : r; } break;
      case 'skewx': if (a.length) t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewy': if (a.length) t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    if (t) m = multiplicar(m, t);
  }
  return m;
}
