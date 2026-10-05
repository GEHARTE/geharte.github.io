// Gerenciador de janelas: lê as proporções REAIS do navegador e da tela e posiciona tudo o que "abre" (caixas de diálogo, menus,
// seletor de cor, painéis soltos e painéis em outra janela do navegador) de modo que nunca fique cortado nem fora da tela.
//
// Por que não basta CSS/innerHeight: no celular o teclado e a barra de endereço mudam a área visível (visualViewport); com zoom ou
// vários monitores a janela pode ser aberta numa posição que não existe mais; e uma janela nova do navegador é posicionada em
// coordenadas da TELA, não da página. Aqui estão as contas (puras, testadas) e o pequeno trecho que lê/escuta o navegador.
export const MARGEM = 8;

// ---------- contas puras ----------
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

// Cabe `r` dentro de `caixa` ({x,y,w,h}): encolhe se for maior e empurra para dentro se passar da borda.
export function ajustar(r, caixa, { margem = MARGEM, minW = 0, minH = 0 } = {}) {
  const w = Math.max(Math.min(minW, caixa.w), Math.min(r.w, caixa.w - 2 * margem));
  const h = Math.max(Math.min(minH, caixa.h), Math.min(r.h, caixa.h - 2 * margem));
  return {
    x: Math.round(lim(r.x, caixa.x + margem, Math.max(caixa.x + margem, caixa.x + caixa.w - margem - w))),
    y: Math.round(lim(r.y, caixa.y + margem, Math.max(caixa.y + margem, caixa.y + caixa.h - margem - h))),
    w: Math.round(w), h: Math.round(h),
  };
}

// Posiciona algo de tamanho `tam` ({w,h}) junto de `ancora` (retângulo do botão/elemento), escolhendo o lado onde cabe inteiro.
// `prefer`: ordem de preferência entre 'baixo' | 'cima' | 'direita' | 'esquerda'; `alinhar`: 'inicio' (borda esquerda/topo da âncora) ou 'fim'.
export function ancorar(ancora, tam, caixa, { prefer = ['baixo', 'cima', 'direita', 'esquerda'], folga = 6, alinhar = 'inicio', margem = MARGEM } = {}) {
  const area = { x: caixa.x + margem, y: caixa.y + margem, r: caixa.x + caixa.w - margem, b: caixa.y + caixa.h - margem };
  const cand = {
    baixo: { x: alinhar === 'fim' ? ancora.right - tam.w : ancora.left, y: ancora.bottom + folga },
    cima: { x: alinhar === 'fim' ? ancora.right - tam.w : ancora.left, y: ancora.top - folga - tam.h },
    direita: { x: ancora.right + folga, y: ancora.top },
    esquerda: { x: ancora.left - folga - tam.w, y: ancora.top },
  };
  // espaço livre em cada lado: se nenhum couber inteiro, usa o lado mais folgado
  const sobra = { baixo: area.b - ancora.bottom - folga, cima: ancora.top - folga - area.y, direita: area.r - ancora.right - folga, esquerda: ancora.left - folga - area.x };
  const cabe = (l) => (l === 'baixo' || l === 'cima' ? sobra[l] >= tam.h : sobra[l] >= tam.w);
  const lado = prefer.find(cabe) || prefer.slice().sort((a, b) => sobra[b] - sobra[a])[0];
  const p = ajustar({ ...cand[lado], w: tam.w, h: tam.h }, caixa, { margem });
  return { x: p.x, y: p.y, w: p.w, h: p.h, lado };
}

// Janela NOVA do navegador (window.open usa coordenadas da TELA). `tela` = área útil do monitor ({left,top,width,height}, sem a barra de
// tarefas). Garante que a barra de título fique à vista e a janela inteira caiba; nunca "muito abaixo da tela".
export function posicaoJanela(desejado, tela, { barra = 32, margem = 12 } = {}) {
  const w = Math.round(Math.min(desejado.width, tela.width - 2 * margem));
  const h = Math.round(Math.min(desejado.height, tela.height - barra - margem));
  return {
    width: Math.max(160, w), height: Math.max(120, h),
    left: Math.round(lim(desejado.left, tela.left + margem, Math.max(tela.left + margem, tela.left + tela.width - margem - w))),
    top: Math.round(lim(desejado.top, tela.top + barra, Math.max(tela.top + barra, tela.top + tela.height - margem - h))),
  };
}

// A janela (já aberta) está toda dentro da tela? Devolve onde ela deveria estar, ou null se está tudo certo.
export function corrigirJanela(atual, tela, tolerancia = 2) {
  const alvo = posicaoJanela({ left: atual.left, top: atual.top, width: atual.width, height: atual.height }, tela);
  const igual = Math.abs(alvo.left - atual.left) <= tolerancia && Math.abs(alvo.top - atual.top) <= tolerancia && Math.abs(alvo.width - atual.width) <= tolerancia && Math.abs(alvo.height - atual.height) <= tolerancia;
  return igual ? null : alvo;
}

// ---------- leitura do navegador ----------
// Área realmente visível da página (já sem teclado virtual / barras que se escondem).
export function caixaVisivel(win = window) {
  const vv = win.visualViewport;
  return { x: vv?.offsetLeft ?? 0, y: vv?.offsetTop ?? 0, w: Math.round(vv?.width ?? win.innerWidth), h: Math.round(vv?.height ?? win.innerHeight) };
}
// Área útil do monitor onde a janela está (Chrome informa availLeft/availTop; sem isso, 0,0).
export function telaDisponivel(win = window) {
  const s = win.screen || {};
  return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth || win.innerWidth, height: s.availHeight || win.innerHeight };
}
// Posição/tamanho EXTERNOS de uma janela, em coordenadas da tela.
export const retanguloJanela = (win) => ({ left: win.screenX ?? win.screenLeft ?? 0, top: win.screenY ?? win.screenTop ?? 0, width: win.outerWidth, height: win.outerHeight });

// Mantém variáveis CSS com a área visível (--vv-x/y/w/h em px) num document. O CSS usa var(--vv-h, 100dvh) etc.
// Devolve a função que desliga. Chame para o document principal e para o de cada janela separada.
export function instalar(win = window) {
  const root = win.document.documentElement;
  const aplicar = () => {
    const c = caixaVisivel(win);
    root.style.setProperty('--vv-x', c.x + 'px'); root.style.setProperty('--vv-y', c.y + 'px');
    root.style.setProperty('--vv-w', c.w + 'px'); root.style.setProperty('--vv-h', c.h + 'px');
  };
  aplicar();
  const alvos = [win, win.visualViewport].filter(Boolean);
  for (const a of alvos) { a.addEventListener('resize', aplicar); a.addEventListener('scroll', aplicar); }
  return () => { for (const a of alvos) { a.removeEventListener('resize', aplicar); a.removeEventListener('scroll', aplicar); } };
}
