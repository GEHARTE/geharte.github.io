// Tutorial guiado do criador de SVG animado: o "botãozinho de ajuda" (?) da janela abre um passo a passo que destaca o controle
// de que está falando e explica, em poucas linhas, COMO SE ANIMA — não só onde clicar.
//
// Desenho: o tour não bloqueia a tela. O escurecimento e o anel de destaque são `pointer-events:none`; só o cartão recebe clique.
// Assim a pessoa lê o passo e já experimenta no mesmo instante, sem fechar nada. As contas (qual passo, onde o cartão cabe, o
// retângulo do destaque) estão em core/tour.js — puras e testadas; aqui só há DOM, medição e teclado.
//
// Os alvos são os atributos `data-ajuda="…"` postos nas telas dos modos (criador-svg-rig.js, criador-svg-pinos.js) e no cabeçalho
// da janela (criador-svg.js). Passo cujo alvo não existe no modo atual é descartado sozinho (filtrarPassos).
import { h } from '../core/dom.js';
import { criarTour, filtrarPassos, posicionarCartao, retanguloDoDestaque } from '../core/tour.js';
import { icon } from './icons.js';

const CHAVE = 'artatk:tour:criador:';               // + id do modo

export function jaViu(modo) {
  try { return localStorage.getItem(CHAVE + modo) === '1'; } catch { return false; }
}
function marcarVisto(modo) {
  try { localStorage.setItem(CHAVE + modo, '1'); } catch { /* navegador sem armazenamento: o tour só não é lembrado */ }
}

// ---------- o conteúdo do tutorial ----------
// `acao` é o atalho do passo: um botão que faz a coisa acontecer (carregar o exemplo), para quem prefere ver antes de ler.
const PASSO_ENTREGA = {
  id: 'entregar', alvo: '[data-ajuda=entregar]', titulo: 'Levar para a página',
  texto: '“Inserir na página” põe este desenho animado no seu documento; “Baixar .svg” salva um arquivo que funciona em qualquer lugar.',
  dica: 'A animação sai em SMIL puro, sem script — por isso passa pelo filtro de segurança do editor. Para conferir antes, use “Ver exportado”.',
};

