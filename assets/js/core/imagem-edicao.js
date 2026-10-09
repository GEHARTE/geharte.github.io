// Edição de imagem do ArtAtk — lógica PURA (sem DOM, sem canvas): varinha mágica, máscaras de seleção, apagar para
// transparente, recortes. Trabalha sobre `{ data: Uint8ClampedArray (RGBA), width, height }` (o mesmo formato do ImageData do
// canvas) e máscaras `Uint8Array` de 1 byte por pixel (0 = fora, 1 = dentro), então roda igual no navegador e no Node (testes).
// Nada aqui altera o que recebe: toda função devolve uma cópia nova.

export const criarImagem = (width, height, data) => ({ width, height, data: data || new Uint8ClampedArray(width * height * 4) });
export const copiarImagem = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
export const criarMascara = (width, height, valor = 0) => new Uint8Array(width * height).fill(valor);
export const contar = (m) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

// ---------- varinha mágica ----------
// O critério de "parecido" (uma vez só, usado por tudo que seleciona por cor): a maior entre a diferença de cor (média
// quadrática dos 3 canais) e a de transparência; dois pixels quase transparentes valem como iguais (a cor "por baixo" do
// nada não conta).
//
// No laço quente a comparação é feita AO QUADRADO: `sqrt(s/3) <= lim` é o mesmo que `s <= 3·lim²` para s e lim não
// negativos, e assim não há uma raiz quadrada por pixel. `distancia` continua aqui porque é ela que define o critério em
// forma legível — e um teste prova que as duas concordam.
export function distancia(d, i, r, g, b, a) {
  const pa = d[i + 3];
  if (pa < 8 && a < 8) return 0;
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return Math.max(Math.sqrt((dr * dr + dg * dg + db * db) / 3), Math.abs(pa - a));
}
export const limiarDaTolerancia = (tolerancia) => (Math.max(0, Math.min(100, Number(tolerancia) || 0)) * 255) / 100;

// A seleção por cor acontece em DUAS fases, e é daí que vem a velocidade:
//
//   1. `candidatos` passa UMA vez pela imagem, em ordem, e marca quais pixels se parecem com cada cor de referência
//      (um bit por cor, até 8). Leitura sequencial: é o que a memória do computador faz de melhor.
//   2. `inundar` espalha a partir das sementes lendo só esse byte por vizinho — sem reler quatro canais, sem refazer a
//      conta de distância e sem criar função dentro do laço.
//
// Antes, cada travessia relia a imagem em ordem aleatória e refazia a conta por vizinho; com quatro cantos, quatro vezes.
function candidatos(img, cores, tolerancia) {
  const { width: w, height: h, data: d } = img;
  const lw = w + 2, n = w * h, out = new Uint8Array(lw * (h + 2)), nc = cores.length;
  const lim = limiarDaTolerancia(tolerancia), limCor = 3 * lim * lim;
  const R = new Int32Array(nc), G = new Int32Array(nc), B = new Int32Array(nc), A = new Int32Array(nc);
  for (let c = 0; c < nc; c++) { R[c] = cores[c].r; G[c] = cores[c].g; B[c] = cores[c].b; A[c] = cores[c].a; }

  if (nc === 1) {                                   // o caso da varinha: sem laço interno
    const r = R[0], g = G[0], b = B[0], a = A[0], transp = a < 8;
    for (let y = 0, i = 0; y < h; y++) {
      const base = (y + 1) * lw + 1;
      for (let x = 0; x < w; x++, i += 4) {
        const pa = d[i + 3];
        if (pa < 8 && transp) { out[base + x] = 1; continue; }
        const da = pa - a;
        if (da > lim || -da > lim) continue;
        const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
        if (dr * dr + dg * dg + db * db <= limCor) out[base + x] = 1;
      }
    }
    return out;
  }
  for (let y = 0, i = 0; y < h; y++) {             // os cantos: as cores são testadas na mesma leitura do pixel
    const base = (y + 1) * lw + 1;
    for (let x = 0; x < w; x++, i += 4) {
      const pr = d[i], pg = d[i + 1], pb = d[i + 2], pa = d[i + 3];
      let bits = 0;
      for (let c = 0; c < nc; c++) {
        if (pa < 8 && A[c] < 8) { bits |= 1 << c; continue; }
        const da = pa - A[c];
        if (da > lim || -da > lim) continue;
        const dr = pr - R[c], dg = pg - G[c], db = pb - B[c];
        if (dr * dr + dg * dg + db * db <= limCor) bits |= 1 << c;
      }
      out[base + x] = bits;
    }
  }
  return out;
}

