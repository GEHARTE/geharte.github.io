// Pinos de deformação do ArtAtk (estilo "Puppet Pin" do After Effects) — lógica PURA: sem DOM, sem DOMParser, sem relógio, sem rede.
// Roda igual no Node (testes) e no navegador.
//
// A IDEIA, em linguagem simples
// -----------------------------
// Um SVG não tem malha de triângulos como um jogo 3D; ele tem CAMINHOS (<path d="M10 10 C…">) feitos de pontos de controle.
// Então a deformação aqui é VETORIAL: em vez de esticar pixels, deslocamos os PONTOS dos caminhos.
//   1. O artista crava PINOS no desenho. Cada pino tem uma posição original (p) e, em cada instante, uma posição atual (q).
//   2. Para cada ponto v do desenho, perguntamos "para onde v vai?". Os pinos mais PERTO de v mandam mais (peso 1/distância²).
//   3. É o método dos MÍNIMOS QUADRADOS MÓVEIS (MLS), versão RÍGIDA (Schaefer, McPhail e Warren, 2006): para cada v procuramos a
//      melhor combinação de "girar + deslocar" que leva os p's perto dos q's, dando mais importância aos pinos próximos de v.
//      O resultado parece borracha: com 1 pino o desenho todo só desliza; com 2 ou mais ele gira e dobra sem esticar.
//   4. Como cada ponto escolhe a SUA combinação, o desenho se deforma suavemente em vez de quebrar.
//   Em contas: pesos w_i = 1/|p_i − v|^(2·alpha); centroides p* e q* (médias ponderadas); p̂_i = p_i − p*, q̂_i = q_i − q*;
//   o ângulo da rotação sai de  c = Σ w (p̂·q̂)  e  s = Σ w (p̂×q̂)  (R = (c, s)/|(c, s)|); e  f(v) = R·(v − p*) + q*.
//   `alpha` é a "rigidez": maior = cada pino manda só na vizinhança; menor = o desenho todo se move mais junto.
//
// Para o número de pontos ser CONSTANTE em todos os quadros (obrigatório para o navegador interpolar `d` com <animate>),
// os caminhos são DENSIFICADOS uma única vez, ao criar o modelo (subdividir segmentos longos deixa a deformação lisa).
// Depois disso só os valores mudam, nunca a estrutura.
//
// DECISÕES (contrato ambíguo → o mais simples):
//  - Erros: `modeloDePinos` LANÇA `Error` (mensagem em pt-BR) para SVG vazio/ilegível ou perigoso; as demais funções não lançam.
//  - `viewBox` do modelo é uma lista [x, y, largura, altura]. `alpha` (rigidez) vive no modelo. `avisos` guarda o que foi ignorado.
//  - A trilha de um pino guarda posições ABSOLUTAS (x e y) no tempo; sem quadros o pino fica parado na posição original.
//  - Ao criar o 1º quadro de um pino fora do instante 0, cria-se também um quadro em 0 com a posição original (o desenho começa em repouso).
//  - Só viram formas deformáveis: path, rect, circle, ellipse, line, polygon, polyline (transform e atributos de pintura herdados são
//    assados). Texto, imagem, <use>, <style>/classes e gradientes (url(#…)) são ignorados/substituídos, com aviso.
//  - SMIL não obedece a prefers-reduced-motion; o SVG exportado não faz nada a respeito (limitação conhecida).
//  - Funções que mudam o modelo devolvem um modelo NOVO (as formas, imutáveis, são compartilhadas por referência).
import { CURVAS, valorEm, porQuadro, semQuadro, clamp } from './anim-motor.js';

export const LIMITES = { pinos: 12, pontos: 4000, formas: 200, duracaoMin: 100, duracaoMax: 60000, quadrosExport: 120, bytesExport: 600000, quadrosKey: 200 };
const EPS = 1e-9;
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// ===================================================================================================================
// 1) LEITURA DE CAMINHOS (path d)
// ===================================================================================================================
// Segmentos normalizados, sempre em coordenadas ABSOLUTAS: { c:'M'|'L'|'C'|'Q'|'Z', p:[números] }
//   M [x y]   L [x y]   C [x1 y1 x2 y2 x y]   Q [x1 y1 x y]   Z []
// H, V → L;  S → C;  T → Q;  A (arco) → uma ou mais C.  Leitor tolerante: ao achar lixo, devolve o que já leu.
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const NUM_G = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Ângulo (com sinal) do vetor u ao vetor v — usado na conversão de arco.
const anguloEntre = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

