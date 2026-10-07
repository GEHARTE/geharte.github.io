// Exemplos do criador de SVG animado (modo "rig de peças"): três desenhos pensados para APRENDER, cada um com o rig de animação pronto.
// Mostram, em ordem de dificuldade: (1) pêndulo duplo — o mínimo (pivô + pai + uma curva); (2) bandeira — uma CADEIA de pais, cada faixa
// girando no tempo certo para formar uma onda; (3) boneco de palitos — hierarquia de verdade (tronco → cabeça, braços → antebraços)
// com pivôs nas articulações, acenando.
//
// Cada exemplo tem `svg` (o desenho ainda sem animação — pode ser carregado e animado do zero) e `criarRig()` (o rig pronto, montado SÓ
// com as funções públicas de core/puppet.js: o mesmo caminho que a tela usa). Tudo aqui é dado puro, sem DOM.
import { rigDeSvg, definirPai, moverPivo, definirQuadro, definirDuracao } from './puppet.js';

// Quadros em sequência: sequencia(rig, id, 'rot', [[t, valor, curva?], …])
function sequencia(rig, id, prop, quadros) {
  return quadros.reduce((r, [t, v, curva]) => definirQuadro(r, id, prop, t, v, curva ? { curva } : {}), rig);
}
// Onda seno amostrada de `passo` em `passo` ms até `duracao` (a última amostra repete a primeira: o laço fecha sem salto).
// fase em ciclos (0,25 = um quarto de volta de atraso). Boa para balanço de pêndulo, bandeira, respiração.
function onda(rig, id, prop, { amp, fase = 0, duracao, passo = 200, base = 0 }) {
  let r = rig;
  for (let t = 0; t <= duracao; t += passo) r = definirQuadro(r, id, prop, t, base + amp * Math.sin(2 * Math.PI * (t / duracao - fase)));
  return r;
}

// ---------- 1) pêndulo duplo ----------
const SVG_PENDULO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" fill="none" stroke="#2b2a33" stroke-width="5" stroke-linecap="round">
  <g id="suporte"><rect x="130" y="26" width="140" height="16" rx="5" fill="#4a4858" stroke="none"/><circle cx="200" cy="44" r="8" fill="#e4572e" stroke="none"/></g>
  <g id="haste-1"><line x1="200" y1="44" x2="200" y2="172"/><circle cx="200" cy="172" r="11" fill="#4f8cff" stroke="none"/></g>
  <g id="haste-2"><line x1="200" y1="172" x2="200" y2="290"/><circle cx="200" cy="296" r="22" fill="#e4572e" stroke="none"/></g>
</svg>`;
function pendulo() {
  const D = 2400;
  let r = rigDeSvg(SVG_PENDULO, { nome: 'Pêndulo duplo' });
  r = definirDuracao(r, D);
  r = definirPai(r, 'haste-1', 'suporte');          // a haste 1 pende do suporte…
  r = definirPai(r, 'haste-2', 'haste-1');          // …e a haste 2 pende da ponta da haste 1: quando a 1 gira, a 2 vai junto
  r = moverPivo(r, 'haste-1', 200, 44);
  r = moverPivo(r, 'haste-2', 200, 172);
  // ease-in-out: o pêndulo desacelera nas pontas e acelera embaixo, como o de verdade
  r = sequencia(r, 'haste-1', 'rot', [[0, -30, 'ease-in-out'], [1200, 30, 'ease-in-out'], [D, -30]]);
  r = onda(r, 'haste-2', 'rot', { amp: 20, fase: 0.08, duracao: D, passo: 200 });
  return r;
}

// ---------- 2) bandeira ----------
const SVG_BANDEIRA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <g id="mastro"><rect x="70" y="40" width="10" height="240" rx="5" fill="#8a6f4d"/><circle cx="75" cy="36" r="9" fill="#e0b84a"/></g>
  <g id="faixa-1"><rect x="80" y="60" width="60" height="110" fill="#2e8b57"/></g>
  <g id="faixa-2"><rect x="140" y="60" width="60" height="110" fill="#f2c94c"/></g>
  <g id="faixa-3"><rect x="200" y="60" width="60" height="110" fill="#2f6fd6"/></g>
  <g id="faixa-4"><rect x="260" y="60" width="60" height="110" fill="#e4572e"/></g>
</svg>`;
function bandeira() {
  const D = 2400;
  let r = rigDeSvg(SVG_BANDEIRA, { nome: 'Bandeira ao vento' });
  r = definirDuracao(r, D);
  const faixas = ['faixa-1', 'faixa-2', 'faixa-3', 'faixa-4'];
  faixas.forEach((id, i) => {
    r = definirPai(r, id, i === 0 ? 'mastro' : faixas[i - 1]);     // cadeia: cada faixa é filha da anterior
    r = moverPivo(r, id, 80 + i * 60, 115);                         // pivô na borda esquerda de cada faixa (onde ela "prende" na anterior)
    r = onda(r, id, 'rot', { amp: 7, fase: 0.1 * i, duracao: D });  // mesma onda, cada faixa um pouco atrasada: a ONDA percorre a bandeira
  });
  return r;
}