// Espalha a partir das sementes pelos pixels marcados com `bit` em `cand`.
//
// `cand` vem com uma MOLDURA de um pixel zerado em volta (ver `candidatos`): como a moldura nunca é candidata, a travessia
// não precisa perguntar se chegou na borda nem recuperar a coluna com `p % largura` — duas contas por vizinho, quatro
// vizinhos por pixel, em milhões de pixels.
//
// `pilha` é reaproveitada entre chamadas: num quadro de 1 920 × 1 440 ela sozinha são 11 MB, e alocá-la quatro vezes custa
// mais que a própria travessia.
function inundar(cand, bit, w, h, sementes, diagonal, pilha) {
  const lw = w + 2;                                  // largura com a moldura
  const dentro = new Uint8Array(cand.length);        // marcado, no mesmo layout de `cand`
  let topo = 0;
  for (const [sx, sy] of sementes) {
    const p = (sy + 1) * lw + (sx + 1);
    if (!dentro[p] && (cand[p] & bit)) { dentro[p] = 1; pilha[topo++] = p; }
  }
  while (topo) {
    const p = pilha[--topo];
    if (!dentro[p - 1] && (cand[p - 1] & bit)) { dentro[p - 1] = 1; pilha[topo++] = p - 1; }
    if (!dentro[p + 1] && (cand[p + 1] & bit)) { dentro[p + 1] = 1; pilha[topo++] = p + 1; }
    if (!dentro[p - lw] && (cand[p - lw] & bit)) { dentro[p - lw] = 1; pilha[topo++] = p - lw; }
    if (!dentro[p + lw] && (cand[p + lw] & bit)) { dentro[p + lw] = 1; pilha[topo++] = p + lw; }
    if (diagonal) {
      if (!dentro[p - lw - 1] && (cand[p - lw - 1] & bit)) { dentro[p - lw - 1] = 1; pilha[topo++] = p - lw - 1; }
      if (!dentro[p - lw + 1] && (cand[p - lw + 1] & bit)) { dentro[p - lw + 1] = 1; pilha[topo++] = p - lw + 1; }
      if (!dentro[p + lw - 1] && (cand[p + lw - 1] & bit)) { dentro[p + lw - 1] = 1; pilha[topo++] = p + lw - 1; }
      if (!dentro[p + lw + 1] && (cand[p + lw + 1] & bit)) { dentro[p + lw + 1] = 1; pilha[topo++] = p + lw + 1; }
    }
  }
  const m = new Uint8Array(w * h);                   // de volta ao layout sem moldura, uma linha por vez
  for (let y = 0; y < h; y++) m.set(dentro.subarray((y + 1) * lw + 1, (y + 1) * lw + 1 + w), y * w);
  return m;
}

// Tira um bit de `cand` (que tem moldura) para uma máscara comum.
const soBit = (cand, bit, w, h) => {
  const lw = w + 2, o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const base = (y + 1) * lw + 1, saida = y * w; for (let x = 0; x < w; x++) o[saida + x] = (cand[base + x] & bit) ? 1 : 0; }
  return o;
};
const corEm = (d, p) => ({ r: d[p * 4], g: d[p * 4 + 1], b: d[p * 4 + 2], a: d[p * 4 + 3] });

// Seleciona os pixels parecidos com o pixel clicado (x, y). `tolerancia` 0–100 (%). `contiguo`: só a área ligada ao clique
// (como o balde de tinta); sem isso, todos os pixels parecidos da imagem inteira. `diagonal`: liga também pelas diagonais.
export function varinha(img, x, y, { tolerancia = 25, contiguo = true, diagonal = false } = {}) {
  const { width: w, height: h, data: d } = img;
  x = Math.floor(x); y = Math.floor(y);
  if (!(x >= 0 && y >= 0 && x < w && y < h)) return criarMascara(w, h);
  const cand = candidatos(img, [corEm(d, y * w + x)], tolerancia);
  return contiguo ? inundar(cand, 1, w, h, [[x, y]], diagonal, new Int32Array(w * h)) : soBit(cand, 1, w, h);
}

// Fundo liso: varinha a partir dos 4 cantos, somadas. Serve para tirar o fundo de uma foto de estúdio ou de um desenho em
// papel branco. As quatro cores são testadas na MESMA leitura da imagem, e os cantos de cor igual viajam numa travessia só
// (com a mesma cor de referência, a união das travessias é a travessia da união das sementes).
export function selecaoDosCantos(img, { tolerancia = 25, contiguo = true, diagonal = false } = {}) {
  const { width: w, height: h, data: d } = img;
  const grupos = new Map();                          // "r,g,b,a" → sementes daquela cor exata
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    if (cx < 0 || cy < 0) continue;                  // imagem de 1 px de lado: os cantos se repetem
    const i = (cy * w + cx) * 4, chave = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
    if (grupos.has(chave)) grupos.get(chave).push([cx, cy]);
    else grupos.set(chave, [[cx, cy]]);
  }
  const sementesPorCor = [...grupos.values()];
  if (!sementesPorCor.length) return criarMascara(w, h);
  const cores = sementesPorCor.map((ss) => corEm(d, ss[0][1] * w + ss[0][0]));
  const cand = candidatos(img, cores, tolerancia);

  let m = null;
  const pilha = contiguo ? new Int32Array(w * h) : null;
  for (let c = 0; c < cores.length; c++) {
    const bit = 1 << c;
    const parcial = contiguo ? inundar(cand, bit, w, h, sementesPorCor[c], diagonal, pilha) : soBit(cand, bit, w, h);
    m = m ? combinar(m, parcial, 'unir') : parcial;
  }
  return m;
}

