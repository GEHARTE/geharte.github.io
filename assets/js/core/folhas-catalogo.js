// Catálogo de folhas de design que vem junto com o ArtAtk. Só DADOS: a lógica está em core/folhas.js.
//
// A folha do MUVVI (Museu Virtual do Vale do Ivaí) nasce do MESMO tema do modelo de site do museu — modelos/muvvi-site/spec.json,
// chave `tema` — para cor e fonte não terem duas verdades. Ao mudar o tema lá, mude aqui: o tema está repetido de propósito (o
// editor não busca o spec na rede só para desenhar o painel), e tests/folhas.test.mjs confere que os dois continuam iguais.
import { folhaDoTema, normalizarFolha } from './folhas.js';
import { FOLHAS_INTERFACE } from './folhas-interface.js';

// cópia do `tema` de modelos/muvvi-site/spec.json
export const TEMA_MUVVI = {
  fundo: '#fcfbf6', texto: '#1b1b18', suave: '#55574f', escuro: '#0e3e20', sobreEscuro: '#ffffff',
  acento: '#86a3fc', sobreAcento: '#0e3e20', superficie: '#efeadb',
  fonteTitulo: 'Libre Caslon Text', fonteTexto: 'Andika', raio: 14,
};

const V = { escuro: '#0e3e20', mata: '#1f6b3a', folha: '#3aa675', creme: '#fcfbf6', superficie: '#efeadb', acento: '#86a3fc', suave: '#55574f' };

// Desenhos da identidade do museu: o rio que dá nome ao vale, o relevo, a mata, o losango que separa as cidades no roteiro,
// o selo e a moldura do acervo. Sem texto (fonte não viaja dentro de SVG) e sem script — entram pelo sanitizador do editor.
const SVGS_MUVVI = [
  { nome: 'Rio Ivaí', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><path fill="${V.escuro}" fill-opacity=".28" d="M0 64C48 40 96 88 160 64S272 40 320 64v56H0Z"><animate attributeName="d" dur="9s" repeatCount="indefinite" values="M0 64C48 40 96 88 160 64S272 40 320 64v56H0Z;M0 64C48 88 96 40 160 64S272 88 320 64v56H0Z;M0 64C48 40 96 88 160 64S272 40 320 64v56H0Z"/></path><path fill="${V.mata}" d="M0 78C52 56 104 100 160 78S268 56 320 78v42H0Z"><animate attributeName="d" dur="6.5s" repeatCount="indefinite" values="M0 78C52 56 104 100 160 78S268 56 320 78v42H0Z;M0 78C52 100 104 56 160 78S268 100 320 78v42H0Z;M0 78C52 56 104 100 160 78S268 56 320 78v42H0Z"/></path></svg>` },
  { nome: 'Serra do vale', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><path fill="${V.folha}" fill-opacity=".45" d="M0 132 88 52l54 52 44-36 60 64 74-44v44Z"/><path fill="${V.mata}" d="M0 160 70 86l58 50 48-30 62 54H0Z"/><path fill="${V.escuro}" d="M0 160 96 112l54 26 56-18 114 40Z"/></svg>` },
  { nome: 'Mata ciliar', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><g fill="none" stroke="${V.escuro}" stroke-width="5" stroke-linecap="round"><path d="M80 150V46"/><path d="M80 104c-26 0-40-16-44-40 26-4 42 10 44 40Z" fill="${V.folha}" stroke-width="4"/><path d="M80 78c24-2 38-18 40-42-26-2-40 12-40 42Z" fill="${V.mata}" stroke-width="4"/><path d="M80 134c-20 0-32-12-36-30 20-4 34 6 36 30Z" fill="${V.folha}" fill-opacity=".7" stroke-width="4"/></g></svg>` },
  { nome: 'Separador ◆', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 24"><g fill="none" stroke="${V.suave}" stroke-width="1.5"><path d="M8 12h108M204 12h108"/></g><g fill="${V.escuro}"><path d="M136 12l10-9 10 9-10 9z"/><path d="M160 12l10-9 10 9-10 9z" fill="${V.acento}"/><path d="M184 12l10-9 10 9-10 9z"/></g></svg>` },
  { nome: 'Selo do museu', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="${V.escuro}"/><circle cx="60" cy="60" r="46" fill="none" stroke="${V.creme}" stroke-opacity=".5" stroke-width="1.5"/><path d="M60 28l26 32-26 32-26-32z" fill="${V.acento}"/><path d="M60 44l14 16-14 16-14-16z" fill="${V.escuro}"/></svg>` },
  { nome: 'Moldura de acervo', code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect x="3" y="3" width="194" height="144" rx="6" fill="${V.superficie}" stroke="${V.escuro}" stroke-width="2"/><g fill="none" stroke="${V.escuro}" stroke-width="3"><path d="M20 20h22M20 20v18M180 20h-22M180 20v18M20 130h22M20 130v-18M180 130h-22M180 130v-18"/></g><circle cx="100" cy="66" r="18" fill="none" stroke="${V.mata}" stroke-width="3"/><path d="M60 110l28-26 20 18 16-14 24 22" fill="none" stroke="${V.mata}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { nome: 'Névoa do vale', bg: true, code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><filter id="nv" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="90"/></filter></defs><rect width="1200" height="800" fill="${V.creme}"/><g filter="url(#nv)"><circle r="300" cx="260" cy="620" fill="${V.folha}" opacity=".35"><animate attributeName="cy" values="620;520;620" dur="18s" repeatCount="indefinite"/></circle><circle r="260" cx="940" cy="220" fill="${V.acento}" opacity=".35"><animate attributeName="cx" values="940;760;940" dur="22s" repeatCount="indefinite"/></circle><circle r="220" cx="620" cy="420" fill="${V.superficie}" opacity=".8"/></g></svg>` },
];