// Arco elíptico SVG (notação de ponto final) → cúbicas de Bézier (≤ 90° cada). Fórmulas do apêndice F.6 da especificação do SVG.
export function arcoParaCubicas(x1, y1, rx, ry, rotGraus, grande, varrer, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [{ c: 'L', p: [x2, y2] }];
  const phi = (rotGraus * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const rx2 = rx * rx, ry2 = ry * ry;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let co = den ? Math.sqrt(Math.max(0, (rx2 * ry2 - den) / den)) : 0;
  if (!!grande === !!varrer) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cs * cxp - sn * cyp + (x1 + x2) / 2, cy = sn * cxp + cs * cyp + (y1 + y2) / 2;
  const t1 = anguloEntre(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = anguloEntre((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!varrer && dt > 0) dt -= 2 * Math.PI;
  if (varrer && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), delta = dt / n, k = (4 / 3) * Math.tan(delta / 4);
  const ponto = (a) => [cx + cs * rx * Math.cos(a) - sn * ry * Math.sin(a), cy + sn * rx * Math.cos(a) + cs * ry * Math.sin(a)];
  const deriv = (a) => [-cs * rx * Math.sin(a) - sn * ry * Math.cos(a), -sn * rx * Math.sin(a) + cs * ry * Math.cos(a)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * delta, b = a + delta, pa = ponto(a), pb = i === n - 1 ? [x2, y2] : ponto(b), da = deriv(a), db = deriv(b);
    out.push({ c: 'C', p: [pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]] });
  }
  return out;
}

export function lerCaminho(d) {
  const s = String(d ?? '');
  const out = [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, ultC = null, ultQ = null, semSub = false;
  const espaco = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  const numero = () => { espaco(); NUM.lastIndex = i; const m = NUM.exec(s); if (!m) return null; i = NUM.lastIndex; return parseFloat(m[0]); };
  const bandeira = () => { espaco(); const ch = s[i]; if (ch !== '0' && ch !== '1') return null; i++; return +ch; };
  const comecaNumero = () => { espaco(); return i < s.length && /[-+.\d]/.test(s[i]); };
  // depois de Z, um desenho sem M novo recomeça do início do subcaminho: deixamos o M explícito
  const garantirSub = () => { if (semSub) { out.push({ c: 'M', p: [sx, sy] }); semSub = false; } };

  for (;;) {
    espaco();
    if (i >= s.length) break;
    if (/[A-Za-z]/.test(s[i])) { cmd = s[i++]; if (!(cmd.toUpperCase() in ARGS)) break; }
    else if (!cmd || /[Zz]/.test(cmd) || !comecaNumero()) break;
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';   // pares extras depois de M viram L
    const C = cmd.toUpperCase(), rel = cmd !== C;
    if (!out.length && C !== 'M') break;
    if (C === 'Z') { if (out.length) { out.push({ c: 'Z', p: [] }); cx = sx; cy = sy; semSub = true; } ultC = ultQ = null; continue; }

    const a = [];
    for (let k = 0; k < ARGS[C]; k++) {
      const v = C === 'A' && (k === 3 || k === 4) ? bandeira() : numero();
      if (v == null) return out;       // comando incompleto: descarta só ele
      a.push(v);
    }
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'M') {
      cx = a[0] + ox; cy = a[1] + oy; sx = cx; sy = cy; semSub = false; out.push({ c: 'M', p: [cx, cy] }); ultC = ultQ = null;
    } else if (C === 'L' || C === 'H' || C === 'V') {
      garantirSub();
      if (C === 'H') cx = a[0] + (rel ? cx : 0); else if (C === 'V') cy = a[0] + (rel ? cy : 0); else { cx = a[0] + ox; cy = a[1] + oy; }
      out.push({ c: 'L', p: [cx, cy] }); ultC = ultQ = null;
    } else if (C === 'C') {
      garantirSub();
      const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
      out.push({ c: 'C', p }); ultC = [p[2], p[3]]; ultQ = null; cx = p[4]; cy = p[5];
    } else if (C === 'S') {
      garantirSub();
      const r = ultC ? [2 * cx - ultC[0], 2 * cy - ultC[1]] : [cx, cy];
      const p = [r[0], r[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
      out.push({ c: 'C', p }); ultC = [p[2], p[3]]; ultQ = null; cx = p[4]; cy = p[5];
    } else if (C === 'Q') {
      garantirSub();
      const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
      out.push({ c: 'Q', p }); ultQ = [p[0], p[1]]; ultC = null; cx = p[2]; cy = p[3];
    } else if (C === 'T') {
      garantirSub();
      const r = ultQ ? [2 * cx - ultQ[0], 2 * cy - ultQ[1]] : [cx, cy];
      const p = [r[0], r[1], a[0] + ox, a[1] + oy];
      out.push({ c: 'Q', p }); ultQ = [p[0], p[1]]; ultC = null; cx = p[2]; cy = p[3];
    } else if (C === 'A') {
      garantirSub();
      const ex = a[5] + ox, ey = a[6] + oy;
      out.push(...arcoParaCubicas(cx, cy, a[0], a[1], a[2], a[3], a[4], ex, ey));
      cx = ex; cy = ey; ultC = ultQ = null;
    }
  }
  return out;
}

// Número → texto com `casas` decimais, sem zeros sobrando e sem "-0".
export function numeroTexto(v, casas = 3) {
  const f = 10 ** casas;
  const r = Math.round(v * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}
export function caminhoParaTexto(segmentos, casas = 3) {
  let texto = '';
  for (const g of segmentos || []) texto += g.c + g.p.map((v) => numeroTexto(v, casas)).join(' ');
  return texto;
}

// ===================================================================================================================
// 2) PONTOS DE CONTROLE E DENSIFICAÇÃO
// ===================================================================================================================
// "Pontos" de um caminho = todos os pares (x, y) dos segmentos, inclusive os pontos de controle das curvas.
export const contarPontos = (segs) => segs.reduce((n, g) => n + g.p.length / 2, 0);
export function pontosDoCaminho(segs) {
  const f = new Float64Array(contarPontos(segs) * 2);
  let k = 0;
  for (const g of segs) for (const v of g.p) f[k++] = v;
  return f;
}
export function comPontos(segs, flat) {
  let k = 0;
  return segs.map((g) => ({ c: g.c, p: g.p.map(() => flat[k++]) }));
}
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// de Casteljau: divide uma curva (lista de pontos de controle [x,y]) em t → [esquerda, direita].
function dividir(pts, t) {
  const esq = [pts[0]], dir = [pts[pts.length - 1]];
  let atual = pts;
  while (atual.length > 1) {
    const prox = [];
    for (let i = 0; i < atual.length - 1; i++) prox.push([atual[i][0] + (atual[i + 1][0] - atual[i][0]) * t, atual[i][1] + (atual[i + 1][1] - atual[i][1]) * t]);
    esq.push(prox[0]); dir.unshift(prox[prox.length - 1]);
    atual = prox;
  }
  return [esq, dir];
}
const MAX_PEDACOS = 400;

// Subdivide segmentos longos para que nenhum passe de ~maxLen. O resultado só depende do desenho (determinístico).
export function densificarSegmentos(segs, maxLen) {
  if (!(maxLen > 0)) return segs.map((g) => ({ c: g.c, p: [...g.p] }));
  const out = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const g of segs) {
    if (g.c === 'M') { out.push({ c: 'M', p: [...g.p] }); cx = sx = g.p[0]; cy = sy = g.p[1]; continue; }
    if (g.c === 'Z') {
      const d = dist(cx, cy, sx, sy), n = Math.min(MAX_PEDACOS, Math.ceil(d / maxLen));
      for (let i = 1; i < n; i++) out.push({ c: 'L', p: [cx + ((sx - cx) * i) / n, cy + ((sy - cy) * i) / n] });
      if (d > EPS) out.push({ c: 'L', p: [sx, sy] });    // fecha com uma linha explícita: o ponto final também é deformado
      out.push({ c: 'Z', p: [] }); cx = sx; cy = sy; continue;
    }
    const ctrl = [[cx, cy]];
    for (let k = 0; k < g.p.length; k += 2) ctrl.push([g.p[k], g.p[k + 1]]);
    let poli = 0;
    for (let k = 1; k < ctrl.length; k++) poli += dist(ctrl[k - 1][0], ctrl[k - 1][1], ctrl[k][0], ctrl[k][1]);
    const corda = dist(cx, cy, ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]);
    const comp = g.c === 'L' ? corda : (poli + corda) / 2;
    const n = Math.max(1, Math.min(MAX_PEDACOS, Math.ceil(comp / maxLen)));
    if (g.c === 'L') {
      for (let i = 1; i <= n; i++) out.push({ c: 'L', p: [cx + ((g.p[0] - cx) * i) / n, cy + ((g.p[1] - cy) * i) / n] });
    } else {
      let resto = ctrl;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) { out.push({ c: g.c, p: resto.slice(1).flat() }); break; }
        const [e, d] = dividir(resto, 1 / (n - i));
        out.push({ c: g.c, p: e.slice(1).flat() });
        resto = d;
      }
    }
    cx = g.p[g.p.length - 2]; cy = g.p[g.p.length - 1];
  }
  return out;
}
export const densificar = (d, maxLen, casas = 3) => caminhoParaTexto(densificarSegmentos(lerCaminho(d), maxLen), casas);

// ===================================================================================================================
// 3) FORMAS BÁSICAS → path
// ===================================================================================================================
const num = (v, padrao = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : padrao; };
const tx = (v) => numeroTexto(v, 4);
const elipse = (cx, cy, rx, ry) => `M${tx(cx - rx)} ${tx(cy)}A${tx(rx)} ${tx(ry)} 0 1 1 ${tx(cx + rx)} ${tx(cy)}A${tx(rx)} ${tx(ry)} 0 1 1 ${tx(cx - rx)} ${tx(cy)}Z`;
export function formaParaCaminho(tag, attrs = {}) {
  const a = attrs || {}, nome = String(tag).toLowerCase();
  switch (nome) {
    case 'path': return String(a.d || '');
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), hh = num(a.height);
      if (!(w > 0 && hh > 0)) return '';
      let rx = a.rx != null ? num(a.rx, 0) : null, ry = a.ry != null ? num(a.ry, 0) : null;
      if (rx == null && ry == null) { rx = ry = 0; } else if (rx == null) rx = ry; else if (ry == null) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), hh / 2);
      if (!rx || !ry) return `M${tx(x)} ${tx(y)}H${tx(x + w)}V${tx(y + hh)}H${tx(x)}Z`;
      const arco = (ex, ey) => `A${tx(rx)} ${tx(ry)} 0 0 1 ${tx(ex)} ${tx(ey)}`;
      return `M${tx(x + rx)} ${tx(y)}H${tx(x + w - rx)}${arco(x + w, y + ry)}V${tx(y + hh - ry)}${arco(x + w - rx, y + hh)}H${tx(x + rx)}${arco(x, y + hh - ry)}V${tx(y + ry)}${arco(x + rx, y)}Z`;
    }
    case 'circle': { const r = num(a.r); return r > 0 ? elipse(num(a.cx), num(a.cy), r, r) : ''; }
    case 'ellipse': { const rx = num(a.rx), ry = num(a.ry); return rx > 0 && ry > 0 ? elipse(num(a.cx), num(a.cy), rx, ry) : ''; }
    case 'line': return `M${tx(num(a.x1))} ${tx(num(a.y1))}L${tx(num(a.x2))} ${tx(num(a.y2))}`;
    case 'polygon': case 'polyline': {
      const n = (String(a.points || '').match(NUM_G) || []).map(Number);
      const pares = Math.floor(n.length / 2);
      if (pares < 2) return '';
      let d = '';
      for (let i = 0; i < pares; i++) d += `${i ? 'L' : 'M'}${tx(n[2 * i])} ${tx(n[2 * i + 1])}`;
      return nome === 'polygon' ? d + 'Z' : d;
    }
    default: return '';
  }
}

