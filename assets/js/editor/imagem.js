// Editor de imagem do ArtAtk: VARINHA MÁGICA (tirar fundo e fazer PNG com transparência) e RECORTE (retângulo com proporção,
// aparar transparência, círculo/elipse, cantos arredondados). Abre numa janela própria sobre a imagem selecionada, com
// desfazer/refazer, e ao aplicar troca o arquivo da imagem na página (PNG; WebP só se o PNG for pesado demais para publicar).
// As contas ficam em core/imagem-edicao.js (puras e testadas); aqui só há tela e ponteiro.
import { h } from '../core/dom.js';
import { downloadBlob } from '../core/util.js';
import * as E from '../core/imagem-edicao.js';
import { S, mutate, commit, emit } from './state.js';
import { activeDoc } from './docs.js';
import { btn, toast } from './ui.js';
import { icon } from './icons.js';
import { addAssetBlob } from './tools.js';

const LIMITE_PNG = 4200000;          // o Publicador recusa imagem acima de ~6 MB em base64 (≈ 4,5 MB de arquivo)
const MAX_HISTORICO = 20;
const MIN_CAIXA = 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const paraCanvas = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return c; };
const paraBlob = (canvas, tipo, qualidade) => new Promise((r) => canvas.toBlob(r, tipo, qualidade));
const nBR = (n) => n.toLocaleString('pt-BR');

