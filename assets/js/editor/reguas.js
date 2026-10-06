// Réguas do editor: horizontal e vertical ao redor do canvas, na unidade escolhida (px, rem, mm, cm, pol, pt), com
//  · marcas que mudam de passo conforme o zoom (medidas.js › marcasDaRegua);
//  · a página destacada, o que está selecionado e a posição do ponteiro;
//  · guias: arraste da régua para criar, arraste a guia para mover, solte sobre a régua para apagar;
//  · canto com a unidade, "Adicionar guia…" por teclado e "Limpar guias".
// A lógica (unidade padrão, conversões, guias) é pura e testada em core/reguas.js.
import { h } from '../core/dom.js';
import { frameOf, aabb, pageW, pageH } from '../core/model.js';
import { marcasDaRegua, UNIDADES, formatar, dePx } from '../core/medidas.js';
import { UNIDADES_REGUA, unidadePadrao, posNaTela, posNoDoc, faixaVisivel, guiasDe, adicionarGuia, moverGuia, removerGuia, limparGuias, totalDeGuias, textoParaPx } from '../core/reguas.js';
import { S, on, emit, selEls, commit } from './state.js';
import { modal, btn, toast } from './ui.js';

const CHAVE = 'artatk.regua';
const TAM = 22;                                   // espessura das réguas (px de tela)
const COR = { fundo: '#15141c', pagina: '#222130', tinta: '#8e8ba1', tique: '#56546d', sel: 'rgba(79,140,255,.38)', ponteiro: '#e4572e' };

let el = {};                                      // { wrap, canto, ch, cv, vp, holder, overlay }
let pref = { visivel: true, unidade: { papel: null, tela: null } };
let ponteiro = null;                              // { x, y } em px do documento, só enquanto o mouse está sobre o canvas
let quadro = 0;

const lerPref = () => { try { const p = JSON.parse(localStorage.getItem(CHAVE) || 'null'); if (p) pref = { visivel: p.visivel !== false, unidade: { papel: null, tela: null, ...(p.unidade || {}) } }; } catch { /* padrão */ } };
const gravarPref = () => { try { localStorage.setItem(CHAVE, JSON.stringify(pref)); } catch { /* sem armazenamento */ } };
const familia = () => (S.doc?.page?.fixa ? 'papel' : 'tela');

export const unidadeAtual = () => { const u = pref.unidade[familia()]; return UNIDADES_REGUA.includes(u) ? u : unidadePadrao(S.doc); };
export const reguasVisiveis = () => pref.visivel;

function definirUnidade(u) { pref.unidade[familia()] = u; gravarPref(); emit('regua'); }
export function alternarReguas(v = !pref.visivel) { pref.visivel = v; gravarPref(); aplicar(); }

function aplicar() {
  el.wrap.classList.toggle('sem-reguas', !pref.visivel);
  requestAnimationFrame(desenhar);
}

// ---------- geometria tela ↔ documento ----------
const origemX = () => el.holder.getBoundingClientRect().left - el.vp.getBoundingClientRect().left;
const origemY = () => el.holder.getBoundingClientRect().top - el.vp.getBoundingClientRect().top;
export function docDeClient(cx, cy) {
  const r = el.holder.getBoundingClientRect();
  return { x: (cx - r.left) / S.zoom, y: (cy - r.top) / S.zoom };
}

// ---------- desenho ----------
function prepara(canvas, w, h_) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h_ * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h_ * dpr); }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h_);
  return c;
}

