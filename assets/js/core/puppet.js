// Rig de peças do ArtAtk (puppet animation) — lógica PURA: sem DOM, sem DOMParser, sem relógio, roda igual no Node (testes) e na página.
//
// PORQUÊ um leitor de SVG próprio: o DOMParser não existe no Node e, no navegador, devolve o que o autor colou sem filtro. Aqui o texto
// passa por um leitor tolerante que já descarta o que é perigoso (<script>, <foreignObject>, on*=, javascript:, hrefs externos) ANTES de
// virar peça. Dado de fora nunca é confiável: tudo que entra no rig passa por normalizarRig.
//
// Modelo do rig (REQ-AN §4):
//   { v:1, nome, viewBox:[x,y,w,h], duracao:ms, pecas:[{ id, nome, pai, pivo:{x,y}, conteudo:<fragmento SVG>, z }],
//     trilhas:{ [pecaId]:{ x:[{t,v,curva}], y, rot, escala, opac } },  defs?:<fragmento>, heranca?:{ fill, stroke… } }
//   Extensões (opcionais) além do contrato: `defs` guarda o que o SVG original tem fora das peças (gradientes, <style>, filtros) e
//   `heranca` os atributos de apresentação do <svg> raiz (fill, stroke…) que as peças herdavam — sem eles o desenho exportado mudaria.
//
// Convenções escolhidas (o contrato não fecha todas):
//  - Funções que "editam" (adicionarPeca, definirPai, definirQuadro…) NÃO alteram o rig: devolvem um rig NOVO (o desfazer da tela
//    fica trivial). Quando a operação é recusada (ciclo, limite de peças) devolvem o MESMO objeto — compare com ===.
//  - adicionarPeca devolve o rig; a peça nova é a última de `pecas` (ou passe `id`).
//  - O pivô e o conteúdo estão no sistema de coordenadas do viewBox (a raiz), nunca no da peça-pai.
//  - Pose de uma peça: { x, y, rot, escala, opac }. Matriz local = T(pivô)·T(x,y)·R(rot)·S(escala)·T(−pivô); a do mundo é
//    mundo(pai)·local. É exatamente o que o SVG exportado faz com <g> aninhados, então o que a tela mostra = o que sai no arquivo.
//  - Os filhos desenham depois (por cima) do conteúdo do pai; entre irmãos vale `z` (menor primeiro) e, empatando, a ordem da lista.
//  - Caixas de forma ignoram a espessura do traço; <text> usa estimativa (0,6 × tamanho da fonte por caractere); porcentagens e
//    unidades (px, pt, %) são lidas como número puro; a caixa de uma forma girada é a dos 4 cantos girados (aproximação).
//  - SMIL não tem como obedecer a prefers-reduced-motion só com marcação: o SVG exportado leva data-puppet="1" e a página (runtime)
//    pode chamar svg.pauseAnimations() quando a pessoa pedir movimento reduzido; exportarSvgPose gera o quadro parado equivalente.
//  - Curvas que o SMIL não expressa (ease-out-back, bounce, degrau…) viram vários pontos amostrados com a MESMA função do motor
//    (anim-motor.js), então o SVG exportado acompanha poseEm; só 'degrau' é aproximado por uma rampa de 1 ms.
import { valorEm, porQuadro, semQuadro, ordenarQuadros, CURVAS } from './anim-motor.js';

export const LIMITES = { pecas: 80, duracaoMin: 100, duracaoMax: 60000, duracaoPadrao: 2000, quadrosPorTrilha: 200, textoMax: 2000000, nos: 20000, profundidade: 64 };
export const PROPS_DO_RIG = {
  x: { rotulo: 'Mover X', un: 'px', padrao: 0, min: -5000, max: 5000 },
  y: { rotulo: 'Mover Y', un: 'px', padrao: 0, min: -5000, max: 5000 },
  rot: { rotulo: 'Girar', un: '°', padrao: 0, min: -1440, max: 1440 },
  escala: { rotulo: 'Escala', un: '×', padrao: 1, min: 0, max: 8 },
  opac: { rotulo: 'Opacidade', un: '', padrao: 1, min: 0, max: 1 },
};
export const NOMES_DAS_PROPS = Object.keys(PROPS_DO_RIG);
export const POSE_PADRAO = Object.freeze({ x: 0, y: 0, rot: 0, escala: 1, opac: 1 });

const r4 = (n) => Math.round(n * 1e4) / 1e4 + 0;                // "+ 0" troca -0 por 0 (o JSON e o deepEqual os distinguem)
const finito = Number.isFinite;
const prender = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, padrao = 0) => { const n = typeof v === 'string' ? parseFloat(v) : v; return finito(n) ? n : padrao; };
// número para texto de SVG: no máximo 4 casas, sem "-0" e sem zeros à toa
const fmt = (n) => { const v = r4(n); return String(Object.is(v, -0) || v === 0 ? 0 : v); };

// ======================================================================================================================
// 1) LEITOR DE SVG
// ======================================================================================================================
const TAGS_RECUSADAS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base', 'metadata']);
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const ATRIBUTOS_COM_DOIS_PONTOS = new Set(['xlink:href', 'xml:space', 'xmlns', 'xmlns:xlink']);

function decodificar(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const cod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!finito(cod) || cod <= 0 || cod > 0x10ffff || (cod >= 0xd800 && cod <= 0xdfff)) return '';
      return String.fromCodePoint(cod);
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m;
  }).replace(CONTROLES, '');
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escTexto = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const noTexto = (texto) => ({ tag: '#texto', attrs: {}, filhos: [], texto });
const novoNo = (tag) => ({ tag, attrs: {}, filhos: [], texto: '' });

// Aplica as regras de segurança a um atributo. Devolve [nome, valor] ou null (descartado), anotando o motivo em `avisos`.
function atributoSeguro(nome, valor, avisos) {
  const n = nome.toLowerCase();
  if (n.startsWith('on')) { avisos.add('Removi atributos de evento (on…)'); return null; }
  if (nome.includes(':') && !ATRIBUTOS_COM_DOIS_PONTOS.has(n)) return null;       // inkscape:, sodipodi:… (o inkscape:label é tratado antes)
  if (/(javascript|vbscript)\s*:/i.test(valor)) { avisos.add('Removi valores com javascript:'); return null; }
  if (n === 'href' || n === 'xlink:href') {
    if (!(valor.startsWith('#') || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(valor))) { avisos.add('Removi links externos (href)'); return null; }
  }
  if (n === 'style') valor = valor.replace(/expression\s*\(/gi, '(');
  return [nome, valor];
}

// Pula um elemento recusado inteiro (com tudo que tem dentro). Devolve o índice logo depois do fechamento.
function pularElemento(s, i, tag) {
  const nome = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (tag.toLowerCase() === 'script') {
    const m = new RegExp('</' + nome + '\\s*>', 'ig'); m.lastIndex = i;
    const r = m.exec(s); return r ? r.index + r[0].length : s.length;
  }
  const re = new RegExp('<(/?)' + nome + '(?=[\\s/>])[^>]*?(/?)>', 'ig'); re.lastIndex = i;
  let prof = 1, r;
  while (prof > 0 && (r = re.exec(s))) { if (r[1]) prof--; else if (!r[2]) prof++; }
  return r ? re.lastIndex : s.length;
}

const ABRE_TAG = /<([A-Za-z_][\w:.-]*)/y;
const ATRIBUTO = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*?)(?=\s|\/?>)))?/y;