export async function abrirEditorImagem(el, { ferramenta = 'varinha', ponto = null } = {}) {
  const meta = S.doc.assets[el.asset], arquivo = S.assets.get(el.asset);
  if (!meta || !arquivo?.blob) { toast('Não achei o arquivo desta imagem.', 'err'); return null; }
  if (/gif/.test(meta.mime)) { toast('GIF animado não pode ser editado aqui: ele viraria uma imagem parada.', 'err'); return null; }
  if (/svg/.test(meta.mime)) { toast('SVG já é vetorial: edite o código ou as formas, não os pixels.', 'err'); return null; }

  let bmp;
  try { bmp = await createImageBitmap(arquivo.blob); } catch { toast('Não consegui abrir essa imagem para editar.', 'err'); return null; }
  const c0 = document.createElement('canvas'); c0.width = bmp.width; c0.height = bmp.height;
  const x0 = c0.getContext('2d', { willReadFrequently: true }); x0.drawImage(bmp, 0, 0);
  const original = x0.getImageData(0, 0, bmp.width, bmp.height);

  // ---------- estado ----------
  let atual = original, mascara = null, caixa = null, tool = ferramenta === 'recorte' ? 'recorte' : 'varinha', escala = 1;
  const desfazer = [], refazer = [];
  const opt = { tolerancia: 25, contiguo: true, suave: 0, razao: 'livre', raio: 18 };
  const alterou = () => atual !== original;

  // ---------- elementos ----------
  const cvImg = h('canvas', { class: 'ie-cv' }), cvSel = h('canvas', { class: 'ie-cv ie-sel' });
  const cropEl = h('div', { class: 'ie-crop', hidden: true }, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((k) => h('i', { class: 'ie-h ie-h-' + k, 'data-h': k })));
  const palco = h('div', { class: 'ie-palco' }, cvImg, cvSel, cropEl);
  const area = h('div', { class: 'ie-area' }, palco);
  const info = h('p', { class: 'ie-info' });
  const bDesfazer = btn({ label: 'Desfazer', ic: 'undo', cls: 'sm', onClick: () => voltar(desfazer, refazer) });
  const bRefazer = btn({ label: 'Refazer', ic: 'redo', cls: 'sm', onClick: () => voltar(refazer, desfazer) });

  const slider = (rotulo, min, max, valor, unidade, aoMudar) => {
    const out = h('output', {}, valor + unidade), inp = h('input', { type: 'range', min, max, value: valor });
    inp.addEventListener('input', () => { out.textContent = inp.value + unidade; aoMudar(Number(inp.value)); });
    return h('label', { class: 'ie-campo' }, h('span', {}, rotulo, out), inp);
  };
  const marca = (rotulo, valor, aoMudar) => { const i = h('input', { type: 'checkbox', checked: valor }); i.addEventListener('change', () => aoMudar(i.checked)); return h('label', { class: 'ie-marca' }, i, h('span', {}, rotulo)); };

  const painelVarinha = h('div', { class: 'ie-painel' },
    h('p', { class: 'hint' }, 'Clique na imagem para selecionar uma cor parecida. Shift soma à seleção; Alt tira dela.'),
    slider('Tolerância', 0, 100, opt.tolerancia, '%', (v) => { opt.tolerancia = v; }),
    marca('Só a área ligada ao clique', opt.contiguo, (v) => { opt.contiguo = v; }),
    slider('Borda suave', 0, 8, opt.suave, ' px', (v) => { opt.suave = v; }),
    h('div', { class: 'btnrow' }, btn({ label: 'Tirar o fundo (cantos)', ic: 'wand', cls: 'sm primary', title: 'Seleciona o fundo liso a partir dos 4 cantos e apaga', onClick: () => tirarFundo() })),
    h('div', { class: 'btnrow' }, btn({ label: 'Apagar seleção', ic: 'trash', cls: 'sm', onClick: () => apagarSelecao(false) }), btn({ label: 'Manter só a seleção', cls: 'sm', onClick: () => apagarSelecao(true) })),
    h('div', { class: 'btnrow' }, btn({ label: 'Inverter', cls: 'sm', onClick: () => { if (mascara) { mascara = E.inverter(mascara); pintarSel(); } } }), btn({ label: 'Limpar seleção', cls: 'sm', onClick: () => { mascara = null; pintarSel(); } })),
    h('div', { class: 'btnrow' }, btn({ label: '− 1 px', cls: 'sm', title: 'Encolhe a seleção (tira o contorno que sobra)', onClick: () => ajustarSel(-1) }), btn({ label: '+ 1 px', cls: 'sm', title: 'Aumenta a seleção', onClick: () => ajustarSel(1) })));

  const razoes = [['livre', 'Livre'], ['original', 'Original'], ['1:1', '1:1 (quadrado)'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['3:4', '3:4'], ['2:3', '2:3'], ['9:16', '9:16']];
  const selRazao = h('select', { 'aria-label': 'Proporção do recorte' }, razoes.map(([v, r]) => h('option', { value: v }, r)));
  selRazao.addEventListener('change', () => { opt.razao = selRazao.value; if (caixa) { caixa = E.ajustarProporcao(caixa, razaoAtual(), lim()); pintarCrop(); } });
  const painelRecorte = h('div', { class: 'ie-painel' },
    h('p', { class: 'hint' }, 'Arraste a moldura sobre a imagem. Escolha uma proporção para travá-la.'),
    h('label', { class: 'ie-campo' }, h('span', {}, 'Proporção'), selRazao),
    h('div', { class: 'btnrow' }, btn({ label: 'Recortar', ic: 'crop', cls: 'sm primary', onClick: () => aplicarRecorte() }), btn({ label: 'Moldura = seleção', cls: 'sm', title: 'Ajusta a moldura à seleção da varinha', onClick: () => molduraDaSelecao() })),
    h('div', { class: 'btnrow' }, btn({ label: 'Aparar transparência', cls: 'sm', title: 'Corta as margens totalmente transparentes', onClick: () => aparar() })),
    h('p', { class: 'ie-sub' }, 'Formato do recorte'),
    h('div', { class: 'btnrow' }, btn({ label: 'Círculo / elipse', cls: 'sm', onClick: () => formato('elipse') })),
    slider('Raio dos cantos', 0, 50, opt.raio, '%', (v) => { opt.raio = v; }),
    h('div', { class: 'btnrow' }, btn({ label: 'Cantos arredondados', cls: 'sm', onClick: () => formato('cantos') })));

  const segs = [['varinha', 'wand', 'Varinha mágica'], ['recorte', 'crop', 'Recorte']];
  const abas = h('div', { class: 'seg' }, segs.map(([id, ic, rot]) => h('button', { type: 'button', 'data-tool': id, title: rot, html: icon(ic, 15) + `<span>${rot}</span>`, onclick: () => trocar(id) })));
  const barra = h('div', { class: 'ie-bar' }, abas, painelVarinha, painelRecorte, h('div', { class: 'btnrow ie-hist' }, bDesfazer, bRefazer), info);

  // ---------- janela ----------
  const doc = activeDoc();
  const fechar = () => { if (alterou() && !confirm('Descartar as alterações desta imagem?')) return; sair(); };
  const sair = () => fundo.remove();
  const bAplicar = btn({ label: 'Aplicar na página', ic: 'check', cls: 'primary', onClick: () => aplicar() });
  const fundo = h('div', { class: 'modal-back ie-back', tabindex: '-1' },
    h('div', { class: 'modal wide ie-modal', role: 'dialog', 'aria-label': 'Editar imagem' },
      h('header', {}, h('b', {}, 'Editar imagem'), btn({ ic: 'x', title: 'Fechar', onClick: fechar, cls: 'icon' })),
      h('div', { class: 'modal-b ie-corpo' }, barra, area),
      h('footer', {}, btn({ label: 'Cancelar', onClick: fechar }), btn({ label: 'Baixar PNG', ic: 'download', onClick: () => baixar() }), bAplicar)));
  doc.body.append(fundo);

  // ---------- desenho ----------
  const lim = () => ({ width: atual.width, height: atual.height });
  const razaoAtual = () => (opt.razao === 'original' ? atual.width / atual.height : E.RAZOES[opt.razao] || 0);
  function ajustarVista() {
    const aw = Math.max(120, area.clientWidth - 28), ah = Math.max(120, area.clientHeight - 28);
    escala = Math.min(aw / atual.width, ah / atual.height, 6);
    for (const c of [cvImg, cvSel]) { c.style.width = atual.width * escala + 'px'; c.style.height = atual.height * escala + 'px'; }
    palco.style.width = atual.width * escala + 'px'; palco.style.height = atual.height * escala + 'px';
    pintarCrop();
  }
  function pintar() {
    cvImg.width = atual.width; cvImg.height = atual.height;
    cvImg.getContext('2d').putImageData(new ImageData(atual.data, atual.width, atual.height), 0, 0);
    ajustarVista(); pintarSel(); resumo();
  }
  function pintarSel() {
    const { width: w, height: hh } = atual;
    cvSel.width = w; cvSel.height = hh;
    const c = cvSel.getContext('2d'); c.clearRect(0, 0, w, hh);
    if (mascara) {
      const id = c.createImageData(w, hh), d = id.data;
      for (let p = 0; p < w * hh; p++) {
        if (!mascara[p]) continue;
        const x = p % w, y = (p - x) / w, borda = x === 0 || y === 0 || x === w - 1 || y === hh - 1 || !mascara[p - 1] || !mascara[p + 1] || !mascara[p - w] || !mascara[p + w], i = p * 4;
        if (borda) { const claro = ((x >> 2) + (y >> 2)) & 1; d[i] = d[i + 1] = d[i + 2] = claro ? 255 : 20; d[i + 3] = 255; } else { d[i] = 79; d[i + 1] = 140; d[i + 2] = 255; d[i + 3] = 80; }
      }
      c.putImageData(id, 0, 0);
    }
    resumo();
  }
  function resumo() {
    const n = mascara ? E.contar(mascara) : 0;
    info.textContent = `${nBR(atual.width)} × ${nBR(atual.height)} px${n ? ` · ${nBR(n)} px selecionados` : ''}`;
    bDesfazer.disabled = !desfazer.length; bRefazer.disabled = !refazer.length;
    bAplicar.disabled = !alterou();
  }
  function pintarCrop() {
    const ativo = tool === 'recorte' && caixa;
    cropEl.hidden = !ativo;
    if (!ativo) return;
    Object.assign(cropEl.style, { left: caixa.x * escala + 'px', top: caixa.y * escala + 'px', width: caixa.w * escala + 'px', height: caixa.h * escala + 'px' });
    cropEl.dataset.medida = `${Math.round(caixa.w)} × ${Math.round(caixa.h)}`;
  }
  function trocar(id) {
    tool = id;
    painelVarinha.hidden = id !== 'varinha'; painelRecorte.hidden = id !== 'recorte';
    abas.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    area.dataset.tool = id;
    if (id === 'recorte' && !caixa) caixa = { x: 0, y: 0, w: atual.width, h: atual.height };
    pintarCrop();
  }

  // ---------- histórico ----------
  function empilhar() { desfazer.push(atual); if (desfazer.length > MAX_HISTORICO) desfazer.shift(); refazer.length = 0; }
  function voltar(de, para) {
    if (!de.length) return;
    para.push(atual); atual = de.pop(); mascara = null; caixa = tool === 'recorte' ? { x: 0, y: 0, w: atual.width, h: atual.height } : null; pintar();
  }
  function usar(nova, { tudo = false } = {}) { empilhar(); atual = nova; mascara = null; caixa = tool === 'recorte' || tudo ? { x: 0, y: 0, w: atual.width, h: atual.height } : null; pintar(); }

  // ---------- varinha ----------
  function clicarImagem(ev) {
    if (tool !== 'varinha') return;
    const r = cvImg.getBoundingClientRect();
    selecionarEm(Math.floor(((ev.clientX - r.left) / r.width) * atual.width), Math.floor(((ev.clientY - r.top) / r.height) * atual.height), ev.shiftKey ? 'unir' : ev.altKey ? 'subtrair' : 'substituir');
  }
  function selecionarEm(x, y, modo = 'substituir') {
    const nova = E.varinha(atual, x, y, { tolerancia: opt.tolerancia, contiguo: opt.contiguo });
    mascara = modo === 'substituir' || !mascara ? nova : E.combinar(mascara, nova, modo);
    if (modo === 'subtrair' && !E.contar(mascara)) mascara = null;
    pintarSel();
  }
  function apagarSelecao(manter) {
    if (!mascara) { toast('Clique na imagem para selecionar primeiro.'); return; }
    usar(manter ? E.manterSomente(atual, mascara, { suavizar: opt.suave }) : E.apagar(atual, mascara, { suavizar: opt.suave }));
  }
  function tirarFundo() { usar(E.apagar(atual, E.selecaoDosCantos(atual, { tolerancia: opt.tolerancia, contiguo: opt.contiguo }), { suavizar: opt.suave })); }
  function ajustarSel(n) { if (mascara) { mascara = E.ajustarBorda(mascara, atual.width, atual.height, n); pintarSel(); } }

  // ---------- recorte ----------
  function molduraDaSelecao() {
    const c = mascara && E.caixaDaMascara(mascara, atual.width, atual.height);
    if (!c) { toast('Selecione algo com a varinha primeiro.'); return; }
    caixa = c; pintarCrop();
  }
  function aplicarRecorte() {
    if (!caixa) return;
    const c = E.normalizarCaixa(atual, caixa);
    if (c.w === atual.width && c.h === atual.height) { toast('A moldura está na imagem inteira. Arraste as bordas para recortar.'); return; }
    usar(E.recortar(atual, c), { tudo: true });
  }
  function aparar() { const r = E.aparar(atual); if (!r.mudou) { toast('Não há margem transparente para aparar.'); return; } usar(r.img, { tudo: true }); }
  function formato(qual) {
    const c = E.normalizarCaixa(atual, caixa || { x: 0, y: 0, w: atual.width, h: atual.height }), base = E.recortar(atual, c);
    const m = qual === 'elipse' ? E.mascaraElipse(base.width, base.height) : E.mascaraArredondada(base.width, base.height, (Math.min(base.width, base.height) / 2) * (opt.raio / 100));
    usar(E.apagar(base, E.inverter(m), { suavizar: 1 }), { tudo: true });
  }
  // arrastar/redimensionar a moldura
  cropEl.addEventListener('pointerdown', (ev) => {
    const k = ev.target.dataset.h || 'move', r0 = { ...caixa }, px = ev.clientX, py = ev.clientY, W = atual.width, H = atual.height;
    ev.preventDefault(); cropEl.setPointerCapture(ev.pointerId);
    const mover = (e) => {
      const dx = (e.clientX - px) / escala, dy = (e.clientY - py) / escala;
      if (k === 'move') { caixa = { ...r0, x: clamp(r0.x + dx, 0, W - r0.w), y: clamp(r0.y + dy, 0, H - r0.h) }; }
      else {
        let a = r0.x, b = r0.y, c = r0.x + r0.w, d = r0.y + r0.h;
        if (k.includes('w')) a = clamp(r0.x + dx, 0, c - MIN_CAIXA); if (k.includes('e')) c = clamp(c + dx, a + MIN_CAIXA, W);
        if (k.includes('n')) b = clamp(r0.y + dy, 0, d - MIN_CAIXA); if (k.includes('s')) d = clamp(d + dy, b + MIN_CAIXA, H);
        caixa = { x: a, y: b, w: c - a, h: d - b };
        const rz = razaoAtual(); if (rz) caixa = E.ajustarProporcao(caixa, rz, lim());
      }
      pintarCrop();
    };
    const fim = () => { cropEl.removeEventListener('pointermove', mover); cropEl.removeEventListener('pointerup', fim); cropEl.removeEventListener('pointercancel', fim); };
    cropEl.addEventListener('pointermove', mover); cropEl.addEventListener('pointerup', fim); cropEl.addEventListener('pointercancel', fim);
  });

  // ---------- saída ----------
  async function aplicar() {
    if (!alterou()) return;
    bAplicar.disabled = true;
    try {
      const cv = paraCanvas(atual);
      let blob = await paraBlob(cv, 'image/png'), ext = 'png', mime = 'image/png', aviso = null;
      if (!blob) throw new Error('O navegador não conseguiu gerar o PNG.');
      if (blob.size > LIMITE_PNG) {
        const w = await paraBlob(cv, 'image/webp', 0.95);
        if (w && w.type === 'image/webp') { blob = w; ext = 'webp'; mime = 'image/webp'; aviso = 'O PNG ficou pesado demais para publicar; a imagem foi guardada como WebP (que também tem transparência). Use "Baixar PNG" para ter o PNG completo.'; }
      }
      const a = await addAssetBlob(blob, { ext, mime, w: atual.width, h: atual.height });
      const razaoAntes = bmp.width / bmp.height, razaoDepois = atual.width / atual.height, mudouFormato = Math.abs(razaoAntes - razaoDepois) / razaoAntes > 0.005;
      mutate([el.id], (e) => {
        e.asset = a.id;
        if (mudouFormato) for (const dev of ['d', 'm']) { const f = e.f?.[dev]; if (f) f.h = Math.round((f.w * atual.height) / atual.width * 10) / 10; }   // a moldura acompanha o novo formato (mesma largura)
      }, 'struct');
      commit(); emit('page');
      toast(aviso || `Imagem atualizada (${ext.toUpperCase()}${ext === 'png' ? ', com transparência' : ''}).`, aviso ? '' : 'ok');
      sair();
    } catch (e) { bAplicar.disabled = false; toast(e.message || String(e), 'err'); }
  }
  async function baixar() {
    try { const blob = await paraBlob(paraCanvas(atual), 'image/png'); downloadBlob(`${(el.name || 'imagem').toString().replace(/[^\w.-]+/g, '-').slice(0, 40) || 'imagem'}.png`, blob); toast('PNG salvo na pasta de Downloads.', 'ok'); }
    catch { toast('Não consegui gerar o PNG.', 'err'); }
  }

  // ---------- teclado (nada daqui chega aos atalhos do editor: Delete apagaria a imagem da página) ----------
  function teclas(e) {
    e.stopPropagation();
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (k === 'escape') { e.preventDefault(); fechar(); return; }
    if (e.target.matches?.('input[type=range],select')) { if (!ctrl) return; }
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? voltar(refazer, desfazer) : voltar(desfazer, refazer); }
    else if (ctrl && k === 'y') { e.preventDefault(); voltar(refazer, desfazer); }
    else if ((k === 'delete' || k === 'backspace') && tool === 'varinha') { e.preventDefault(); apagarSelecao(false); }
    else if (k === 'enter' && tool === 'recorte') { e.preventDefault(); aplicarRecorte(); }
  }
  fundo.addEventListener('keydown', teclas);      // na janela (não no documento): o evento para aqui e não chega aos atalhos do editor
  cvImg.addEventListener('pointerdown', clicarImagem); cvSel.addEventListener('pointerdown', clicarImagem);
  addEventListener('resize', () => { if (fundo.isConnected) ajustarVista(); });

  trocar(tool); pintar();
  fundo.focus();
  requestAnimationFrame(ajustarVista);
  if (ponto && tool === 'varinha') selecionarEm(ponto.x, ponto.y);
  return { fechar: sair };
}