function regua(canvas, horizontal) {
  const comprimento = horizontal ? el.vp.clientWidth : el.vp.clientHeight;
  if (!comprimento) return;
  const c = prepara(canvas, horizontal ? comprimento : TAM, horizontal ? TAM : comprimento);
  const origem = horizontal ? origemX() : origemY(), z = S.zoom, un = unidadeAtual();
  const larg = horizontal ? pageW(S.doc, S.dev) : pageH(S.doc, S.dev);
  c.fillStyle = COR.fundo; c.fillRect(0, 0, horizontal ? comprimento : TAM, horizontal ? TAM : comprimento);

  const p0 = posNaTela(0, origem, z), p1 = posNaTela(larg, origem, z);          // a página na régua
  c.fillStyle = COR.pagina;
  if (horizontal) c.fillRect(p0, 0, p1 - p0, TAM); else c.fillRect(0, p0, TAM, p1 - p0);

  const sel = selEls().filter((e) => !e.hide);                                   // o que está selecionado
  if (sel.length) {
    const b = aabb(sel.length === 1 ? frameOf(sel[0], S.dev) : unirFrames(sel));
    const a = posNaTela(horizontal ? b.x : b.y, origem, z), f = posNaTela(horizontal ? b.x + b.w : b.y + b.h, origem, z);
    c.fillStyle = COR.sel;
    if (horizontal) c.fillRect(a, 0, Math.max(1, f - a), TAM); else c.fillRect(0, a, TAM, Math.max(1, f - a));
  }

  const { inicio, fim } = faixaVisivel(origem, comprimento, z);
  let marcas;
  try { marcas = marcasDaRegua(inicio, fim, z, un); } catch { return; }
  c.strokeStyle = COR.tique; c.fillStyle = COR.tinta; c.font = '600 9.5px system-ui, sans-serif'; c.lineWidth = 1;
  c.textBaseline = 'alphabetic';
  for (const m of marcas) {
    const t = Math.round(posNaTela(m.px, origem, z)) + 0.5, maior = m.nivel === 'maior';
    c.beginPath();
    if (horizontal) { c.moveTo(t, TAM); c.lineTo(t, maior ? TAM - 14 : TAM - 6); } else { c.moveTo(TAM, t); c.lineTo(maior ? TAM - 14 : TAM - 6, t); }
    c.stroke();
    if (maior && m.rotulo) {
      if (horizontal) { c.textAlign = 'left'; c.fillText(m.rotulo, t + 3, 10); }
      else { c.save(); c.translate(10, t - 3); c.rotate(-Math.PI / 2); c.textAlign = 'left'; c.fillText(m.rotulo, 0, 0); c.restore(); }
    }
  }
  if (ponteiro) {                                                                // posição do ponteiro
    const t = Math.round(posNaTela(horizontal ? ponteiro.x : ponteiro.y, origem, z)) + 0.5;
    c.strokeStyle = COR.ponteiro; c.beginPath();
    if (horizontal) { c.moveTo(t, 0); c.lineTo(t, TAM); } else { c.moveTo(0, t); c.lineTo(TAM, t); }
    c.stroke();
  }
}
const unirFrames = (els) => { const bs = els.map((e) => aabb(frameOf(e, S.dev))); const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0, r: 0 }; };

export function desenhar() {
  if (!el.ch || !S.doc || !pref.visivel) return;
  cancelAnimationFrame(quadro);
  quadro = requestAnimationFrame(() => {
    regua(el.ch, true); regua(el.cv, false);
    el.canto.textContent = UNIDADES[unidadeAtual()]?.rotulo || unidadeAtual();
  });
}

// ---------- guias (arrastar da régua, mover, apagar) ----------
const dentroDe = (canvas, cx, cy) => { const r = canvas.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; };
const rotuloPos = (px) => formatar(dePx(px, unidadeAtual()), unidadeAtual());

// Arrasta uma guia (nova ou existente). `eixo`: 'x' = linha vertical, 'y' = horizontal. `de` = posição atual (null se nova).
function arrastarGuia(e, eixo, de) {
  e.preventDefault(); e.stopPropagation();
  let atual = de;
  const mover = (ev) => {
    const p = docDeClient(ev.clientX, ev.clientY);
    const v = eixo === 'x' ? p.x : p.y;
    const fora = dentroDe(eixo === 'x' ? el.cv : el.ch, ev.clientX, ev.clientY) || ev.clientX < el.vp.getBoundingClientRect().left || ev.clientY < el.vp.getBoundingClientRect().top;
    atual = fora ? null : Math.round(Math.min(Math.max(v, 0), eixo === 'x' ? pageW(S.doc, S.dev) : pageH(S.doc, S.dev)) * 100) / 100;
    emit('guia-previa', atual == null ? null : { eixo, pos: atual, rotulo: rotuloPos(atual), cx: ev.clientX, cy: ev.clientY });
  };
  const soltar = () => {
    removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar); removeEventListener('pointercancel', soltar);
    emit('guia-previa', null);
    let mudou = false;
    if (de != null && atual == null) mudou = removerGuia(S.doc, S.dev, eixo, de);                        // soltou sobre a régua: apaga
    else if (de != null && atual != null && atual !== de) mudou = moverGuia(S.doc, S.dev, eixo, de, atual);
    else if (de == null && atual != null) mudou = adicionarGuia(S.doc, S.dev, eixo, atual);
    if (mudou) { commit(); emit('guias'); }
  };
  addEventListener('pointermove', mover); addEventListener('pointerup', soltar); addEventListener('pointercancel', soltar);
  mover(e);
}

