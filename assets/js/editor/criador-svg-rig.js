// Modo "RIG DE PEÇAS" do criador de SVG animado: lista de peças (árvore pai → filho), prévia ao vivo, ferramentas de pivô/mover/girar,
// linha do tempo com quadros-chave, tocar/pausar/repetir, desfazer/refazer. É só TELA: toda conta (pose, matrizes, quadros, gesto de
// arrastar/girar, histórico) está em core/puppet.js e core/puppet-edicao.js, que são puros e testados.
//
// Como a prévia funciona (importante para entender o código): o SVG é montado UMA vez por estrutura (exportarSvgPose =
// <g data-peca="id"> aninhados espelhando a hierarquia). A cada quadro só se troca o atributo transform/opacity desses <g> com
// transformDaPeca(): é o mesmo cálculo que as animateTransform do arquivo exportado fazem, então "o que vejo = o que sai".
// Contrato com a janela (criador-svg.js): montar(container, ctx) → { exportarSvg, destruir, temAlteracoes, nome, carregarSvg }.
//   ctx = { svg, nome, avisarMudanca(), aviso(msg, tipo)? }  (aviso é opcional; sem ele o modo funciona do mesmo jeito)
import { h } from '../core/dom.js';
import { NOMES_DE_CURVA } from '../core/anim-motor.js';
import { sanitizeSvg } from '../core/sanitize.js';
import * as P from '../core/puppet.js';
import * as E from '../core/puppet-edicao.js';
import { EXEMPLOS } from '../core/puppet-exemplos.js';
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const botao = ({ rotulo, ic, titulo, aoClicar, cls = '', texto }) => h('button', { class: `btn ${cls}`, type: 'button', title: titulo || rotulo || '', onclick: aoClicar, html: (ic ? icon(ic, 15) : '') + (texto || '') + (rotulo ? `<span>${rotulo}</span>` : '') });
const arred = (v, c = 2) => String(Math.round(v * 10 ** c) / 10 ** c);

