// Runtime dos controladores no VISUALIZADOR (página publicada, prévia e teste de leitura): a camada fina entre o navegador e as
// funções puras de anim-motor.js e leitura.js. Aqui mora tudo que toca a janela: rolagem, retângulos dos elementos, relógio, HUD.
// Regras de desempenho: LER todas as medidas de uma vez e só depois ESCREVER estilos (senão cada escrita força o navegador a refazer
// o layout); só trabalhar quando a rolagem mudou; só escrever quando o valor mudou.
import { progressoDaFaixa, valoresDoControlador, combinar, estiloDeValores, valoresReduzidos, normalizarControladores } from './anim-motor.js';
import { criarMedidor, visibilidadeEfetiva, relatorioCsv, montarEnvio, estimarLeitura, contarPalavras, ESTADOS } from './leitura.js';

const noEl = (raiz, id) => raiz.querySelector(`.el[data-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);     // ids são slugs; o escape é só por segurança

// ---------- rolagem ----------
export function iniciarRolagem(raiz, doc, { dev = 'd', janela = window } = {}) {
  const reduzir = janela.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const alvos = [];
  for (const el of doc.elements || []) {
    const lista = normalizarControladores(el.ctl).filter((c) => c.k === 'rolagem' && (!c.dispositivos || c.dispositivos.includes(dev)));
    if (!lista.length || el.hide) continue;
    const frame = noEl(raiz, el.id), ct = frame?.querySelector('.el-ct');
    if (frame && ct) alvos.push({ frame, ct, lista, ultimo: '', atual: null, suave: Math.max(0, ...lista.map((c) => c.suave || 0)) });
  }
  if (!alvos.length) return { parar() {}, total: 0 };

  if (reduzir) {                          // movimento reduzido: só opacidade/desfoque, no valor final
    for (const a of alvos) Object.assign(a.ct.style, estiloDeValores(combinar(a.lista.map(valoresReduzidos))));
    return { parar() {}, total: alvos.length };
  }

  const docEl = janela.document.documentElement;
  let pendente = 0, ativo = true;
  const quadro = () => {
    pendente = 0;
    if (!ativo) return;
    const vh = janela.innerHeight, rolagem = janela.scrollY, docAltura = docEl.scrollHeight;
    // 1) LER tudo
    const medidas = alvos.map((a) => { const r = a.frame.getBoundingClientRect(); return { topo: r.top, altura: r.height, vh, rolagem, docAltura }; });
    // 2) ESCREVER
    let animando = false;
    alvos.forEach((a, i) => {
      const alvoV = combinar(a.lista.map((c) => valoresDoControlador(c, progressoDaFaixa(medidas[i], c.faixa))));
      let v = alvoV;
      if (a.suave > 0) {                                                        // inércia: caminha uma fração do trecho a cada quadro
        const k = 1 - a.suave; v = {};
        for (const [p, x] of Object.entries(alvoV)) { const de = a.atual?.[p] ?? x; v[p] = de + (x - de) * k; if (Math.abs(x - v[p]) > 0.01) animando = true; }
        a.atual = v;
      }
      const css = estiloDeValores(v), chave = JSON.stringify(css);
      if (chave !== a.ultimo) { Object.assign(a.ct.style, css); a.ultimo = chave; }
    });
    if (animando) agendar();
  };
  const agendar = () => { if (!pendente && ativo) pendente = janela.requestAnimationFrame(quadro); };
  janela.addEventListener('scroll', agendar, { passive: true });
  janela.addEventListener('resize', agendar);
  alvos.forEach((a) => a.ct.style.setProperty('will-change', 'transform, opacity'));
  agendar();
  return {
    total: alvos.length,
    parar() {
      ativo = false; janela.removeEventListener('scroll', agendar); janela.removeEventListener('resize', agendar);
      if (pendente) janela.cancelAnimationFrame(pendente);
      for (const a of alvos) { for (const p of ['translate', 'scale', 'rotate', 'opacity', 'filter', 'will-change']) a.ct.style.removeProperty(p); }
    },
  };
}

// ---------- tempo em tela ----------
const COR = { 'nao-visto': '#8a8799', 'passou-rapido': '#e4572e', parcial: '#e9b72a', lido: '#2fb36b' };
const ESTILO_ID = 'artatk-leitura-css';
const CSS_HUD = `#artatk-leitura{position:fixed;right:12px;bottom:12px;z-index:2147483000;width:min(340px,calc(100vw - 24px));max-height:60vh;display:flex;flex-direction:column;background:#17161d;color:#e8e6ef;font:12px/1.4 system-ui,sans-serif;border:1px solid #3a3848;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
#artatk-leitura header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #3a3848}#artatk-leitura header b{flex:1;font-size:12.5px}
#artatk-leitura button{font:600 11px system-ui;color:#e8e6ef;background:#2a2935;border:1px solid #3a3848;border-radius:7px;padding:4px 9px;cursor:pointer}#artatk-leitura button:hover{background:#34333f}
#artatk-leitura ul{list-style:none;margin:0;padding:6px;overflow:auto}#artatk-leitura li{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:6px 8px;border-radius:8px;cursor:pointer}#artatk-leitura li:hover{background:#252430}
#artatk-leitura .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#artatk-leitura .t{color:#a9a6b8;font-variant-numeric:tabular-nums}
#artatk-leitura .b{grid-column:1/-1;height:5px;border-radius:3px;background:#2a2935;overflow:hidden}#artatk-leitura .b i{display:block;height:100%;width:0;background:var(--c,#8a8799);transition:width .25s}
#artatk-leitura .s{grid-column:1/-1;font-size:10.5px;color:var(--c,#8a8799)}#artatk-leitura footer{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid #3a3848}
#artatk-leitura.min ul,#artatk-leitura.min footer{display:none}#artatk-leitura .vazio{padding:12px;color:#a9a6b8}`;

export function iniciarLeitura(raiz, doc, { modo = 'teste', dev = 'd', destino = null, pagina = {}, janela = window } = {}) {
  const documento = janela.document;
  const medidor = criarMedidor(), blocos = [];
  for (const el of doc.elements || []) {
    if (el.hide) continue;
    const frame = noEl(raiz, el.id); if (!frame) continue;
    const tempo = normalizarControladores(el.ctl).find((c) => c.k === 'tempo');
    const texto = el.t === 'text' ? (el.text || frame.textContent || '') : (el.t === 'shape' && el.label ? el.label : '');
    // teste do autor: todo texto de verdade entra; visitantes: só o que o autor marcou com "Tempo em tela"
    if (!(tempo || (modo === 'teste' && el.t === 'text' && contarPalavras(texto) >= 4))) continue;
    const nome = tempo?.nome || el.name || (texto.trim().split(/\s+/).slice(0, 5).join(' ') + (contarPalavras(texto) > 5 ? '…' : '')) || el.id;
    medidor.registrar(el.id, { nome, texto, meta: tempo?.meta ?? 'auto', visivelMin: tempo?.visivelMin });
    blocos.push({ id: el.id, frame });
  }
  if (!blocos.length) return { parar() {}, total: 0, resumo: () => [] };

  let ultimoY = janela.scrollY, ultimoT = janela.performance.now(), velocidade = 0, hud = null, linhas = new Map(), ativo = true;
  const tick = () => {
    if (!ativo) return;
    const t = janela.performance.now(), y = janela.scrollY, dt = Math.max(1, t - ultimoT);
    velocidade = velocidade * 0.5 + (Math.abs(y - ultimoY) / dt) * 1000 * 0.5; ultimoY = y; ultimoT = t;       // px/s suavizado
    const aba = documento.visibilityState === 'visible', vh = janela.innerHeight;
    const rects = blocos.map((b) => b.frame.getBoundingClientRect());
    blocos.forEach((b, i) => medidor.amostra(b.id, { t, visivel: visibilidadeEfetiva({ topo: rects[i].top, altura: rects[i].height, vh }), ativo: aba, velocidade }));
    if (modo === 'teste') pintarHud();
  };
  const id = janela.setInterval(tick, 200);
  const aoEsconder = () => { if (documento.visibilityState === 'hidden') { medidor.pausar(); if (modo === 'visitante') enviar(); } else { ultimoT = janela.performance.now(); } };
  documento.addEventListener('visibilitychange', aoEsconder);
  janela.addEventListener('pagehide', aoEsconder);

  // ----- visitantes reais: envio anônimo, uma vez por saída, só se houver destino configurado e a pessoa não pediu "não rastrear" -----
  const sessao = Math.random().toString(36).slice(2, 10);
  function enviar() {
    if (!destino || janela.navigator.doNotTrack === '1') return false;
    const corpo = montarEnvio({ pagina, sessao, dev, vw: janela.innerWidth, resumo: medidor.resumo() });
    if (!corpo.blocos.length) return false;
    const ok = janela.navigator.sendBeacon?.(destino, new Blob([JSON.stringify(corpo)], { type: 'text/plain;charset=UTF-8' }));     // text/plain: dispensa a checagem prévia (CORS) do navegador
    if (ok) medidor.zerar();
    return !!ok;
  }

  // ----- teste do autor: painel ao vivo -----
  const segs = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
  function montarHud() {
    if (!documento.getElementById(ESTILO_ID)) { const s = documento.createElement('style'); s.id = ESTILO_ID; s.textContent = CSS_HUD; documento.head.append(s); }
    hud = documento.createElement('aside'); hud.id = 'artatk-leitura'; hud.setAttribute('aria-label', 'Teste de leitura');
    const cab = documento.createElement('header'), tit = documento.createElement('b'); tit.textContent = 'Teste de leitura';
    const bMin = documento.createElement('button'); bMin.type = 'button'; bMin.textContent = '–'; bMin.title = 'Recolher'; bMin.onclick = () => hud.classList.toggle('min');
    cab.append(tit, bMin);
    const ul = documento.createElement('ul'); ul.setAttribute('aria-live', 'off');
    const rod = documento.createElement('footer');
    const botao = (rot, fn) => { const b = documento.createElement('button'); b.type = 'button'; b.textContent = rot; b.onclick = fn; rod.append(b); };
    botao('Baixar CSV', () => baixar('leitura.csv', relatorioCsv(medidor.resumo()), 'text/csv;charset=utf-8'));
    botao('Copiar JSON', () => janela.navigator.clipboard?.writeText(JSON.stringify(medidor.resumo(), null, 1)));
    botao('Zerar', () => { medidor.zerar(); pintarHud(); });
    hud.append(cab, ul, rod); documento.body.append(hud);
    for (const b of blocos) {
      const li = documento.createElement('li'); li.dataset.id = b.id;
      li.innerHTML = '<span class="n"></span><span class="t"></span><span class="b"><i></i></span><span class="s"></span>';
      li.onclick = () => b.frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ul.append(li); linhas.set(b.id, li);
    }
  }
  function baixar(nome, texto, tipo) { const a = documento.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + texto], { type: tipo })); a.download = nome; documento.body.append(a); a.click(); a.remove(); }
  function pintarHud() {
    if (!hud) return;
    for (const r of medidor.resumo()) {
      const li = linhas.get(r.id), cor = COR[r.estado]; if (!li) continue;
      li.style.setProperty('--c', cor);
      li.querySelector('.n').textContent = r.nome; li.querySelector('.t').textContent = `${segs(r.tempoMs)} / ${segs(r.metaMs)} s`;
      li.querySelector('.b i').style.width = `${Math.round(r.fracao * 100)}%`; li.querySelector('.s').textContent = ESTADOS[r.estado];
      const frame = blocos.find((b) => b.id === r.id).frame; frame.style.outline = r.estado === 'nao-visto' ? '' : `2px dashed ${cor}`; frame.style.outlineOffset = '4px';
    }
  }
  if (modo === 'teste') { montarHud(); pintarHud(); }

  return {
    total: blocos.length, resumo: () => medidor.resumo(), enviar,
    parar() {
      ativo = false; janela.clearInterval(id); documento.removeEventListener('visibilitychange', aoEsconder); janela.removeEventListener('pagehide', aoEsconder);
      hud?.remove(); for (const b of blocos) { b.frame.style.outline = ''; b.frame.style.outlineOffset = ''; }
    },
  };
}
export { estimarLeitura };
