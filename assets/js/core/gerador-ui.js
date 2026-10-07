// Gerador de modelos embutido: (1) salva a página aberta como modelo; (2) gera um modelo a partir de uma especificação
// em JSON (o mesmo formato de modelos/<id>/spec.json e de tools/gerar-modelos.mjs). Usa <dialog> nativo para funcionar
// no editor e no painel de arquivos.
import { h } from './dom.js';
import { modeloDeDoc, gerarDeSpec, slugModelo } from './modelos.js';
import { miniaturaModelo, baixarModelo } from './galeria.js';

export const ESPEC_EXEMPLO = {
  nome: 'Meu modelo',
  descricao: 'Topo, destaque, três cartões e rodapé.',
  categoria: 'Meus modelos',
  tema: { fundo: '#fcfbf6', escuro: '#0e3e20', acento: '#86a3fc', sobreAcento: '#0e3e20', fonteTitulo: 'Libre Caslon Text', fonteTexto: 'Andika' },
  secoes: [
    { tipo: 'topo', marca: 'Minha marca', links: ['Início', 'Sobre', 'Contato'] },
    { tipo: 'hero', fundo: 'claro', imagem: true, kicker: 'Apresentação', titulo: 'Um título que chama atenção', texto: 'Uma frase de apoio explicando o que a página oferece.', botao: { rotulo: 'Saiba mais', href: '#' } },
    { tipo: 'cards', titulo: 'O que oferecemos', colunas: 3, itens: [{ titulo: 'Um', texto: 'Texto curto.' }, { titulo: 'Dois', texto: 'Texto curto.' }, { titulo: 'Três', texto: 'Texto curto.' }] },
    { tipo: 'rodape', texto: 'Minha marca · 2026' },
  ],
};

const AJUDA = `Seções (campo "tipo"):
  topo      { marca, links:[ "Texto" | {rotulo, href} ] }
  hero      { fundo:"claro"|"escuro"|"acento", imagem:true|false, kicker, titulo, texto, botao:{rotulo, href} }
  texto     { titulo, paragrafos:[ "…" ] }
  cards     { titulo, colunas:1-4, itens:[ {titulo, texto, href} ] }
  faixa     { texto, fundo:"escuro"|"acento" }
  galeria   { titulo, quantidade:1-12, colunas:2-4 }   (quadros "Imagem" para trocar)
  chamada   { titulo, texto, botao:{rotulo, href} }
  rodape    { texto, links:[ … ] }
Tema (opcional): fundo, texto, suave, escuro, sobreEscuro, acento, sobreAcento, superficie, fonteTitulo, fonteTexto, raio.
Cada seção gera o layout de PC (1200) e o de celular (390).`;

