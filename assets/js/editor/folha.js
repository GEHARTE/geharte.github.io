// Painel "Folha de design": o kit visual do projeto — cores, fontes, formas e desenhos — ao lado das ferramentas, a um clique.
// É um painel do dock como qualquer outro: dá para recolher, empilhar, soltar sobre o canvas ou separar em outra janela.
//
// O que cada clique faz (a regra é sempre "aplica ao que está selecionado; sem seleção, à página"):
//   cor     → cor do texto / preenchimento da forma; com Shift, o traço. Sem nada selecionado, vira o fundo da página.
//   fonte   → a família do texto (ou do rótulo da forma) selecionado.
//   forma   → insere a forma já com o estilo da folha (preenchimento, traço, raio).
//   desenho → insere o SVG; os marcados como fundo entram como fundo de página.
// A folha escolhida fica gravada NO DOCUMENTO (`doc.folha`), não no navegador: quem abrir o projeto depois vê a mesma folha.
// As contas (contraste, onde a cor entra, normalização) estão em core/folhas.js — puras e testadas.
import { h } from '../core/dom.js';
import { FOLHAS, folhaPorId } from '../core/folhas-catalogo.js';
import { contraste, nivelDeContraste, campoDaCor, folhaSugerida } from '../core/folhas.js';
import { FONTS, fontStack, loadFonts } from '../core/fonts.js';
import { shapeSvg } from '../core/render.js';
import { makeElement, fontOwner } from '../core/model.js';
import { S, on, emit, selEls, mutate, setPage, touch } from './state.js';
import { createShape, insertSvg, insertSvgBackground } from './tools.js';
import { section, hint, btn, toast } from './ui.js';

const nomeDoPapel = {
  fundo: 'fundo da página', superficie: 'blocos e cartões', texto: 'texto', suave: 'texto secundário',
  marca: 'marca', acento: 'destaque', sobre: 'texto sobre cor forte',
};

