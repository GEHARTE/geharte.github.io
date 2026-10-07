// Ajudas PURAS da tela do rig de peças (sem DOM): histórico de desfazer/refazer, conversão tempo ↔ pixel da linha do tempo, contas do
// gesto de arrastar/girar na prévia, consulta de quadros e "dividir grupo em peças". Ficam aqui, e não em editor/criador-svg-rig.js,
// para poderem ser testadas no Node (tests/puppet-edicao.test.mjs): a tela só liga ponteiro e pixel a estas funções.
import { NOMES_DAS_PROPS, IDENTIDADE, aplicarMatriz, inverterMatriz, lerSvg, serializar, caixaDoConteudo, adicionarPeca, removerPeca, pecaPorId, definirQuadro, poseEm, matrizes, LIMITES } from './puppet.js';

const prender = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- histórico ----------
// Guarda ESTADOS inteiros (o rig é imutável, então guardar é barato: só ponteiros). `gravar(antes)` registra o estado de antes de uma
// mudança; `desfazer(atual)` devolve o estado anterior (ou null) e guarda o atual para refazer.
export function criarHistorico(max = 20) {
  let passado = [], futuro = [];
  return {
    gravar(antes) { passado.push(antes); if (passado.length > max) passado.shift(); futuro = []; },
    desfazer(atual) { if (!passado.length) return null; futuro.push(atual); return passado.pop(); },
    refazer(atual) { if (!futuro.length) return null; passado.push(atual); return futuro.pop(); },
    podeDesfazer: () => passado.length > 0,
    podeRefazer: () => futuro.length > 0,
    limpar() { passado = []; futuro = []; },
  };
}

// ---------- linha do tempo ----------
// t (ms) ↔ x (px) numa régua de `largura` px que cobre 0…duracao. xParaT prende no intervalo e arredonda ao `passo` (ms) — passo 0 = só inteiro.
export const tParaX = (t, duracao, largura) => (duracao > 0 ? (prender(t, 0, duracao) / duracao) * largura : 0);
export function xParaT(x, duracao, largura, passo = 0) {
  const t = largura > 0 ? prender((x / largura) * duracao, 0, duracao) : 0;
  return prender(passo > 0 ? Math.round(t / passo) * passo : Math.round(t), 0, duracao);
}
export const formatarTempo = (ms) => `${(Math.max(0, ms) / 1000).toFixed(2).replace('.', ',')} s`;

// ---------- quadros ----------
export const temQuadroEm = (rig, id, prop, t, eps = 0.5) => !!rig.trilhas[id]?.[prop]?.some((k) => Math.abs(k.t - t) <= eps);
export const quadroEm = (rig, id, prop, t, eps = 0.5) => rig.trilhas[id]?.[prop]?.find((k) => Math.abs(k.t - t) <= eps) || null;
// Todos os quadros da peça: [{ prop, t, v, curva }] ordenados por tempo.
export function quadrosDaPeca(rig, id) {
  const tr = rig.trilhas[id] || {}, out = [];
  for (const prop of NOMES_DAS_PROPS) for (const k of tr[prop] || []) out.push({ prop, t: k.t, v: k.v, curva: k.curva || 'linear' });
  return out.sort((a, b) => a.t - b.t || NOMES_DAS_PROPS.indexOf(a.prop) - NOMES_DAS_PROPS.indexOf(b.prop));
}
// Instantes (únicos, ordenados) com algum quadro: da peça (id) ou de todas (id omitido).
export function instantesDeQuadros(rig, id = null) {
  const ts = new Set();
  for (const [pid, tr] of Object.entries(rig.trilhas)) if (id == null || pid === id) for (const lista of Object.values(tr)) for (const k of lista) ts.add(k.t);
  return [...ts].sort((a, b) => a - b);
}
// Pula para o quadro seguinte (dir > 0) ou anterior (dir < 0) a t; null se não houver.
export function proximoInstante(instantes, t, dir) {
  if (dir > 0) return instantes.find((x) => x > t + 0.5) ?? null;
  for (let i = instantes.length - 1; i >= 0; i--) if (instantes[i] < t - 0.5) return instantes[i];
  return null;
}
// Põe quadros em TODAS as propriedades da peça em t, com o valor que ela tem ali (o botão "◆ quadro").
export function quadrosDeTudoEm(rig, id, t) {
  const pose = poseEm(rig, t)[id];
  if (!pose) return rig;
  return NOMES_DAS_PROPS.reduce((r, prop) => definirQuadro(r, id, prop, t, pose[prop]), rig);
}
// Move um quadro no tempo (arrastar o losango). Se já houver quadro no destino, ele é substituído. Mantém valor e curva.
export function moverQuadro(rig, id, prop, deT, paraT) {
  const k = quadroEm(rig, id, prop, deT);
  if (!k) return rig;
  const alvo = Math.round(prender(paraT, 0, rig.duracao));
  if (alvo === k.t) return rig;
  const lista = rig.trilhas[id][prop].filter((q) => q !== k && Math.abs(q.t - alvo) > 0.5);
  lista.push({ ...k, t: alvo });
  lista.sort((a, b) => a.t - b.t);
  return { ...rig, trilhas: { ...rig.trilhas, [id]: { ...rig.trilhas[id], [prop]: lista } } };
}