// ---------- 3) boneco de palitos acenando ----------
const SVG_BONECO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none" stroke="#2b2a33" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
  <g id="perna-esq"><path d="M200 252 L172 336 L148 336"/></g>
  <g id="perna-dir"><path d="M200 252 L228 336 L252 336"/></g>
  <g id="tronco"><line x1="200" y1="140" x2="200" y2="252"/></g>
  <g id="braco-esq"><line x1="198" y1="156" x2="152" y2="206"/></g>
  <g id="antebraco-esq"><line x1="152" y1="206" x2="116" y2="252"/></g>
  <g id="braco-dir"><line x1="202" y1="156" x2="248" y2="206"/></g>
  <g id="antebraco-dir"><line x1="248" y1="206" x2="284" y2="252"/></g>
  <g id="cabeca"><circle cx="200" cy="100" r="34" fill="#ffffff"/><circle cx="188" cy="94" r="3" fill="#2b2a33" stroke="none"/><circle cx="212" cy="94" r="3" fill="#2b2a33" stroke="none"/><path d="M186 112 Q200 126 214 112" stroke-width="5"/></g>
</svg>`;
function boneco() {
  const D = 2400;
  let r = rigDeSvg(SVG_BONECO, { nome: 'Boneco acenando' });
  r = definirDuracao(r, D);
  // hierarquia: o tronco carrega a cabeça e os braços; cada braço carrega o seu antebraço. As pernas ficam soltas (o tronco balança sobre elas).
  for (const [id, pai] of [['cabeca', 'tronco'], ['braco-esq', 'tronco'], ['braco-dir', 'tronco'], ['antebraco-esq', 'braco-esq'], ['antebraco-dir', 'braco-dir']]) r = definirPai(r, id, pai);
  // pivôs nas articulações (o padrão é o centro da peça, que não serve para dobrar um braço)
  for (const [id, x, y] of [['tronco', 200, 252], ['cabeca', 200, 134], ['braco-esq', 198, 156], ['antebraco-esq', 152, 206], ['braco-dir', 202, 156], ['antebraco-dir', 248, 206], ['perna-esq', 200, 252], ['perna-dir', 200, 252]]) r = moverPivo(r, id, x, y);
  r = sequencia(r, 'tronco', 'rot', [[0, 0, 'ease-in-out'], [600, -2, 'ease-in-out'], [1800, 2, 'ease-in-out'], [D, 0]]);
  r = sequencia(r, 'cabeca', 'rot', [[0, 0, 'ease-in-out'], [500, 6, 'ease-in-out'], [1100, -5, 'ease-in-out'], [1700, 6, 'ease-in-out'], [D, 0]]);
  // braço direito: sobe (ease-out), fica no alto, desce. Ângulo negativo = sentido anti-horário = levantar.
  r = sequencia(r, 'braco-dir', 'rot', [[0, 0, 'ease-out'], [450, -125, 'linear'], [1900, -125, 'ease-in-out'], [D, 0]]);
  // antebraço: balança de um lado a outro enquanto o braço está no alto — é isso que parece "acenar"
  r = sequencia(r, 'antebraco-dir', 'rot', [[0, 0], [450, 0, 'ease-in-out'], [750, 28, 'ease-in-out'], [1050, -28, 'ease-in-out'], [1350, 28, 'ease-in-out'], [1650, -28, 'ease-in-out'], [1900, 0, 'ease-in-out'], [D, 0]]);
  r = sequencia(r, 'braco-esq', 'rot', [[0, 0, 'ease-in-out'], [1200, -4, 'ease-in-out'], [D, 0]]);
  r = sequencia(r, 'antebraco-esq', 'rot', [[0, 0, 'ease-in-out'], [1200, 3, 'ease-in-out'], [D, 0]]);
  return r;
}

export const EXEMPLOS = [
  { id: 'pendulo', nome: 'Pêndulo duplo', nivel: 'Começando', svg: SVG_PENDULO, criarRig: pendulo,
    descricao: 'O mínimo: três peças. A haste 2 é FILHA da haste 1, então quando a 1 balança a 2 vai junto — e ainda balança por conta própria.' },
  { id: 'bandeira', nome: 'Bandeira ao vento', nivel: 'Cadeia de pais', svg: SVG_BANDEIRA, criarRig: bandeira,
    descricao: 'Quatro faixas encadeadas (cada uma filha da anterior), todas com a mesma onda, cada uma um pouco atrasada: a onda percorre a bandeira.' },
  { id: 'boneco', nome: 'Boneco acenando', nivel: 'Hierarquia completa', svg: SVG_BONECO, criarRig: boneco,
    descricao: 'Tronco → cabeça e braços; braço → antebraço. Os pivôs ficam nas articulações (ombro, cotovelo, pescoço, quadril): clique numa peça e veja o ponto.' },
];
export const exemploPorId = (id) => EXEMPLOS.find((e) => e.id === id) || null;