// Formas já no estilo da casa: inseridas com o preenchimento, o traço e o raio certos, sem passar pelo painel de propriedades.
const FORMAS_MUVVI = [
  { nome: 'Cartão', shape: 'rect', s: { fill: TEMA_MUVVI.superficie, stroke: null, radius: TEMA_MUVVI.raio } },
  { nome: 'Faixa escura', shape: 'rect', s: { fill: TEMA_MUVVI.escuro, stroke: null, radius: TEMA_MUVVI.raio } },
  { nome: 'Contorno', shape: 'rect', s: { fill: null, stroke: TEMA_MUVVI.escuro, sw: 2, radius: TEMA_MUVVI.raio } },
  { nome: 'Pílula de acento', shape: 'rect', s: { fill: TEMA_MUVVI.acento, stroke: null, radius: 9999 } },
  { nome: 'Divisória', shape: 'line', s: { fill: null, stroke: TEMA_MUVVI.suave, sw: 1.5 } },
  { nome: 'Losango', shape: 'diamond', s: { fill: TEMA_MUVVI.escuro, stroke: null } },
];

export const FOLHA_MUVVI = normalizarFolha({
  ...folhaDoTema(TEMA_MUVVI, {
    id: 'muvvi',
    nome: 'MUVVI — Museu Virtual do Vale do Ivaí',
    descricao: 'Verde do vale, creme de papel e azul de acento; Libre Caslon Text nos títulos e Andika no texto. Vem do modelo de site do museu.',
  }),
  formas: FORMAS_MUVVI,
  svgs: SVGS_MUVVI,
});

// A casa: as cores e as fontes do próprio Gehrarte, para quem edita o blog e as páginas do site.
export const FOLHA_GEHRARTE = normalizarFolha({
  id: 'gehrarte',
  nome: 'Gehrarte — blog e site',
  descricao: 'Laranja da marca, roxo de apoio e o cinza-escuro do texto; Space Grotesk nos títulos e Inter no texto.',
  raio: 12,
  cores: [
    { id: 'fundo', nome: 'Fundo', valor: '#ffffff', papel: 'fundo' },
    { id: 'papel', nome: 'Papel', valor: '#f4f2fa', papel: 'superficie' },
    { id: 'tinta', nome: 'Tinta', valor: '#17161d', papel: 'texto' },
    { id: 'suave', nome: 'Texto suave', valor: '#5d5a6b', papel: 'suave' },
    { id: 'laranja', nome: 'Laranja Gehrarte', valor: '#e4572e', papel: 'marca' },
    { id: 'roxo', nome: 'Roxo', valor: '#7b5cff', papel: 'acento' },
    { id: 'ouro', nome: 'Ouro', valor: '#ffb703', papel: 'acento' },
    { id: 'claro', nome: 'Sobre a marca', valor: '#ffffff', papel: 'sobre' },
  ],
  fontes: [{ nome: 'Space Grotesk', uso: 'Títulos' }, { nome: 'Inter', uso: 'Texto' }],
  formas: [
    { nome: 'Cartão', shape: 'rect', s: { fill: '#f4f2fa', stroke: null, radius: 12 } },
    { nome: 'Botão', shape: 'rect', s: { fill: '#e4572e', stroke: null, radius: 9999 } },
    { nome: 'Contorno', shape: 'rect', s: { fill: null, stroke: '#17161d', sw: 2, radius: 12 } },
    { nome: 'Divisória', shape: 'line', s: { fill: null, stroke: '#5d5a6b', sw: 1.5 } },
  ],
  svgs: [
    { nome: 'Sublinhado', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 40"><style>.u{fill:none;stroke:#e4572e;stroke-width:6;stroke-linecap:round;stroke-dasharray:320;stroke-dashoffset:320;animation:u 1.4s .2s ease-out forwards}@keyframes u{to{stroke-dashoffset:0}}</style><path class="u" d="M8 26C60 10 120 34 170 18S260 10 292 22"/></svg>' },
    { nome: 'Estrela da casa', code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#ffb703" d="M50-0Q50 50 100 50Q50 50 50 100Q50 50 0 50Q50 50 50 0Z" transform="translate(0 0)"/></svg>' },
  ],
});

// A ordem é a do seletor: primeiro os projetos da casa, depois os kits de uso geral (interface e jogos).
export const FOLHAS = [FOLHA_MUVVI, FOLHA_GEHRARTE, ...FOLHAS_INTERFACE];
export const folhaPorId = (id) => FOLHAS.find((f) => f.id === id) || null;
