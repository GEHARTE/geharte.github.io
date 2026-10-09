// Folhas de design: o kit visual de um projeto — cores com papel, fontes com uso, formas já no estilo da casa e SVGs da identidade.
// PURO: sem DOM, sem rede. A tela é editor/folha.js.
//
// Por que existe: quem monta uma página do MUVVI não devia precisar lembrar que o verde é #0e3e20 nem que o título é Libre Caslon
// Text. A folha põe isso a um clique de distância, ao lado das ferramentas, e o resultado sai consistente entre páginas e pessoas.
//
// Uma folha é { id, nome, descricao, cores[], fontes[], formas[], svgs[], raio }:
//   cores  { id, nome, valor, papel }   papel: 'fundo' | 'superficie' | 'texto' | 'suave' | 'marca' | 'acento' | 'sobre'
//   fontes { nome, uso }                `nome` precisa existir em core/fonts.js, senão o editor não carrega a família
//   formas { nome, shape, s, label? }   `shape` é um dos SHAPE_LIST (core/render.js); `s` é o estilo pronto
//   svgs   { nome, code, bg? }          SVG inteiro, como na biblioteca; `bg` marca os que servem de fundo de página

const PAPEIS = new Set(['fundo', 'superficie', 'texto', 'suave', 'marca', 'acento', 'sobre']);
const HEX = /^#[0-9a-f]{6}$/i;
const limpar = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- contraste (WCAG 2.1) ----------
// Luminância relativa de um hex #rrggbb. Serve para dizer, na própria folha, quais pares de cor dão para ler.
export function luminancia(hex) {
  if (!HEX.test(hex || '')) return 0;
  const canal = (i) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}
// Razão de contraste entre duas cores: 1 (iguais) a 21 (preto sobre branco).
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)];
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
}
// O que aquele contraste permite, em português de gente.
export function nivelDeContraste(razao) {
  if (razao >= 7) return { id: 'aaa', rotulo: 'Ótimo', nota: 'Legível em qualquer tamanho (AAA).' };
  if (razao >= 4.5) return { id: 'aa', rotulo: 'Bom', nota: 'Legível em texto corrido (AA).' };
  if (razao >= 3) return { id: 'grande', rotulo: 'Só em título', nota: 'Vale para texto grande ou negrito (AA grande).' };
  return { id: 'baixo', rotulo: 'Pouco legível', nota: 'Não use para texto: o contraste é baixo demais.' };
}
// Entre as cores da folha, a que melhor se lê sobre `fundo` (usado ao sugerir a cor do texto).
export function melhorSobre(fundo, cores) {
  let melhor = null, razao = 0;
  for (const c of cores || []) { const r = contraste(fundo, c.valor); if (r > razao) { razao = r; melhor = c; } }
  return melhor ? { cor: melhor, razao } : null;
}

// ---------- onde uma cor entra em cada tipo de elemento ----------
// Devolve o campo de `el.s` a mudar, ou null quando a cor não se aplica (imagem, SVG: a cor está dentro do desenho).
export function campoDaCor(tipo, { traco = false } = {}) {
  if (tipo === 'text') return traco ? null : 'color';
  if (tipo === 'shape' || tipo === 'path') return traco ? 'stroke' : 'fill';
  return null;
}
export const corSeAplica = (tipo, opts) => campoDaCor(tipo, opts) !== null;

// ---------- normalização ----------
// Folha vinda de fora (arquivo, documento importado) nunca é confiável: tudo que não bate com o formato é descartado em silêncio.
export function normalizarFolha(bruta) {
  if (!bruta || typeof bruta !== 'object') return null;
  const id = limpar(bruta.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) return null;
  const cores = (Array.isArray(bruta.cores) ? bruta.cores : [])
    .filter((c) => c && HEX.test(c.valor || ''))
    .slice(0, 24)
    .map((c, i) => ({
      id: limpar(c.id, 30) || `cor-${i + 1}`,
      nome: limpar(c.nome, 40) || `Cor ${i + 1}`,
      valor: c.valor.toLowerCase(),
      papel: PAPEIS.has(c.papel) ? c.papel : 'acento',
    }));
  const fontes = (Array.isArray(bruta.fontes) ? bruta.fontes : [])
    .filter((f) => f && limpar(f.nome, 60))
    .slice(0, 8)
    .map((f) => ({ nome: limpar(f.nome, 60), uso: limpar(f.uso, 40) || 'Texto', peso: Number.isFinite(+f.peso) ? +f.peso : null }));
  const formas = (Array.isArray(bruta.formas) ? bruta.formas : [])
    .filter((f) => f && limpar(f.shape, 20))
    .slice(0, 16)
    .map((f) => ({ nome: limpar(f.nome, 40) || 'Forma', shape: limpar(f.shape, 20), s: { ...(f.s || {}) }, label: limpar(f.label, 60) || '' }));
  const svgs = (Array.isArray(bruta.svgs) ? bruta.svgs : [])
    .filter((s) => s && typeof s.code === 'string' && s.code.includes('<svg'))
    .slice(0, 24)
    .map((s) => ({ nome: limpar(s.nome, 40) || 'Desenho', code: s.code, bg: !!s.bg }));
  return {
    id,
    nome: limpar(bruta.nome, 60) || id,
    descricao: limpar(bruta.descricao, 300),
    raio: Number.isFinite(+bruta.raio) ? Math.min(400, Math.max(0, +bruta.raio)) : 12,
    cores, fontes, formas, svgs,
  };
}

// Folha a partir do `tema` de um modelo de projeto (modelos/<id>/spec.json): é assim que a folha do MUVVI nasce do modelo do site,
// sem repetir cor em dois lugares. Só as cores e as fontes vêm daqui; formas e SVGs são escolha de quem monta a folha.
export function folhaDoTema(tema, { id, nome, descricao } = {}) {
  const t = tema || {};
  const por = [
    ['fundo', 'Fundo', t.fundo, 'fundo'], ['superficie', 'Superfície', t.superficie, 'superficie'],
    ['texto', 'Texto', t.texto, 'texto'], ['suave', 'Texto suave', t.suave, 'suave'],
    ['escuro', 'Marca', t.escuro, 'marca'], ['acento', 'Acento', t.acento, 'acento'],
    ['sobre-escuro', 'Sobre a marca', t.sobreEscuro, 'sobre'], ['sobre-acento', 'Sobre o acento', t.sobreAcento, 'sobre'],
  ];
  return normalizarFolha({
    id, nome, descricao, raio: t.raio,
    cores: por.filter(([, , v]) => HEX.test(v || '')).map(([cid, cnome, valor, papel]) => ({ id: cid, nome: cnome, valor, papel })),
    fontes: [t.fonteTitulo && { nome: t.fonteTitulo, uso: 'Títulos' }, t.fonteTexto && { nome: t.fonteTexto, uso: 'Texto' }].filter(Boolean),
  });
}

// Qual folha mostrar quando a pessoa abre um documento: a gravada nele (`doc.folha`), senão a do modelo de onde ele veio
// (`doc.modelo`), senão a primeira do catálogo. Nunca devolve null se houver catálogo.
export function folhaSugerida(doc, catalogo) {
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const por = (id) => lista.find((f) => f.id === id) || null;
  return por(doc?.folha) || por(String(doc?.modelo || '').replace(/-site$/, '')) || lista[0] || null;
}
