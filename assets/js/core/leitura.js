// Tempo em tela e leitura — lógica PURA. Responde a uma pergunta de quem escreve: "o texto está sendo LIDO?".
// Não basta o bloco estar na tela: rolar rápido é folhear, aba em segundo plano não lê ninguém. Aqui só se faz a conta; quem mede
// a janela e o relógio é o runtime (core/anim-runtime.js), que entrega amostras prontas (visível quanto? aba ativa? rolando a quantos px/s?).
//
// Regra do tempo de leitura: a pessoa lê ~200 palavras por minuto em silêncio (valor conservador; textos densos e telas pequenas
// pedem mais). A meta de cada bloco é palavras ÷ velocidade, no mínimo 1,5 s; o autor pode fixar a meta à mão.

export const PALAVRAS_POR_MIN = 200;
export const LIMIARES = {
  visivelMin: 0.5,            // fração do bloco que precisa estar à vista para contar
  folheando: 900,             // px/s: acima disso a pessoa está rolando, não lendo
  lido: 0.8,                  // fração da meta que já conta como "lido"
  passou: 0.25,               // abaixo disto, "só passou"
  saltoMaxMs: 1000,           // buraco entre duas amostras maior que isso (aba suspensa) não vira tempo
  janelaCobertura: 0.6,       // bloco mais alto que a janela: cobrir 60% dela vale como "visível"
};
export const ESTADOS = { 'nao-visto': 'Não visto', 'passou-rapido': 'Só passou', parcial: 'Lido em parte', lido: 'Lido' };

export const contarPalavras = (texto) => (String(texto ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
export function estimarLeitura(texto, { wpm = PALAVRAS_POR_MIN } = {}) {
  const n = contarPalavras(texto);
  return n ? Math.max(1.5, Math.round(((n / Math.max(30, wpm)) * 60) * 10) / 10) : 0;      // segundos
}

// Quanto do bloco conta como "à vista": a fração do próprio bloco visível, ou — se ele for mais alto que a janela — quanto da
// janela ele cobre (reescalado para que cobrir `janelaCobertura` valha 1).
export function visibilidadeEfetiva({ topo, altura, vh }, { janelaCobertura = LIMIARES.janelaCobertura } = {}) {
  if (!(altura > 0) || !(vh > 0)) return 0;
  const vis = Math.max(0, Math.min(topo + altura, vh) - Math.max(topo, 0));
  return Math.min(1, Math.max(vis / altura, Math.min(1, vis / vh / janelaCobertura)));
}

export function criarMedidor({ limiares = {} } = {}) {
  const L = { ...LIMIARES, ...limiares };
  const blocos = new Map();
  const estadoDe = (b) => {
    if (b.vistoMs <= 0) return 'nao-visto';
    if (!(b.metaMs > 0)) return 'lido';
    const f = b.tempoMs / b.metaMs;
    return f >= L.lido ? 'lido' : f >= L.passou ? 'parcial' : 'passou-rapido';
  };
  const resumo1 = (b) => ({ id: b.id, nome: b.nome, palavras: b.palavras, metaMs: Math.round(b.metaMs), tempoMs: Math.round(b.tempoMs), vistoMs: Math.round(b.vistoMs), entradas: b.entradas, fracao: b.metaMs > 0 ? Math.round(Math.min(1, b.tempoMs / b.metaMs) * 100) / 100 : 1, estado: estadoDe(b) });
  return {
    // meta: segundos fixados pelo autor, ou 'auto' (estima pelas palavras)
    registrar(id, { nome = id, texto = '', palavras, meta = 'auto', visivelMin = L.visivelMin } = {}) {
      const n = Number.isFinite(palavras) ? palavras : contarPalavras(texto);
      const metaMs = (Number.isFinite(meta) ? meta : estimarLeitura(String(texto) || ('x '.repeat(n)))) * 1000;
      blocos.set(id, { id, nome, palavras: n, metaMs, visivelMin, tempoMs: 0, vistoMs: 0, entradas: 0, ultimoT: null, aVista: false });
    },
    // t em ms; visivel 0–1; ativo = aba à vista; velocidade = px/s da rolagem
    amostra(id, { t, visivel = 0, ativo = true, velocidade = 0 }) {
      const b = blocos.get(id);
      if (!b || !Number.isFinite(t)) return;
      const dt = b.ultimoT == null ? 0 : Math.min(Math.max(0, t - b.ultimoT), L.saltoMaxMs);
      b.ultimoT = t;
      const aVista = ativo && visivel >= b.visivelMin;
      if (aVista && !b.aVista) b.entradas++;
      b.aVista = aVista;
      if (!aVista) return;
      b.vistoMs += dt;
      if (velocidade <= L.folheando) b.tempoMs += dt;
    },
    pausar() { for (const b of blocos.values()) { b.ultimoT = null; b.aVista = false; } },     // aba escondida: o próximo dt recomeça
    estado: (id) => (blocos.has(id) ? estadoDe(blocos.get(id)) : null),
    resumo: () => [...blocos.values()].map(resumo1),
    tem: (id) => blocos.has(id),
    zerar() { for (const b of blocos.values()) { b.tempoMs = 0; b.vistoMs = 0; b.entradas = 0; b.ultimoT = null; b.aVista = false; } },
  };
}

// ---------- saída ----------
const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;
export function relatorioCsv(resumo) {
  const cab = ['bloco', 'palavras', 'meta_s', 'tempo_lendo_s', 'tempo_na_tela_s', 'entradas', 'situacao'];
  const s = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
  return [cab.join(';'), ...resumo.map((r) => [csv(r.nome), r.palavras, s(r.metaMs), s(r.tempoMs), s(r.vistoMs), r.entradas, csv(ESTADOS[r.estado])].join(';'))].join('\n');
}
// O que vai para o destino na medição de VISITANTES: só números e nomes de bloco — nunca o texto da página, nenhum identificador
// persistente (a `sessao` é sorteada a cada visita e some ao fechar a aba) e nenhum dado do navegador além da largura da janela.
export function montarEnvio({ pagina, sessao, dev, vw, resumo }) {
  return { v: 1, pagina: { id: String(pagina?.id || ''), tipo: String(pagina?.kind || '') }, sessao: String(sessao || ''), dev: dev === 'm' ? 'm' : 'd', vw: Math.round(vw || 0),
    blocos: resumo.filter((r) => r.vistoMs > 0 || r.tempoMs > 0).map((r) => ({ id: r.id, nome: r.nome, palavras: r.palavras, metaMs: r.metaMs, tempoMs: r.tempoMs, vistoMs: r.vistoMs, entradas: r.entradas, estado: r.estado })) };
}