// ---------- menu do canto + "Adicionar guia…" ----------
function adicionarPorTexto() {
  const un = unidadeAtual();
  const eixo = h('select', { 'aria-label': 'Direção da guia' }, h('option', { value: 'x' }, 'Vertical (posição na horizontal)'), h('option', { value: 'y' }, 'Horizontal (posição na vertical)'));
  const pos = h('input', { type: 'text', inputmode: 'decimal', placeholder: `ex.: 2,5 ${UNIDADES[un].rotulo}`, 'aria-label': 'Posição da guia' });
  const fim = () => {
    const px = textoParaPx(pos.value, un);
    if (px == null) { toast('Não entendi a medida. Exemplos: 40, 2,5cm, 10mm.', 'err'); pos.focus(); return; }
    if (!adicionarGuia(S.doc, S.dev, eixo.value, px)) { toast('A guia precisa ficar dentro da página (e não repetir uma que já existe).', 'err'); return; }
    m.close(); commit(); emit('guias');
  };
  const m = modal({ title: 'Adicionar guia', body: [h('label', { class: 'fld' }, 'Direção', eixo), h('label', { class: 'fld' }, `Posição, a partir do canto da página (${UNIDADES[un].nome.toLowerCase()})`, pos),
    h('p', { class: 'hint' }, 'Você pode digitar a unidade junto: 2,5cm, 10mm, 40px, 1,5rem.')], actions: [btn({ label: 'Adicionar', cls: 'primary', onClick: fim })] });
  pos.addEventListener('keydown', (e) => { if (e.key === 'Enter') fim(); });
  pos.focus();
}

function menuCanto(ancora) {
  const old = document.querySelector('#menu-regua'); if (old) { old.remove(); return; }
  const un = unidadeAtual(), n = totalDeGuias(S.doc);
  const item = (rot, fn, ligado = false, off = false) => h('button', { class: ligado ? 'on' : '', disabled: off || null, onclick: () => { m.remove(); fn(); } }, h('span', {}, rot));
  const m = h('div', { id: 'menu-regua', class: 'popover menu', role: 'menu' },
    ...UNIDADES_REGUA.map((u) => item(`${UNIDADES[u].nome} (${UNIDADES[u].rotulo})`, () => definirUnidade(u), u === un)),
    h('hr'),
    item('Adicionar guia…', adicionarPorTexto),
    item(`Limpar guias${n ? ` (${n})` : ''}`, () => { if (limparGuias(S.doc)) { commit(); emit('guias'); } }, false, !n),
    h('hr'),
    item('Ocultar réguas (Alt+R)', () => alternarReguas(false)));
  document.body.append(m);
  const r = ancora.getBoundingClientRect();
  Object.assign(m.style, { top: r.bottom + 4 + 'px', left: r.left + 'px' });
  setTimeout(() => document.addEventListener('pointerdown', function away(ev) { if (!m.contains(ev.target) && ev.target !== ancora) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
}

// ---------- início ----------
export function initReguas(refs) {
  el = refs;
  lerPref();
  el.ch.addEventListener('pointerdown', (e) => { if (e.button === 0) arrastarGuia(e, 'y', null); });
  el.cv.addEventListener('pointerdown', (e) => { if (e.button === 0) arrastarGuia(e, 'x', null); });
  el.canto.addEventListener('click', () => menuCanto(el.canto));
  // guias existentes: arrastar para mover (a camada de guias é desenhada pelo palco; aqui só o gesto)
  el.overlay.addEventListener('pointerdown', (e) => {
    const g = e.target.closest?.('.guia-u:not(.previa)');
    if (g && e.button === 0) arrastarGuia(e, g.dataset.eixo, Number(g.dataset.pos));
  });
  // posição do ponteiro sobre o canvas
  el.vp.addEventListener('pointermove', (e) => { ponteiro = docDeClient(e.clientX, e.clientY); desenhar(); });
  el.vp.addEventListener('pointerleave', () => { ponteiro = null; desenhar(); });
  el.vp.addEventListener('scroll', desenhar, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(desenhar).observe(el.vp);
  for (const ev of ['zoom', 'select', 'geom', 'el', 'struct', 'struct-lite', 'page', 'device', 'regua', 'saved']) on(ev, desenhar);
  aplicar();
}