// ---------- gesto na prévia ----------
// Todas em coordenadas do viewBox (a "raiz"). `mundo` = resultado de matrizes(rig, pose).
export const matrizDoPai = (rig, mundo, id) => { const p = pecaPorId(rig, id); return (p?.pai && mundo[p.pai]) || IDENTIDADE; };
// Onde o pivô da peça está na tela agora (já com o pai e a própria pose).
export const pivoNoMundo = (rig, mundo, id) => { const p = pecaPorId(rig, id); return p && mundo[id] ? aplicarMatriz(mundo[id], p.pivo.x, p.pivo.y) : null; };
// Pivô (nas coordenadas do desenho original, que é onde ele vive) que fica EXATAMENTE sob `ponto` (coordenadas da raiz) no instante tMs.
// O pivô aparece na tela em mundo(pai)·(pivô + (x, y)) — a rotação e a escala da própria peça não o movem —, então basta desfazer o pai e a translação.
export function pivoParaPonto(rig, id, tMs, ponto) {
  const poses = poseEm(rig, tMs), pose = poses[id], inv = pose && inverterMatriz(matrizDoPai(rig, matrizes(rig, poses), id));
  if (!inv) return null;
  const l = aplicarMatriz(inv, ponto.x, ponto.y);
  return { x: l.x - pose.x, y: l.y - pose.y };
}
// Um deslocamento (dx, dy) em coordenadas da raiz → quanto somar a x/y da peça. O x/y é aplicado DENTRO do espaço do pai, então se o pai
// está girado ou escalado é preciso desfazer isso (só a parte linear da matriz do pai, sem a translação).
export function paraEspacoDoPai(matrizPai, dx, dy) {
  const inv = inverterMatriz(matrizPai);
  return inv ? { x: inv[0] * dx + inv[2] * dy, y: inv[1] * dx + inv[3] * dy } : { x: dx, y: dy };
}
// Ângulo (graus, 0 = para a direita, cresce no sentido horário da tela) do ponto (px,py) visto do centro (cx,cy).
export const anguloDe = (cx, cy, px, py) => (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
// Escolhe a volta de `novo` mais próxima de `anterior` (soma/subtrai 360): sem isso o ponteiro cruzando a "emenda" em ±180° faria a peça dar um salto de 360°.
export const desenrolar = (anterior, novo) => novo + 360 * Math.round((anterior - novo) / 360);
// Quanto a peça deve girar (graus) quando o ponteiro vai de p0 a p1 em volta do centro (pivô na tela). Se a matriz do pai espelha o desenho (determinante < 0), o sentido inverte.
export function deltaDeAngulo(centro, p0, p1, matrizPai = IDENTIDADE) {
  const a0 = anguloDe(centro.x, centro.y, p0.x, p0.y), a1 = desenrolar(a0, anguloDe(centro.x, centro.y, p1.x, p1.y));
  return (a1 - a0) * (matrizPai[0] * matrizPai[3] - matrizPai[1] * matrizPai[2] < 0 ? -1 : 1);
}
// Quatro cantos (na raiz) da caixa do desenho da peça na pose atual — para o contorno de seleção. null se a peça não desenha nada.
export function cantosNoMundo(rig, mundo, id) {
  const p = pecaPorId(rig, id), c = p && caixaDoConteudo(p.conteudo);
  if (!c || !mundo[id]) return null;
  return [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]].map(([x, y]) => aplicarMatriz(mundo[id], x, y));
}

// ---------- dividir um grupo em peças ----------
// Quando o SVG tem tudo dentro de um só <g> (ou o autor agrupou demais), vira UMA peça. Aqui o grupo é aberto: cada filho direto vira
// uma peça, no lugar do grupo (mesmo pai). O transform do grupo é empurrado para os filhos e os atributos de apresentação (fill, stroke…)
// que o grupo definia e o filho não tem são copiados para ele — assim o desenho não muda. Todas herdam o z da peça original (a ordem da lista desempata); devolve o MESMO rig se não der para dividir.
const APRESENTACAO = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'text-anchor'];
export function dividirPeca(rig, id) {
  const peca = pecaPorId(rig, id);
  if (!peca) return rig;
  const raiz = lerSvg(`<svg>${peca.conteudo}</svg>`);
  const g = raiz?.filhos.length === 1 && raiz.filhos[0].tag === 'g' ? raiz.filhos[0] : null;
  const filhos = g ? g.filhos.filter((f) => f.tag !== '#texto') : [];
  const desenham = filhos.filter((f) => !['defs', 'style', 'title', 'desc', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'pattern', 'symbol', 'marker'].includes(f.tag.toLowerCase()));
  if (desenham.length < 2 || rig.pecas.length - 1 + desenham.length > LIMITES.pecas) return rig;
  const guardados = filhos.filter((f) => !desenham.includes(f)).map(serializar).join('');         // defs dentro do grupo precisam ir junto (ids de gradiente…)
  let novo = rig;
  desenham.forEach((f, i) => {
    const attrs = { ...f.attrs };
    for (const k of APRESENTACAO) if (g.attrs[k] != null && attrs[k] == null) attrs[k] = g.attrs[k];
    if (g.attrs.transform) attrs.transform = `${g.attrs.transform}${attrs.transform ? ' ' + attrs.transform : ''}`;
    const base = f.attrs.id || f.attrs['data-nome'] || `${peca.id}-${i + 1}`;
    novo = adicionarPeca(novo, { id: base, nome: f.attrs['data-nome'] || f.attrs.id || `${peca.nome} ${i + 1}`, pai: peca.pai, conteudo: serializar({ ...f, attrs }), z: peca.z });
  });
  if (guardados) novo = { ...novo, defs: `${novo.defs || ''}${guardados}` };
  return removerPeca(novo, id);
}

// "Boneco acenando!" → "boneco-acenando" (nome de arquivo seguro)
export const nomeDeArquivo = (nome, padrao = 'animacao') => String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || padrao;