// ===================================================================================================================
// 4) MLS RÍGIDO
// ===================================================================================================================
// pinos = [{ p:{x,y} original, q:{x,y} atual }]. A versão rápida trabalha sobre uma lista "chata" [x0,y0,x1,y1,…].
const parado = (pinos) => pinos.every((k) => Math.abs(k.q.x - k.p.x) < EPS && Math.abs(k.q.y - k.p.y) < EPS);

export function deformarFlat(flat, pinos, { alpha = 1 } = {}) {
  const n = flat.length, out = new Float64Array(n), m = pinos.length;
  if (!m || parado(pinos)) { out.set(flat); return out; }
  const al = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 8);
  const px = pinos.map((k) => k.p.x), py = pinos.map((k) => k.p.y), qx = pinos.map((k) => k.q.x), qy = pinos.map((k) => k.q.y);
  const w = new Float64Array(m);
  for (let i = 0; i < n; i += 2) {
    const vx = flat[i], vy = flat[i + 1];
    let sw = 0, spx = 0, spy = 0, sqx = 0, sqy = 0, exato = -1;
    for (let j = 0; j < m; j++) {
      const dx = px[j] - vx, dy = py[j] - vy, d2 = dx * dx + dy * dy;
      if (d2 < 1e-18) { exato = j; break; }              // v está exatamente sobre o pino j: vai para onde o pino foi
      const wj = al === 1 ? 1 / d2 : d2 ** -al;          // |d|^(2·alpha) = (d²)^alpha
      w[j] = wj; sw += wj; spx += wj * px[j]; spy += wj * py[j]; sqx += wj * qx[j]; sqy += wj * qy[j];
    }
    if (exato >= 0) { out[i] = qx[exato]; out[i + 1] = qy[exato]; continue; }
    const psx = spx / sw, psy = spy / sw, qsx = sqx / sw, qsy = sqy / sw;
    let c = 0, s = 0;
    for (let j = 0; j < m; j++) {
      const ax = px[j] - psx, ay = py[j] - psy, bx = qx[j] - qsx, by = qy[j] - qsy;
      c += w[j] * (ax * bx + ay * by); s += w[j] * (ax * by - ay * bx);
    }
    const nr = Math.hypot(c, s);
    if (nr > 1e-12 * sw) { c /= nr; s /= nr; } else { c = 1; s = 0; }   // sem informação de giro (ex.: 1 pino): só desliza
    const dx = vx - psx, dy = vy - psy;
    out[i] = c * dx - s * dy + qsx; out[i + 1] = s * dx + c * dy + qsy;
  }
  return out;
}
export function deformarPontos(pontos, pinos, opcoes = {}) {
  const flat = new Float64Array(pontos.length * 2);
  pontos.forEach((q, i) => { flat[2 * i] = q.x; flat[2 * i + 1] = q.y; });
  const r = deformarFlat(flat, pinos, opcoes);
  return pontos.map((_, i) => ({ x: r[2 * i], y: r[2 * i + 1] }));
}
export function deformarCaminho(d, pinos, { alpha = 1, casas = 3 } = {}) {
  const segs = lerCaminho(d);
  return caminhoParaTexto(comPontos(segs, deformarFlat(pontosDoCaminho(segs), pinos, { alpha })), casas);
}