// Leitor tolerante: nunca lança. Devolve { raiz, topo, avisos }: raiz = primeiro <svg> encontrado (ou null), topo = nó falso que
// contém tudo que veio no texto (serve para ler FRAGMENTOS, sem <svg> em volta).
function analisar(texto) {
  const s = String(texto ?? '').slice(0, LIMITES.textoMax);
  const avisos = new Set();
  const topo = novoNo('#raiz');
  const pilha = [topo];
  let i = 0, contagem = 0;
  const atual = () => pilha[pilha.length - 1];
  const addTexto = (t) => { if (t.trim()) { const d = atual(); d.filhos.push(noTexto(t)); d.texto += t; } };

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { addTexto(decodificar(s.slice(i))); break; }
    if (lt > i) addTexto(decodificar(s.slice(i, lt)));
    i = lt;
    if (s.startsWith('<!--', i)) { const f = s.indexOf('-->', i + 4); i = f < 0 ? s.length : f + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) { const f = s.indexOf(']]>', i + 9); addTexto(s.slice(i + 9, f < 0 ? s.length : f).replace(CONTROLES, '')); i = f < 0 ? s.length : f + 3; continue; }
    if (s.startsWith('<?', i)) { const f = s.indexOf('?>', i + 2); i = f < 0 ? s.length : f + 2; continue; }
    if (s.startsWith('<!', i)) {                                                  // DOCTYPE (entidades declaradas nele NÃO são expandidas)
      const f = s.indexOf('>', i), c = s.indexOf('[', i);
      if (c >= 0 && f >= 0 && c < f) { const f2 = s.indexOf(']>', c); i = f2 < 0 ? s.length : f2 + 2; } else i = f < 0 ? s.length : f + 1;
      continue;
    }
    if (s.startsWith('</', i)) {                                                  // fechamento
      const f = s.indexOf('>', i), nome = s.slice(i + 2, f < 0 ? s.length : f).trim();
      i = f < 0 ? s.length : f + 1;
      for (let k = pilha.length - 1; k > 0; k--) if (pilha[k].tag === nome) { pilha.length = k; break; }   // fecha também os esquecidos abertos dentro
      continue;
    }
    ABRE_TAG.lastIndex = i;
    const ab = ABRE_TAG.exec(s);
    if (!ab) { addTexto('<'); i++; continue; }                                   // "<" solto no texto
    const tag = ab[1];
    let j = i + ab[0].length, fechaSozinho = false, terminou = false, label = null;
    const attrs = {};
    while (j < s.length) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '>') { j++; terminou = true; break; }
      if (s[j] === '/' && s[j + 1] === '>') { j += 2; fechaSozinho = terminou = true; break; }
      ATRIBUTO.lastIndex = j;
      const am = ATRIBUTO.exec(s);
      if (!am || am[0].length === 0) { j++; continue; }
      j += am[0].length;
      const bruto = am[2] ?? am[3] ?? am[4] ?? '';
      if (am[1] === 'inkscape:label') { label = decodificar(bruto); continue; }
      const ok = atributoSeguro(am[1], decodificar(bruto), avisos);
      if (ok && !(ok[0] in attrs) && Object.keys(attrs).length < 120) attrs[ok[0]] = ok[1];
    }
    if (!terminou) break;                                                          // tag nunca fechada: o resto é lixo
    i = j;
    const baixa = tag.toLowerCase();
    if (TAGS_RECUSADAS.has(baixa) || (tag.includes(':') && !/^svg:/i.test(tag))) {
      if (TAGS_RECUSADAS.has(baixa) && baixa !== 'metadata') avisos.add(`Removi <${baixa === 'foreignobject' ? 'foreignObject' : baixa}>`);
      if (!fechaSozinho) i = pularElemento(s, i, tag);
      continue;
    }
    if (/^(animate|set|animatetransform|animatemotion)$/i.test(baixa) && /href/i.test(attrs.attributeName || '')) { avisos.add('Removi animação que mexia em links'); continue; }
    if (++contagem > LIMITES.nos || pilha.length > LIMITES.profundidade) { avisos.add('O SVG é grande demais: li só o começo'); break; }
    const no = novoNo(tag.replace(/^svg:/i, ''));
    no.attrs = attrs;
    if (label && !('data-nome' in attrs)) no.attrs['data-nome'] = label;
    atual().filhos.push(no);
    if (baixa === 'style' && !fechaSozinho) {                                       // texto cru até </style>
      const re = /<\/style\s*>/ig; re.lastIndex = i;
      const r = re.exec(s), corpo = s.slice(i, r ? r.index : s.length);
      i = r ? r.index + r[0].length : s.length;
      const css = decodificar(corpo.replace(/<!\[CDATA\[|\]\]>/g, '')).replace(/@import[^;]*;?/gi, '').replace(/javascript\s*:/gi, '');
      if (css.trim()) { no.filhos.push(noTexto(css)); no.texto = css; }
      continue;
    }
    if (!fechaSozinho) pilha.push(no);
  }
  const achar = (n) => { for (const f of n.filhos) { if (f.tag.toLowerCase() === 'svg') return f; const r = achar(f); if (r) return r; } return null; };
  const raiz = achar(topo);
  if (raiz) raiz.tag = 'svg';
  return { raiz, topo, avisos: [...avisos] };
}

// Lê o texto de um SVG e devolve a árvore { tag, attrs, filhos, texto } do <svg> (ou null se não achar nenhum). Nós de texto têm tag '#texto'.
export const lerSvg = (texto) => analisar(texto).raiz;
// Igual a lerSvg, mas também diz o que foi removido por segurança: { raiz, avisos:[pt-BR] }.
export const lerSvgComAvisos = (texto) => { const { raiz, avisos } = analisar(texto); return { raiz, avisos }; };

