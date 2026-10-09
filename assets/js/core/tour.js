// Tour guiado (tutorial passo a passo) — PURO: sem DOM, sem relógio, sem rede. Recebe dados e devolve dados.
// Quem desenha o cartão e o destaque na tela é editor/criador-svg-ajuda.js; aqui ficam as duas contas que valem teste:
//   1. a navegação entre passos (sem estourar os limites);
//   2. onde o cartão cabe em volta do alvo (abaixo, acima, ao lado ou, se nada couber, no meio da área).
// Um passo é { id, titulo, texto, alvo?: string, dica?: string, acao?: { rotulo, fazer } } — `alvo` é um seletor que a tela resolve.

const clamp = (v, a, b) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));

// Tira da lista os passos que falam de algo que não está nesta tela (um modo pode não ter todos os controles).
export function filtrarPassos(passos, existe = () => true) {
  return (Array.isArray(passos) ? passos : []).filter((p) => p && (!p.alvo || existe(p.alvo)));
}

// Estado do tour: qual passo está na tela. `ir` prende o índice na faixa; `proximo`/`anterior` devolvem null no fim/começo.
export function criarTour(passos) {
  const lista = (Array.isArray(passos) ? passos : []).filter(Boolean);
  let i = 0;
  const preso = (n) => (lista.length ? Math.min(Math.max(0, Math.trunc(n) || 0), lista.length - 1) : 0);
  return {
    total: lista.length,
    passos: () => lista.slice(),
    indice: () => i,
    passo: () => lista[i] || null,
    ir(n) { i = preso(n); return lista[i] || null; },
    proximo() { if (i >= lista.length - 1) return null; i += 1; return lista[i]; },
    anterior() { if (i <= 0) return null; i -= 1; return lista[i]; },
    noInicio: () => i === 0,
    noFim: () => i >= lista.length - 1,
  };
}

// Onde pôr o cartão. `alvo` e `area` são retângulos { x, y, w, h } (null em alvo = passo sem destaque); `cartao` é { w, h }.
// Tenta abaixo, acima, à direita e à esquerda do alvo, nesta ordem, e fica com o primeiro lado que cabe inteiro na área.
// Sem lado possível, vai para o meio da área. O resultado é sempre preso dentro da área, para o cartão não sair da tela.
export function posicionarCartao(alvo, cartao, area, { folga = 12 } = {}) {
  const c = { w: Math.max(0, cartao?.w || 0), h: Math.max(0, cartao?.h || 0) };
  const meio = () => ({ x: area.x + (area.w - c.w) / 2, y: area.y + (area.h - c.h) / 2, lado: 'centro' });
  if (!alvo || !Number.isFinite(alvo.x) || !Number.isFinite(alvo.y)) return meio();

  const cx = alvo.x + alvo.w / 2, cy = alvo.y + alvo.h / 2;
  const fim = { x: area.x + area.w, y: area.y + area.h };
  const lados = [
    { lado: 'baixo', x: cx - c.w / 2, y: alvo.y + alvo.h + folga, cabe: alvo.y + alvo.h + folga + c.h <= fim.y },
    { lado: 'cima', x: cx - c.w / 2, y: alvo.y - folga - c.h, cabe: alvo.y - folga - c.h >= area.y },
    { lado: 'direita', x: alvo.x + alvo.w + folga, y: cy - c.h / 2, cabe: alvo.x + alvo.w + folga + c.w <= fim.x },
    { lado: 'esquerda', x: alvo.x - folga - c.w, y: cy - c.h / 2, cabe: alvo.x - folga - c.w >= area.x },
  ];
  const escolhido = lados.find((l) => l.cabe);
  if (!escolhido) return meio();
  return {
    lado: escolhido.lado,
    x: clamp(escolhido.x, area.x + folga, fim.x - c.w - folga),
    y: clamp(escolhido.y, area.y + folga, fim.y - c.h - folga),
  };
}

// Retângulo do destaque: o alvo com uma folga em volta, preso na área (o anel nunca vaza para fora da janela).
export function retanguloDoDestaque(alvo, area, { folga = 6 } = {}) {
  if (!alvo || !Number.isFinite(alvo.x)) return null;
  const x = Math.max(area.x, alvo.x - folga), y = Math.max(area.y, alvo.y - folga);
  const x2 = Math.min(area.x + area.w, alvo.x + alvo.w + folga), y2 = Math.min(area.y + area.h, alvo.y + alvo.h + folga);
  return x2 <= x || y2 <= y ? null : { x, y, w: x2 - x, h: y2 - y };
}
