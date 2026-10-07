// Motor de animação v2 do ArtAtk — lógica PURA (sem DOM, sem relógio): curvas de suavização, interpolação de valores e de quadros-chave,
// faixas de rolagem, controladores e presets. É a base comum dos controladores de rolagem, do tempo em tela e do criador de SVG animado:
// todos dependem destas funções e nenhuma delas toca o navegador, então tudo roda igual no Node (testes) e na página.
//
// Ideia central: um efeito é uma FUNÇÃO DO PROGRESSO. Quem anima só precisa responder "qual é o valor em p ∈ [0,1]?"; de onde vem o p
// (tempo, rolagem, ponteiro) é problema de quem chama. Por isso aqui só há matemática.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// ---------- curvas de suavização ----------
// Nome → função de [0,1] em [0,1]. `cubic-bezier(x1,y1,x2,y2)` também vale (igual ao CSS).
export const CURVAS = {
  linear: (t) => t,
  suave: (t) => t * t * (3 - 2 * t),                          // smoothstep
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - (1 - t) ** 3,
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
  'ease-out-back': (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  'ease-out-bounce': (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  degrau: (t) => (t < 1 ? 0 : 1),                              // salta no fim (útil para trocar de estado)
};
export const NOMES_DE_CURVA = Object.keys(CURVAS);

// Bézier cúbica do CSS: dado x (tempo) acha y por bisseção (precisão de sobra para animação).
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s, Y = (s) => ((ay * s + by) * s + cy) * s;
  return (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let lo = 0, hi = 1, s = t;
    for (let i = 0; i < 24; i++) { const x = X(s); if (Math.abs(x - t) < 1e-6) break; if (x < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return Y(s);
  };
}
const cache = new Map();
export function curva(nome) {
  if (typeof nome === 'function') return nome;
  if (CURVAS[nome]) return CURVAS[nome];
  const m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(String(nome || ''));
  if (m) { const k = m.slice(1).map(Number); if (k[0] < 0 || k[0] > 1 || k[2] < 0 || k[2] > 1) return CURVAS.linear; if (!cache.has(nome)) cache.set(nome, bezier(...k)); return cache.get(nome); }
  return CURVAS.linear;
}
export const suavizar = (nome, t) => curva(nome)(clamp01(t));

// ---------- interpolação ----------
// Quadros-chave: [{ t, v, curva? }] ordenados por t. Entre dois quadros vale a curva do quadro de ORIGEM (como nos editores de animação).
// Antes do primeiro e depois do último o valor fica parado. Aceita t em qualquer unidade (ms, 0–1…).
export function valorEm(quadros, t, padrao = 0) {
  if (!Array.isArray(quadros) || !quadros.length) return padrao;
  if (t <= quadros[0].t) return quadros[0].v;
  const n = quadros.length;
  if (t >= quadros[n - 1].t) return quadros[n - 1].v;
  let i = 0;
  while (i < n - 2 && t >= quadros[i + 1].t) i++;
  const a = quadros[i], b = quadros[i + 1], span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 1;
  return lerp(a.v, b.v, suavizar(a.curva || 'linear', u));
}
export const ordenarQuadros = (q) => [...q].filter((k) => Number.isFinite(k?.t) && Number.isFinite(k?.v)).sort((x, y) => x.t - y.t);

// Insere/atualiza um quadro em t (tolerância `eps`), mantendo a ordem. Devolve a lista nova.
export function porQuadro(quadros, t, v, { curva: c, eps = 1e-6 } = {}) {
  const out = ordenarQuadros(quadros || []);
  const i = out.findIndex((k) => Math.abs(k.t - t) <= eps);
  const novo = { t, v, ...(c || (i >= 0 && out[i].curva) ? { curva: c || out[i].curva } : {}) };
  if (i >= 0) out[i] = novo; else { out.push(novo); out.sort((x, y) => x.t - y.t); }
  return out;
}
export const semQuadro = (quadros, t, eps = 1e-6) => (quadros || []).filter((k) => Math.abs(k.t - t) > eps);

// ---------- propriedades animáveis dos controladores ----------
// padrao = valor "neutro" (o que não muda nada). Soma (x, y, rot, blur) ou multiplica (escala, opac) quando há vários controladores.
export const PROPS = {
  x: { rotulo: 'Deslocar X', un: 'px', padrao: 0, min: -3000, max: 3000, modo: 'soma' },
  y: { rotulo: 'Deslocar Y', un: 'px', padrao: 0, min: -3000, max: 3000, modo: 'soma' },
  escala: { rotulo: 'Escala', un: '×', padrao: 1, min: 0, max: 8, modo: 'produto' },
  rot: { rotulo: 'Girar', un: '°', padrao: 0, min: -1440, max: 1440, modo: 'soma' },
  opac: { rotulo: 'Opacidade', un: '', padrao: 1, min: 0, max: 1, modo: 'produto' },
  blur: { rotulo: 'Desfoque', un: 'px', padrao: 0, min: 0, max: 80, modo: 'soma' },
};
export const NOMES_DE_PROP = Object.keys(PROPS);

// ---------- rolagem ----------
// Geometria medida pelo navegador: { topo } = distância do topo do elemento ao topo da janela (px, pode ser negativa), { altura } do
// elemento, { vh } altura da janela, { rolagem } scrollY e { docAltura }. Faixas (como `animation-range` do CSS):
//   entrada  0 quando o topo do elemento aparece embaixo da janela → 1 quando ele acabou de entrar inteiro;
//   saida    0 quando o topo encosta no topo da janela → 1 quando o elemento acabou de sair;
//   cobrir   0 na entrada pelo fundo → 1 na saída pelo topo (a travessia toda);
//   conter   0 quando entrou inteiro → 1 quando começa a sair (elemento mais baixo que a janela);
//   pagina   progresso da rolagem da PÁGINA inteira (0 no topo, 1 no fim).
export const FAIXAS = { entrada: 'Ao entrar', saida: 'Ao sair', cobrir: 'Atravessando a tela', conter: 'Enquanto está inteiro', pagina: 'Página toda' };
export function progressoDaFaixa(g, faixa = 'cobrir') {
  const { topo, altura, vh } = g;
  let p;
  switch (faixa) {
    case 'entrada': p = altura > 0 ? (vh - topo) / altura : topo < vh ? 1 : 0; break;
    case 'saida': p = altura > 0 ? -topo / altura : topo < 0 ? 1 : 0; break;
    case 'conter': { const d = vh - altura; p = d > 0 ? (vh - altura - topo) / d : topo <= 0 ? 1 : 0; break; }
    case 'pagina': { const max = (g.docAltura || 0) - vh; p = max > 0 ? (g.rolagem || 0) / max : 0; break; }
    default: p = (vh + altura) > 0 ? (vh - topo) / (vh + altura) : 0;
  }
  return clamp01(p);
}
// Recorta um sub-trecho [de, ate] da faixa e o reescala para 0–1 (ex.: "só nos primeiros 40% da entrada").
export const remapear = (p, de = 0, ate = 1) => (ate > de ? clamp01((p - de) / (ate - de)) : p >= ate ? 1 : 0);

// ---------- controladores ----------
// Controlador de ROLAGEM: { id, k:'rolagem', faixa, de, ate, curva, props:{ y:[v0,v1], escala:[1,1.2], … }, suave?, dispositivos? }
// Os valores são gravados prontos (não só o nome do preset): o documento publicado continua igual mesmo se os presets mudarem um dia.
export const PRESETS_ROLAGEM = {
  parallax: { nome: 'Parallax (move mais devagar)', faixa: 'cobrir', de: 0, ate: 1, curva: 'linear', props: { y: [70, -70] } },
  'parallax-inverso': { nome: 'Parallax inverso (move mais rápido)', faixa: 'cobrir', de: 0, ate: 1, curva: 'linear', props: { y: [-70, 70] } },
  aparecer: { nome: 'Aparecer ao rolar', faixa: 'entrada', de: 0, ate: 0.7, curva: 'ease-out', props: { opac: [0, 1], y: [48, 0] } },
  sumir: { nome: 'Sumir ao sair', faixa: 'saida', de: 0.2, ate: 1, curva: 'ease-in', props: { opac: [1, 0], y: [0, -48] } },
  girar: { nome: 'Girar com a rolagem', faixa: 'cobrir', de: 0, ate: 1, curva: 'linear', props: { rot: [-60, 60] } },
  zoom: { nome: 'Zoom com a rolagem', faixa: 'cobrir', de: 0, ate: 1, curva: 'linear', props: { escala: [0.8, 1.2] } },
  foco: { nome: 'Entrar em foco', faixa: 'entrada', de: 0, ate: 0.8, curva: 'ease-out', props: { blur: [16, 0], opac: [0.2, 1] } },
  deslizar: { nome: 'Deslizar da lateral', faixa: 'entrada', de: 0, ate: 0.8, curva: 'ease-out', props: { x: [-120, 0], opac: [0, 1] } },
  progresso: { nome: 'Crescer com a página (barra de progresso)', faixa: 'pagina', de: 0, ate: 1, curva: 'linear', props: { escala: [0.02, 1] } },
};
export const NOMES_DE_PRESET = Object.keys(PRESETS_ROLAGEM);

// Intensidade: afasta cada valor do neutro (0 = sem efeito, 1 = o preset, 2 = o dobro).
export const intensificar = (prop, par, i = 1) => par.map((v) => { const n = PROPS[prop].padrao; return r4(n + (v - n) * i); });

export function controladorDePreset(id, { intensidade = 1, faixa, de, ate, curva: c } = {}) {
  const p = PRESETS_ROLAGEM[id];
  if (!p) return null;
  const props = {};
  for (const [k, par] of Object.entries(p.props)) props[k] = intensificar(k, par, intensidade);
  return normalizarControlador({ k: 'rolagem', preset: id, intensidade, faixa: faixa || p.faixa, de: de ?? p.de, ate: ate ?? p.ate, curva: c || p.curva, props });
}

// ---------- quadros-chave no TEMPO ----------
// Controlador de QUADROS: { k:'quadros', quando, dur (ms), atraso (ms), repetir (1..99, 0 = sem parar), vaiVolta, mantem, props:{ y:[{t:0..1, v, curva?}] } }.
// Diferente da rolagem, aqui o progresso vem do RELÓGIO, a partir de um gatilho.
export const QUANDO = { carregar: 'Ao abrir a página', ver: 'Ao aparecer na tela', clicar: 'Ao clicar', mouse: 'Ao passar o mouse' };
export const PRESETS_QUADROS = {
  pulsar: { nome: 'Pulsar', quando: 'ver', dur: 900, repetir: 2, props: { escala: [{ t: 0, v: 1 }, { t: 0.5, v: 1.12, curva: 'ease-out' }, { t: 1, v: 1, curva: 'ease-in' }] } },
  balancar: { nome: 'Balançar', quando: 'mouse', dur: 700, repetir: 1, props: { rot: [{ t: 0, v: 0 }, { t: 0.25, v: -8 }, { t: 0.5, v: 8 }, { t: 0.75, v: -4 }, { t: 1, v: 0 }] } },
  quicar: { nome: 'Quicar', quando: 'ver', dur: 1100, repetir: 1, props: { y: [{ t: 0, v: -90, curva: 'ease-in' }, { t: 0.45, v: 0, curva: 'ease-out' }, { t: 0.65, v: -28, curva: 'ease-in' }, { t: 0.82, v: 0, curva: 'ease-out' }, { t: 0.92, v: -8 }, { t: 1, v: 0 }], opac: [{ t: 0, v: 0 }, { t: 0.2, v: 1 }] } },
  respirar: { nome: 'Respirar (sem parar)', quando: 'carregar', dur: 4000, repetir: 0, vaiVolta: true, props: { escala: [{ t: 0, v: 1 }, { t: 1, v: 1.05, curva: 'ease-in-out' }], opac: [{ t: 0, v: 0.85 }, { t: 1, v: 1, curva: 'ease-in-out' }] } },
  'entrada-dramatica': { nome: 'Entrada dramática', quando: 'ver', dur: 1400, repetir: 1, props: { escala: [{ t: 0, v: 0.6 }, { t: 0.6, v: 1.06, curva: 'ease-out-back' }, { t: 1, v: 1 }], blur: [{ t: 0, v: 18 }, { t: 0.6, v: 0, curva: 'ease-out' }], opac: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }] } },
  chacoalhar: { nome: 'Chacoalhar (ao clicar)', quando: 'clicar', dur: 500, repetir: 1, props: { x: [{ t: 0, v: 0 }, { t: 0.2, v: -10 }, { t: 0.4, v: 10 }, { t: 0.6, v: -6 }, { t: 0.8, v: 6 }, { t: 1, v: 0 }] } },
};
export const NOMES_DE_PRESET_QUADROS = Object.keys(PRESETS_QUADROS);
export const controladorDeQuadros = (id, extra = {}) => (PRESETS_QUADROS[id] ? normalizarControlador({ k: 'quadros', preset: id, ...PRESETS_QUADROS[id], ...extra }) : null);

// Em que ponto do efeito estamos `ms` milissegundos depois do gatilho? { p: 0..1 dentro da volta, volta, fim }. Respeita atraso, repetições
// e ida-e-volta. Quando acaba: p fica no último ponto (mantem) ou o efeito solta (fim = true e quem chama zera o estilo).
export function progressoNoTempo(c, ms) {
  const t = ms - (c.atraso || 0);
  if (t < 0) return { p: 0, volta: 0, fim: false, esperando: true };
  const dur = Math.max(1, c.dur), voltas = c.repetir === 0 ? Infinity : Math.max(1, c.repetir || 1);
  const volta = Math.floor(t / dur);
  if (volta >= voltas) return { p: c.vaiVolta && voltas % 2 === 0 ? 0 : 1, volta: voltas - 1, fim: true };
  const f = (t - volta * dur) / dur;
  return { p: c.vaiVolta && volta % 2 === 1 ? 1 - f : f, volta, fim: false };
}
export function valoresDosQuadros(c, p) {
  const out = {};
  for (const [k, lista] of Object.entries(c.props || {})) out[k] = valorEm(lista, p, PROPS[k].padrao);
  return out;
}
export function valoresReduzidosQuadros(c) {      // movimento reduzido: só o estado final de opacidade/desfoque
  const v = {};
  for (const [k, lista] of Object.entries(c.props || {})) if (k === 'opac' || k === 'blur') v[k] = lista[lista.length - 1].v;
  return v;
}

let seq = 0;
const novoId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

// Limpa um controlador vindo de fora (documento antigo, JSON importado, publicador): só o que se conhece, dentro dos limites.
export function normalizarControlador(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.k === 'rolagem') {
    const props = {};
    for (const [k, par] of Object.entries(c.props || {})) {
      const def = PROPS[k];
      if (!def || !Array.isArray(par) || par.length !== 2 || !par.every(Number.isFinite)) continue;
      props[k] = par.map((v) => r4(clamp(v, def.min, def.max)));
    }
    if (!Object.keys(props).length) return null;
    const de = clamp01(Number.isFinite(c.de) ? c.de : 0), ate = clamp01(Number.isFinite(c.ate) ? c.ate : 1);
    return { id: String(c.id || novoId()).slice(0, 40), k: 'rolagem', ...(c.preset && PRESETS_ROLAGEM[c.preset] ? { preset: c.preset } : {}), ...(Number.isFinite(c.intensidade) ? { intensidade: r4(clamp(c.intensidade, 0, 4)) } : {}),
      faixa: FAIXAS[c.faixa] ? c.faixa : 'cobrir', de: Math.min(de, ate), ate: Math.max(de, ate), curva: typeof c.curva === 'string' && (CURVAS[c.curva] || /^cubic-bezier\(/.test(c.curva)) ? c.curva : 'linear', props,
      ...(Number.isFinite(c.suave) && c.suave > 0 ? { suave: r4(clamp(c.suave, 0, 0.95)) } : {}), ...(Array.isArray(c.dispositivos) ? { dispositivos: c.dispositivos.filter((d) => d === 'd' || d === 'm') } : {}) };
  }
  if (c.k === 'quadros') {
    const props = {};
    for (const [k, lista] of Object.entries(c.props || {})) {
      const def = PROPS[k]; if (!def || !Array.isArray(lista)) continue;
      const q = ordenarQuadros(lista.map((x) => ({ t: clamp01(x?.t), v: clamp(Number(x?.v), def.min, def.max), ...(typeof x?.curva === 'string' && (CURVAS[x.curva] || /^cubic-bezier\(/.test(x.curva)) ? { curva: x.curva } : {}) }))).slice(0, 24);
      if (q.length) props[k] = q.map((x) => ({ ...x, t: r4(x.t), v: r4(x.v) }));
    }
    if (!Object.keys(props).length) return null;
    return { id: String(c.id || novoId()).slice(0, 40), k: 'quadros', ...(c.preset && PRESETS_QUADROS[c.preset] ? { preset: c.preset } : {}), quando: QUANDO[c.quando] ? c.quando : 'ver', dur: Math.round(clamp(Number.isFinite(c.dur) ? c.dur : 1000, 100, 60000)),
      atraso: Math.round(clamp(Number.isFinite(c.atraso) ? c.atraso : 0, 0, 30000)), repetir: Number.isFinite(c.repetir) ? Math.round(clamp(c.repetir, 0, 99)) : 1, vaiVolta: !!c.vaiVolta, mantem: c.mantem !== false,
      ...(Array.isArray(c.dispositivos) ? { dispositivos: c.dispositivos.filter((d) => d === 'd' || d === 'm') } : {}), props };
  }
  if (c.k === 'tempo') {
    const meta = c.meta === 'auto' || c.meta == null ? 'auto' : Number.isFinite(c.meta) ? clamp(c.meta, 0.5, 3600) : 'auto';
    return { id: String(c.id || novoId()).slice(0, 40), k: 'tempo', meta, ...(Number.isFinite(c.visivelMin) ? { visivelMin: r4(clamp(c.visivelMin, 0.1, 1)) } : {}), ...(c.nome ? { nome: String(c.nome).slice(0, 60) } : {}) };
  }
  return null;
}
export const normalizarControladores = (lista) => (Array.isArray(lista) ? lista.map(normalizarControlador).filter(Boolean).slice(0, 12) : []);

// Valores das propriedades de UM controlador de rolagem no progresso `p` (já recortado por de/ate e suavizado pela curva).
export function valoresDoControlador(c, p) {
  const u = suavizar(c.curva, remapear(p, c.de, c.ate)), out = {};
  for (const [k, [a, b]] of Object.entries(c.props || {})) out[k] = lerp(a, b, u);
  return out;
}
// Vários controladores no mesmo elemento: soma onde faz sentido (deslocar, girar, desfocar) e multiplica no resto (escala, opacidade).
export function combinar(lista) {
  const out = {};
  for (const v of lista) for (const [k, x] of Object.entries(v)) {
    const def = PROPS[k]; if (!def) continue;
    out[k] = k in out ? (def.modo === 'produto' ? out[k] * x : out[k] + x) : x;
  }
  return out;
}
// Valores → estilo CSS para o conteúdo do elemento (propriedades individuais de transform: não brigam com as animações que já existem).
export function estiloDeValores(v) {
  const s = {};
  if (v.x != null || v.y != null) s.translate = `${r4(v.x || 0)}px ${r4(v.y || 0)}px`;
  if (v.escala != null) s.scale = String(r4(v.escala));
  if (v.rot != null) s.rotate = `${r4(v.rot)}deg`;
  if (v.opac != null) s.opacity = String(r4(clamp01(v.opac)));
  if (v.blur != null) s.filter = v.blur > 0.01 ? `blur(${r4(v.blur)}px)` : 'none';
  return s;
}
// Com "reduzir movimento" ligado a pessoa não quer ver deslocamento: fica o estado FINAL de opacidade/desfoque e o resto volta ao neutro.
export function valoresReduzidos(c) {
  const v = {};
  for (const [k, par] of Object.entries(c.props || {})) if (k === 'opac' || k === 'blur') v[k] = par[1];
  return v;
}
