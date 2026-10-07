// Edição de imagem do ArtAtk — lógica PURA (sem DOM, sem canvas): varinha mágica, máscaras de seleção, apagar para
// transparente, recortes. Trabalha sobre `{ data: Uint8ClampedArray (RGBA), width, height }` (o mesmo formato do ImageData do
// canvas) e máscaras `Uint8Array` de 1 byte por pixel (0 = fora, 1 = dentro), então roda igual no navegador e no Node (testes).
// Nada aqui altera o que recebe: toda função devolve uma cópia nova.

export const criarImagem = (width, height, data) => ({ width, height, data: data || new Uint8ClampedArray(width * height * 4) });
export const copiarImagem = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
export const criarMascara = (width, height, valor = 0) => new Uint8Array(width * height).fill(valor);
export const contar = (m) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

// ---------- varinha mágica ----------
// Distância (0–255) entre o pixel `i` e a cor da semente. É a maior entre a diferença de cor (média quadrática dos 3 canais) e a de
// transparência; dois pixels quase transparentes valem como iguais (a cor "por baixo" do nada não conta).
function distancia(d, i, r, g, b, a) {
  const pa = d[i + 3];
  if (pa < 8 && a < 8) return 0;
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return Math.max(Math.sqrt((dr * dr + dg * dg + db * db) / 3), Math.abs(pa - a));
}
export const limiarDaTolerancia = (tolerancia) => (Math.max(0, Math.min(100, Number(tolerancia) || 0)) * 255) / 100;

// Seleciona os pixels parecidos com o pixel clicado (x, y). `tolerancia` 0–100 (%). `contiguo`: só a área ligada ao clique
// (como o balde de tinta); sem isso, todos os pixels parecidos da imagem inteira. `diagonal`: liga também pelas diagonais.
export function varinha(img, x, y, { tolerancia = 25, contiguo = true, diagonal = false } = {}) {
  const { width: w, height: h, data: d } = img;
  x = Math.floor(x); y = Math.floor(y);
  const m = criarMascara(w, h);
  if (!(x >= 0 && y >= 0 && x < w && y < h)) return m;
  const s = (y * w + x) * 4, r = d[s], g = d[s + 1], b = d[s + 2], a = d[s + 3], lim = limiarDaTolerancia(tolerancia);
  const parecido = (p) => distancia(d, p * 4, r, g, b, a) <= lim;
  if (!contiguo) { for (let p = 0; p < w * h; p++) if (parecido(p)) m[p] = 1; return m; }
  const pilha = new Int32Array(w * h);
  let topo = 0;
  pilha[topo++] = y * w + x; m[y * w + x] = 1;
  const visita = (p) => { if (!m[p] && parecido(p)) { m[p] = 1; pilha[topo++] = p; } };
  while (topo) {
    const p = pilha[--topo], px = p % w, py = (p - px) / w;
    if (px > 0) visita(p - 1);
    if (px < w - 1) visita(p + 1);
    if (py > 0) visita(p - w);
    if (py < h - 1) visita(p + w);
    if (diagonal) {
      if (px > 0 && py > 0) visita(p - w - 1);
      if (px < w - 1 && py > 0) visita(p - w + 1);
      if (px > 0 && py < h - 1) visita(p + w - 1);
      if (px < w - 1 && py < h - 1) visita(p + w + 1);
    }
  }
  return m;
}

// Fundo liso: varinha a partir dos 4 cantos, somadas. Serve para tirar o fundo de uma foto de estúdio ou de um desenho em papel branco.
export function selecaoDosCantos(img, opcoes = {}) {
  const { width: w, height: h } = img;
  let m = criarMascara(w, h);
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) m = combinar(m, varinha(img, cx, cy, opcoes), 'unir');
  return m;
}

// ---------- máscaras ----------
export function combinar(a, b, modo = 'substituir') {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    o[i] = modo === 'unir' ? (a[i] | b[i]) : modo === 'subtrair' ? (a[i] & ~b[i] & 1) : modo === 'interseccao' ? (a[i] & b[i]) : b[i];
  }
  return o;
}
export const inverter = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };

// Cresce (n > 0) ou encolhe (n < 0) a seleção em |n| pixels (quadrado). Útil para pegar o "halo" que sobra na borda ao tirar o fundo.
export function ajustarBorda(m, width, height, n) {
  const r = Math.abs(Math.round(n));
  if (!r) return new Uint8Array(m);
  const cresce = n > 0, vazio = cresce ? 0 : 1;      // fora da imagem conta como "o que a seleção não é" ao crescer, e como "é" ao encolher (borda da imagem não come a seleção)
  const passo = (src, horizontal) => {
    const o = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let v = cresce ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
        const q = xx < 0 || yy < 0 || xx >= width || yy >= height ? vazio : src[yy * width + xx];
        if (cresce ? q : !q) { v = cresce ? 1 : 0; break; }
      }
      o[y * width + x] = v;
    }
    return o;
  };
  return passo(passo(m, true), false);
}