function montar(container, ctx = {}) {
  const aviso = ctx.aviso || ((m) => console.warn(m));
  const avisarMudanca = () => ctx.avisarMudanca?.();

  // ---------- estado ----------
  let rig = ctx.svg ? P.rigDeSvg(ctx.svg, { nome: ctx.nome || 'Animação' }) : P.rigVazio(ctx.nome || 'Animação');
  let inicial = rig;                                     // "sem alterações" = o rig ainda é o carregado
  let sel = rig.pecas[0]?.id ?? null;                     // peça selecionada
  let quadroSel = null;                                  // quadro-chave selecionado { id, prop, t }
  let t = 0;                                             // instante (ms)
  let tocando = false, repetir = true, ferramenta = 'mover', modoFinal = false, quadroRaf = 0, relogio0 = 0;
  let estrutura = null, grupos = new Map();              // da prévia (ver cabeçalho)
  const historico = E.criarHistorico(20);
  const tInt = () => Math.round(t);

  // ---------- elementos ----------
  const campos = {};                                     // x y rot escala opac → { inp, q }
  const pv = h('div', { class: 'cs-pv' });
  const ov = sv('svg', { class: 'cs-ov', preserveAspectRatio: 'xMidYMid meet' });
  const vazio = h('div', { class: 'cs-vazio' });
  const palco = h('div', { class: 'cs-palco' }, pv, ov, vazio);
  const dica = h('p', { class: 'cs-dica' });
  const lista = h('ul', { class: 'cs-lista' });
  const cabecaLh = h('div', { class: 'cs-lh-cab' });
  const linhasLh = h('div', { class: 'cs-lh-linhas' });
  const corpoLh = h('div', { class: 'cs-lh-corpo' }, linhasLh, h('div', { class: 'cs-lh-over' }, cabecaLh));
  const tempoTxt = h('output', { class: 'cs-tempo-txt' });
  const durInp = h('input', { type: 'number', class: 'cs-num', min: 0.1, max: 60, step: 0.1, 'aria-label': 'Duração em segundos' });
  const nomeInp = h('input', { type: 'text', class: 'cs-txt', maxlength: 60, 'aria-label': 'Nome da peça' });
  const paiSel = h('select', { class: 'cs-sel', 'aria-label': 'Pai da peça' });
  const pivoX = h('input', { type: 'number', class: 'cs-num', step: 1, 'aria-label': 'Pivô X' });
  const pivoY = h('input', { type: 'number', class: 'cs-num', step: 1, 'aria-label': 'Pivô Y' });
  const curvaSel = h('select', { class: 'cs-sel', 'aria-label': 'Curva até o próximo quadro' });
  const bDesfazer = botao({ ic: 'undo', titulo: 'Desfazer (Ctrl+Z)', cls: 'icon', aoClicar: () => voltar(true) });
  const bRefazer = botao({ ic: 'redo', titulo: 'Refazer (Ctrl+Y)', cls: 'icon', aoClicar: () => voltar(false) });
  const bTocar = botao({ ic: 'play', titulo: 'Tocar / pausar (Espaço)', cls: 'icon', aoClicar: () => (tocando ? parar() : tocar()) });
  const bRepetir = h('label', { class: 'cs-marca' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { repetir = e.target.checked; if (modoFinal) reconstruirFinal(); } }), h('span', {}, 'Repetir'));
  const bMover = botao({ rotulo: 'Mover / girar', ic: 'cursor', titulo: 'Arraste a peça para mover; use a alça para girar', aoClicar: () => escolherFerramenta('mover') });
  const bPivo = botao({ rotulo: 'Pivô', ic: 'drop', titulo: 'Clique na prévia para pôr o pivô (o ponto em torno do qual a peça gira)', aoClicar: () => escolherFerramenta('pivo') });
  const bFinal = botao({ rotulo: 'Ver exportado', ic: 'eye', titulo: 'Mostra o SVG animado de verdade (SMIL), depois do sanitizador', aoClicar: () => alternarFinal() });
  const menuExemplos = h('div', { class: 'cs-menu', hidden: true });
  const areaColar = h('div', { class: 'cs-colar', hidden: true });
  const arquivo = h('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: true });

  // ---------- montagem da tela ----------
  const grupoProps = P.NOMES_DAS_PROPS.map(campoProp);
  const painelProps = h('aside', { class: 'cs-props' },
    h('h4', {}, 'Peça selecionada'),
    h('div', { class: 'cs-bloco', id: 'cs-bloco-peca' },
      h('label', { class: 'cs-rot' }, h('span', {}, 'Nome'), nomeInp),
      h('label', { class: 'cs-rot' }, h('span', {}, 'Pai (a peça segue o pai)'), paiSel),
      h('div', { class: 'cs-duplo' }, h('label', { class: 'cs-rot' }, h('span', {}, 'Pivô X'), pivoX), h('label', { class: 'cs-rot' }, h('span', {}, 'Pivô Y'), pivoY)),
      h('div', { class: 'cs-btns' },
        botao({ ic: 'up', titulo: 'Desenhar mais ao fundo entre as irmãs', cls: 'icon', aoClicar: () => mudar(P.moverNaOrdem(rig, sel, -1)) }),
        botao({ ic: 'down', titulo: 'Desenhar mais à frente entre as irmãs', cls: 'icon', aoClicar: () => mudar(P.moverNaOrdem(rig, sel, 1)) }),
        botao({ rotulo: 'Dividir grupo', titulo: 'Abre o grupo e faz uma peça para cada filho dele', aoClicar: dividir }),
        botao({ ic: 'trash', titulo: 'Excluir peça (os filhos sobem para o pai dela)', cls: 'icon', aoClicar: () => { if (sel) { const antes = sel; sel = null; mudar(P.removerPeca(rig, antes)); } } }))),
    h('h4', {}, 'Nesta posição do tempo'),
    h('div', { class: 'cs-bloco' }, grupoProps,
      h('div', { class: 'cs-btns' }, botao({ rotulo: '◆ quadro', titulo: 'Grava um quadro-chave em todas as propriedades neste instante (K)', cls: 'primary', aoClicar: () => { if (sel) { parar(); mudar(E.quadrosDeTudoEm(rig, sel, tInt())); } } }),
        botao({ rotulo: 'Apagar quadros aqui', titulo: 'Apaga os quadros desta peça neste instante (Delete)', aoClicar: apagarQuadros }))),
    h('label', { class: 'cs-rot' }, h('span', {}, 'Curva do quadro selecionado (até o próximo)'), curvaSel),
    h('p', { class: 'cs-dica' }, 'Clique num losango da linha do tempo para escolher o quadro e mudar a curva dele.'));

  const aside = h('aside', { class: 'cs-pecas' }, h('h4', {}, 'Peças'), lista, h('p', { class: 'cs-dica' }, 'A peça filha vai junto quando a mãe se mexe. Escolha a mãe no painel ao lado.'));
  const barra = h('div', { class: 'cs-barra' },
    botao({ rotulo: 'Exemplos', ic: 'template', titulo: 'Carregar um exemplo pronto para aprender', aoClicar: () => { menuExemplos.hidden = !menuExemplos.hidden; areaColar.hidden = true; } }),
    botao({ rotulo: 'Colar SVG', ic: 'code', aoClicar: () => { areaColar.hidden = !areaColar.hidden; menuExemplos.hidden = true; if (!areaColar.hidden) areaColar.querySelector('textarea').focus(); } }),
    botao({ rotulo: 'Abrir arquivo', ic: 'upload', aoClicar: () => arquivo.click() }),
    h('span', { class: 'cs-sep' }), bDesfazer, bRefazer, h('span', { class: 'cs-sep' }), bMover, bPivo, h('span', { class: 'cs-sep' }), bFinal, arquivo);
  const transporte = h('div', { class: 'cs-transp' },
    botao({ texto: '⏮', titulo: 'Voltar ao início (Home)', cls: 'icon', aoClicar: () => { parar(); definirT(0); } }),
    botao({ texto: '◀◆', titulo: 'Quadro anterior (←)', cls: 'icon', aoClicar: () => irParaQuadro(-1) }),
    bTocar,
    botao({ texto: '◆▶', titulo: 'Próximo quadro (→)', cls: 'icon', aoClicar: () => irParaQuadro(1) }),
    bRepetir, tempoTxt, h('span', { class: 'cs-esp' }), h('label', { class: 'cs-rot cs-inline' }, h('span', {}, 'Duração (s)'), durInp));
  const linha = h('div', { class: 'cs-lh' }, corpoLh);
  const raiz = h('div', { class: 'cs-rig', tabindex: '-1' }, barra, menuExemplos, areaColar,
    h('div', { class: 'cs-meio' }, aside, h('div', { class: 'cs-centro' }, palco, dica), painelProps),
    h('div', { class: 'cs-baixo' }, transporte, linha));
  container.append(raiz);
  for (const c of NOMES_DE_CURVA) curvaSel.append(h('option', { value: c }, c));

  function campoProp(prop) {
    const def = P.PROPS_DO_RIG[prop], pequeno = prop === 'escala' || prop === 'opac';
    const inp = h('input', { type: 'number', class: 'cs-num', step: pequeno ? 0.05 : 1, min: def.min, max: def.max, 'aria-label': def.rotulo });
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!sel || !Number.isFinite(v)) return; parar(); mudar(P.definirQuadro(rig, sel, prop, tInt(), v)); });
    const q = botao({ texto: '◆', titulo: `Quadro-chave de "${def.rotulo}" neste instante`, cls: 'cs-q', aoClicar: () => alternarQuadro(prop) });
    campos[prop] = { inp, q };
    return h('div', { class: 'cs-linha-prop' }, h('label', {}, def.rotulo + (def.un ? ` (${def.un})` : '')), inp, q);
  }

  // ---------- mudanças e histórico ----------
  // `mudar` registra no histórico e redesenha tudo; use para uma ação completa (clique, campo). Gestos longos (arrastar) mexem em `rig`
  // direto, redesenham só o quadro e registram UMA vez no fim (fimDoGesto).
  function mudar(novo) {
    if (novo === rig) return false;
    historico.gravar(rig); rig = novo;
    aposMudar(); return true;
  }
  function fimDoGesto(antes) { if (rig !== antes) { historico.gravar(antes); aposMudar(); } }
  function aposMudar() {
    if (sel && !P.pecaPorId(rig, sel)) sel = rig.pecas[0]?.id ?? null;
    if (quadroSel && !E.temQuadroEm(rig, quadroSel.id, quadroSel.prop, quadroSel.t)) quadroSel = null;
    t = Math.min(t, rig.duracao);
    renderTudo(); avisarMudanca();
  }
  function voltar(desfazer) {
    parar();
    const outro = desfazer ? historico.desfazer(rig) : historico.refazer(rig);
    if (!outro) return;
    rig = outro; aposMudar();
  }
  function alternarQuadro(prop) {
    if (!sel) return;
    parar();
    const tt = tInt();
    if (E.temQuadroEm(rig, sel, prop, tt)) mudar(P.removerQuadro(rig, sel, prop, tt));
    else mudar(P.definirQuadro(rig, sel, prop, tt, P.poseEm(rig, tt)[sel][prop]));
  }
  function apagarQuadros() {
    if (!sel) return;
    parar();
    const tt = tInt();
    mudar(quadroSel && Math.abs(quadroSel.t - tt) < 1 ? P.removerQuadro(rig, quadroSel.id, quadroSel.prop, quadroSel.t) : P.NOMES_DAS_PROPS.reduce((r, p) => P.removerQuadro(r, sel, p, tt), rig));
  }
  function dividir() {
    if (!sel) return;
    const novo = E.dividirPeca(rig, sel);
    if (novo === rig) { aviso('Só dá para dividir uma peça que seja um grupo com 2 ou mais filhos (e sem estourar 80 peças).', 'err'); return; }
    sel = null; mudar(novo); sel = rig.pecas.at(-1)?.id ?? null; renderTudo();
  }

  // ---------- tempo e reprodução ----------
  function definirT(novo) { t = Math.min(rig.duracao, Math.max(0, novo)); renderQuadro(); }
  function irParaQuadro(dir) {
    parar();
    const alvo = E.proximoInstante(E.instantesDeQuadros(rig, sel), t, dir);
    if (alvo != null) definirT(alvo);
  }
  function tocar() {
    if (!rig.pecas.length) return;
    if (modoFinal) alternarFinal();
    if (t >= rig.duracao - 1) t = 0;
    tocando = true; relogio0 = performance.now() - t; bTocar.innerHTML = icon('pause', 15);
    const passo = (agora) => {
      if (!tocando) return;
      t = agora - relogio0;
      if (t >= rig.duracao) { if (repetir) { relogio0 = agora; t = 0; } else { t = rig.duracao; renderQuadro(); parar(); return; } }
      renderQuadro(); quadroRaf = requestAnimationFrame(passo);
    };
    quadroRaf = requestAnimationFrame(passo);
  }
  function parar() { if (!tocando) return; tocando = false; cancelAnimationFrame(quadroRaf); bTocar.innerHTML = icon('play', 15); renderQuadro(); }

  // ---------- prévia ----------
  const estruturaMudou = () => !estrutura || estrutura.pecas !== rig.pecas || estrutura.defs !== rig.defs || estrutura.vb !== rig.viewBox || estrutura.heranca !== rig.heranca;
  function montarPrevia() {
    if (modoFinal || !estruturaMudou()) return;
    estrutura = { pecas: rig.pecas, defs: rig.defs, vb: rig.viewBox, heranca: rig.heranca };
    pv.innerHTML = rig.pecas.length ? P.exportarSvgPose(rig, t) : '';
    grupos = new Map([...pv.querySelectorAll('[data-peca]')].map((g) => [g.getAttribute('data-peca'), g]));
  }
  function aplicarPose() {
    const pose = P.poseEm(rig, t);
    if (modoFinal) return pose;
    for (const p of rig.pecas) {
      const g = grupos.get(p.id), q = pose[p.id];
      if (!g) continue;
      g.setAttribute('transform', P.transformDaPeca(p, q));
      if (q.opac !== 1) g.setAttribute('opacity', q.opac); else g.removeAttribute('opacity');
    }
    return pose;
  }
  function reconstruirFinal() {
    const r = sanitizeSvg(P.exportarSvgAnimado(rig, { laco: repetir }), 'cs-prev');
    if (!r.ok) aviso(r.error, 'err');
    pv.innerHTML = r.ok ? r.svg : '';
  }
  function alternarFinal() {
    parar();
    modoFinal = !modoFinal; estrutura = null; grupos = new Map();
    bFinal.classList.toggle('on', modoFinal); palco.classList.toggle('cs-final', modoFinal);
    if (modoFinal) reconstruirFinal();
    renderQuadro();
  }
  const paraRaiz = (ev) => { const m = ov.getScreenCTM(); if (!m) return { x: 0, y: 0 }; const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()); return { x: p.x, y: p.y }; };
  function desenharOverlay(pose) {
    ov.setAttribute('viewBox', rig.viewBox.join(' '));
    ov.replaceChildren();
    if (modoFinal || !sel || !P.pecaPorId(rig, sel)) return;
    const mundo = P.matrizes(rig, pose), r = ov.getBoundingClientRect(), vb = rig.viewBox;
    const u = 1 / (Math.min(r.width / vb[2], r.height / vb[3]) || 1);                         // 1 px da tela em unidades do viewBox
    const cantos = E.cantosNoMundo(rig, mundo, sel), piv = E.pivoNoMundo(rig, mundo, sel);
    if (cantos) ov.append(sv('polygon', { class: 'cs-ov-caixa', points: cantos.map((c) => `${arred(c.x, 2)},${arred(c.y, 2)}`).join(' ') }));
    if (!piv) return;
    const ang = Math.atan2(mundo[sel][1], mundo[sel][0]) - Math.PI / 2, R = 48 * u, hx = piv.x + R * Math.cos(ang), hy = piv.y + R * Math.sin(ang);
    ov.append(sv('line', { class: 'cs-ov-haste', x1: piv.x, y1: piv.y, x2: hx, y2: hy }),
      sv('circle', { class: 'cs-ov-rot', 'data-alca': 'rot', cx: hx, cy: hy, r: 7 * u }),
      sv('line', { class: 'cs-ov-pivo-l', x1: piv.x - 10 * u, y1: piv.y, x2: piv.x + 10 * u, y2: piv.y }),
      sv('line', { class: 'cs-ov-pivo-l', x1: piv.x, y1: piv.y - 10 * u, x2: piv.x, y2: piv.y + 10 * u }),
      sv('circle', { class: 'cs-ov-pivo', 'data-alca': 'pivo', cx: piv.x, cy: piv.y, r: 6 * u }));
  }

  // ---------- renderização ----------
  function renderQuadro() {
    montarPrevia();
    const pose = aplicarPose();
    desenharOverlay(pose);
    atualizarCampos(pose);
    const pct = rig.duracao ? (t / rig.duracao) * 100 : 0;
    cabecaLh.style.left = `${pct}%`;
    tempoTxt.textContent = `${E.formatarTempo(t)} / ${E.formatarTempo(rig.duracao)}`;
    vazio.hidden = rig.pecas.length > 0;
  }
  function atualizarCampos(pose) {
    const p = sel && P.pecaPorId(rig, sel), q = p && pose[sel], ativo = container.ownerDocument.activeElement;
    for (const prop of P.NOMES_DAS_PROPS) {
      const { inp, q: bq } = campos[prop];
      inp.disabled = !p; bq.disabled = !p;
      if (q && inp !== ativo) inp.value = arred(q[prop], prop === 'escala' || prop === 'opac' ? 3 : 2);
      bq.classList.toggle('on', !!p && E.temQuadroEm(rig, sel, prop, t));
    }
    if (p) { if (pivoX !== ativo) pivoX.value = arred(p.pivo.x); if (pivoY !== ativo) pivoY.value = arred(p.pivo.y); if (nomeInp !== ativo) nomeInp.value = p.nome; }
    if (durInp !== ativo) durInp.value = arred(rig.duracao / 1000, 2);
  }
  function renderLista() {
    lista.replaceChildren();
    for (const { peca, nivel } of P.arvoreDePecas(rig)) {
      const tem = !!rig.trilhas[peca.id];
      lista.append(h('li', {}, h('button', { type: 'button', class: 'cs-item' + (peca.id === sel ? ' on' : ''), style: { paddingLeft: `${8 + nivel * 14}px` }, title: peca.nome, onclick: () => selecionar(peca.id) },
        nivel ? h('span', { class: 'cs-galho' }, '└') : null, h('span', { class: 'cs-item-nome' }, peca.nome), tem ? h('span', { class: 'cs-item-q', title: 'Tem quadros-chave' }, '◆') : null)));
    }
    if (!rig.pecas.length) lista.append(h('li', { class: 'cs-vazio-txt' }, 'Nenhuma peça ainda.'));
  }
  function renderPropriedades() {
    const p = sel && P.pecaPorId(rig, sel);
    painelProps.classList.toggle('cs-sem-sel', !p);
    nomeInp.disabled = paiSel.disabled = pivoX.disabled = pivoY.disabled = !p;
    paiSel.replaceChildren(h('option', { value: '' }, '— nenhum (raiz) —'));
    if (p) for (const { peca } of P.arvoreDePecas(rig)) if (P.podeSerPai(rig, p.id, peca.id)) paiSel.append(h('option', { value: peca.id, selected: p.pai === peca.id }, peca.nome));
    if (p && !p.pai) paiSel.value = '';
    const k = quadroSel && E.quadroEm(rig, quadroSel.id, quadroSel.prop, quadroSel.t);
    curvaSel.disabled = !k;
    if (k && ![...curvaSel.options].some((o) => o.value === (k.curva || 'linear'))) curvaSel.append(h('option', { value: k.curva }, k.curva));
    curvaSel.value = k ? k.curva || 'linear' : 'linear';
  }
  // Linha do tempo: uma linha por peça (todos os quadros dela juntos) e, para a peça selecionada, uma por propriedade.
  function renderLinha() {
    linhasLh.replaceChildren();
    const dur = rig.duracao, pct = (ms) => `${(ms / dur) * 100}%`, passo = dur <= 3000 ? 250 : dur <= 10000 ? 1000 : dur <= 30000 ? 5000 : 10000;
    const marcas = [];
    for (let m = 0; m <= dur; m += passo) marcas.push(h('span', { class: 'cs-lh-marca', style: { left: pct(m) } }, m % 1000 === 0 || passo >= 1000 ? `${m / 1000}s` : ''));
    linhasLh.append(h('div', { class: 'cs-lh-row cs-lh-regua' }, h('div', { class: 'cs-lh-rot' }, 'Tempo'), h('div', { class: 'cs-lh-faixa', 'data-scrub': '1' }, marcas)));
    const losango = (id, prop, ms, extra = '') => h('button', { type: 'button', class: `cs-lh-q ${extra}`.trim(), style: { left: pct(ms) }, 'data-id': id, 'data-prop': prop, 'data-t': ms, title: `${prop === '*' ? 'Quadros' : P.PROPS_DO_RIG[prop].rotulo} em ${E.formatarTempo(ms)}`, tabindex: '-1' });
    for (const { peca, nivel } of P.arvoreDePecas(rig)) {
      const ts = E.instantesDeQuadros(rig, peca.id);
      linhasLh.append(h('div', { class: 'cs-lh-row' + (peca.id === sel ? ' on' : '') },
        h('div', { class: 'cs-lh-rot', 'data-sel': peca.id, style: { paddingLeft: `${6 + nivel * 10}px` }, title: peca.nome }, peca.nome),
        h('div', { class: 'cs-lh-faixa', 'data-scrub': '1' }, ts.map((ms) => losango(peca.id, '*', ms, 'cs-lh-resumo')))));
      if (peca.id !== sel) continue;
      for (const prop of P.NOMES_DAS_PROPS) {
        const ks = rig.trilhas[sel]?.[prop] || [];
        linhasLh.append(h('div', { class: 'cs-lh-row cs-lh-sub' }, h('div', { class: 'cs-lh-rot' }, P.PROPS_DO_RIG[prop].rotulo),
          h('div', { class: 'cs-lh-faixa', 'data-scrub': '1' }, ks.map((k) => losango(sel, prop, k.t, quadroSel && quadroSel.id === sel && quadroSel.prop === prop && Math.abs(quadroSel.t - k.t) < 1 ? 'on' : '')))));
      }
    }
  }
  function renderTudo() { renderLista(); renderPropriedades(); renderLinha(); renderQuadro(); bDesfazer.disabled = !historico.podeDesfazer(); bRefazer.disabled = !historico.podeRefazer(); dica.textContent = textoDaDica(); }
  const textoDaDica = () => (ferramenta === 'pivo' ? 'Pivô: clique na prévia para definir o ponto em torno do qual a peça selecionada gira. Defina o pivô ANTES de animar.' : 'Arraste a peça para movê-la e use a alça (círculo azul) para girar: cada gesto cria quadros-chave no instante atual. Shift prende o ângulo/eixo. O ponto laranja é o pivô e também pode ser arrastado.');
  function escolherFerramenta(f) { ferramenta = f; bMover.classList.toggle('on', f === 'mover'); bPivo.classList.toggle('on', f === 'pivo'); palco.dataset.ferramenta = f; dica.textContent = textoDaDica(); }
  function selecionar(id) { sel = id; quadroSel = null; renderLista(); renderPropriedades(); renderLinha(); renderQuadro(); }

  // ---------- gestos na prévia ----------
  function arrastar(ev, aoMover, aoFim) {
    palco.setPointerCapture(ev.pointerId);
    const mover = (e) => aoMover(e);
    const fim = (e) => { palco.removeEventListener('pointermove', mover); palco.removeEventListener('pointerup', fim); palco.removeEventListener('pointercancel', fim); aoFim(e); };
    palco.addEventListener('pointermove', mover); palco.addEventListener('pointerup', fim); palco.addEventListener('pointercancel', fim);
  }
  function iniciarMover(ev) {
    parar();
    t = tInt();
    const antes = rig, id = sel, tt = t, pose0 = P.poseEm(antes, tt), mundo0 = P.matrizes(antes, pose0), pai = E.matrizDoPai(antes, mundo0, id), p0 = paraRaiz(ev), x0 = ev.clientX, y0 = ev.clientY;
    let moveu = false;
    arrastar(ev, (e) => {
      if (!moveu && Math.hypot(e.clientX - x0, e.clientY - y0) < 3) return;
      moveu = true;
      const p = paraRaiz(e);
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const d = E.paraEspacoDoPai(pai, dx, dy);
      rig = P.definirQuadro(P.definirQuadro(antes, id, 'x', tt, pose0[id].x + d.x), id, 'y', tt, pose0[id].y + d.y);
      renderQuadro();
    }, () => { if (moveu) fimDoGesto(antes); });
  }
  function iniciarGiro(ev) {
    parar();
    t = tInt();
    const antes = rig, id = sel, tt = t, pose0 = P.poseEm(antes, tt), mundo0 = P.matrizes(antes, pose0), pai = E.matrizDoPai(antes, mundo0, id), centro = E.pivoNoMundo(antes, mundo0, id);
    if (!centro) return;
    let anterior = paraRaiz(ev), acum = 0;
    arrastar(ev, (e) => {
      const p = paraRaiz(e);
      acum += E.deltaDeAngulo(centro, anterior, p, pai); anterior = p;
      let rot = pose0[id].rot + acum;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      rig = P.definirQuadro(antes, id, 'rot', tt, rot);
      renderQuadro();
    }, () => fimDoGesto(antes));
  }
  function iniciarPivo(ev) {
    parar();
    t = tInt();
    const antes = rig, id = sel, tt = t;
    arrastar(ev, (e) => {
      const l = E.pivoParaPonto(antes, id, tt, paraRaiz(e));
      if (l) { rig = P.moverPivo(antes, id, l.x, l.y); renderQuadro(); }
    }, () => fimDoGesto(antes));
  }
  palco.addEventListener('pointerdown', (ev) => {
    if (modoFinal || ev.button !== 0) return;
    const alvo = ev.target.closest?.('[data-alca]')?.getAttribute('data-alca');
    if (alvo && sel) { ev.preventDefault(); return alvo === 'rot' ? iniciarGiro(ev) : iniciarPivo(ev); }
    if (ferramenta === 'pivo') {
      if (!sel) return;
      const l = E.pivoParaPonto(rig, sel, tInt(), paraRaiz(ev));
      if (l) mudar(P.moverPivo(rig, sel, l.x, l.y));
      return;
    }
    const g = ev.target.closest?.('[data-peca]');
    if (g) { ev.preventDefault(); const id = g.getAttribute('data-peca'); if (id !== sel) selecionar(id); iniciarMover(ev); }
  });
  palco.dataset.ferramenta = ferramenta;

  // ---------- gestos na linha do tempo ----------
  function larguraDaFaixa() { const f = corpoLh.querySelector('.cs-lh-faixa'); const r = f.getBoundingClientRect(); return { esq: r.left, larg: r.width }; }
  corpoLh.addEventListener('pointerdown', (ev) => {
    const rot = ev.target.closest?.('[data-sel]');
    if (rot) { selecionar(rot.getAttribute('data-sel')); return; }
    const q = ev.target.closest?.('.cs-lh-q');
    if (q) { ev.preventDefault(); return arrastarQuadro(ev, q); }
    if (!ev.target.closest?.('[data-scrub]')) return;
    parar();
    const { esq, larg } = larguraDaFaixa(), ir = (e) => definirT(E.xParaT(e.clientX - esq, rig.duracao, larg));
    ir(ev); corpoLh.setPointerCapture(ev.pointerId);
    const fim = () => { corpoLh.removeEventListener('pointermove', ir); corpoLh.removeEventListener('pointerup', fim); corpoLh.removeEventListener('pointercancel', fim); };
    corpoLh.addEventListener('pointermove', ir); corpoLh.addEventListener('pointerup', fim); corpoLh.addEventListener('pointercancel', fim);
  });
  function arrastarQuadro(ev, el) {
    parar();
    const id = el.getAttribute('data-id'), prop = el.getAttribute('data-prop'), deT = +el.getAttribute('data-t'), antes = rig, { esq, larg } = larguraDaFaixa();
    if (id !== sel) {                                                                  // a linha de outra peça: seleciona (isso reconstrói a linha do tempo, então o losango é achado de novo)
      selecionar(id);
      el = corpoLh.querySelector(`.cs-lh-q[data-id="${id}"][data-prop="${prop}"][data-t="${deT}"]`) || el;
    }
    quadroSel = prop === '*' ? null : { id, prop, t: deT };
    corpoLh.querySelectorAll('.cs-lh-q.on').forEach((x) => x.classList.remove('on'));
    if (prop !== '*') el.classList.add('on');
    renderPropriedades(); definirT(deT);
    const x0 = ev.clientX; let moveu = false;
    corpoLh.setPointerCapture(ev.pointerId);
    const mover = (e) => {
      if (!moveu && Math.abs(e.clientX - x0) < 3) return;
      moveu = true;
      const novoT = E.xParaT(e.clientX - esq, rig.duracao, larg), props = prop === '*' ? P.NOMES_DAS_PROPS : [prop];
      rig = props.reduce((r, p) => E.moverQuadro(r, id, p, deT, novoT), antes);
      el.style.left = `${(novoT / rig.duracao) * 100}%`;
      if (quadroSel) quadroSel = { id, prop, t: novoT };
      definirT(novoT);
    };
    const fim = () => {
      corpoLh.removeEventListener('pointermove', mover); corpoLh.removeEventListener('pointerup', fim); corpoLh.removeEventListener('pointercancel', fim);
      if (moveu) fimDoGesto(antes);
    };
    corpoLh.addEventListener('pointermove', mover); corpoLh.addEventListener('pointerup', fim); corpoLh.addEventListener('pointercancel', fim);
  }

  // ---------- campos do painel ----------
  nomeInp.addEventListener('change', () => { if (sel) mudar(P.renomearPeca(rig, sel, nomeInp.value)); });
  paiSel.addEventListener('change', () => {
    if (!sel) return;
    const novo = P.definirPai(rig, sel, paiSel.value || null);
    if (novo === rig) { aviso('Essa peça não pode ser filha dela mesma nem de uma descendente.', 'err'); renderPropriedades(); return; }
    mudar(novo);
  });
  const mudarPivo = () => { if (sel) { const x = parseFloat(pivoX.value), y = parseFloat(pivoY.value); if (Number.isFinite(x) && Number.isFinite(y)) mudar(P.moverPivo(rig, sel, x, y)); } };
  pivoX.addEventListener('change', mudarPivo); pivoY.addEventListener('change', mudarPivo);
  curvaSel.addEventListener('change', () => { if (quadroSel) mudar(P.definirCurva(rig, quadroSel.id, quadroSel.prop, quadroSel.t, curvaSel.value)); });
  durInp.addEventListener('change', () => { const s = parseFloat(durInp.value); if (Number.isFinite(s)) { parar(); mudar(P.definirDuracao(rig, s * 1000)); } else atualizarCampos(P.poseEm(rig, t)); });

  // ---------- carregar SVG ----------
  function carregarTexto(texto, nome) {
    if (temAlteracoes() && !confirm('Trocar o desenho descarta a animação atual. Continuar?')) return false;
    const { raiz: arvore, avisos } = P.lerSvgComAvisos(texto);
    if (!arvore) { aviso('Não encontrei um <svg> nesse texto.', 'err'); return false; }
    const novo = P.rigDeSvg(texto, { nome: nome || 'Animação' });
    if (!novo.pecas.length) { aviso('Esse SVG não tem formas para animar.', 'err'); return false; }
    instalar(novo);
    if (avisos.length) aviso(`${avisos.join('; ')}. Isso não é permitido numa página.`);
    return true;
  }
  function instalar(novo) {
    parar(); historico.limpar();
    rig = inicial = novo; sel = rig.pecas[0]?.id ?? null; quadroSel = null; t = 0; estrutura = null;
    if (modoFinal) alternarFinal();
    areaColar.hidden = menuExemplos.hidden = true;
    renderTudo(); avisarMudanca(); raiz.focus();
  }
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files?.[0]; arquivo.value = '';
    if (!f) return;
    if (f.size > 3e6) { aviso('Arquivo grande demais (máx. 3 MB).', 'err'); return; }
    carregarTexto(await f.text(), f.name.replace(/\.svg$/i, ''));
  });
  const area = h('textarea', { class: 'cs-area', rows: 6, placeholder: '<svg viewBox="0 0 200 200"> … </svg>', spellcheck: 'false', 'aria-label': 'Código SVG' });
  areaColar.append(h('p', { class: 'cs-dica' }, 'Cole o código do SVG. Cada grupo (<g>) ou forma solta no primeiro nível vira uma peça; se tudo estiver dentro de um grupo só, use "Dividir grupo".'), area,
    h('div', { class: 'cs-btns' }, botao({ rotulo: 'Carregar', cls: 'primary', aoClicar: () => { if (carregarTexto(area.value, ctx.nome)) area.value = ''; } }), botao({ rotulo: 'Fechar', aoClicar: () => { areaColar.hidden = true; } })));
  for (const e of EXEMPLOS) menuExemplos.append(h('button', { type: 'button', class: 'cs-ex', onclick: () => { if (!temAlteracoes() || confirm('Trocar o desenho descarta a animação atual. Continuar?')) instalar(e.criarRig()); } },
    h('b', {}, e.nome), h('small', {}, e.nivel), h('span', {}, e.descricao)));
  menuExemplos.append(h('button', { type: 'button', class: 'cs-ex cs-ex-fechar', onclick: () => { menuExemplos.hidden = true; } }, 'Fechar'));
  vazio.append(h('b', {}, 'Comece por aqui'), h('span', {}, 'Escolha um exemplo pronto ou cole/abra um SVG seu.'),
    h('div', { class: 'cs-btns' }, botao({ rotulo: 'Exemplos', ic: 'template', cls: 'primary', aoClicar: () => { menuExemplos.hidden = false; } }), botao({ rotulo: 'Colar SVG', ic: 'code', aoClicar: () => { areaColar.hidden = false; area.focus(); } })));

  // ---------- teclado (a janela já impede que chegue aos atalhos do editor) ----------
  raiz.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input,select,textarea')) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); voltar(!e.shiftKey); }
    else if (ctrl && k === 'y') { e.preventDefault(); voltar(false); }
    else if (k === ' ') { e.preventDefault(); tocando ? parar() : tocar(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); parar(); definirT(t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 500 : 50)); }
    else if (k === 'home') { e.preventDefault(); parar(); definirT(0); }
    else if (k === 'end') { e.preventDefault(); parar(); definirT(rig.duracao); }
    else if (k === 'k' && sel) { e.preventDefault(); parar(); mudar(E.quadrosDeTudoEm(rig, sel, tInt())); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); apagarQuadros(); }
    else if (k === 'escape' && (!menuExemplos.hidden || !areaColar.hidden)) { e.preventDefault(); menuExemplos.hidden = areaColar.hidden = true; }
  });
  addEventListener('resize', () => { if (raiz.isConnected) renderQuadro(); });

  escolherFerramenta('mover');
  renderTudo();
  requestAnimationFrame(renderQuadro);               // depois do primeiro layout, para o overlay medir o tamanho certo

  if (ctx.svg) { const { avisos } = P.lerSvgComAvisos(ctx.svg); if (avisos.length) aviso(`${avisos.join('; ')}. Isso não é permitido numa página.`); }

  function temAlteracoes() { return rig !== inicial; }
  return {
    exportarSvg: () => (rig.pecas.length ? P.exportarSvgAnimado(rig, { laco: repetir }) : ''),
    destruir() { parar(); raiz.remove(); },
    temAlteracoes,
    nome: () => rig.nome,
    carregarSvg: (texto, nome) => carregarTexto(texto, nome),
    focar: () => raiz.focus(),
  };
}

export const modoRig = { id: 'rig', rotulo: 'Rig de peças', montar };