export function initFolhaPanel(root) {
  if (!root) return { refresh: () => {} };
  let folha = null;

  const escolher = (id, { gravar = true } = {}) => {
    const nova = folhaPorId(id) || FOLHAS[0];
    if (!nova) return;
    folha = nova;
    if (gravar) gravarNoDoc();
    loadFonts(folha.fontes.map((f) => f.nome).filter((n) => FONTS.some((x) => x.name === n)));
    pintar();
  };
  // A folha vai para o documento quando a pessoa a ESCOLHE ou USA — nunca só por abrir o painel (abrir não deveria sujar o arquivo).
  function gravarNoDoc() {
    if (!folha || !S.doc || S.doc.folha === folha.id) return;
    S.doc.folha = folha.id;
    touch();
  }

  // ---------- ações ----------
  const corDaPagina = () => S.doc?.page?.bg?.c || '#ffffff';

  function aplicarCor(cor, traco) {
    gravarNoDoc();
    const els = selEls();
    if (!els.length) {
      setPage((p) => { p.bg.g = null; p.bg.c = cor.valor; });     // sem seleção, a cor é da página (o `page` que volta repinta os avisos)
      toast(`Fundo da página: ${cor.nome}.`, 'ok');
      return;
    }
    const alvos = els.filter((e) => campoDaCor(e.t, { traco }));
    if (!alvos.length) { toast(traco ? 'O que está selecionado não tem traço.' : 'Imagem e SVG não recebem cor: a cor está dentro do desenho.', 'err'); return; }
    mutate(alvos.map((e) => e.id), (e) => {
      const campo = campoDaCor(e.t, { traco });
      e.s[campo] = cor.valor;
      if (campo === 'stroke' && !(e.s.sw > 0)) e.s.sw = 2;                   // traço sem espessura não aparece
    });
    emit('struct-lite');
    toast(`${traco ? 'Traço' : 'Cor'}: ${cor.nome}.`, 'ok');
  }

  function aplicarFonte(fonte) {
    gravarNoDoc();
    const alvos = selEls().filter((e) => fontOwner(e));
    if (!alvos.length) { toast('Escolha um texto (ou uma forma com texto dentro) para trocar a fonte.', 'err'); return; }
    loadFonts([fonte.nome]);
    mutate(alvos.map((e) => e.id), (e) => { fontOwner(e).fontFamily = fonte.nome; });
    emit('struct-lite');
    toast(`Fonte: ${fonte.nome}.`, 'ok');
  }

  function inserirForma(f) {
    gravarNoDoc();
    const el = createShape(f.shape);
    mutate([el.id], (e) => { e.s = { ...e.s, ...f.s }; });
    emit('struct-lite');
  }

  // ---------- desenho do painel ----------
  function amostraDeCor(c) {
    const r = contraste(c.valor, corDaPagina());
    const n = nivelDeContraste(r);
    const b = h('button', {
      class: 'fd-cor', type: 'button', 'data-papel': c.papel,
      title: `${c.nome} · ${c.valor} · ${nomeDoPapel[c.papel] || c.papel}\nSobre o fundo da página: ${r}:1 — ${n.rotulo}. ${n.nota}\nClique aplica a cor; Shift+clique aplica ao traço.`,
      onclick: (ev) => aplicarCor(c, ev.shiftKey),
    },
      h('span', { class: 'fd-chip', style: { background: c.valor } }),
      h('span', { class: 'fd-cor-nome' }, c.nome),
      h('span', { class: 'fd-cor-hex' }, c.valor));
    if (c.papel === 'texto' || c.papel === 'suave') b.append(h('span', { class: `fd-sel fd-${n.id}`, title: n.nota }, n.rotulo));
    return b;
  }

  function pintar() {
    root.replaceChildren();
    if (!folha) { root.append(hint('Nenhuma folha de design disponível.')); return; }

    const seletor = h('select', { class: 'fd-sel-folha', 'aria-label': 'Folha de design do projeto', onchange: (e) => escolher(e.target.value) },
      FOLHAS.map((f) => h('option', { value: f.id, selected: f.id === folha.id || null }, f.nome)));
    root.append(h('div', { class: 'fd-topo' }, seletor, h('p', { class: 'hint' }, folha.descricao)));

    root.append(section('Cores', [
      h('div', { class: 'fd-cores' }, folha.cores.map(amostraDeCor)),
      hint('Clique aplica ao que está selecionado (texto: a cor; forma: o preenchimento). Shift+clique aplica ao traço. Sem nada selecionado, a cor vira o fundo da página.'),
    ], { aberta: true, chave: 'folha-cores' }));

    root.append(section('Fontes', [
      h('div', { class: 'fd-fontes' }, folha.fontes.map((f) => h('button', {
        class: 'fd-fonte', type: 'button', style: { fontFamily: fontStack(f.nome) },
        title: `Aplicar ${f.nome} ao texto selecionado`, onclick: () => aplicarFonte(f),
      }, h('b', {}, f.nome), h('span', {}, f.uso)))),
      hint('A fonte entra no texto (ou no rótulo da forma) que estiver selecionado.'),
    ], { aberta: true, chave: 'folha-fontes' }));

    // As amostras ficam sobre o fundo DA FOLHA, não sobre o do editor: uma forma branca, numa célula escura, some — e o que
    // importa é ver a peça onde ela vai viver.
    const corFundo = folha.cores.find((c) => c.papel === 'fundo')?.valor || null;
    const sobreOFundo = corFundo ? { background: corFundo } : null;
    root.append(section('Formas', [
      h('div', { class: 'grid shapes' }, folha.formas.map((f) => {
        const prev = makeElement('shape', { shape: f.shape, s: { ...f.s } });
        return h('button', { class: 'cell', type: 'button', style: sobreOFundo, title: `Inserir: ${f.nome}`, onclick: () => inserirForma(f) },
          h('div', { class: 'pv', html: shapeSvg(prev, 52, 52) }));
      })),
      hint('A forma entra na página já com o preenchimento, o traço e o canto da folha.'),
    ], { aberta: true, chave: 'folha-formas' }));

    root.append(section('Desenhos', [
      h('div', { class: 'grid svgs' }, folha.svgs.map((s) => h('button', {
        class: 'cell wide' + (s.bg ? ' bgcell' : ''), type: 'button', title: s.bg ? `${s.nome} (fundo de página)` : s.nome,
        onclick: () => { gravarNoDoc(); return s.bg ? insertSvgBackground(s.code, s.nome) : insertSvg(s.code, s.nome); },
      }, h('div', { class: 'pv', style: !s.bg && corFundo ? { background: corFundo } : null, html: s.code }), h('span', {}, s.nome)))),
      hint('A amostra aparece sobre a cor de fundo da folha. Os marcados como fundo cobrem a página inteira; os demais entram como um desenho que dá para mover e animar.'),
    ], { aberta: true, chave: 'folha-svgs' }));

    const fundo = folha.cores.find((c) => c.papel === 'fundo');
    root.append(h('div', { class: 'pad fd-rodape' },
      fundo ? btn({ label: 'Pôr o fundo da folha na página', ic: 'fit', onClick: () => aplicarCor(fundo, false) }) : null,
      hint('A folha fica gravada no projeto: quem abrir este arquivo depois vê a mesma.')));
  }

  // O documento manda: ao abrir outro arquivo, a folha dele (ou a do modelo de onde veio) é a que aparece.
  let docVisto = null;
  function doDocumento() {
    if (!S.doc || S.doc === docVisto) return false;
    docVisto = S.doc;
    escolher(folhaSugerida(S.doc, FOLHAS)?.id, { gravar: false });
    return true;
  }
  on('struct', doDocumento);
  on('page', () => { if (!doDocumento() && folha) pintar(); });   // a cor do fundo mudou: os avisos de contraste mudam junto
  doDocumento();
  return { refresh: pintar };
}