// Árvore → texto (atributos escapados, filhos na ordem original).
export function serializar(no) {
  if (!no) return '';
  if (no.tag === '#texto') return escTexto(no.texto);
  const attrs = Object.entries(no.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (!no.filhos?.length) return `<${no.tag}${attrs}/>`;
  return `<${no.tag}${attrs}>${no.filhos.map(serializar).join('')}</${no.tag}>`;
}

// ======================================================================================================================
// 2) GEOMETRIA: matrizes afins, transform="", caminhos e caixas
// ======================================================================================================================
// Matriz [a,b,c,d,e,f] = [[a c e],[b d f],[0 0 1]] (a mesma ordem do matrix() do SVG).
export const IDENTIDADE = Object.freeze([1, 0, 0, 1, 0, 0]);
export const multiplicar = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const aplicarMatriz = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export const translacao = (x, y) => [1, 0, 0, 1, x, y];
export const rotacao = (graus) => { const a = (graus * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
export const escalar = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function inverterMatriz(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!finito(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const RE_NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const numeros = (s) => (String(s ?? '').match(RE_NUM) || []).map(Number).filter(finito);

// transform="translate(10 5) rotate(30) scale(2)…" → matriz. Função desconhecida ou malformada é ignorada (vale identidade).
export function lerTransform(texto) {
  let m = IDENTIDADE;
  for (const mt of String(texto || '').matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const a = numeros(mt[2]);
    let t = null;
    switch (mt[1]) {
      case 'matrix': if (a.length >= 6) t = a.slice(0, 6); break;
      case 'translate': t = translacao(a[0] ?? 0, a[1] ?? 0); break;
      case 'scale': t = escalar(a[0] ?? 1, a[1] ?? a[0] ?? 1); break;
      case 'rotate': if (a.length) { const r = rotacao(a[0]); t = a.length >= 3 ? multiplicar(multiplicar(translacao(a[1], a[2]), r), translacao(-a[1], -a[2])) : r; } break;
      case 'skewX': if (a.length) t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': if (a.length) t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    if (t) m = multiplicar(m, t);
  }
  return m;
}

// ---------- caminhos (path d="…") ----------
// Lê d="" e devolve segmentos ABSOLUTOS: M{x,y} L{x,y} C{x1,y1,x2,y2,x,y} Q{x1,y1,x,y} A{rx,ry,rot,grande,varre,x,y} Z.
// H/V viram L; S e T viram C e Q (com o ponto de controle refletido); comandos relativos (minúsculas) viram absolutos. Parar no primeiro erro
// e devolver o que já foi lido é de propósito (como o navegador faz).
export function lerCaminho(d) {
  const s = String(d || ''), n = s.length, out = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, ctrlC = null, ctrlQ = null;
  const sep = () => { while (i < n && (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++; };
  const re = new RegExp(RE_NUM.source, 'y');
  const numero = () => { sep(); re.lastIndex = i; const m = re.exec(s); if (!m) return null; i += m[0].length; return Number(m[0]); };
  const flag = () => { sep(); const c = s[i]; if (c === '0' || c === '1') { i++; return +c; } return null; };
  const ler = (k) => { const v = []; for (let q = 0; q < k; q++) { const x = numero(); if (x === null) return null; v.push(x); } return v; };
  while (true) {
    sep();
    if (i >= n) break;
    const ch = s[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      cmd = ch; i++;
      if (cmd === 'Z' || cmd === 'z') { if (!out.length) break; out.push({ c: 'Z' }); cx = sx; cy = sy; ctrlC = ctrlQ = null; cmd = null; continue; }
    } else if (cmd === null) break;
    if (!out.length && cmd !== 'M' && cmd !== 'm') break;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
    let v;
    if (C === 'M' || C === 'L' || C === 'T') {
      if (!(v = ler(2))) break;
      const x = v[0] + ox, y = v[1] + oy;
      if (C === 'M') { out.push({ c: 'M', x, y }); sx = x; sy = y; cmd = rel ? 'l' : 'L'; ctrlC = ctrlQ = null; }
      else if (C === 'L') { out.push({ c: 'L', x, y }); ctrlC = ctrlQ = null; }
      else { const qx = ctrlQ ? 2 * cx - ctrlQ.x : cx, qy = ctrlQ ? 2 * cy - ctrlQ.y : cy; out.push({ c: 'Q', x1: qx, y1: qy, x, y }); ctrlQ = { x: qx, y: qy }; ctrlC = null; }
      cx = x; cy = y;
    } else if (C === 'H') { if (!(v = ler(1))) break; cx = v[0] + ox; out.push({ c: 'L', x: cx, y: cy }); ctrlC = ctrlQ = null; }
    else if (C === 'V') { if (!(v = ler(1))) break; cy = v[0] + oy; out.push({ c: 'L', x: cx, y: cy }); ctrlC = ctrlQ = null; }
    else if (C === 'C') {
      if (!(v = ler(6))) break;
      const seg = { c: 'C', x1: v[0] + ox, y1: v[1] + oy, x2: v[2] + ox, y2: v[3] + oy, x: v[4] + ox, y: v[5] + oy };
      out.push(seg); ctrlC = { x: seg.x2, y: seg.y2 }; ctrlQ = null; cx = seg.x; cy = seg.y;
    } else if (C === 'S') {
      if (!(v = ler(4))) break;
      const x1 = ctrlC ? 2 * cx - ctrlC.x : cx, y1 = ctrlC ? 2 * cy - ctrlC.y : cy;
      const seg = { c: 'C', x1, y1, x2: v[0] + ox, y2: v[1] + oy, x: v[2] + ox, y: v[3] + oy };
      out.push(seg); ctrlC = { x: seg.x2, y: seg.y2 }; ctrlQ = null; cx = seg.x; cy = seg.y;
    } else if (C === 'Q') {
      if (!(v = ler(4))) break;
      const seg = { c: 'Q', x1: v[0] + ox, y1: v[1] + oy, x: v[2] + ox, y: v[3] + oy };
      out.push(seg); ctrlQ = { x: seg.x1, y: seg.y1 }; ctrlC = null; cx = seg.x; cy = seg.y;
    } else if (C === 'A') {
      const a = ler(3); if (!a) break;
      const g = flag(), vr = flag(); if (g === null || vr === null) break;
      const p = ler(2); if (!p) break;
      const seg = { c: 'A', rx: a[0], ry: a[1], rot: a[2], grande: g, varre: vr, x: p[0] + ox, y: p[1] + oy };
      out.push(seg); ctrlC = ctrlQ = null; cx = seg.x; cy = seg.y;
    }
  }
  return out;
}

// Arco do SVG (ponto final) → arco centrado (spec SVG, F.6.5). null quando o arco degenera numa reta.
function arcoCentrado(x1, y1, a) {
  let rx = Math.abs(a.rx), ry = Math.abs(a.ry);
  if (!rx || !ry || (x1 === a.x && y1 === a.y)) return null;
  const phi = (a.rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx2 = (x1 - a.x) / 2, dy2 = (y1 - a.y) / 2;
  const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const numer = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (a.grande === a.varre ? -1 : 1) * Math.sqrt(Math.max(0, numer / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + a.x) / 2, cy = sin * cxp + cos * cyp + (y1 + a.y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry, vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const t1 = ang(1, 0, ux, uy);
  let dt = ang(ux, uy, vx, vy);
  if (!a.varre && dt > 0) dt -= 2 * Math.PI; else if (a.varre && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, t1, dt };
}

// Caixa { x, y, w, h } de segmentos absolutos (de lerCaminho), com os extremos EXATOS das curvas (não só dos pontos de controle) e dos arcos.
export function caixaDoCaminho(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0, sx = 0, sy = 0, tem = false;
  const ponto = (x, y) => { tem = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const raizes = (a, b, c) => {
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const dis = b * b - 4 * a * c;
    if (dis < 0) return [];
    const q = Math.sqrt(dis);
    return [(-b + q) / (2 * a), (-b - q) / (2 * a)];
  };
  const cubica = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
  const quad = (p0, p1, p2, t) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
  for (const g of segs) {
    if (g.c === 'M') { ponto(g.x, g.y); cx = sx = g.x; cy = sy = g.y; }
    else if (g.c === 'L') { ponto(cx, cy); ponto(g.x, g.y); cx = g.x; cy = g.y; }
    else if (g.c === 'Z') { cx = sx; cy = sy; }
    else if (g.c === 'C') {
      ponto(cx, cy); ponto(g.x, g.y);
      const ts = [...raizes(-cx + 3 * g.x1 - 3 * g.x2 + g.x, 2 * (cx - 2 * g.x1 + g.x2), g.x1 - cx), ...raizes(-cy + 3 * g.y1 - 3 * g.y2 + g.y, 2 * (cy - 2 * g.y1 + g.y2), g.y1 - cy)];
      for (const t of ts) if (t > 0 && t < 1) ponto(cubica(cx, g.x1, g.x2, g.x, t), cubica(cy, g.y1, g.y2, g.y, t));
      cx = g.x; cy = g.y;
    } else if (g.c === 'Q') {
      ponto(cx, cy); ponto(g.x, g.y);
      for (const [a, b, c] of [[cx, g.x1, g.x], [cy, g.y1, g.y]]) {
        const den = a - 2 * b + c;
        if (Math.abs(den) > 1e-12) { const t = (a - b) / den; if (t > 0 && t < 1) ponto(quad(cx, g.x1, g.x, t), quad(cy, g.y1, g.y, t)); }
      }
      cx = g.x; cy = g.y;
    } else if (g.c === 'A') {
      ponto(cx, cy); ponto(g.x, g.y);
      const ar = arcoCentrado(cx, cy, g);
      if (ar) {
        const { cx: ccx, cy: ccy, rx, ry, phi, t1, dt } = ar, cs = Math.cos(phi), sn = Math.sin(phi), volta = 2 * Math.PI;
        for (const base of [Math.atan2(-ry * sn, rx * cs), Math.atan2(ry * cs, rx * sn)]) for (const th of [base, base + Math.PI]) {
          const d = dt >= 0 ? (((th - t1) % volta) + volta) % volta : (((t1 - th) % volta) + volta) % volta;
          if (d <= Math.abs(dt)) ponto(ccx + rx * cs * Math.cos(th) - ry * sn * Math.sin(th), ccy + rx * sn * Math.cos(th) + ry * cs * Math.sin(th));
        }
      }
      cx = g.x; cy = g.y;
    }
  }
  return tem ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const uniao = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
function caixaTransformada(c, m) {
  if (!c) return null;
  const pts = [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].map(([x, y]) => aplicarMatriz(m, x, y));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
const NAO_DESENHA = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'pattern', 'clippath', 'mask', 'symbol', 'marker', 'filter', 'script', 'animate', 'animatetransform', 'animatemotion', 'set', 'stop', '#texto']);
const CONTAINERS = new Set(['g', 'a', 'svg', 'switch']);

// Caixa { x, y, w, h } de um nó, no sistema do PAI dele (já aplica o transform="" do próprio nó). null se não desenha nada.
// `ids` (opcional) = mapa id → nó, para resolver <use href="#…">. `orc` (interno) limita o trabalho total e impede <use> que aponta para
// um ancestral dele (ou cadeias de <use> que se multiplicam, tipo "bilhão de risadas"): sem isso um SVG malicioso travaria a aba.
export function caixaDe(no, ids = null, prof = 0, orc = { n: 0, ativos: new Set() }) {
  if (!no || prof > LIMITES.profundidade || ++orc.n > LIMITES.nos || NAO_DESENHA.has(no.tag.toLowerCase())) return null;
  const a = no.attrs || {};
  if (a.display === 'none' || /display\s*:\s*none/.test(a.style || '')) return null;
  const tag = no.tag.toLowerCase(), N = (k, p = 0) => num(a[k], p);
  let c = null;
  switch (tag) {
    case 'rect': case 'image': c = { x: N('x'), y: N('y'), w: Math.max(0, N('width')), h: Math.max(0, N('height')) }; break;
    case 'circle': { const r = Math.max(0, N('r')); c = { x: N('cx') - r, y: N('cy') - r, w: 2 * r, h: 2 * r }; break; }
    case 'ellipse': { const rx = Math.max(0, N('rx')), ry = Math.max(0, a.ry !== undefined ? N('ry') : rx); c = { x: N('cx') - rx, y: N('cy') - ry, w: 2 * rx, h: 2 * ry }; break; }
    case 'line': { const x0 = N('x1'), y0 = N('y1'), x1 = N('x2'), y1 = N('y2'); c = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; break; }
    case 'polygon': case 'polyline': {
      const v = numeros(a.points), xs = [], ys = [];
      for (let k = 0; k + 1 < v.length; k += 2) { xs.push(v[k]); ys.push(v[k + 1]); }
      if (xs.length) c = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      break;
    }
    case 'path': c = caixaDoCaminho(lerCaminho(a.d)); break;
    case 'text': {                                                               // estimativa: não há como medir fonte sem navegador
      const tam = N('font-size', 16), t = no.filhos.map((f) => f.texto || (f.filhos || []).map((g) => g.texto).join('')).join('').length;
      const larg = t * tam * 0.6, x = N('x'), y = N('y'), anc = a['text-anchor'];
      c = { x: anc === 'middle' ? x - larg / 2 : anc === 'end' ? x - larg : x, y: y - tam * 0.8, w: larg, h: tam };
      break;
    }
    case 'use': {
      const ref = String(a.href || a['xlink:href'] || '').replace(/^#/, ''), alvo = ids?.get(ref);
      if (alvo && alvo !== no && !orc.ativos.has(alvo)) {
        orc.ativos.add(alvo);
        const cb = caixaDe(alvo, ids, prof + 1, orc);
        orc.ativos.delete(alvo);
        if (cb) c = { x: cb.x + N('x'), y: cb.y + N('y'), w: cb.w, h: cb.h };
      }
      break;
    }
    default:
      if (CONTAINERS.has(tag)) for (const f of no.filhos) c = uniao(c, caixaDe(f, ids, prof + 1, orc));
  }
  return a.transform ? caixaTransformada(c, lerTransform(a.transform)) : c;
}
function mapaDeIds(no, mapa = new Map()) {
  if (no?.attrs?.id) mapa.set(no.attrs.id, no);
  for (const f of no?.filhos || []) mapaDeIds(f, mapa);
  return mapa;
}

// Caixa de um fragmento de SVG serializado (o `conteudo` de uma peça), com cache (a tela pede isso o tempo todo).
const cacheCaixa = new Map();
export function caixaDoConteudo(conteudo) {
  const k = String(conteudo || '');
  if (cacheCaixa.has(k)) return cacheCaixa.get(k);
  let c = null;
  for (const n of analisar(k).topo.filhos) c = uniao(c, caixaDe(n));
  if (cacheCaixa.size > 300) cacheCaixa.clear();
  cacheCaixa.set(k, c);
  return c;
}

// ======================================================================================================================
// 3) RIG: criação, normalização e edição (sempre devolvendo um rig novo)
// ======================================================================================================================
const HERANCA_OK = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'style']);
const TAGS_DE_PECA = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'use', 'a', 'svg', 'switch']);
const VIEWBOX_PADRAO = [0, 0, 400, 300];

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function idUnico(base, usados) {
  let id = slug(base) || 'peca', k = 2;
  const raiz = id;
  while (usados.has(id)) id = `${raiz.slice(0, 36)}-${k++}`;
  usados.add(id);
  return id;
}
const RE_BEZIER = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
// Nome de curva do motor ou cubic-bezier() do CSS com x1 e x2 em [0,1] (fora disso o motor cai em linear, então nem guardamos).
const curvaValida = (c) => {
  if (typeof c !== 'string') return false;
  if (Object.prototype.hasOwnProperty.call(CURVAS, c)) return true;
  const m = RE_BEZIER.exec(c);
  return !!m && [m[1], m[2], m[3], m[4]].every((v) => finito(+v)) && +m[1] >= 0 && +m[1] <= 1 && +m[3] >= 0 && +m[3] <= 1;
};

// Limpa um fragmento de SVG (o conteúdo de uma peça ou os defs): relê e reserializa, o que descarta script/on*/javascript:.
function limparFragmento(texto, max = 600000) {
  const t = String(texto ?? '');
  if (!t || t.length > max) return '';
  return analisar(t).topo.filhos.map(serializar).join('');
}
function limparHeranca(h) {
  const out = {};
  if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) {
    if (!HERANCA_OK.has(k) || typeof v !== 'string' || v.length > 2000) continue;
    const ok = atributoSeguro(k, v, new Set());
    if (ok) out[k] = ok[1];
  }
  return out;
}
function lerViewBox(v) {
  const a = typeof v === 'string' ? numeros(v) : Array.isArray(v) ? v.map((x) => num(x, NaN)) : [];
  if (a.length !== 4 || !a.every(finito) || a[2] <= 0 || a[3] <= 0) return null;
  return [prender(a[0], -1e5, 1e5), prender(a[1], -1e5, 1e5), prender(a[2], 1e-3, 1e5), prender(a[3], 1e-3, 1e5)].map(r4);
}

function normalizarTrilha(t, duracao) {
  const out = {};
  if (!t || typeof t !== 'object') return out;
  for (const prop of NOMES_DAS_PROPS) {
    const def = PROPS_DO_RIG[prop], lista = t[prop];
    if (!Array.isArray(lista)) continue;
    const q = [];
    for (const k of lista) {
      if (!k || typeof k !== 'object') continue;
      const tt = num(k.t, NaN), v = num(k.v, NaN);
      if (!finito(tt) || !finito(v)) continue;
      q.push({ t: Math.round(prender(tt, 0, duracao)), v: r4(prender(v, def.min, def.max)), ...(curvaValida(k.curva) && k.curva !== 'linear' ? { curva: k.curva } : {}) });
    }
    const ordenado = ordenarQuadros(q), unico = [];
    for (const k of ordenado) { if (unico.length && unico[unico.length - 1].t === k.t) unico[unico.length - 1] = k; else unico.push(k); }   // dois quadros no mesmo instante: vale o último
    if (unico.length) out[prop] = unico.slice(0, LIMITES.quadrosPorTrilha);
  }
  return out;
}

// Normaliza um rig vindo de FORA (arquivo, JSON colado, documento antigo): limita, deduplica ids, quebra ciclos, descarta o desconhecido.
// Nunca lança; sempre devolve um rig válido (vazio, se for o caso). Aplicar duas vezes dá o mesmo resultado.
export function normalizarRig(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  try {
    const duracao = Math.round(prender(num(o.duracao, LIMITES.duracaoPadrao), LIMITES.duracaoMin, LIMITES.duracaoMax));
    const usados = new Set(), brutas = (Array.isArray(o.pecas) ? o.pecas : []).filter((p) => p && typeof p === 'object').slice(0, LIMITES.pecas);
    const pecas = [], idOriginal = new Map();
    brutas.forEach((p, i) => {
      const id = idUnico(typeof p.id === 'string' && slug(p.id) ? p.id : `p${i + 1}`, usados);
      if (typeof p.id === 'string' && !idOriginal.has(p.id)) idOriginal.set(p.id, id);
      pecas.push({
        id, nome: (typeof p.nome === 'string' && p.nome.trim() ? p.nome.trim() : id).slice(0, 60), pai: null,
        pivo: { x: r4(prender(num(p.pivo?.x), -1e5, 1e5)), y: r4(prender(num(p.pivo?.y), -1e5, 1e5)) },
        conteudo: limparFragmento(p.conteudo), z: Math.round(prender(num(p.z, i), -1e6, 1e6)),
      });
    });
    const ids = new Set(pecas.map((p) => p.id)), achar = (chave) => (idOriginal.has(chave) ? idOriginal.get(chave) : ids.has(chave) ? chave : null);
    pecas.forEach((p, i) => {                                                      // pai: tem de existir e não ser a própria peça
      const alvo = typeof brutas[i].pai === 'string' ? achar(brutas[i].pai) : null;
      p.pai = alvo && alvo !== p.id ? alvo : null;
    });
    quebrarCiclos(pecas);
    const trilhas = {};
    if (o.trilhas && typeof o.trilhas === 'object') for (const [chave, bruta] of Object.entries(o.trilhas)) {
      const id = achar(chave);
      if (!id || trilhas[id]) continue;
      const t = normalizarTrilha(bruta, duracao);
      if (Object.keys(t).length) trilhas[id] = t;
    }
    const rig = { v: 1, nome: (typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : 'Animação').slice(0, 80), viewBox: lerViewBox(o.viewBox) || [...VIEWBOX_PADRAO], duracao, pecas, trilhas };
    const defs = limparFragmento(o.defs, 400000);
    if (defs) rig.defs = defs;
    const heranca = limparHeranca(o.heranca);
    if (Object.keys(heranca).length) rig.heranca = heranca;
    return rig;
  } catch {
    return { v: 1, nome: 'Animação', viewBox: [...VIEWBOX_PADRAO], duracao: LIMITES.duracaoPadrao, pecas: [], trilhas: {} };
  }
}
// Quem aparece na própria cadeia de pais perde o pai (corta o laço no ponto onde ele é detectado).
function quebrarCiclos(pecas) {
  const porId = new Map(pecas.map((p) => [p.id, p]));
  for (const p of pecas) {
    const visto = new Set([p.id]);
    for (let a = porId.get(p.pai); a; a = porId.get(a.pai)) {
      if (visto.has(a.id)) { p.pai = null; break; }
      visto.add(a.id);
    }
  }
}

export const rigVazio = (nome = 'Animação', viewBox = VIEWBOX_PADRAO) => normalizarRig({ nome, viewBox, pecas: [] });
export const pecaPorId = (rig, id) => rig.pecas.find((p) => p.id === id) || null;
const trocarPeca = (rig, id, fn) => ({ ...rig, pecas: rig.pecas.map((p) => (p.id === id ? fn(p) : p)) });

// Irmãos de um pai (null = raízes) na ordem de desenho: z crescente e, empatando, a ordem da lista.
export function filhosDe(rig, paiId = null) {
  return rig.pecas.map((p, i) => ({ p, i })).filter(({ p }) => (p.pai ?? null) === paiId).sort((a, b) => a.p.z - b.p.z || a.i - b.i).map(({ p }) => p);
}
// Lista plana em ordem de árvore (pai antes dos filhos): [{ peca, nivel }]. É o que a lista de peças da tela mostra.
export function arvoreDePecas(rig) {
  const out = [], visto = new Set();
  const visita = (paiId, nivel) => { for (const p of filhosDe(rig, paiId)) { if (visto.has(p.id)) continue; visto.add(p.id); out.push({ peca: p, nivel }); visita(p.id, nivel + 1); } };
  visita(null, 0);
  return out;
}
export function descendentes(rig, id) {
  const out = new Set(), pilha = [id];
  while (pilha.length) { const x = pilha.pop(); for (const p of rig.pecas) if (p.pai === x && !out.has(p.id)) { out.add(p.id); pilha.push(p.id); } }
  return out;
}
export const podeSerPai = (rig, id, paiId) => paiId == null || (paiId !== id && !!pecaPorId(rig, paiId) && !!pecaPorId(rig, id) && !descendentes(rig, id).has(paiId));

// Cria o rig a partir de um SVG: cada filho de topo desenhável do <svg> (<g>, formas, texto, imagem) vira UMA peça (pai null, pivô no
// centro da caixa dela). O que não desenha (defs, <style>, gradientes, filtros…) vai para `defs`; fill/stroke do <svg> vão para `heranca`.
// Passando de 80 peças, as que sobram são agrupadas na última. Devolve sempre um rig válido (sem <svg> → rig sem peças).
// Se o SVG foi exportado por exportarSvgAnimado (tem data-puppet e data-rig), o rig volta COMPLETO, com hierarquia, pivôs e quadros.
export function rigDeSvg(texto, { nome = 'Animação' } = {}) {
  const { raiz } = analisar(texto);
  if (!raiz) return rigVazio(nome);
  if (raiz.attrs['data-puppet'] && raiz.attrs['data-rig']) { const volta = restaurarRig(raiz); if (volta) return volta; }   // SVG que saiu deste criador: reabre com a animação
  const ids = mapaDeIds(raiz), a = raiz.attrs;
  const vb = lerViewBox(a.viewBox);
  const alvos = [], defs = [];
  for (const f of raiz.filhos) {
    const tag = f.tag.toLowerCase();
    if (f.tag === '#texto') continue;
    if (TAGS_DE_PECA.has(tag)) { if (!(CONTAINERS.has(tag) && !f.filhos.length && tag !== 'svg')) alvos.push(f); }
    else defs.push(f);
  }
  if (alvos.length > LIMITES.pecas) { const resto = alvos.splice(LIMITES.pecas - 1); alvos.push({ tag: 'g', attrs: { id: 'resto' }, filhos: resto, texto: '' }); }
  const usados = new Set(), caixas = alvos.map((n) => caixaDe(n, ids));
  let viewBox = vb;
  if (!viewBox) {
    const w = num(a.width, 0), h = num(a.height, 0);
    if (w > 0 && h > 0) viewBox = [0, 0, w, h];
    else { const u = caixas.reduce((acc, c) => uniao(acc, c), null); viewBox = u && u.w > 0 && u.h > 0 ? [u.x, u.y, u.w, u.h].map(r4) : [...VIEWBOX_PADRAO]; }
  }
  const centroPadrao = { x: viewBox[0] + viewBox[2] / 2, y: viewBox[1] + viewBox[3] / 2 };
  const contagemDeTags = {};
  const pecas = alvos.map((n, i) => {
    const tag = n.tag.toLowerCase();
    contagemDeTags[tag] = (contagemDeTags[tag] || 0) + 1;
    const base = n.attrs['data-nome'] || n.attrs.id || n.attrs['aria-label'] || `${tag}-${contagemDeTags[tag]}`;
    const id = idUnico(n.attrs.id || base, usados), c = caixas[i];
    return { id, nome: String(base).slice(0, 60), pai: null, pivo: c ? { x: r4(c.x + c.w / 2), y: r4(c.y + c.h / 2) } : centroPadrao, conteudo: serializar(n), z: i };
  });
  const heranca = {};
  for (const [k, v] of Object.entries(a)) if (HERANCA_OK.has(k)) heranca[k] = v;
  return normalizarRig({ nome, viewBox, pecas, defs: defs.map(serializar).join(''), heranca });
}

// Reconstrói o rig de um SVG exportado: a estrutura (peças, pivôs, pais, z, quadros) vem do JSON em data-rig (sem o conteúdo, que seria
// duplicado); o conteúdo de cada peça vem dos próprios <g data-peca>, o que sobra na raiz vira defs. null se algo não bater (cai no
// caminho normal de rigDeSvg). Usa data-peca (e não o id) porque o sanitizeSvg reescreve os ids ao inserir na página.
function restaurarRig(raiz) {
  let meta;
  try { meta = JSON.parse(raiz.attrs['data-rig']); } catch { return null; }
  if (!meta || typeof meta !== 'object' || !Array.isArray(meta.pecas) || !meta.pecas.length) return null;
  const conteudos = new Map(), defs = [], ehPeca = (n) => n.tag === 'g' && n.attrs['data-peca'] != null;
  let ok = true, titulo = false;
  const visita = (g) => {
    const interno = g.filhos.find((f) => f.tag === 'g');
    if (!interno) { ok = false; return; }
    const resto = [];
    for (const f of interno.filhos) { if (ehPeca(f)) visita(f); else resto.push(f); }
    conteudos.set(g.attrs['data-peca'], resto.map(serializar).join(''));
  };
  for (const f of raiz.filhos) {
    if (ehPeca(f)) visita(f);
    else if (f.tag === 'title' && !titulo) titulo = true;
    else if (f.tag !== '#texto') defs.push(f);
  }
  if (!ok || meta.pecas.some((p) => !p || !conteudos.has(p.id))) return null;
  const heranca = {};
  for (const [k, v] of Object.entries(raiz.attrs)) if (HERANCA_OK.has(k)) heranca[k] = v;
  return normalizarRig({ nome: meta.nome, duracao: meta.duracao, viewBox: meta.viewBox || lerViewBox(raiz.attrs.viewBox), pecas: meta.pecas.map((p) => ({ ...p, conteudo: conteudos.get(p.id) })), trilhas: meta.trilhas, defs: defs.map(serializar).join(''), heranca });
}

// ---------- edição (devolve rig novo; recusa → o mesmo objeto) ----------
// Gera um id livre a partir de uma base ("braco" → "braco", "braco-2"…).
export const idNovo = (rig, base = 'peca') => idUnico(base, new Set(rig.pecas.map((p) => p.id)));
export function adicionarPeca(rig, dados = {}) {
  if (rig.pecas.length >= LIMITES.pecas) return rig;
  const id = idNovo(rig, dados.id || dados.nome || 'peca');
  const conteudo = limparFragmento(dados.conteudo);
  const caixa = caixaDoConteudo(conteudo);
  const pivo = dados.pivo && finito(dados.pivo.x) && finito(dados.pivo.y) ? dados.pivo : caixa ? { x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 } : { x: rig.viewBox[0] + rig.viewBox[2] / 2, y: rig.viewBox[1] + rig.viewBox[3] / 2 };
  const pai = typeof dados.pai === 'string' && pecaPorId(rig, dados.pai) ? dados.pai : null;
  const z = finito(dados.z) ? Math.round(dados.z) : Math.max(-1, ...rig.pecas.map((p) => p.z)) + 1;
  const peca = { id, nome: String(dados.nome || id).slice(0, 60), pai, pivo: { x: r4(prender(pivo.x, -1e5, 1e5)), y: r4(prender(pivo.y, -1e5, 1e5)) }, conteudo, z };
  return { ...rig, pecas: [...rig.pecas, peca] };
}
// Tira a peça; os filhos dela sobem para o pai dela e as trilhas dela somem.
export function removerPeca(rig, id) {
  const p = pecaPorId(rig, id);
  if (!p) return rig;
  const trilhas = { ...rig.trilhas };
  delete trilhas[id];
  return { ...rig, pecas: rig.pecas.filter((q) => q.id !== id).map((q) => (q.pai === id ? { ...q, pai: p.pai } : q)), trilhas };
}
export function definirPai(rig, id, paiId) {
  const novo = paiId ?? null;
  const p = pecaPorId(rig, id);
  if (!p || (p.pai ?? null) === novo || !podeSerPai(rig, id, novo)) return rig;      // recusa ciclo (inclusive ser pai de si mesmo)
  return trocarPeca(rig, id, (q) => ({ ...q, pai: novo }));
}
export function moverPivo(rig, id, x, y) {
  if (!pecaPorId(rig, id) || !finito(x) || !finito(y)) return rig;
  return trocarPeca(rig, id, (p) => ({ ...p, pivo: { x: r4(prender(x, -1e5, 1e5)), y: r4(prender(y, -1e5, 1e5)) } }));
}
export function renomearPeca(rig, id, nome) {
  const n = String(nome ?? '').trim().slice(0, 60);
  if (!n || !pecaPorId(rig, id)) return rig;
  return trocarPeca(rig, id, (p) => ({ ...p, nome: n }));
}
// Sobe (delta<0) ou desce (delta>0) a peça na ordem de desenho entre os irmãos, renumerando o z deles de 0 em diante.
export function moverNaOrdem(rig, id, delta) {
  const p = pecaPorId(rig, id);
  if (!p || !delta) return rig;
  const irmaos = filhosDe(rig, p.pai ?? null), de = irmaos.findIndex((q) => q.id === id), para = prender(de + Math.sign(delta) * Math.abs(Math.round(delta)), 0, irmaos.length - 1);
  if (de === para) return rig;
  irmaos.splice(para, 0, irmaos.splice(de, 1)[0]);
  const z = new Map(irmaos.map((q, i) => [q.id, i]));
  return { ...rig, pecas: rig.pecas.map((q) => (z.has(q.id) ? { ...q, z: z.get(q.id) } : q)) };
}
export function definirDuracao(rig, ms) {
  const d = Math.round(prender(num(ms, rig.duracao), LIMITES.duracaoMin, LIMITES.duracaoMax));
  if (d === rig.duracao) return rig;
  const trilhas = {};
  for (const [id, t] of Object.entries(rig.trilhas)) { const n = normalizarTrilha(t, d); if (Object.keys(n).length) trilhas[id] = n; }
  return { ...rig, duracao: d, trilhas };
}
export function definirQuadro(rig, id, prop, tMs, valor, { curva } = {}) {
  const def = PROPS_DO_RIG[prop];
  if (!def || !pecaPorId(rig, id) || !finito(tMs) || !finito(valor)) return rig;
  const t = Math.round(prender(tMs, 0, rig.duracao)), v = r4(prender(valor, def.min, def.max));
  const atual = rig.trilhas[id]?.[prop] || [];
  const c = curvaValida(curva) ? curva : undefined;
  let lista = porQuadro(atual, t, v, { curva: c, eps: 0.5 });
  if (c === 'linear') lista = lista.map((k) => (k.t === t ? (({ curva: _c, ...resto }) => resto)(k) : k));     // "linear" é o padrão: não precisa ficar gravado
  if (lista.length > LIMITES.quadrosPorTrilha) return rig;
  return { ...rig, trilhas: { ...rig.trilhas, [id]: { ...(rig.trilhas[id] || {}), [prop]: lista } } };
}
// Troca só a curva do quadro em t (o valor fica). Sem quadro em t, não faz nada.
export function definirCurva(rig, id, prop, tMs, curva) {
  const q = rig.trilhas[id]?.[prop]?.find((k) => Math.abs(k.t - tMs) <= 0.5);
  return q ? definirQuadro(rig, id, prop, q.t, q.v, { curva: curvaValida(curva) ? curva : 'linear' }) : rig;
}
export function removerQuadro(rig, id, prop, tMs) {
  const lista = rig.trilhas[id]?.[prop];
  if (!lista) return rig;
  const nova = semQuadro(lista, tMs, 0.5);
  if (nova.length === lista.length) return rig;
  const trilha = { ...rig.trilhas[id] };
  if (nova.length) trilha[prop] = nova; else delete trilha[prop];
  const trilhas = { ...rig.trilhas };
  if (Object.keys(trilha).length) trilhas[id] = trilha; else delete trilhas[id];
  return { ...rig, trilhas };
}

// ======================================================================================================================
// 4) POSE, MATRIZES E AMOSTRAGEM
// ======================================================================================================================
// Pose de TODAS as peças no instante tMs: { [id]: { x, y, rot, escala, opac } }. Sem quadros, vale o padrão; antes do primeiro quadro
// e depois do último o valor fica parado (como em qualquer editor de animação).
export function poseEm(rig, tMs) {
  const out = {};
  for (const p of rig.pecas) {
    const tr = rig.trilhas?.[p.id] || {}, pose = {};
    for (const k of NOMES_DAS_PROPS) pose[k] = r4(valorEm(tr[k], tMs, PROPS_DO_RIG[k].padrao));
    out[p.id] = pose;
  }
  return out;
}
const poseDe = (pose, id) => ({ ...POSE_PADRAO, ...(pose?.[id] || {}) });
// Matriz LOCAL da peça: gira/escala em torno do pivô.
export function matrizLocal(peca, p) {
  const { x: px, y: py } = peca.pivo;
  return multiplicar(multiplicar(multiplicar(multiplicar(translacao(px, py), translacao(p.x, p.y)), rotacao(p.rot)), escalar(p.escala)), translacao(-px, -py));
}
// Matrizes do MUNDO: { [id]: [a,b,c,d,e,f] } = mundo(pai)·local. Leva um ponto do desenho original (conteúdo da peça) até onde ele
// aparece no quadro. `pose` = resultado de poseEm (peça ausente = padrão). Seguro contra pai inexistente e ciclo (trata como raiz).
export function matrizes(rig, pose) {
  const porId = new Map(rig.pecas.map((p) => [p.id, p])), memo = {};
  const mundo = (p, vistos) => {
    if (memo[p.id]) return memo[p.id];
    const local = matrizLocal(p, poseDe(pose, p.id)), pai = p.pai && !vistos.has(p.pai) ? porId.get(p.pai) : null;
    vistos.add(p.id);
    return (memo[p.id] = pai ? multiplicar(mundo(pai, vistos), local) : local);
  };
  for (const p of rig.pecas) mundo(p, new Set());
  return memo;
}
// Opacidade efetiva (produto da peça com os pais) — aproximação para quem desenha sem aninhar; no SVG aninhado cada <g> compõe a sua.
export function opacidades(rig, pose) {
  const porId = new Map(rig.pecas.map((p) => [p.id, p])), out = {};
  const f = (p, vistos) => { if (p.id in out) return out[p.id]; vistos.add(p.id); const pai = p.pai && !vistos.has(p.pai) ? porId.get(p.pai) : null; return (out[p.id] = poseDe(pose, p.id).opac * (pai ? f(pai, vistos) : 1)); };
  for (const p of rig.pecas) f(p, new Set());
  return out;
}
// Quadros por segundo → [{ t, pose }] de 0 até a duração (inclusive o último instante). Limita a 6000 quadros (passo maior se preciso).
export function amostrarPoses(rig, fps = 30) {
  const f = prender(num(fps, 30), 1, 120);
  let passo = 1000 / f;
  const n = Math.floor(rig.duracao / passo) + 1;
  if (n > 6000) passo = rig.duracao / 5999;
  const out = [];
  for (let t = 0; t < rig.duracao - 1e-6; t += passo) out.push({ t: r4(t), pose: poseEm(rig, t) });
  out.push({ t: rig.duracao, pose: poseEm(rig, rig.duracao) });
  return out;
}

// ======================================================================================================================
// 5) EXPORTAÇÃO: SVG animado (SMIL) com <g> aninhados que espelham a hierarquia
// ======================================================================================================================
// Estrutura de cada peça (pivô = (px,py), coordenadas do viewBox):
//   <g id="peca-ID" data-peca="ID" transform="translate(px py)" [animateTransform…]>        ← move/gira/escala em torno do pivô
//     <g transform="translate(-px -py)"> conteúdo da peça + <g> dos filhos </g>
//   </g>
// As animateTransform têm additive="sum" e vêm na ordem translate → rotate → scale, o que dá T(pivô)·T(x,y)·R·S·T(−pivô).
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Instantes (ms) em que uma ou mais trilhas precisam de um ponto: todos os quadros + amostras dentro dos trechos com curva não linear.
function momentosDas(trilhas, dur) {
  const ts = new Set([0, dur]);
  for (const q of trilhas) {
    if (!q?.length) continue;
    const l = ordenarQuadros(q);
    for (const k of l) if (k.t > 0 && k.t < dur) ts.add(r4(k.t));
    for (let i = 0; i + 1 < l.length; i++) {
      const a = l[i], b = l[i + 1];
      if (!a.curva || a.curva === 'linear' || a.v === b.v || a.t >= dur) continue;
      if (a.curva === 'degrau') { if (b.t - a.t > 1) ts.add(r4(b.t - 1)); continue; }
      const n = Math.max(2, Math.min(12, Math.floor(600 / Math.max(1, l.length))));
      for (let s = 1; s < n; s++) ts.add(r4(a.t + ((b.t - a.t) * s) / n));
    }
  }
  return [...ts].filter((t) => t >= 0 && t <= dur).sort((a, b) => a - b);
}
const atribDur = (dur, laco) => `dur="${fmt(dur / 1000)}s" begin="0s" ${laco ? 'repeatCount="indefinite"' : 'fill="freeze"'}`;
function animacao(tipo, trilhas, padroes, dur, laco, formata) {
  if (!trilhas.some((t) => t?.length)) return '';
  const ts = momentosDas(trilhas, dur);
  const valores = ts.map((t) => formata(trilhas.map((q, i) => valorEm(q, t, padroes[i])))).join(';');
  const tempos = ts.map((t) => (t === 0 ? '0' : t === dur ? '1' : String(Math.round((t / dur) * 1e6) / 1e6))).join(';');
  return tipo === 'opacity'
    ? `<animate attributeName="opacity" values="${valores}" keyTimes="${tempos}" calcMode="linear" ${atribDur(dur, laco)}/>`
    : `<animateTransform attributeName="transform" type="${tipo}" additive="sum" values="${valores}" keyTimes="${tempos}" calcMode="linear" ${atribDur(dur, laco)}/>`;
}
// transform estático da peça numa pose (o mesmo que a animação produz naquele instante). Útil para a tela atualizar o <g> a cada quadro.
export function transformDaPeca(peca, pose) {
  const p = { ...POSE_PADRAO, ...(pose || {}) };
  return `translate(${fmt(peca.pivo.x)} ${fmt(peca.pivo.y)})${p.x || p.y ? ` translate(${fmt(p.x)} ${fmt(p.y)})` : ''}${p.rot ? ` rotate(${fmt(p.rot)})` : ''}${p.escala !== 1 ? ` scale(${fmt(p.escala)})` : ''}`;
}

function montarGrupos(rig, modo, opcoes) {
  const dur = rig.duracao, laco = opcoes.laco !== false, pose = modo.pose;
  const grupo = (p) => {
    const tr = rig.trilhas[p.id] || {}, pp = poseDe(pose, p.id);
    const filhos = filhosDe(rig, p.id).map(grupo).join('');
    let anim = '', attrs = '';
    if (modo.animar) {
      anim = animacao('translate', [tr.x, tr.y], [0, 0], dur, laco, ([x, y]) => `${fmt(x)} ${fmt(y)}`)
        + animacao('rotate', [tr.rot], [0], dur, laco, ([v]) => fmt(v))
        + animacao('scale', [tr.escala], [1], dur, laco, ([v]) => fmt(v))
        + animacao('opacity', [tr.opac], [1], dur, laco, ([v]) => fmt(v));
      attrs = `transform="translate(${fmt(p.pivo.x)} ${fmt(p.pivo.y)})"`;
    } else {
      attrs = `transform="${transformDaPeca(p, pp)}"${pp.opac !== 1 ? ` opacity="${fmt(pp.opac)}"` : ''}`;
    }
    return `<g id="peca-${escXml(p.id)}" data-peca="${escXml(p.id)}" ${attrs}>${anim}<g transform="translate(${fmt(-p.pivo.x)} ${fmt(-p.pivo.y)})">${p.conteudo}${filhos}</g></g>`;
  };
  return filhosDe(rig, null).map(grupo).join('');
}
// Estrutura do rig SEM o conteúdo (que já está nos <g>): vai em data-rig do <svg>, para reabrir o SVG no criador com a animação (rigDeSvg).
const metaDoRig = (rig) => {
  const trilhas = {};                                   // ordem canônica (peças e propriedades): o mesmo rig sempre exporta o mesmo texto
  for (const p of rig.pecas) { const t = rig.trilhas[p.id]; if (!t) continue; const o = {}; for (const k of NOMES_DAS_PROPS) if (t[k]?.length) o[k] = t[k]; if (Object.keys(o).length) trilhas[p.id] = o; }
  return JSON.stringify({ v: 1, nome: rig.nome, duracao: rig.duracao, viewBox: rig.viewBox, pecas: rig.pecas.map(({ id, nome, pai, pivo, z }) => ({ id, nome, pai, pivo: { x: pivo.x, y: pivo.y }, z })), trilhas });
};
function montarSvg(rig, modo, opcoes) {
  const vb = rig.viewBox.map(fmt).join(' ');
  const heranca = Object.entries(rig.heranca || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const usaXlink = /xlink:/.test(rig.defs || '') || rig.pecas.some((p) => /xlink:/.test(p.conteudo));
  return `<svg xmlns="http://www.w3.org/2000/svg"${usaXlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''} viewBox="${vb}" width="100%" height="100%" data-puppet="1" data-rig="${escAttr(metaDoRig(rig))}"${heranca}>`
    + `<title>${escXml(rig.nome)}</title>${rig.defs || ''}${montarGrupos(rig, modo, opcoes)}</svg>`;
}

// SVG ANIMADO (SMIL), pronto para passar por sanitizeSvg e ser inserido na página. `laco:false` toca uma vez e congela no fim.
export function exportarSvgAnimado(rig, { laco = true } = {}) {
  return montarSvg(rig, { animar: true, pose: null }, { laco });
}
// SVG PARADO na pose de tMs (sem animação): serve de prévia, de quadro de cartaz e de alternativa para movimento reduzido.
// Todo <g> de peça leva data-peca="id": a tela acha e atualiza (transformDaPeca) sem reconstruir tudo, e rigDeSvg reabre o arquivo.
export function exportarSvgPose(rig, tMs = 0) {
  return montarSvg(rig, { animar: false, pose: poseEm(rig, tMs) }, {});
}
