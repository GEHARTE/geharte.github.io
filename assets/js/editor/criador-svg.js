// Criador de SVG animado do ArtAtk (estilo "puppet animation"): janela grande sobre o editor que hospeda os MODOS de criação em abas
// (hoje: "Rig de peças"; o modo "Pinos de deformação" se registra em criador-svg-modos.js). A janela só cuida do que é comum a todos:
// abas, "Inserir na página", "Baixar .svg", confirmação ao fechar com alterações e o isolamento do teclado.
//
// O teclado dentro da janela NÃO chega aos atalhos do editor (Delete apagaria o elemento selecionado da página): o keydown é tratado
// na própria janela e o evento para aqui (stopPropagation), igual a editor/imagem.js. Por isso a janela tem tabindex -1 e recebe o foco.
import { h } from '../core/dom.js';
import { downloadBlob } from '../core/util.js';
import { nomeDeArquivo } from '../core/puppet-edicao.js';
import { activeDoc } from './docs.js';
import { btn, toast } from './ui.js';
import { MODOS, registrarModo } from './criador-svg-modos.js';
import { modoRig } from './criador-svg-rig.js';
import { modoPinos } from './criador-svg-pinos.js';

registrarModo(modoRig);
registrarModo(modoPinos);          // pinos de deformação (core/pinos.js): o segundo modo; as abas aparecem sozinhas com 2 modos
export { MODOS, registrarModo };

// O CSS é de um arquivo só (assets/css/criador-svg.css); a janela garante que ele esteja carregado no documento onde abre.
function garantirCss(doc) {
  for (const arq of ['criador-svg.css', 'criador-svg-pinos.css']) {                  // um CSS por modo (cada agente cuidou do seu)
    if (doc.querySelector(`link[data-criador-svg="${arq}"]`)) continue;
    const l = doc.createElement('link');
    l.rel = 'stylesheet'; l.setAttribute('data-criador-svg', arq);
    l.href = new URL(`../../css/${arq}`, import.meta.url).href;
    doc.head.append(l);
  }
}

// Abre o criador. `svg`: SVG de partida (texto) ou null; `nome`: nome sugerido; `aoInserir(svgTexto, nome)`: chamado com o SVG ANIMADO pronto
// (ainda sem passar por sanitizeSvg: quem insere na página deve sanitizar). Devolve { fechar }.
export function abrirCriadorDeSvg({ svg = null, nome = 'SVG animado', aoInserir } = {}) {
  const doc = activeDoc();
  garantirCss(doc);
  const montados = new Map();                                   // id do modo → instância (cada aba guarda o próprio estado)
  const painel = new Map();                                     // id do modo → container
  let ativo = null;

  const abas = h('div', { class: 'seg2 cs-abas', role: 'tablist' });
  const corpo = h('div', { class: 'modal-b cs-corpo' });
  const ctxDe = () => ({ svg, nome, avisarMudanca: () => {}, aviso: (m, tipo) => toast(m, tipo === 'err' ? 'err' : '') });

  function ativar(id) {
    const modo = MODOS.find((m) => m.id === id) || MODOS[0];
    if (!modo) return;
    ativo = modo.id;
    for (const [mid, el] of painel) el.hidden = mid !== modo.id;
    if (!montados.has(modo.id)) {
      const el = h('div', { class: 'cs-modo', 'data-modo': modo.id });
      painel.set(modo.id, el); corpo.append(el);
      try { montados.set(modo.id, modo.montar(el, ctxDe())); }
      catch (e) { el.append(h('p', { class: 'hint bad' }, `Não consegui abrir este modo: ${e.message || e}`)); montados.set(modo.id, null); }
    }
    for (const [mid, el] of painel) el.hidden = mid !== modo.id;
    abas.querySelectorAll('button').forEach((b) => { const on = b.dataset.modo === modo.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    montados.get(modo.id)?.focar?.();
  }
  for (const m of MODOS) abas.append(h('button', { type: 'button', role: 'tab', 'data-modo': m.id, onclick: () => ativar(m.id) }, m.rotulo));
  abas.hidden = MODOS.length < 2;                               // com um modo só, as abas seriam enfeite

  const instanciaAtiva = () => montados.get(ativo) || null;
  const temAlteracoes = () => [...montados.values()].some((m) => m?.temAlteracoes?.());
  const sair = () => { for (const m of montados.values()) { try { m?.destruir?.(); } catch { /* já fora da tela */ } } fundo.remove(); };
  const fechar = () => { if (temAlteracoes() && !confirm('Descartar a animação que você está criando?')) return; sair(); };

  function gerar() {
    const m = instanciaAtiva();
    let texto = '';
    try { texto = m?.exportarSvg?.() || ''; } catch (e) { toast(`Não consegui gerar o SVG: ${e.message || e}`, 'err'); return null; }
    if (!texto) { toast('Ainda não há nada para exportar: carregue um SVG ou escolha um exemplo.', 'err'); return null; }
    return { texto, nome: m.nome?.() || nome || 'SVG animado' };
  }
  function inserir() {
    const r = gerar();
    if (!r) return;
    try { aoInserir?.(r.texto, r.nome); } catch (e) { toast(`Não consegui inserir: ${e.message || e}`, 'err'); return; }
    sair();
  }
  function baixar() {
    const r = gerar();
    if (!r) return;
    downloadBlob(`${nomeDeArquivo(r.nome)}.svg`, new Blob([r.texto], { type: 'image/svg+xml' }));
    toast('SVG animado salvo na pasta de Downloads.', 'ok');
  }

  const fundo = h('div', { class: 'modal-back cs-back', tabindex: '-1' },
    h('div', { class: 'modal wide cs-modal', role: 'dialog', 'aria-label': 'Criador de SVG animado' },
      h('header', {}, h('b', {}, 'Criador de SVG animado'), abas, btn({ ic: 'x', title: 'Fechar', onClick: fechar, cls: 'icon' })),
      corpo,
      h('footer', {}, btn({ label: 'Cancelar', onClick: fechar }), btn({ label: 'Baixar .svg', ic: 'download', onClick: baixar }), btn({ label: 'Inserir na página', ic: 'check', cls: 'primary', onClick: inserir }))));
  fundo.addEventListener('keydown', (e) => {                    // na janela (não no documento): o evento para aqui e não chega aos atalhos do editor
    e.stopPropagation();
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); fechar(); }
  });
  doc.body.append(fundo);
  ativar(MODOS[0]?.id);
  fundo.focus();
  return { fechar: sair };
}
