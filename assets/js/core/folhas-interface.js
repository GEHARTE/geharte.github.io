// Folhas de design de INTERFACE: as que servem para montar telas — aplicativos, painéis, botões, formulários — e para jogos.
// Só DADOS e os geradores que evitam repetir o mesmo desenho em duas cores. A lógica está em core/folhas.js.
//
// Por que geradores: o conjunto de ícones da interface clara e o da escura são o MESMO desenho com outra cor. Em vez de dois
// blocos iguais que saem de sincronia no primeiro ajuste, há uma lista de caminhos e uma função que aplica a cor.
import { normalizarFolha } from './folhas.js';

// ---------- ícones de interface ----------
// Traço de 2 px numa grade de 24, como manda o costume dos sistemas de ícones. Sem preenchimento: a cor é só do traço,
// então o mesmo desenho serve em fundo claro e escuro.
const ICONES = [
  ['Menu', '<path d="M4 7h16M4 12h16M4 17h16"/>'],
  ['Buscar', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>'],
  ['Pessoa', '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'],
  ['Ajustes', '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>'],
  ['Aviso', '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>'],
  ['Mais', '<path d="M12 5v14M5 12h14"/>'],
  ['Feito', '<path d="M4 12.5l5.5 5.5L20 6.5"/>'],
  ['Fechar', '<path d="M6 6l12 12M18 6L6 18"/>'],
  ['Avançar', '<path d="M4 12h15M13 6l6 6-6 6"/>'],
  ['Excluir', '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'],
  ['Baixar', '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'],
  ['Cadeado', '<rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>'],
];
const iconeSvg = (corpo, cor) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;
const iconesDe = (cor) => ICONES.map(([nome, corpo]) => ({ nome, code: iconeSvg(corpo, cor) }));

// ---------- peças de interface (as "formas" da folha) ----------
// O que uma tela é feita: botão cheio, botão de contorno, campo, cartão, etiqueta e a linha que separa seções.
const pecasDeUi = ({ primaria, superficie, borda, campo, texto, raio }) => [
  { nome: 'Botão', shape: 'rect', s: { fill: primaria, stroke: null, radius: raio }, label: 'Botão' },
  { nome: 'Botão de contorno', shape: 'rect', s: { fill: null, stroke: primaria, sw: 2, radius: raio }, label: 'Botão' },
  { nome: 'Campo', shape: 'rect', s: { fill: campo, stroke: borda, sw: 1.5, radius: raio - 2 } },
  { nome: 'Cartão', shape: 'rect', s: { fill: superficie, stroke: borda, sw: 1, radius: raio + 4 } },
  { nome: 'Etiqueta', shape: 'rect', s: { fill: primaria, stroke: null, radius: 9999 }, label: 'novo' },
  { nome: 'Separador', shape: 'line', s: { fill: null, stroke: borda, sw: 1.5 } },
  { nome: 'Barra', shape: 'rect', s: { fill: primaria, stroke: null, radius: 9999 } },
  { nome: 'Avatar', shape: 'ellipse', s: { fill: superficie, stroke: borda, sw: 1.5 } },
];

// Fundo quadriculado de tela (o xadrez de "nada aqui ainda"), nas duas versões.
const malha = (linha, fundo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><pattern id="m" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0v40" fill="none" stroke="${linha}" stroke-width="1"/></pattern></defs><rect width="1200" height="800" fill="${fundo}"/><rect width="1200" height="800" fill="url(#m)"/></svg>`;

// ---------- 1. Interface clara ----------
export const FOLHA_UI_CLARA = normalizarFolha({
  id: 'interface-clara',
  nome: 'Interface — clara',
  descricao: 'Sistema de tela para aplicativos e painéis em fundo claro: azul de ação, cinzas de estrutura e os quatro avisos (feito, atenção, erro, informação). Inter no texto.',
  raio: 10,
  cores: [
    { id: 'fundo', nome: 'Fundo', valor: '#ffffff', papel: 'fundo' },
    { id: 'superficie', nome: 'Superfície', valor: '#f4f5f7', papel: 'superficie' },
    { id: 'borda', nome: 'Borda', valor: '#d7dae0', papel: 'superficie' },
    { id: 'texto', nome: 'Texto', valor: '#111827', papel: 'texto' },
    { id: 'suave', nome: 'Texto suave', valor: '#596274', papel: 'suave' },
    { id: 'primaria', nome: 'Ação', valor: '#1d4ed8', papel: 'marca' },
    { id: 'feito', nome: 'Feito', valor: '#15803d', papel: 'acento' },
    { id: 'atencao', nome: 'Atenção', valor: '#9a5b00', papel: 'acento' },
    { id: 'erro', nome: 'Erro', valor: '#b91c1c', papel: 'acento' },
    { id: 'sobre', nome: 'Sobre a ação', valor: '#ffffff', papel: 'sobre' },
  ],
  fontes: [{ nome: 'Inter', uso: 'Interface e texto' }, { nome: 'Space Grotesk', uso: 'Títulos' }],
  formas: pecasDeUi({ primaria: '#1d4ed8', superficie: '#f4f5f7', borda: '#d7dae0', campo: '#ffffff', texto: '#111827', raio: 10 }),
  svgs: [...iconesDe('#111827'), { nome: 'Malha de fundo', bg: true, code: malha('#e6e8ec', '#ffffff') }],
});

// ---------- 2. Interface escura ----------
export const FOLHA_UI_ESCURA = normalizarFolha({
  id: 'interface-escura',
  nome: 'Interface — escura',
  descricao: 'A mesma linguagem da interface clara, no escuro: azul que acende no fundo fundo, cinzas de estrutura e os avisos em tons que não cegam. Inter no texto.',
  raio: 10,
  cores: [
    { id: 'fundo', nome: 'Fundo', valor: '#0f1117', papel: 'fundo' },
    { id: 'superficie', nome: 'Superfície', valor: '#1a1d26', papel: 'superficie' },
    { id: 'borda', nome: 'Borda', valor: '#2d313d', papel: 'superficie' },
    { id: 'texto', nome: 'Texto', valor: '#e9ebf2', papel: 'texto' },
    { id: 'suave', nome: 'Texto suave', valor: '#a2a9ba', papel: 'suave' },
    { id: 'primaria', nome: 'Ação', valor: '#6ea8ff', papel: 'marca' },
    { id: 'feito', nome: 'Feito', valor: '#4ade80', papel: 'acento' },
    { id: 'atencao', nome: 'Atenção', valor: '#fbbf24', papel: 'acento' },
    { id: 'erro', nome: 'Erro', valor: '#f87171', papel: 'acento' },
    { id: 'sobre', nome: 'Sobre a ação', valor: '#0f1117', papel: 'sobre' },
  ],
  fontes: [{ nome: 'Inter', uso: 'Interface e texto' }, { nome: 'Space Grotesk', uso: 'Títulos' }],
  formas: pecasDeUi({ primaria: '#6ea8ff', superficie: '#1a1d26', borda: '#2d313d', campo: '#12151c', texto: '#e9ebf2', raio: 10 }),
  svgs: [...iconesDe('#e9ebf2'), { nome: 'Malha de fundo', bg: true, code: malha('#20242e', '#0f1117') }],
});

// ---------- 3. Jogos ----------
const J = { fundo: '#0d0820', painel: '#1b1033', neon: '#ff2e88', ciano: '#22e4ff', ouro: '#ffd166', vida: '#ff4d6d', verde: '#39ff88', texto: '#f6f4ff' };

// Desenhos do painel de jogo. Alguns se mexem — é o que um HUD faz: a moeda gira, o coração bate, a mira respira.
const SVGS_JOGO = [
  { nome: 'Vida (coração)', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><style>.c{transform-origin:16px 16px;animation:b 1.1s ease-in-out infinite}@keyframes b{0%,100%{transform:scale(1)}18%{transform:scale(1.14)}36%{transform:scale(1)}54%{transform:scale(1.08)}}</style><g class="c" fill="${J.vida}"><rect x="6" y="6" width="8" height="4"/><rect x="18" y="6" width="8" height="4"/><rect x="4" y="10" width="24" height="6"/><rect x="6" y="16" width="20" height="4"/><rect x="9" y="20" width="14" height="3"/><rect x="12" y="23" width="8" height="3"/><rect x="14" y="26" width="4" height="2"/></g></svg>` },
  { nome: 'Moeda', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g><animateTransform attributeName="transform" type="scale" values="1 1;0.12 1;1 1" additive="sum" dur="1.6s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;28 0;0 0" additive="sum" dur="1.6s" repeatCount="indefinite"/><circle cx="32" cy="32" r="26" fill="${J.ouro}"/><circle cx="32" cy="32" r="19" fill="none" stroke="#b07d12" stroke-width="3"/><path d="M32 18v28M26 24h12M26 40h12" stroke="#b07d12" stroke-width="4" stroke-linecap="round" fill="none"/></g></svg>` },
  { nome: 'Estrela', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${J.ouro}" stroke="#b07d12" stroke-width="2.5" stroke-linejoin="round" d="M32 6l7.6 16.2 17.4 2.4-12.7 12.6 3.1 17.8L32 46.6 16.6 55l3.1-17.8L7 24.6l17.4-2.4z"/></svg>` },
  { nome: 'Escudo', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${J.ciano}" fill-opacity=".25" stroke="${J.ciano}" stroke-width="3" stroke-linejoin="round" d="M32 5l23 8v19c0 14-9.6 23.6-23 27C18.6 55.6 9 46 9 32V13z"/><path fill="none" stroke="${J.ciano}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M22 32l7 7 14-14"/></svg>` },
  { nome: 'Espada', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#cfd6e4" stroke="#7b8498" stroke-width="2" stroke-linejoin="round" d="M41 6h11v11L28 41l-5-6z"/><path fill="#8d5a2b" stroke="#5d3a1a" stroke-width="2" stroke-linejoin="round" d="M22 36l6 6-6 6-6-6z"/><path fill="none" stroke="#5d3a1a" stroke-width="5" stroke-linecap="round" d="M18 46L9 55"/></svg>` },
  { nome: 'Troféu', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${J.ouro}" stroke="#b07d12" stroke-width="2.5" stroke-linejoin="round" d="M18 8h28v14a14 14 0 0 1-28 0z"/><path fill="none" stroke="#b07d12" stroke-width="3" d="M18 12H9v4a9 9 0 0 0 9 9M46 12h9v4a9 9 0 0 1-9 9"/><path fill="${J.ouro}" stroke="#b07d12" stroke-width="2.5" stroke-linejoin="round" d="M27 36h10v8h-10zM20 44h24v8H20z"/></svg>` },
  { nome: 'Mira', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="${J.neon}" stroke-width="3" stroke-linecap="round"><circle cx="32" cy="32" r="20"><animate attributeName="r" values="20;22;20" dur="2.4s" repeatCount="indefinite"/></circle><path d="M32 4v12M32 48v12M4 32h12M48 32h12"/></g><circle cx="32" cy="32" r="4" fill="${J.neon}"/></svg>` },
  { nome: 'Raio', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${J.ouro}" stroke="#b07d12" stroke-width="2" stroke-linejoin="round" d="M36 4L14 36h14l-4 24 22-32H32z"><animate attributeName="opacity" values="1;.55;1" dur="1.2s" repeatCount="indefinite"/></path></svg>` },
  { nome: 'Direcional', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${J.painel}" stroke="${J.ciano}" stroke-width="2.5" stroke-linejoin="round" d="M23 5h18v18h18v18H41v18H23V41H5V23h18z"/><g fill="${J.ciano}"><path d="M32 12l5 7H27zM32 52l-5-7h10zM12 32l7-5v10zM52 32l-7 5V27z"/></g></svg>` },
  { nome: 'Barra de vida', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 36"><rect x="2" y="2" width="236" height="32" rx="8" fill="${J.painel}" stroke="${J.ciano}" stroke-width="2.5"/><rect x="8" y="8" width="224" height="20" rx="5" fill="#2a1c47"/><rect x="8" y="8" height="20" rx="5" fill="${J.vida}"><animate attributeName="width" values="224;64;224" dur="6s" repeatCount="indefinite"/></rect></svg>` },
  { nome: 'Painel do HUD', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="${J.painel}" fill-opacity=".92" stroke="${J.ciano}" stroke-width="3" stroke-linejoin="round" d="M4 20L20 4h160l16 16v80l-16 16H20L4 100z"/><path fill="none" stroke="${J.neon}" stroke-width="2" d="M14 24L24 14h152l10 10v72l-10 10H24l-10-10z"/></svg>` },
  { nome: 'Grade neon', bg: true, code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17082e"/><stop offset="1" stop-color="${J.fundo}"/></linearGradient><pattern id="g" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0v80" fill="none" stroke="${J.neon}" stroke-opacity=".32" stroke-width="1.5"/></pattern></defs><rect width="1200" height="800" fill="url(#ceu)"/><circle cx="600" cy="430" r="190" fill="${J.neon}" opacity=".22"/><rect y="400" width="1200" height="400" fill="url(#g)"/></svg>` },
];

export const FOLHA_JOGOS = normalizarFolha({
  id: 'jogos',
  nome: 'Jogos — painel neon',
  descricao: 'Para telas de jogo e painéis de pontuação: fundo roxo profundo, magenta e ciano de neon, ouro de recompensa e vermelho de vida. Press Start 2P nos números, Space Grotesk no texto.',
  raio: 8,
  cores: [
    { id: 'fundo', nome: 'Fundo', valor: J.fundo, papel: 'fundo' },
    { id: 'painel', nome: 'Painel', valor: J.painel, papel: 'superficie' },
    { id: 'texto', nome: 'Texto', valor: J.texto, papel: 'texto' },
    { id: 'suave', nome: 'Texto suave', valor: '#b3a8d8', papel: 'suave' },
    { id: 'neon', nome: 'Neon', valor: J.neon, papel: 'marca' },
    { id: 'ciano', nome: 'Ciano', valor: J.ciano, papel: 'acento' },
    { id: 'ouro', nome: 'Ouro', valor: J.ouro, papel: 'acento' },
    { id: 'vida', nome: 'Vida', valor: J.vida, papel: 'acento' },
    { id: 'energia', nome: 'Energia', valor: J.verde, papel: 'acento' },
    { id: 'sobre', nome: 'Sobre o neon', valor: '#1a0520', papel: 'sobre' },
  ],
  fontes: [{ nome: 'Press Start 2P', uso: 'Pontuação e títulos' }, { nome: 'Space Grotesk', uso: 'Texto' }],
  formas: [
    { nome: 'Painel', shape: 'rect', s: { fill: J.painel, stroke: J.ciano, sw: 3, radius: 8 } },
    { nome: 'Botão', shape: 'rect', s: { fill: J.neon, stroke: null, radius: 8 }, label: 'JOGAR' },
    { nome: 'Barra', shape: 'rect', s: { fill: J.vida, stroke: null, radius: 9999 } },
    { nome: 'Gema', shape: 'diamond', s: { fill: J.ciano, stroke: '#0b5a6b', sw: 3 } },
    { nome: 'Selo', shape: 'star', s: { fill: J.ouro, stroke: '#b07d12', sw: 3, sides: 5, inner: 0.45 } },
    { nome: 'Moldura', shape: 'rect', s: { fill: null, stroke: J.neon, sw: 4, radius: 8 } },
  ],
  svgs: SVGS_JOGO,
});

export const FOLHAS_INTERFACE = [FOLHA_UI_CLARA, FOLHA_UI_ESCURA, FOLHA_JOGOS];