export const PASSOS = {
  rig: [
    { id: 'ideia', titulo: 'Animar é fazer poses no tempo',
      texto: 'Você divide o desenho em peças, deixa cada peça numa pose num instante e noutra pose mais adiante. O computador preenche todo o meio. O resto são detalhes.',
      dica: 'O caminho mais curto para aprender: carregue um exemplo pronto e mexa nele.',
      acao: { rotulo: 'Carregar um exemplo', chave: 'exemplo' } },
    { id: 'pecas', alvo: '[data-ajuda=pecas]', titulo: 'As peças',
      texto: 'Cada parte do desenho é uma peça; clique numa para selecioná-la. A peça filha anda junto com a mãe: se o braço é filho do tronco, girar o tronco leva o braço.',
      dica: 'Veio tudo numa peça só? Use “Dividir grupo” no painel da direita.' },
    { id: 'pivo', alvo: '[data-ajuda=pivo]', titulo: 'O pivô: onde a peça gira',
      texto: 'Toda rotação acontece em volta do pivô. O antebraço gira no cotovelo, a porta na dobradiça. Escolha a ferramenta Pivô e clique no lugar certo da peça.',
      dica: 'É o ajuste que mais muda o resultado: pivô no lugar errado faz a peça patinar em vez de articular.' },
    { id: 'tempo', alvo: '[data-ajuda=linha]', titulo: 'A linha do tempo',
      texto: 'Aqui embaixo o tempo corre da esquerda para a direita. A marca vermelha é o instante que você está vendo — arraste-a para passear pela animação.',
      dica: 'As setas ← → andam 50 ms; com Shift, 500 ms.' },
    { id: 'quadro', alvo: '[data-ajuda=quadro]', titulo: 'O quadro-chave',
      texto: 'Quadro-chave é uma pose gravada num instante. A receita: leve a marca do tempo ao começo, deixe a peça como ela deve começar e grave ◆; vá para 0,8 s, mexa na peça e grave ◆ outra vez.',
      dica: 'Dois quadros já são uma animação. A tecla K grava sem sair do mouse.' },
    { id: 'tocar', alvo: '[data-ajuda=tocar]', titulo: 'Veja rodando',
      texto: 'A barra de espaço toca e pausa. Com “Repetir” ligado, o movimento volta ao começo sem parar.',
      dica: 'Para o ciclo não dar tranco, faça o último quadro igual ao primeiro.' },
    { id: 'curva', alvo: '[data-ajuda=curva]', titulo: 'A curva muda tudo',
      texto: 'A curva diz COMO a peça vai de uma pose à outra. “linear” parece robô; “ease-in-out” sai devagar, acelera e freia — é o que dá vida.',
      dica: 'Clique num losango da linha do tempo para escolher o quadro e trocar a curva dele.' },
    { id: 'oficio', titulo: 'Três truques de animador',
      texto: 'Menos quadros, mais vida: dois ou três bastam para quase tudo. Atrase o que vem depois: se o braço sobe, a mão chega 0,1 s mais tarde — só isso já parece peso. Exagere um tiquinho: passe um pouco do ponto final e volte.',
      dica: 'Quando algo parece morto, quase sempre é curva “linear” ou tudo começando no mesmo instante.' },
    PASSO_ENTREGA,
  ],
  pinos: [
    { id: 'ideia', titulo: 'Pinos deformam o desenho',
      texto: 'Em vez de cortar o desenho em peças, você crava pinos nele e os arrasta: o desenho estica e dobra como borracha. É o jeito certo para folha ao vento, cauda, cabelo, bandeira.',
      dica: 'Carregue o exemplo da folha e arraste um pino — em dez segundos a ideia fica clara.',
      acao: { rotulo: 'Carregar o exemplo', chave: 'exemplo' } },
    { id: 'cravar', alvo: '[data-ajuda=ferramenta]', titulo: 'Crave os pinos',
      texto: 'Com “Cravar pino”, clique no desenho. Três pinos resolvem muita coisa: um na base, um no meio e um na ponta.',
      dica: 'Pino demais engessa o desenho e deixa a conta pesada. Comece com poucos.' },
    { id: 'ancora', alvo: '[data-ajuda=palco]', titulo: 'Um pino fica parado: a âncora',
      texto: 'O pino que você nunca move é o que segura o desenho no lugar — no cabo da folha, no pé do personagem, na haste da bandeira.',
      dica: 'Sem âncora, mover um pino arrasta o desenho inteiro junto.' },
    { id: 'tempo', alvo: '[data-ajuda=linha]', titulo: 'Arraste no tempo',
      texto: 'Mude o instante na linha do tempo, escolha “Mover pinos” e arraste um pino: isso grava um quadro-chave ali. Repita em mais um ou dois instantes e o movimento nasce.',
      dica: 'Ir e voltar à mesma posição faz o ciclo fechar: 0 s na pose A, meio na pose B, fim na pose A.' },
    { id: 'rigidez', alvo: '[data-ajuda=rigidez]', titulo: 'Rigidez',
      texto: 'Rigidez baixa: o desenho inteiro acompanha o pino, bem mole. Alta: cada pino só puxa o que está perto dele.',
      dica: 'Não existe valor certo — mexa com a animação tocando e pare onde o movimento parecer do material do desenho.' },
    { id: 'tocar', alvo: '[data-ajuda=tocar]', titulo: 'Veja rodando',
      texto: 'A barra de espaço toca e pausa. Se a repetição der um salto no fim, use “Fechar ciclo”: ele copia a pose do início para o fim.',
      dica: 'Movimento de vento quase nunca é simétrico: adiante um pino em relação ao outro e o resultado melhora.' },
    PASSO_ENTREGA,
  ],
};