// ---------- máscaras ----------
// O modo é decidido UMA vez, antes do laço: comparar texto a cada pixel custa mais que a conta em si.
export function combinar(a, b, modo = 'substituir') {
  const n = a.length, o = new Uint8Array(n);
  if (modo === 'unir') { for (let i = 0; i < n; i++) o[i] = a[i] | b[i]; }
  else if (modo === 'subtrair') { for (let i = 0; i < n; i++) o[i] = a[i] & ~b[i] & 1; }
  else if (modo === 'interseccao') { for (let i = 0; i < n; i++) o[i] = a[i] & b[i]; }
  else o.set(b.subarray(0, n));
  return o;
}
export const inverter = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };

// Cresce (n > 0) ou encolhe (n < 0) a seleção em |n| pixels (quadrado). Útil para pegar o "halo" que sobra na borda ao tirar o fundo.
export function ajustarBorda(m, width, height, n) {
  const r = Math.abs(Math.round(n));
  if (!r) return new Uint8Array(m);
  const cresce = n > 0;
  // Crescer é "há algum 1 na janela"; encolher é "são todos 1". Com a CONTAGEM de 1 na janela, os dois viram comparações de
  // inteiro: >0 e ==tamanho. A contagem anda com o pixel (entra um, sai outro), então o custo não cresce com o raio.
  // Fora da imagem conta como "o que a seleção não é" ao crescer e como "é" ao encolher — a borda não come a seleção.
  const fora = cresce ? 0 : 1;
  const meio = new Uint8Array(m.length), fim = new Uint8Array(m.length);

  for (let y = 0; y < height; y++) {                     // horizontal
    const base = y * width, ultimo = width - 1;
    let soma = 0, janela = 0;
    for (let k = -r; k <= r; k++) { soma += k < 0 || k > ultimo ? fora : m[base + k]; janela++; }
    for (let x = 0; x < width; x++) {
      meio[base + x] = (cresce ? soma > 0 : soma === janela) ? 1 : 0;
      const entra = x + r + 1, sai = x - r;
      soma += (entra > ultimo ? fora : m[base + entra]) - (sai < 0 ? fora : m[base + sai]);
    }
  }
  for (let x = 0; x < width; x++) {                      // vertical
    const ultimo = height - 1;
    let soma = 0, janela = 0;
    for (let k = -r; k <= r; k++) { soma += k < 0 || k > ultimo ? fora : meio[k * width + x]; janela++; }
    for (let y = 0; y < height; y++) {
      fim[y * width + x] = (cresce ? soma > 0 : soma === janela) ? 1 : 0;
      const entra = y + r + 1, sai = y - r;
      soma += (entra > ultimo ? fora : meio[entra * width + x]) - (sai < 0 ? fora : meio[sai * width + x]);
    }
  }
  return fim;
}

// Caixa que envolve a seleção: { x, y, w, h } ou null se vazia.
export function caixaDaMascara(m, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (m[y * width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Borda suave: desfoca a máscara (média em caixa, `raio` px) para a transparência não ter degrau.
// Duas passadas de média em caixa (horizontal e vertical) com SOMA CORRENTE: ao andar um pixel, entra um valor e sai outro,
// em vez de somar os 2r+1 de novo — trabalho que não cresce com o raio. Fora da imagem a borda se repete (era o que o
// `clamp` fazia), e é por isso que cada janela começa com o primeiro valor contado r+1 vezes.
//
// Os dois sentidos são escritos separados de propósito: uma função de indexação escolhida por `horizontal` custaria três
// chamadas por pixel e come o ganho (medido).
export function desfocar(m, width, height, raio) {
  const r = Math.max(0, Math.round(raio));
  const f = Float32Array.from(m);
  if (!r) return f;
  const n = 2 * r + 1, meio = new Float32Array(f.length), fim = new Float32Array(f.length);

  for (let y = 0; y < height; y++) {                     // horizontal
    const base = y * width, ultimo = width - 1;
    let soma = f[base] * (r + 1);
    for (let k = 1; k <= r; k++) soma += f[base + (k < width ? k : ultimo)];
    for (let x = 0; x < width; x++) {
      meio[base + x] = soma / n;
      const entra = x + r + 1, sai = x - r;
      soma += f[base + (entra < width ? entra : ultimo)] - f[base + (sai > 0 ? sai : 0)];
    }
  }
  for (let x = 0; x < width; x++) {                      // vertical
    const ultimo = (height - 1) * width;
    let soma = meio[x] * (r + 1);
    for (let k = 1; k <= r; k++) soma += meio[x + (k < height ? k * width : ultimo)];
    for (let y = 0; y < height; y++) {
      fim[y * width + x] = soma / n;
      const entra = y + r + 1, sai = y - r;
      soma += meio[x + (entra < height ? entra * width : ultimo)] - meio[x + (sai > 0 ? sai * width : 0)];
    }
  }
  return fim;
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