// opts: { docAtual?, meus, aoSalvar?(modelo), onUsar?(modelo) }
export function abrirGerador({ docAtual, meus, aoSalvar, onUsar }) {
  let aba = docAtual ? 'pagina' : 'spec';
  let ultimo = null;                                        // { modelo, avisos } pronto para salvar/usar
  const msg = h('div', { class: 'gal-msg', hidden: true, role: 'status' });
  const mostra = (t, tipo = '') => { msg.textContent = t; msg.className = `gal-msg ${tipo}`; msg.hidden = !t; };
  const dlg = h('dialog', { class: 'gal-dlg', 'aria-label': 'Gerar modelo' });
  const corpo = h('div', { class: 'gal-dlg-c' });
  dlg.append(corpo);

  const nome = h('input', { type: 'text', maxlength: '80', value: docAtual?.title ? `${docAtual.title} (modelo)` : '', 'aria-label': 'Nome do modelo' });
  const desc = h('input', { type: 'text', maxlength: '200', 'aria-label': 'Descrição do modelo' });
  const catg = h('input', { type: 'text', maxlength: '40', value: 'Meus modelos', list: 'gal-cats-lista', 'aria-label': 'Categoria' });
  const spec = h('textarea', { spellcheck: 'false', 'aria-label': 'Especificação do modelo em JSON' });
  spec.value = JSON.stringify(ESPEC_EXEMPLO, null, 2);
  const previa = h('div', { class: 'gal-previa' });

  const salvar = (e) => {
    try {
      meus.salvar(ultimo.modelo); aoSalvar?.(ultimo.modelo);
      mostra(`Modelo “${ultimo.modelo.nome}” salvo em Meus modelos.`, 'ok');
      e.target.disabled = true;
    } catch (er) { mostra(er.message, 'erro'); }
  };

  function preparar() {
    ultimo = null; previa.replaceChildren();
    if (aba === 'pagina') {
      if (!nome.value.trim()) { mostra('Dê um nome ao modelo.', 'erro'); return false; }
      const r = modeloDeDoc(docAtual, { nome: nome.value, descricao: desc.value, categoria: catg.value || 'Meus modelos', id: slugModelo(nome.value) });
      ultimo = r; mostra(r.avisos.join(' '), r.avisos.length ? '' : 'ok');
    } else {
      let obj;
      try { obj = JSON.parse(spec.value); } catch (er) { mostra(`O JSON tem um erro: ${er.message}`, 'erro'); return false; }
      const r = gerarDeSpec(obj);
      if (!r.modelo) { mostra(r.erros.join(' · '), 'erro'); return false; }
      ultimo = r; mostra(r.avisos.length ? r.avisos.join(' ') : `Modelo gerado: ${r.modelo.doc.elements.length} elementos, página de ${r.modelo.doc.page.h.d}px no PC e ${r.modelo.doc.page.h.m}px no celular.`, r.avisos.length ? '' : 'ok');
    }
    previa.append(miniaturaModelo(ultimo.modelo));
    return true;
  }

  function pinta() {
    const abas = docAtual ? h('div', { class: 'gal-abas', role: 'tablist' },
      h('button', { type: 'button', class: 'gal-btn', role: 'tab', 'aria-selected': String(aba === 'pagina'), onclick: () => { aba = 'pagina'; ultimo = null; mostra(''); pinta(); } }, 'Da página aberta'),
      h('button', { type: 'button', class: 'gal-btn', role: 'tab', 'aria-selected': String(aba === 'spec'), onclick: () => { aba = 'spec'; ultimo = null; mostra(''); pinta(); } }, 'De uma especificação')) : null;
    const gerar = h('button', { type: 'button', class: 'gal-btn', onclick: () => { preparar(); pinta(); } }, aba === 'pagina' ? 'Ver o modelo' : 'Gerar prévia');
    const podeAgir = !!ultimo;
    corpo.replaceChildren(...[
      h('h2', {}, 'Gerar modelo'),
      abas,
      aba === 'pagina'
        ? [h('p', {}, 'Guarda a página que você está editando como um modelo reutilizável. Imagens enviadas viram quadros “Imagem” (modelos não carregam arquivos).'),
          h('label', {}, 'Nome', nome), h('label', {}, 'Descrição (opcional)', desc), h('label', {}, 'Categoria', catg),
          h('datalist', { id: 'gal-cats-lista' }, ['Meus modelos', 'Blog', 'MUVVI', 'Pessoal'].map((c) => h('option', { value: c })))]
        : [h('p', {}, 'Descreva as seções da página em JSON e o ArtAtk monta o layout de PC e de celular. Ideal para transformar um briefing de design em um ponto de partida.'),
          h('label', {}, 'Especificação (JSON)', spec), h('details', {}, h('summary', {}, 'Seções e campos disponíveis'), h('pre', {}, AJUDA))],
      msg, podeAgir ? previa : null,
      h('div', { class: 'gal-dlg-rodape' },
        h('button', { type: 'button', class: 'gal-btn', onclick: () => dlg.close() }, 'Fechar'),
        gerar,
        podeAgir ? h('button', { type: 'button', class: 'gal-btn', onclick: () => baixarModelo(ultimo.modelo) }, 'Baixar .json') : null,
        podeAgir ? h('button', { type: 'button', class: 'gal-btn', onclick: salvar }, 'Salvar em Meus modelos') : null,
        podeAgir && onUsar ? h('button', { type: 'button', class: 'gal-btn primario', onclick: () => { dlg.close(); onUsar(ultimo.modelo); } }, 'Usar agora') : null),
    ].flat().filter(Boolean));
  }
  pinta();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
