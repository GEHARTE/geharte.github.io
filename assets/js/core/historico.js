// Teto do histórico de desfazer — PURO (sem DOM, sem relógio).
//
// O editor guarda um instantâneo do documento (texto JSON) a cada edição. Só contar passos não basta: medido num documento
// real do repositório, 120 instantâneos passam de **13 MB** de memória — e quem mais sofre é o celular, que é onde há menos
// memória e onde o navegador descarta a aba quando ela pesa.
//
// Então o histórico tem dois tetos: quantos passos e quanto espaço. O que estoura sai pelo começo (o mais antigo), e nunca
// se corta abaixo de `minimo` instantâneos — um documento gigante não pode ficar sem desfazer nenhum.

export const PASSOS_MAX = 120;
export const CARACTERES_MAX = 8_000_000;          // ≈ 8 MB de texto; o JSON do documento é quase todo ASCII
export const MINIMO = 2;                          // o atual e um para onde voltar

// Devolve { hist, hi, cortados }. `hist` é uma lista NOVA quando houve corte, e a mesma quando não houve.
export function podar(hist, hi, { passos = PASSOS_MAX, caracteres = CARACTERES_MAX, minimo = MINIMO } = {}) {
  const lista = Array.isArray(hist) ? hist : [];
  let inicio = 0;
  const maximo = Math.max(minimo, Math.min(passos, lista.length));
  if (lista.length > maximo) inicio = lista.length - maximo;

  let total = 0;
  for (let i = inicio; i < lista.length; i++) total += lista[i].length;
  // tira dos mais antigos até caber, sempre deixando `minimo` (e sem jogar fora o instantâneo atual)
  const ultimoQuePodeSair = Math.min(lista.length - minimo, Number.isFinite(hi) ? hi : lista.length);
  while (total > caracteres && inicio < ultimoQuePodeSair) { total -= lista[inicio].length; inicio++; }

  if (!inicio) return { hist: lista, hi, cortados: 0 };
  return { hist: lista.slice(inicio), hi: Math.max(0, (Number.isFinite(hi) ? hi : lista.length - 1) - inicio), cortados: inicio };
}

export const tamanhoDoHistorico = (hist) => (Array.isArray(hist) ? hist : []).reduce((n, s) => n + (s?.length || 0), 0);