// Caixa que envolve a seleção: { x, y, w, h } ou null se vazia.
export function caixaDaMascara(m, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (m[y * width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Borda suave: desfoca a máscara (média em caixa, `raio` px) para a transparência não ter degrau.
function desfocar(m, width, height, raio) {
  const r = Math.max(0, Math.round(raio));
  let f = Float32Array.from(m);
  if (!r) return f;
  const passo = (src, horizontal) => {
    const o = new Float32Array(src.length), n = 2 * r + 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let soma = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(width - 1, Math.max(0, horizontal ? x + k : x)), yy = Math.min(height - 1, Math.max(0, horizontal ? y : y + k));
        soma += src[yy * width + xx];
      }
      o[y * width + x] = soma / n;
    }
    return o;
  };
  f = passo(passo(f, true), false);
  return f;
}

// ---------- apagar / manter ----------
// Deixa TRANSPARENTE o que está na seleção (a cor dos pixels não muda, só o alfa). `suavizar` (px) amacia a borda.
export function apagar(img, mascara, { suavizar = 0 } = {}) {
  const o = copiarImagem(img), { width: w, height: h } = img;
  const peso = suavizar > 0 ? desfocar(mascara, w, h, suavizar) : mascara;
  for (let p = 0; p < w * h; p++) {
    const k = peso[p];
    if (k > 0) o.data[p * 4 + 3] = Math.round(o.data[p * 4 + 3] * (1 - Math.min(1, k)));
  }
  return o;
}
export const manterSomente = (img, mascara, opcoes) => apagar(img, inverter(mascara), opcoes);

// ---------- recortes ----------
const inteiro = (v) => Math.round(Number(v) || 0);
export function normalizarCaixa(img, c) {
  const x = Math.max(0, Math.min(img.width - 1, inteiro(c.x))), y = Math.max(0, Math.min(img.height - 1, inteiro(c.y)));
  return { x, y, w: Math.max(1, Math.min(img.width - x, inteiro(c.w))), h: Math.max(1, Math.min(img.height - y, inteiro(c.h))) };
}
export function recortar(img, caixa) {
  const c = normalizarCaixa(img, caixa), o = criarImagem(c.w, c.h);
  for (let y = 0; y < c.h; y++) {
    const de = ((c.y + y) * img.width + c.x) * 4;
    o.data.set(img.data.subarray(de, de + c.w * 4), y * c.w * 4);
  }
  return o;
}
// Corta as margens totalmente transparentes. Devolve { img, caixa }; se não há nada para aparar (ou tudo é transparente), a mesma imagem.
export function aparar(img, limiar = 8) {
  const { width: w, height: h, data: d } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= limiar) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { img: copiarImagem(img), caixa: { x: 0, y: 0, w, h }, mudou: false };
  const caixa = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return { img: recortar(img, caixa), caixa, mudou: caixa.w !== w || caixa.h !== h };
}

// Formas de recorte (máscaras de "o que fica"): elipse (círculo se a imagem for quadrada) e retângulo de cantos arredondados.
export function mascaraElipse(width, height) {
  const m = criarMascara(width, height), cx = width / 2, cy = height / 2, a = width / 2, b = height / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const dx = (x + 0.5 - cx) / a, dy = (y + 0.5 - cy) / b; if (dx * dx + dy * dy <= 1) m[y * width + x] = 1; }
  return m;
}
export function mascaraArredondada(width, height, raio) {
  const m = criarMascara(width, height), r = Math.max(0, Math.min(raio, width / 2, height / 2));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + 0.5, py = y + 0.5, qx = px < r ? r - px : px > width - r ? px - (width - r) : 0, qy = py < r ? r - py : py > height - r ? py - (height - r) : 0;
    if (qx * qx + qy * qy <= r * r) m[y * width + x] = 1;
  }
  return m;
}

// Proporção do recorte: ajusta a caixa para `razao` (largura/altura) mexendo na altura, depois na largura se não couber na imagem.
export function ajustarProporcao(caixa, razao, limites) {
  if (!(razao > 0)) return { ...caixa };
  let w = caixa.w, h = Math.round(w / razao);
  if (h > limites.height) { h = limites.height; w = Math.round(h * razao); }
  if (w > limites.width) { w = limites.width; h = Math.round(w / razao); }
  const x = Math.max(0, Math.min(limites.width - w, caixa.x)), y = Math.max(0, Math.min(limites.height - h, caixa.y));
  return { x, y, w, h };
}
export const RAZOES = { livre: 0, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16 };

// Mapeia um ponto do documento (px) para o pixel da imagem dentro de um elemento de imagem sem rotação, conforme o ajuste
// (preencher/conter/esticar). null se cai fora da imagem ou se não dá para mapear (elemento girado).
export function pontoNaImagem(ponto, quadro, natural, ajuste = 'cover') {
  if (!quadro || quadro.r || !(natural?.w > 0 && natural?.h > 0 && quadro.w > 0 && quadro.h > 0)) return null;
  const lx = ponto.x - quadro.x, ly = ponto.y - quadro.y;
  let u, v;
  if (ajuste === 'fill') { u = (lx / quadro.w) * natural.w; v = (ly / quadro.h) * natural.h; }
  else {
    const s = ajuste === 'contain' ? Math.min(quadro.w / natural.w, quadro.h / natural.h) : Math.max(quadro.w / natural.w, quadro.h / natural.h);
    u = (lx - (quadro.w - natural.w * s) / 2) / s; v = (ly - (quadro.h - natural.h * s) / 2) / s;
  }
  return u >= 0 && v >= 0 && u < natural.w && v < natural.h ? { x: Math.floor(u), y: Math.floor(v) } : null;
}