// ---------- a tela ----------
// hospede: o elemento que cobre a viewport (.cs-back) — é nele que o tour é desenhado, em coordenadas relativas a ele.
// corpo: o container do modo ativo (onde os data-ajuda daquele modo estão). acoes: { exemplo?: () => void }.
export function abrirAjuda({ hospede, corpo, modo = 'rig', acoes = {} } = {}) {
  if (!hospede) return null;
  hospede.querySelector('.cs-tour')?.remove();
  hospede.querySelector('.cs-tour-back')?.remove();

  const achar = (sel) => {
    for (const raiz of [corpo, hospede]) {
      for (const el of raiz?.querySelectorAll?.(sel) || []) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  };
  const passos = filtrarPassos(PASSOS[modo] || PASSOS.rig, (sel) => !!achar(sel));
  if (!passos.length) return null;
  const tour = criarTour(passos);

  const foco = h('div', { class: 'cs-tour-foco', 'aria-hidden': 'true' });
  const fundo = h('div', { class: 'cs-tour-back', 'aria-hidden': 'true' }, foco);
  const titulo = h('b', { class: 'cs-tour-tit', id: 'cs-tour-tit' });
  const texto = h('p', { class: 'cs-tour-txt' });
  const dica = h('p', { class: 'cs-tour-dica' });
  const conta = h('span', { class: 'cs-tour-conta' });
  const pontos = h('div', { class: 'cs-tour-pontos' });
  const bAcao = h('button', { type: 'button', class: 'btn cs-tour-acao', hidden: true });
  const bAnterior = h('button', { type: 'button', class: 'btn', onclick: () => { tour.anterior(); pintar(); } }, 'Voltar');
  const bProximo = h('button', { type: 'button', class: 'btn primary', onclick: avancar });
  const bFechar = h('button', { type: 'button', class: 'btn icon cs-tour-x', title: 'Fechar o tutorial', 'aria-label': 'Fechar o tutorial', html: icon('x', 16), onclick: () => sair() });
  const cartao = h('div', {
    class: 'cs-tour', role: 'dialog', 'aria-labelledby': 'cs-tour-tit', 'aria-live': 'polite', tabindex: '-1',
  }, h('header', {}, h('span', { class: 'cs-tour-marca' }, 'Tutorial'), conta, bFechar), titulo, texto, dica,
    h('footer', {}, pontos, h('span', { class: 'cs-esp' }), bAcao, bAnterior, bProximo));

  hospede.append(fundo, cartao);

  function avancar() { if (!tour.proximo()) { sair(true); return; } pintar(); }

  function sair(concluido = false) {
    marcarVisto(modo);
    desligar();
    fundo.remove(); cartao.remove();
    if (concluido) corpo?.querySelector?.('[tabindex="-1"]')?.focus?.();
  }

  // Posição do cartão e do destaque, em coordenadas do hospede (que é quem cobre a viewport).
  function pintar() {
    const p = tour.passo();
    if (!p) { sair(true); return; }
    const alvo = p.alvo ? achar(p.alvo) : null;
    try { alvo?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* navegador antigo */ }

    titulo.textContent = p.titulo;
    texto.textContent = p.texto;
    dica.textContent = p.dica || ''; dica.hidden = !p.dica;
    conta.textContent = `${tour.indice() + 1} de ${tour.total}`;
    bAnterior.disabled = tour.noInicio();
    bProximo.textContent = tour.noFim() ? 'Entendi' : 'Próximo';
    const fazer = p.acao && acoes[p.acao.chave];
    bAcao.hidden = !fazer;
    if (fazer) { bAcao.textContent = p.acao.rotulo; bAcao.onclick = () => { fazer(); requestAnimationFrame(posicionar); }; }

    pontos.replaceChildren(...tour.passos().map((q, i) => h('button', {
      type: 'button', class: 'cs-tour-ponto' + (i === tour.indice() ? ' on' : ''),
      title: q.titulo, 'aria-label': `Passo ${i + 1}: ${q.titulo}`, 'aria-current': i === tour.indice() ? 'step' : null,
      onclick: () => { tour.ir(i); pintar(); },
    })));

    posicionar();
    cartao.focus({ preventScroll: true });
  }

  function posicionar() {
    const p = tour.passo();
    if (!p) return;
    const base = hospede.getBoundingClientRect();
    const rel = (r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const area = { x: 0, y: 0, w: base.width, h: base.height };
    const el = p.alvo ? achar(p.alvo) : null;
    const alvo = el ? rel(el.getBoundingClientRect()) : null;

    const d = retanguloDoDestaque(alvo, area);
    foco.hidden = !d;
    if (d) Object.assign(foco.style, { left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px` });

    const c = cartao.getBoundingClientRect();
    const pos = posicionarCartao(alvo, { w: c.width, h: c.height }, area);
    Object.assign(cartao.style, { left: `${pos.x}px`, top: `${pos.y}px` });
    cartao.dataset.lado = pos.lado;
  }

  // ---------- teclado e redesenho ----------
  // O keydown para no cartão: o modo escuta setas/espaço/Delete e não deve reagir enquanto a pessoa navega o tutorial.
  const naTecla = (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); sair(); return; }
    if (k === 'ArrowRight' || k === 'Enter' || k === 'PageDown') { e.preventDefault(); e.stopPropagation(); avancar(); return; }
    if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); tour.anterior(); pintar(); return; }
    e.stopPropagation();
  };
  cartao.addEventListener('keydown', naTecla);
  const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => posicionar()) : null;
  obs?.observe(hospede);
  const aoMudarTela = () => requestAnimationFrame(posicionar);
  addEventListener('resize', aoMudarTela);
  document.addEventListener('fullscreenchange', aoMudarTela);
  function desligar() {
    obs?.disconnect();
    removeEventListener('resize', aoMudarTela);
    document.removeEventListener('fullscreenchange', aoMudarTela);
  }

  pintar();
  return { fechar: () => sair(), reposicionar: posicionar };
}