// ===================================================================================================================
// 5) LEITOR TOLERANTE DE SVG (sem DOMParser)
// ===================================================================================================================
const IGNORADAS = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'lineargradient', 'radialgradient', 'filter', 'title', 'desc', 'metadata', 'style']);
const FORMAS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);
// atributos de pintura que a forma "herda" dos grupos e que vão para o SVG exportado
const PINTURA = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule'];
const decodificar = (v) => String(v).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const mapa = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
  return mapa[e.toLowerCase()] ?? m;
});
function lerAtributos(texto) {
  const a = {};
  for (const m of texto.matchAll(/([^\s=/"'<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[m[1].toLowerCase()] = decodificar(m[2] ?? m[3]);
  return a;
}
function estiloEmAtributos(estilo) {
  const o = {};
  for (const par of String(estilo || '').split(';')) { const i = par.indexOf(':'); if (i > 0) o[par.slice(0, i).trim().toLowerCase()] = par.slice(i + 1).trim(); }
  return o;
}

// Matrizes 2D [a b c d e f]: x' = a·x + c·y + e ; y' = b·x + d·y + f
const IDENTIDADE = [1, 0, 0, 1, 0, 0];
const mult = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export function lerTransformacao(texto) {
  let m = IDENTIDADE;
  for (const g of String(texto || '').matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = (g[2].match(NUM_G) || []).map(Number), nome = g[1].toLowerCase();
    let n = null;
    if (nome === 'matrix' && a.length >= 6) n = a.slice(0, 6);
    else if (nome === 'translate' && a.length >= 1) n = [1, 0, 0, 1, a[0], a[1] || 0];
    else if (nome === 'scale' && a.length >= 1) n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
    else if (nome === 'rotate' && a.length >= 1) {
      const r = (a[0] * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0;
      n = [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy];
    } else if (nome === 'skewx' && a.length >= 1) n = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
    else if (nome === 'skewy' && a.length >= 1) n = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
    if (n) m = mult(m, n);
  }
  return m;
}
const aplicarMatriz = (segs, m) => (m === IDENTIDADE ? segs : segs.map((g) => {
  const p = [];
  for (let k = 0; k < g.p.length; k += 2) p.push(m[0] * g.p[k] + m[2] * g.p[k + 1] + m[4], m[1] * g.p[k] + m[3] * g.p[k + 1] + m[5]);
  return { c: g.c, p };
}));

// Lê o SVG e devolve { viewBox, formas:[{tag, attrs, d, matriz}], avisos }. Lança Error se ilegível ou perigoso.
export function lerFormasDoSvg(texto) {
  const src = String(texto ?? '');
  if (!/<svg[\s>]/i.test(src)) throw new Error('Não encontrei uma tag <svg>.');
  if (/<\s*(script|foreignobject)\b/i.test(src)) throw new Error('SVG recusado: contém <script> ou <foreignObject>.');
  if (/javascript\s*:/i.test(src)) throw new Error('SVG recusado: contém "javascript:".');
  const avisos = new Set();
  const formas = [];
  let viewBox = null, largura = 0, altura = 0, visto = false;
  const pilha = [];            // { tag, heranca, matriz, ignorar }
  const topo = () => pilha[pilha.length - 1] || { heranca: {}, matriz: IDENTIDADE, ignorar: 0 };
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  for (const m of src.matchAll(re)) {
    if (!m[2]) continue;
    const fecha = m[1] === '/', tag = m[2].toLowerCase().replace(/^svg:/, '');
    if (fecha) { while (pilha.length) { const x = pilha.pop(); if (x.tag === tag) break; } continue; }
    const attrs = lerAtributos(m[3]);
    for (const k of Object.keys(attrs)) if (k.startsWith('on')) throw new Error('SVG recusado: contém um atributo de evento (' + k + ').');
    const pai = topo();
    const filho = { tag, heranca: { ...pai.heranca }, matriz: pai.matriz, ignorar: pai.ignorar + (IGNORADAS.has(tag) ? 1 : 0) };
    if (tag === 'svg' && !visto) {
      visto = true;
      const vb = String(attrs.viewbox || '').match(NUM_G);
      if (vb && vb.length === 4 && +vb[2] > 0 && +vb[3] > 0) viewBox = vb.map(Number);
      largura = num(attrs.width, 0); altura = num(attrs.height, 0);
    }
    if (tag === 'style') avisos.add('O SVG tem <style> (classes CSS): as cores vindas de classes são ignoradas.');
    if (['text', 'image', 'use'].includes(tag) && !pai.ignorar) avisos.add(`Elemento <${tag}> ignorado (só caminhos e formas básicas são deformáveis).`);
    const estilo = { ...attrs, ...estiloEmAtributos(attrs.style) };
    for (const k of PINTURA) if (estilo[k] != null) filho.heranca[k] = String(estilo[k]);
    if (attrs.transform) filho.matriz = mult(pai.matriz, lerTransformacao(attrs.transform));
    if (FORMAS.has(tag) && !filho.ignorar && estilo.display !== 'none') {
      const d = formaParaCaminho(tag, attrs);
      if (d) formas.push({ tag, attrs: { ...filho.heranca }, d, matriz: filho.matriz });
      else avisos.add(`<${tag}> sem medidas válidas foi ignorado.`);
    }
    if (!m[4]) pilha.push(filho);
  }
  if (!formas.length) throw new Error('Não encontrei caminhos nem formas básicas neste SVG.');
  if (!viewBox && largura > 0 && altura > 0) viewBox = [0, 0, largura, altura];
  return { viewBox, formas, avisos: [...avisos] };
}

// ===================================================================================================================
// 6) MODELO
// ===================================================================================================================
// {
//   v: 1, viewBox:[x,y,w,h], duracao: ms, alpha: rigidez,
//   formas: [{ id, atributosFixos:{fill,…}, d: 'caminho densificado' }],
//   pinos:  [{ id, x, y, trilha:{ x:[{t,v,curva?}], y:[…] } }],   // x,y = posição original; trilha = posição absoluta no tempo
//   avisos: [texto]
// }
const NOMES_ATRIBUTOS = new Set(PINTURA);
const valorSeguro = (v) => {
  const s = String(v).trim().slice(0, 200);
  return /[<>"]|javascript:|url\(/i.test(s) ? null : s;
};
function limparAtributos(a) {
  const o = {};
  for (const [k, v] of Object.entries(a && typeof a === 'object' ? a : {})) {
    if (!NOMES_ATRIBUTOS.has(k)) continue;
    const s = valorSeguro(v);
    if (s != null) o[k] = s; else if (k === 'fill' || k === 'stroke') o[k] = '#888888';   // gradiente/padrão vira cinza
  }
  return o;
}
const idSeguro = (v, padrao) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 40) || padrao;
// Casas decimais conforme o tamanho do desenho (~1 parte em 20 mil): arquivos menores sem perda visível.
const casasDoViewBox = (vb) => { const g = Math.max(vb?.[2] || 100, vb?.[3] || 100); return g < 10 ? 4 : g < 100 ? 3 : g < 1000 ? 2 : 1; };
export const casasDoModelo = (m) => casasDoViewBox(m.viewBox);

const curvaValida = (c) => (typeof c === 'string' && (CURVAS[c] || /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(c)) ? c : null);
const semLinear = (l) => l.map((k) => (k.curva === 'linear' ? { t: k.t, v: k.v } : k));

function limparTrilha(lista, duracao) {
  const out = new Map();
  for (const k of Array.isArray(lista) ? lista : []) {
    if (!k || !Number.isFinite(k.t) || !Number.isFinite(k.v)) continue;
    const tt = Math.round(clamp(k.t, 0, duracao)), c = curvaValida(k.curva);
    out.set(tt, { t: tt, v: r4(clamp(k.v, -1e6, 1e6)), ...(c && c !== 'linear' ? { curva: c } : {}) });
  }
  return [...out.values()].sort((a, b) => a.t - b.t).slice(0, LIMITES.quadrosKey);
}

// Limpa um modelo vindo de fora (arquivo antigo, JSON importado): só o que se conhece, dentro dos limites. Idempotente.
export function normalizarModelo(obj, { maxPontos = LIMITES.pontos } = {}) {
  if (!obj || typeof obj !== 'object') return null;
  const vb = Array.isArray(obj.viewBox) && obj.viewBox.length === 4 && obj.viewBox.every(Number.isFinite) && obj.viewBox[2] > 0 && obj.viewBox[3] > 0 ? obj.viewBox.map(r4) : [0, 0, 100, 100];
  const duracao = Math.round(clamp(Number.isFinite(obj.duracao) ? obj.duracao : 2000, LIMITES.duracaoMin, LIMITES.duracaoMax));
  const casas = casasDoViewBox(vb);
  const formas = [], ids = new Set();
  let pontos = 0;
  for (const f of Array.isArray(obj.formas) ? obj.formas.slice(0, LIMITES.formas) : []) {
    if (!f || typeof f.d !== 'string') continue;
    const segs = lerCaminho(f.d), n = contarPontos(segs);
    if (!n || pontos + n > maxPontos) continue;
    let id = idSeguro(f.id, `f${formas.length + 1}`);
    while (ids.has(id)) id += 'x';
    ids.add(id); pontos += n;
    formas.push({ id, atributosFixos: limparAtributos(f.atributosFixos), d: caminhoParaTexto(segs, casas) });
  }
  const pinos = [], idsP = new Set();
  for (const p of Array.isArray(obj.pinos) ? obj.pinos.slice(0, LIMITES.pinos) : []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    let id = idSeguro(p.id, `p${pinos.length + 1}`);
    while (idsP.has(id)) id += 'x';
    idsP.add(id);
    pinos.push({ id, x: r4(clamp(p.x, -1e6, 1e6)), y: r4(clamp(p.y, -1e6, 1e6)), trilha: { x: limparTrilha(p.trilha?.x, duracao), y: limparTrilha(p.trilha?.y, duracao) } });
  }
  const avisos = (Array.isArray(obj.avisos) ? obj.avisos : []).filter((a) => typeof a === 'string').slice(0, 10).map((a) => a.slice(0, 200));
  return { v: 1, viewBox: vb, duracao, alpha: r4(clamp(Number.isFinite(obj.alpha) ? obj.alpha : 1, 0, 8)), formas, pinos, avisos };
}

// SVG → modelo. A densificação acontece AQUI, uma única vez: o nº de pontos de cada forma não muda mais.
export function modeloDePinos(svgTexto, { maxPontos = LIMITES.pontos, duracao = 2000 } = {}) {
  const { viewBox, formas: brutas, avisos } = lerFormasDoSvg(svgTexto);
  const prontas = brutas.map((f) => ({ f, segs: aplicarMatriz(lerCaminho(f.d), f.matriz) })).filter((x) => x.segs.length);
  if (!prontas.length) throw new Error('Os caminhos do SVG estão vazios ou ilegíveis.');
  const sem = prontas.reduce((n, x) => n + contarPontos(x.segs), 0);
  if (sem > maxPontos) throw new Error(`Desenho complexo demais: ${sem} pontos (o limite é ${maxPontos}). Simplifique o SVG.`);
  let vb = viewBox;
  if (!vb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of prontas) { const f = pontosDoCaminho(x.segs); for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); } }
    const w = Math.max(1, x1 - x0), hh = Math.max(1, y1 - y0), pad = Math.max(w, hh) * 0.05;
    vb = [r4(x0 - pad), r4(y0 - pad), r4(w + 2 * pad), r4(hh + 2 * pad)];
  }
  // passo de densificação: ~1/40 do lado maior; se estourar o limite de pontos, afrouxa até caber
  let passo = Math.max(vb[2], vb[3]) / 40, dens = [];
  for (let i = 0; i < 40; i++) {
    dens = prontas.map((x) => densificarSegmentos(x.segs, passo));
    if (dens.reduce((n, s) => n + contarPontos(s), 0) <= maxPontos) break;
    passo *= 1.25;
  }
  const casas = casasDoViewBox(vb);
  const temGradiente = prontas.some((x) => Object.values(x.f.attrs).some((v) => /url\(/i.test(v)));
  return normalizarModelo({
    v: 1, viewBox: vb, duracao, alpha: 1, pinos: [],
    formas: prontas.map((x, i) => ({ id: `f${i + 1}`, atributosFixos: x.f.attrs, d: caminhoParaTexto(dens[i], casas) })),
    avisos: [...avisos, ...(temGradiente ? ['Gradientes e padrões (url(#…)) foram trocados por cinza.'] : [])],
  }, { maxPontos });
}

export const contarPontosDoModelo = (m) => m.formas.reduce((n, f) => n + contarPontos(lerCaminho(f.d)), 0);

// ---------- edição (devolve modelo novo) ----------
const comPinos = (m, pinos) => ({ ...m, pinos });
const idLivre = (m) => { let n = m.pinos.length + 1; const ids = new Set(m.pinos.map((p) => p.id)); while (ids.has(`p${n}`)) n++; return `p${n}`; };

// Crava um pino na posição ORIGINAL (x, y) do desenho. No limite de pinos devolve o mesmo modelo. O novo pino é o último da lista.
export function adicionarPino(m, x, y, { id } = {}) {
  if (m.pinos.length >= LIMITES.pinos || !Number.isFinite(x) || !Number.isFinite(y)) return m;
  const livre = id && !m.pinos.some((p) => p.id === idSeguro(id, '')) ? idSeguro(id, '') : '';
  return comPinos(m, [...m.pinos, { id: livre || idLivre(m), x: r4(x), y: r4(y), trilha: { x: [], y: [] } }]);
}
export const removerPino = (m, id) => comPinos(m, m.pinos.filter((p) => p.id !== id));

// Põe o pino em (x, y) no instante tMs (cria ou atualiza o quadro-chave). A curva vale para o trecho que SAI deste quadro.
export function moverPinoEm(m, id, tMs, x, y, { curva: c } = {}) {
  const alvo = m.pinos.find((p) => p.id === id);
  if (!alvo || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(tMs)) return m;
  const tt = Math.round(clamp(tMs, 0, m.duracao)), cv = curvaValida(c) || undefined, opc = { curva: cv, eps: 0.5 };
  let lx = alvo.trilha.x, ly = alvo.trilha.y;
  if (!lx.length && tt > 0) { lx = porQuadro(lx, 0, alvo.x, { eps: 0.5 }); ly = porQuadro(ly, 0, alvo.y, { eps: 0.5 }); }   // começa em repouso
  lx = semLinear(porQuadro(lx, tt, r4(x), opc)).slice(0, LIMITES.quadrosKey);
  ly = semLinear(porQuadro(ly, tt, r4(y), opc)).slice(0, LIMITES.quadrosKey);
  return comPinos(m, m.pinos.map((p) => (p.id === id ? { ...p, trilha: { x: lx, y: ly } } : p)));
}
export function removerQuadroDoPino(m, id, tMs) {
  const tt = Math.round(tMs);
  return comPinos(m, m.pinos.map((p) => (p.id === id ? { ...p, trilha: { x: semQuadro(p.trilha.x, tt, 0.5), y: semQuadro(p.trilha.y, tt, 0.5) } } : p)));
}
// Move o quadro-chave do pino de deMs para paraMs (x e y juntos). Se já houver um quadro no destino, ele é substituído.
export function moverQuadroDoPino(m, id, deMs, paraMs) {
  const de = Math.round(deMs), para = Math.round(clamp(paraMs, 0, m.duracao));
  const alvo = m.pinos.find((p) => p.id === id);
  if (!alvo || de === para || !alvo.trilha.x.some((k) => Math.abs(k.t - de) <= 0.5)) return m;
  const move = (l) => {
    const k = l.find((q) => Math.abs(q.t - de) <= 0.5);
    return [...semQuadro(semQuadro(l, de, 0.5), para, 0.5), { ...k, t: para }].sort((a, b) => a.t - b.t);
  };
  return comPinos(m, m.pinos.map((p) => (p.id === id ? { ...p, trilha: { x: move(p.trilha.x), y: move(p.trilha.y) } } : p)));
}
// Muda só a curva do quadro (se existir) em tMs.
export function definirCurvaDoQuadro(m, id, tMs, c) {
  const cv = curvaValida(c);
  if (!cv) return m;
  const tt = Math.round(tMs), troca = (l) => semLinear(l.map((k) => (Math.abs(k.t - tt) <= 0.5 ? { ...k, curva: cv } : k)));
  return comPinos(m, m.pinos.map((p) => (p.id === id ? { ...p, trilha: { x: troca(p.trilha.x), y: troca(p.trilha.y) } } : p)));
}
// Muda a duração. Com `escalar`, os quadros-chave acompanham (a animação fica mais lenta/rápida); sem, ficam onde estão (e são cortados).
export function definirDuracao(m, ms, { escalar = false } = {}) {
  const nova = Math.round(clamp(ms, LIMITES.duracaoMin, LIMITES.duracaoMax)), f = escalar ? nova / m.duracao : 1;
  const ajusta = (l) => { const o = new Map(); for (const k of l) { const tt = Math.round(clamp(k.t * f, 0, nova)); o.set(tt, { ...k, t: tt }); } return [...o.values()].sort((a, b) => a.t - b.t); };
  return { ...m, duracao: nova, pinos: m.pinos.map((p) => ({ ...p, trilha: { x: ajusta(p.trilha.x), y: ajusta(p.trilha.y) } })) };
}
export const definirRigidez = (m, alpha) => ({ ...m, alpha: r4(clamp(Number.isFinite(alpha) ? alpha : 1, 0, 8)) });
// Para repetir sem salto: cada pino com quadros ganha um quadro no fim igual ao valor do instante 0.
export function fecharCiclo(m) {
  return comPinos(m, m.pinos.map((p) => {
    if (!p.trilha.x.length) return p;
    const x0 = valorEm(p.trilha.x, 0, p.x), y0 = valorEm(p.trilha.y, 0, p.y);
    return { ...p, trilha: { x: porQuadro(p.trilha.x, m.duracao, x0, { eps: 0.5 }), y: porQuadro(p.trilha.y, m.duracao, y0, { eps: 0.5 }) } };
  }));
}

// ---------- pose e quadros ----------
// Pinos no instante tMs: [{ id, p:{x,y} (original), q:{x,y} (atual) }]
export function poseDosPinos(m, tMs) {
  return m.pinos.map((k) => ({ id: k.id, p: { x: k.x, y: k.y }, q: { x: valorEm(k.trilha.x, tMs, k.x), y: valorEm(k.trilha.y, tMs, k.y) } }));
}

// As formas já lidas (segmentos + pontos) ficam em cache por forma: arrastar um pino a 60 quadros/s não pode reler o texto todo vez.
const cacheFormas = new WeakMap();
function preparada(f) {
  let c = cacheFormas.get(f);
  if (!c) { const segs = lerCaminho(f.d); c = { segs, pts: pontosDoCaminho(segs) }; cacheFormas.set(f, c); }
  return c;
}
// Lista de `d` deformados (um por forma) no instante tMs. Com os pinos parados devolve o `d` original, idêntico.
export function quadroDoModelo(m, tMs) {
  const pinos = poseDosPinos(m, tMs);
  if (!pinos.length || parado(pinos)) return m.formas.map((f) => f.d);
  const casas = casasDoModelo(m);
  return m.formas.map((f) => { const c = preparada(f); return caminhoParaTexto(comPontos(c.segs, deformarFlat(c.pts, pinos, { alpha: m.alpha })), casas); });
}
// Pontos deformados de todas as formas (para desenhar a malha de pontos): lista de {x,y}.
export function pontosDoQuadro(m, tMs) {
  const pinos = poseDosPinos(m, tMs), out = [];
  for (const f of m.formas) { const c = preparada(f), r = deformarFlat(c.pts, pinos, { alpha: m.alpha }); for (let i = 0; i < r.length; i += 2) out.push({ x: r[i], y: r[i + 1] }); }
  return out;
}

// Quadros da animação: duração × fps (+1) quadros espalhados de 0 a duração (o último cai exatamente no fim). Cada quadro = lista de `d`.
// `quadros` força a contagem exata (usado pela exportação quando precisa reduzir).
export function amostrar(m, fps = 20, { maxQuadros = 600, quadros } = {}) {
  const n = quadros ? Math.max(2, Math.round(quadros)) : Math.max(2, Math.min(maxQuadros, Math.round((m.duracao / 1000) * clamp(fps, 1, 60)) + 1));
  return Array.from({ length: n }, (_, i) => quadroDoModelo(m, (m.duracao * i) / (n - 1)));
}

// ===================================================================================================================
// 7) EXPORTAÇÃO — SVG animado com SMIL
// ===================================================================================================================
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const atributos = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

// Quantos quadros cabem: respeita o fps, o teto de 120 quadros e ~600 KB. O tamanho de um quadro é medido em quadros de verdade
// (deformados têm mais casas decimais que o desenho original). Devolve { quadros, fps, bytes (estimativa), avisos }.
export function planejarExportacao(m, fps = 20) {
  const avisos = [];
  const original = m.formas.reduce((n, f) => n + f.d.length + 200, 600);
  let porQuadro = 1;
  for (const f of [0.25, 0.5, 0.75]) porQuadro = Math.max(porQuadro, quadroDoModelo(m, m.duracao * f).reduce((n, d) => n + d.length + 1, 0));
  let n = Math.max(2, Math.round((m.duracao / 1000) * clamp(fps, 1, 60)) + 1);
  if (n > LIMITES.quadrosExport) { n = LIMITES.quadrosExport; avisos.push(`Quadros limitados a ${LIMITES.quadrosExport} para o arquivo não ficar pesado.`); }
  const porBytes = Math.max(2, Math.floor((LIMITES.bytesExport - original) / porQuadro));
  if (n > porBytes) { n = porBytes; avisos.push(`Arquivo grande: reduzi para ${n} quadros (limite ≈ ${Math.round(LIMITES.bytesExport / 1000)} KB). Simplifique o desenho para mais fluidez.`); }
  return { quadros: n, fps: Math.round((((n - 1) * 1000) / m.duracao) * 10) / 10, bytes: original + porQuadro * n, avisos };
}

function montarSvg(m, n, laco) {
  const quadros = amostrar(m, 20, { quadros: n });
  const kt = Array.from({ length: n }, (_, i) => (i === 0 ? '0' : i === n - 1 ? '1' : numeroTexto(i / (n - 1), 4))).join(';');
  const repete = laco ? 'repeatCount="indefinite"' : 'repeatCount="1" fill="freeze"';
  let corpo = '';
  m.formas.forEach((f, i) => {
    const valores = quadros.map((q) => q[i]);
    const parada = valores.every((v) => v === valores[0]);
    const anim = parada ? '' : `<animate attributeName="d" dur="${m.duracao}ms" ${repete} calcMode="linear" keyTimes="${kt}" values="${valores.map(esc).join(';')}"/>`;
    corpo += `<path id="${esc(f.id)}"${atributos(f.atributosFixos)} d="${esc(f.d)}"${anim ? `>${anim}</path>` : '/>'}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${m.viewBox.map((v) => numeroTexto(v, 4)).join(' ')}">${corpo}</svg>`;
}

// Devolve { svg, quadros, fps, bytes, avisos }. Um <path> por forma; o `d` de cada quadro vai em <animate attributeName="d" values=…>.
// Sem movimento algum (todos os quadros iguais) o <path> sai sem <animate>. Se mesmo assim passar do limite, tira quadros até caber.
export function exportarSvgPinosDetalhado(m, { laco = true, fps = 20 } = {}) {
  const plano = planejarExportacao(m, fps), avisos = [...plano.avisos];
  let n = plano.quadros, svg = montarSvg(m, n, laco);
  for (let i = 0; i < 4 && svg.length > LIMITES.bytesExport && n > 2; i++) {
    n = Math.max(2, Math.floor(n * (LIMITES.bytesExport / svg.length) * 0.95));
    svg = montarSvg(m, n, laco);
    if (i === 0) avisos.push(`Arquivo grande: reduzi para ${n} quadros.`);
  }
  if (svg.length > LIMITES.bytesExport) avisos.push('Mesmo com 2 quadros o arquivo passa de 600 KB: simplifique o desenho.');
  return { svg, quadros: n, fps: Math.round((((n - 1) * 1000) / m.duracao) * 10) / 10, bytes: svg.length, avisos };
}
export const exportarSvgPinos = (m, opcoes) => exportarSvgPinosDetalhado(m, opcoes).svg;
