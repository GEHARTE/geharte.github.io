// Criador de SVG animado — modo PINOS DE DEFORMAÇÃO (estilo "Puppet Pin" do After Effects).
// A tela do modo: o artista crava pinos no desenho, arrasta os pinos em quadros-chave numa linha do tempo e o desenho se deforma
// como borracha. Toda a conta (deformar, interpolar, exportar) está em core/pinos.js — PURA e testada; aqui só há tela e ponteiro.
//
// Como se encaixa: a janela hospedeira (editor/criador-svg.js) chama `modoPinos.montar(container, ctx)` e recebe de volta
// { exportarSvg(), destruir(), temAlteracoes() }. Este módulo só preenche o `container` que recebe; não conhece a janela.
//   ctx = { svg: string|null, nome: string, avisarMudanca(): void }
//
// Escolhas (para o artista que está aprendendo, e para quem for mexer aqui depois):
//  - O modelo é IMUTÁVEL: cada edição cria um modelo novo. Por isso desfazer/refazer é só guardar modelos antigos numa lista (20 passos).
//  - Arrastar um pino cria/atualiza o quadro-chave do pino no instante atual da linha do tempo (como no After Effects).
//  - Cravar um pino com o desenho já deformado no instante atual "crava o pino onde ele está": o ponto sob o clique fica parado.
//  - Tocar a animação redesenha só o atributo `d` dos caminhos (um laço requestAnimationFrame); a linha do tempo não é refeita.
//  - O teclado fica DENTRO do contêiner: `stopPropagation` no keydown/keyup, senão Delete/Espaço/Ctrl+Z disparariam os atalhos do editor.
//  - Sem sanitizador aqui: o SVG que sai é gerado por core/pinos.js a partir de uma lista fechada de atributos (nada de script/eventos).
import { h } from '../core/dom.js';
import { NOMES_DE_CURVA } from '../core/anim-motor.js';
import {
  modeloDePinos, adicionarPino, removerPino, moverPinoEm, removerQuadroDoPino, definirCurvaDoQuadro, moverQuadroDoPino, definirDuracao, definirRigidez,
  fecharCiclo, poseDosPinos, quadroDoModelo, pontosDoQuadro, exportarSvgPinosDetalhado, LIMITES,
} from '../core/pinos.js';

const NS = 'http://www.w3.org/2000/svg';
const HISTORICO = 20;
const PASSO_TECLA = 50;       // ms por toque de seta na linha do tempo
const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const seg = (ms) => (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- exemplo para aprender ----------
// Uma folha (com nervura e cabinho) e uma animação pronta: o cabinho fica fixo e a ponta balança, o meio acompanha um pouco.
export const SVG_EXEMPLO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <path d="M100 18 C152 52 172 112 100 178 C28 112 48 52 100 18 Z" fill="#3aa675" stroke="#1d6b48" stroke-width="3" stroke-linejoin="round"/>
  <path d="M100 40 L100 174" fill="none" stroke="#1d6b48" stroke-width="4" stroke-linecap="round"/>
  <path d="M100 176 L100 196" fill="none" stroke="#8a5a33" stroke-width="7" stroke-linecap="round"/>
</svg>`;

export function modeloExemplo() {
  let m = modeloDePinos(SVG_EXEMPLO, { duracao: 2400 });
  m = adicionarPino(m, 100, 190);     // p1: o cabinho (fica parado, é a âncora)
  m = adicionarPino(m, 100, 105);     // p2: o meio da folha
  m = adicionarPino(m, 100, 26);      // p3: a ponta
  const balanco = [[0, 100, 26], [600, 142, 34], [1200, 100, 26], [1800, 58, 34], [2400, 100, 26]];
  for (const [t, x, y] of balanco) m = moverPinoEm(m, 'p3', t, x, y, { curva: 'ease-in-out' });
  const meio = [[0, 100, 105], [600, 111, 105], [1200, 100, 105], [1800, 89, 105], [2400, 100, 105]];
  for (const [t, x, y] of meio) m = moverPinoEm(m, 'p2', t, x, y, { curva: 'ease-in-out' });
  return m;
}

// ---------- o modo ----------
export const modoPinos = {
  id: 'pinos',
  rotulo: 'Pinos de deformação',
  montar(container, ctx = {}) {
    return montarTela(container, ctx || {});
  },
};

function montarTela(container, ctx) {
  // ---------- estado ----------
  let modelo = null, t = 0, tocando = false, repetir = true, sel = null, ferramenta = 'cravar', curvaAtual = 'ease-in-out', malha = false, sujo = false;
  let desfazer = [], refazer = [], raf = 0, ultimo = 0, morto = false, arrasto = null, scrub = false, arrastoQuadro = null;
  const aviso = (m) => { if (!morto) ctx.avisarMudanca?.(m); };

  // ---------- elementos ----------
  const svg = sv('svg', { class: 'pn-svg', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Desenho com pinos de deformação' });
  const gDesenho = sv('g'), gMalha = sv('path', { class: 'pn-malha' }), gFantasmas = sv('g'), gPinos = sv('g');
  svg.append(gDesenho, gMalha, gFantasmas, gPinos);
  const palco = h('div', { class: 'pn-palco', 'data-ferr': ferramenta }, svg);
  const status = h('p', { class: 'pn-status', role: 'status' });

  const botao = (rotulo, aoClicar, { titulo = '', cls = '' } = {}) => h('button', { type: 'button', class: `btn sm pn-b ${cls}`, title: titulo || rotulo, onclick: aoClicar }, rotulo);
  const bCravar = botao('Cravar pino', () => ferr('cravar'), { titulo: 'Clique no desenho para cravar um pino' });
  const bMover = botao('Mover pinos', () => ferr('mover'), { titulo: 'Arraste os pinos; no instante atual cria um quadro-chave' });
  const bDesfazer = botao('Desfazer', () => voltar(desfazer, refazer), { titulo: 'Desfazer (Ctrl+Z)' });
  const bRefazer = botao('Refazer', () => voltar(refazer, desfazer), { titulo: 'Refazer (Ctrl+Shift+Z)' });
  const bTocar = botao('▶ Tocar', () => alternar(), { titulo: 'Tocar / pausar (Espaço)', cls: 'primary' });
  const bRemoverPino = botao('Remover pino', () => removerSelecionado(), { titulo: 'Remove o pino selecionado (Delete)' });
  const bRemoverQuadro = botao('Remover quadro', () => removerQuadro(), { titulo: 'Remove o quadro-chave do pino selecionado neste instante' });
  const bFechar = botao('Fechar ciclo', () => aplicar(fecharCiclo(modelo)), { titulo: 'Cria no fim um quadro igual ao do início, para a repetição não dar salto' });

  const campo = (rotulo, ...filhos) => h('label', { class: 'pn-campo' }, h('span', {}, rotulo), ...filhos);
  const rigidez = h('input', { type: 'range', min: 0, max: 4, step: 0.1, value: 1, 'aria-label': 'Rigidez' });
  const rigidezSaida = h('output', {}, '1');
  let rigidezAntes = null;       // o modelo de antes de mexer no controle: um único passo de "desfazer" por arrastada
  rigidez.addEventListener('input', () => { if (!rigidezAntes) rigidezAntes = modelo; rigidezSaida.textContent = rigidez.value; modelo = definirRigidez(modelo, +rigidez.value); desenhar(); });
  rigidez.addEventListener('change', () => { if (rigidezAntes && rigidezAntes !== modelo) { empilhar(rigidezAntes); aviso(); } rigidezAntes = null; render(); });
  const marcaMalha = h('input', { type: 'checkbox' });
  marcaMalha.addEventListener('change', () => { malha = marcaMalha.checked; desenhar(); });
  const marcaRepetir = h('input', { type: 'checkbox', checked: true });
  marcaRepetir.addEventListener('change', () => { repetir = marcaRepetir.checked; });
  const selCurva = h('select', { 'aria-label': 'Curva do quadro' }, NOMES_DE_CURVA.map((n) => h('option', { value: n }, n)));
  selCurva.value = curvaAtual;
  selCurva.addEventListener('change', () => {
    curvaAtual = selCurva.value;
    if (sel && temQuadro(sel, t)) aplicar(definirCurvaDoQuadro(modelo, sel, t, curvaAtual));
  });
  const entDuracao = h('input', { type: 'number', min: LIMITES.duracaoMin / 1000, max: LIMITES.duracaoMax / 1000, step: 0.1, value: 2 });
  const marcaEsticar = h('input', { type: 'checkbox' });
  entDuracao.addEventListener('change', () => {
    const ms = clamp((parseFloat(entDuracao.value) || 2) * 1000, LIMITES.duracaoMin, LIMITES.duracaoMax);
    aplicar(definirDuracao(modelo, ms, { escalar: marcaEsticar.checked }));
    t = Math.min(t, modelo.duracao); desenhar();
  });
  const caixa = h('textarea', { class: 'pn-codigo', rows: 5, spellcheck: false, placeholder: 'Cole aqui o código de um SVG (caminhos, retângulos, círculos…)' });
  const bCarregar = botao('Carregar este SVG', () => carregarTexto(caixa.value), { cls: 'primary' });
  const bExemplo = botao('Exemplo: folha ao vento', () => { empilharAtual(); trocarModelo(modeloExemplo()); mensagem('Exemplo carregado. Aperte ▶ e depois arraste um pino para mudar a animação.'); });
  const lista = h('p', { class: 'pn-ajuda' });

  const painel = h('div', { class: 'pn-lado' },
    h('div', { class: 'pn-grupo' }, h('p', { class: 'pn-tit' }, 'Ferramenta'), h('div', { class: 'pn-linha' }, bCravar, bMover)),
    h('div', { class: 'pn-grupo' }, h('p', { class: 'pn-tit' }, 'Histórico'), h('div', { class: 'pn-linha' }, bDesfazer, bRefazer)),
    h('div', { class: 'pn-grupo' }, h('p', { class: 'pn-tit' }, 'Deformação'),
      h('label', { class: 'pn-campo' }, h('span', {}, 'Rigidez', rigidezSaida), rigidez),
      h('p', { class: 'pn-ajuda' }, 'Baixa: o desenho todo acompanha. Alta: cada pino só puxa o que está perto dele.'),
      h('label', { class: 'pn-marca' }, marcaMalha, h('span', {}, 'Mostrar malha de pontos'))),
    h('div', { class: 'pn-grupo' }, h('p', { class: 'pn-tit' }, 'Pino selecionado'),
      campo('Curva do quadro', selCurva), h('div', { class: 'pn-linha' }, bRemoverPino, bRemoverQuadro), bFechar, lista),
    h('div', { class: 'pn-grupo' }, h('p', { class: 'pn-tit' }, 'Duração'),
      campo('Segundos', entDuracao), h('label', { class: 'pn-marca' }, marcaEsticar, h('span', {}, 'Esticar os quadros junto'))),
    h('details', { class: 'pn-grupo' }, h('summary', { class: 'pn-tit' }, 'Carregar outro SVG'), caixa, h('div', { class: 'pn-linha' }, bCarregar, bExemplo)));

  // linha do tempo
  const rotulos = h('div', { class: 'pn-rotulos' }), area = h('div', { class: 'pn-area' });
  const cabeca = h('div', { class: 'pn-cabeca', 'aria-hidden': 'true' });
  const leitura = h('output', { class: 'pn-leitura' }, '0,00 / 2,00 s');
  const transporte = h('div', { class: 'pn-transporte' }, bTocar, h('label', { class: 'pn-marca' }, marcaRepetir, h('span', {}, 'Repetir')), leitura);
  const grade = h('div', { class: 'pn-grade' }, rotulos, area);
  const tempo = h('div', { class: 'pn-tempo' }, transporte, grade);
  const raiz = h('div', { class: 'pn', tabindex: '-1', 'aria-label': 'Pinos de deformação' }, h('div', { class: 'pn-corpo' }, h('div', { class: 'pn-centro' }, palco, status), painel), tempo);
  container.replaceChildren(raiz);

  // ---------- consultas ----------
  const temQuadro = (id, ms) => !!modelo?.pinos.find((p) => p.id === id)?.trilha.x.some((k) => Math.abs(k.t - ms) <= 0.5);
  const numero = (id) => modelo.pinos.findIndex((p) => p.id === id) + 1;

  function ponto(ev) {
    const m = svg.getScreenCTM?.();
    if (!m) return null;
    const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const r = p.matrixTransform(m.inverse());
    return Number.isFinite(r.x) && Number.isFinite(r.y) ? { x: r.x, y: r.y } : null;
  }
  // tamanho de 1 pixel de tela em unidades do desenho (para os pinos terem tamanho constante na tela)
  function unidadePorPx() {
    const r = svg.getBoundingClientRect?.();
    const [, , w, hh] = modelo.viewBox;
    const px = r && r.width > 0 && r.height > 0 ? Math.min(w / r.width, hh / r.height) : Math.max(w, hh) / 500;
    return px > 0 ? px : 1;
  }

  // ---------- modelo, histórico ----------
  function trocarModelo(novo, silencioso = false) {
    modelo = novo; t = 0; sel = null; parar();
    entDuracao.value = (modelo.duracao / 1000).toString(); rigidez.value = modelo.alpha; rigidezSaida.textContent = String(modelo.alpha);
    render();
    if (!silencioso) aviso();
  }
  function empilhar(anterior) { desfazer.push(anterior); if (desfazer.length > HISTORICO) desfazer.shift(); refazer = []; sujo = true; }
  const empilharAtual = () => { if (modelo) empilhar(modelo); };
  // Aplica uma edição discreta: guarda o modelo antigo para o "desfazer" e redesenha tudo.
  function aplicar(novo) {
    if (!novo || novo === modelo) return;
    empilhar(modelo); modelo = novo; render(); aviso();
  }
  function voltar(de, para) {
    if (!de.length) return;
    para.push(modelo); modelo = de.pop();
    if (sel && !modelo.pinos.some((p) => p.id === sel)) sel = null;
    t = Math.min(t, modelo.duracao);
    entDuracao.value = (modelo.duracao / 1000).toString(); rigidez.value = modelo.alpha; rigidezSaida.textContent = String(modelo.alpha);
    sujo = true; render(); aviso();
  }
  function carregarTexto(texto) {
    try {
      const novo = modeloDePinos(texto);
      empilharAtual(); trocarModelo(novo);
      mensagem(`SVG carregado: ${novo.formas.length} forma(s). ${novo.avisos.join(' ')}`.trim());
    } catch (e) { mensagem(e.message || 'Não consegui ler este SVG.', true); }
  }

  // ---------- ações ----------
  function ferr(f) { ferramenta = f; palco.dataset.ferr = f; bCravar.classList.toggle('on', f === 'cravar'); bMover.classList.toggle('on', f === 'mover'); mensagem(f === 'cravar' ? 'Clique no desenho para cravar um pino.' : 'Arraste um pino para deformar o desenho neste instante.'); }
  function selecionar(id) { sel = id; syncCurva(); render(); }
  function removerSelecionado() { if (sel) { const id = sel; sel = null; aplicar(removerPino(modelo, id)); } }
  function removerQuadro() { if (sel && temQuadro(sel, t)) aplicar(removerQuadroDoPino(modelo, sel, t)); else mensagem('O pino selecionado não tem quadro-chave neste instante.', true); }
  function mensagem(texto, erro = false) { status.textContent = texto; status.classList.toggle('pn-erro', erro); }

  // ---------- reprodução ----------
  function parar() { tocando = false; cancelAnimationFrame(raf); raf = 0; bTocar.textContent = '▶ Tocar'; }
  function alternar() {
    if (tocando) { parar(); return; }
    if (t >= modelo.duracao) t = 0;
    tocando = true; ultimo = 0; bTocar.textContent = '⏸ Pausar';
    const passo = (agora) => {
      if (!tocando || morto) return;
      if (ultimo) t += agora - ultimo;
      ultimo = agora;
      if (t >= modelo.duracao) { if (repetir) t %= modelo.duracao; else { t = modelo.duracao; parar(); } }
      desenhar();
      if (tocando) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
  }
  function irPara(ms) { t = clamp(Math.round(ms), 0, modelo.duracao); desenhar(); }

  // ---------- desenho ----------
  // Por quadro: só os caminhos, a malha, os pinos e a cabeça de reprodução. A estrutura (linhas da linha do tempo) só em render().
  const circulos = new Map();       // id → { disco, rotulo, ligacao, anel }
  function desenhar() {
    if (!modelo) return;
    const ds = quadroDoModelo(modelo, t);
    const filhos = gDesenho.children;
    for (let i = 0; i < ds.length && i < filhos.length; i++) filhos[i].setAttribute('d', ds[i]);
    gMalha.setAttribute('d', malha ? pontosDoQuadro(modelo, t).map((q) => `M${+q.x.toFixed(2)} ${+q.y.toFixed(2)}h0`).join('') : '');
    const u = unidadePorPx(), toque = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.6 : 1;   // dedo precisa de alvo maior
    gMalha.setAttribute('stroke-width', String(5 * u));
    for (const k of poseDosPinos(modelo, t)) {
      const c = circulos.get(k.id);
      if (!c) continue;
      const deslocado = Math.hypot(k.q.x - k.p.x, k.q.y - k.p.y) > 0.01 * u;
      for (const [e, r] of [[c.disco, 8 * u * toque], [c.anel, 12 * u * toque]]) { e.setAttribute('cx', k.q.x); e.setAttribute('cy', k.q.y); e.setAttribute('r', r); }
      c.rotulo.setAttribute('x', k.q.x); c.rotulo.setAttribute('y', k.q.y); c.rotulo.setAttribute('font-size', 10 * u); c.rotulo.setAttribute('dy', 3.5 * u);
      c.ligacao.setAttribute('x1', k.p.x); c.ligacao.setAttribute('y1', k.p.y); c.ligacao.setAttribute('x2', k.q.x); c.ligacao.setAttribute('y2', k.q.y);
      c.ligacao.style.display = deslocado ? '' : 'none';
      c.ancora.setAttribute('cx', k.p.x); c.ancora.setAttribute('cy', k.p.y); c.ancora.setAttribute('r', 3 * u); c.ancora.style.display = deslocado ? '' : 'none';
      c.ligacao.setAttribute('stroke-width', 1.5 * u);
    }
    const f = modelo.duracao ? t / modelo.duracao : 0;
    cabeca.style.setProperty('--f', String(f));
    leitura.textContent = `${seg(t)} / ${seg(modelo.duracao)} s`;
  }

  // Estrutura: pinos no palco, linhas da linha do tempo, botões. Roda a cada edição (não a cada quadro).
  let formasNoDom = null;
  function render() {
    // as formas só mudam ao carregar outro SVG (ou desfazer/refazer isso): compara a referência para saber se o DOM precisa ser refeito
    if (formasNoDom !== modelo.formas) {
      formasNoDom = modelo.formas;
      svg.setAttribute('viewBox', modelo.viewBox.join(' '));
      gDesenho.replaceChildren(...modelo.formas.map((f) => sv('path', { ...f.atributosFixos, d: f.d, 'data-forma': f.id })));
    }
    circulos.clear(); gPinos.replaceChildren(); gFantasmas.replaceChildren();
    modelo.pinos.forEach((p) => {
      const ativo = p.id === sel;
      const anel = sv('circle', { class: 'pn-anel' + (ativo ? ' on' : ''), 'data-pino': p.id });
      const disco = sv('circle', { class: 'pn-disco' + (ativo ? ' on' : ''), 'data-pino': p.id });
      const rotulo = sv('text', { class: 'pn-num', 'text-anchor': 'middle', 'pointer-events': 'none' }); rotulo.textContent = String(numero(p.id));
      const ligacao = sv('line', { class: 'pn-ligacao', 'pointer-events': 'none' });
      const ancora = sv('circle', { class: 'pn-ancora', 'pointer-events': 'none' });
      gFantasmas.append(ligacao, ancora);
      gPinos.append(anel, disco, rotulo);
      circulos.set(p.id, { anel, disco, rotulo, ligacao, ancora });
    });
    // linha do tempo
    rotulos.replaceChildren(h('div', { class: 'pn-reg-rot' }), ...modelo.pinos.map((p) => h('button', { type: 'button', class: 'pn-rot' + (p.id === sel ? ' on' : ''), onclick: () => selecionar(p.id) }, `Pino ${numero(p.id)}`)));
    area.replaceChildren(regua(), ...modelo.pinos.map((p) => trilha(p)), cabeca);
    bRemoverPino.disabled = !sel; bRemoverQuadro.disabled = !sel; bFechar.disabled = !modelo.pinos.some((p) => p.trilha.x.length);
    bDesfazer.disabled = !desfazer.length; bRefazer.disabled = !refazer.length;
    lista.textContent = sel ? `Pino ${numero(sel)} selecionado: ${modelo.pinos.find((p) => p.id === sel).trilha.x.length} quadro(s)-chave.` : modelo.pinos.length ? 'Clique em um pino (ou no nome dele na linha do tempo) para selecioná-lo.' : 'Ainda não há pinos. Escolha "Cravar pino" e clique no desenho.';
    bCravar.classList.toggle('on', ferramenta === 'cravar'); bMover.classList.toggle('on', ferramenta === 'mover');
    desenhar();
  }
  function regua() {
    const passos = [100, 250, 500, 1000, 2000, 5000, 10000], passo = passos.find((p) => modelo.duracao / p <= 10) || 10000;
    const r = h('div', { class: 'pn-regua' });
    for (let ms = 0; ms <= modelo.duracao; ms += passo) r.append(h('span', { class: 'pn-marca-t', style: { left: `calc(var(--pad) + (100% - 2 * var(--pad)) * ${ms / modelo.duracao})` } }, seg(ms).replace(',00', '')));
    return r;
  }
  function trilha(p) {
    const r = h('div', { class: 'pn-trilha' + (p.id === sel ? ' on' : ''), 'data-pino': p.id });
    for (const k of p.trilha.x) r.append(h('i', { class: 'pn-k' + (p.id === sel && Math.abs(k.t - t) <= 0.5 ? ' on' : ''), 'data-t': k.t, title: `${seg(k.t)} s${k.curva ? ' · ' + k.curva : ''}`, style: { left: `calc(var(--pad) + (100% - 2 * var(--pad)) * ${k.t / modelo.duracao})` } }));
    return r;
  }

  // ---------- ponteiro: palco ----------
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const alvo = ev.target.closest?.('[data-pino]');
    if (tocando) parar();
    raiz.focus({ preventScroll: true });
    if (alvo) {
      ev.preventDefault();
      const id = alvo.getAttribute('data-pino');
      if (sel !== id) selecionar(id);
      arrasto = { id, antes: modelo, moveu: false };
      svg.setPointerCapture?.(ev.pointerId);
      return;
    }
    if (ferramenta === 'cravar') {
      const p = ponto(ev);
      if (!p) return;
      const novo = adicionarPino(modelo, p.x, p.y);
      if (novo === modelo) { mensagem(`O limite é de ${LIMITES.pinos} pinos.`, true); return; }
      sel = novo.pinos[novo.pinos.length - 1].id;
      aplicar(novo);
      mensagem(`Pino ${novo.pinos.length} cravado. Mude para "Mover pinos" e arraste-o em outro instante da linha do tempo.`);
    } else if (sel) { sel = null; render(); }
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!arrasto) return;
    const p = ponto(ev);
    if (!p) return;
    if (!arrasto.moveu) { arrasto.moveu = true; }
    modelo = moverPinoEm(modelo, arrasto.id, t, p.x, p.y, { curva: curvaAtual });
    desenhar();
  });
  const soltar = (ev) => {
    if (!arrasto) return;
    svg.releasePointerCapture?.(ev.pointerId);
    if (arrasto.moveu) { empilhar(arrasto.antes); render(); aviso(); }
    arrasto = null;
  };
  svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);

  // ---------- ponteiro: linha do tempo ----------
  function tempoDoPonteiro(ev) {
    const r = area.getBoundingClientRect(), pad = 10;
    const largura = r.width - 2 * pad;
    return largura > 0 ? clamp(((ev.clientX - r.left - pad) / largura) * modelo.duracao, 0, modelo.duracao) : 0;
  }
  area.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    if (tocando) parar();
    raiz.focus({ preventScroll: true });
    area.setPointerCapture?.(ev.pointerId);
    const linha = ev.target.closest?.('.pn-trilha'), k = ev.target.closest?.('.pn-k');
    if (linha) { const id = linha.getAttribute('data-pino'); if (id !== sel) { sel = id; render(); } }
    if (k && linha) {
      // clicar num losango vai até o quadro; arrastar o losango muda o instante do quadro
      const t0 = +k.getAttribute('data-t');
      arrastoQuadro = { id: linha.getAttribute('data-pino'), antes: modelo, t0, x0: ev.clientX, moveu: false };
      irPara(t0);
    } else { scrub = true; irPara(tempoDoPonteiro(ev)); }
    if (sel) syncCurva();
  });
  area.addEventListener('pointermove', (ev) => {
    if (scrub) { irPara(tempoDoPonteiro(ev)); return; }
    if (!arrastoQuadro || (!arrastoQuadro.moveu && Math.abs(ev.clientX - arrastoQuadro.x0) < 4)) return;
    arrastoQuadro.moveu = true;
    const novo = Math.round(tempoDoPonteiro(ev));
    modelo = moverQuadroDoPino(arrastoQuadro.antes, arrastoQuadro.id, arrastoQuadro.t0, novo);
    t = novo;
    const k = [...area.querySelectorAll(`.pn-trilha[data-pino="${arrastoQuadro.id}"] .pn-k`)].find((e) => +e.getAttribute('data-t') === arrastoQuadro.t0);
    if (k) k.style.left = `calc(var(--pad) + (100% - 2 * var(--pad)) * ${novo / modelo.duracao})`;
    desenhar();
  });
  const fimPonteiro = (ev) => {
    area.releasePointerCapture?.(ev.pointerId);
    if (arrastoQuadro) { const a = arrastoQuadro; arrastoQuadro = null; if (a.moveu) { empilhar(a.antes); aviso(); } render(); return; }
    if (!scrub) return;
    scrub = false;
    if (sel) { syncCurva(); render(); }
  };
  area.addEventListener('pointerup', fimPonteiro); area.addEventListener('pointercancel', fimPonteiro);
  function syncCurva() {
    const p = modelo.pinos.find((q) => q.id === sel), k = p?.trilha.x.find((q) => Math.abs(q.t - t) <= 0.5);
    if (k) { curvaAtual = k.curva || 'linear'; selCurva.value = curvaAtual; }
  }

  // ---------- teclado (nada daqui chega aos atalhos do editor) ----------
  const emCampo = (e) => !!e.target.closest?.('input,textarea,select');
  raiz.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? voltar(refazer, desfazer) : voltar(desfazer, refazer); return; }
    if (ctrl && k === 'y') { e.preventDefault(); voltar(refazer, desfazer); return; }
    if (emCampo(e) || ctrl) return;
    if (k === ' ' && !e.target.closest?.('button')) { e.preventDefault(); alternar(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removerSelecionado(); }
    else if (k === 'arrowleft') { e.preventDefault(); irPara(t - PASSO_TECLA); }
    else if (k === 'arrowright') { e.preventDefault(); irPara(t + PASSO_TECLA); }
    else if (k === 'home') { e.preventDefault(); irPara(0); }
    else if (k === 'end') { e.preventDefault(); irPara(modelo.duracao); }
  });
  raiz.addEventListener('keyup', (e) => e.stopPropagation());
  const redimensionar = () => { if (!morto && modelo) desenhar(); };
  let obs = null;
  if (typeof ResizeObserver !== 'undefined') { obs = new ResizeObserver(redimensionar); obs.observe(svg); }

  // ---------- partida ----------
  ferr('cravar');
  const entrada = ctx.svg && String(ctx.svg).trim();
  let inicial = null;
  if (entrada) {
    try { inicial = modeloDePinos(entrada); mensagem(`Desenho carregado: ${inicial.formas.length} forma(s). ${inicial.avisos.join(' ')}`.trim()); }
    catch (e) { mensagem(`${e.message || 'Não consegui ler o SVG.'} Mostrei o exemplo no lugar.`, true); }
  }
  trocarModelo(inicial || modeloExemplo(), true);
  if (!inicial && !entrada) mensagem('Este é um exemplo: aperte ▶ Tocar e depois arraste um pino (ferramenta "Mover pinos") para mudar a animação.');
  desfazer = []; refazer = []; sujo = false; render();
  if (inicial) caixa.value = '';

  // ---------- interface do modo ----------
  return {
    exportarSvg() {
      const r = exportarSvgPinosDetalhado(modelo, { laco: repetir, fps: 20 });
      if (r.avisos.length) mensagem(r.avisos.join(' '));
      return r.svg;
    },
    temAlteracoes: () => sujo,
    destruir() {
      morto = true; parar(); obs?.disconnect();
      container.replaceChildren();
    },
  };
}
