// Exportar → PDF (REQ-AK, AK-40/42/43): abre o visualizador em modo de impressão com o RASCUNHO atual (o que está na tela, publicado ou não).
// O navegador faz o PDF ("Salvar como PDF"): vetorial, texto selecionável, fontes embutidas, sem servidor. A conversão em si está em
// core/pdf.js e perfil.js; aqui só há o diálogo e a abertura da aba.
//   · página para site / tela: uma página de PDF do tamanho da página, no layout de PC ou de celular;
//   · papel (A5, A4…): o papel final, ou "para gráfica" (com a sangria) e, opcionalmente, MARCAS DE CORTE nos 4 cantos.
import { h } from '../core/dom.js';
import { BASE } from '../core/util.js';
import { viewerQuery, pageH, ehFixa, ehUnico } from '../core/model.js';
import { tamanhoPagina, folhaPdf, urlImpressao, ALTURA_MAX } from '../core/pdf.js';
import { sangriaMm, margemMm, avisosDeImpressao } from '../core/gabarito.js';
import { rotuloDaPagina } from '../core/formatos.js';
import { S, saveNow } from './state.js';
import { modal, seg, toast, btn, toggle } from './ui.js';
import { icon } from './icons.js';

export function openExportPdf() {
  const papel = ehFixa(S.doc);
  let dev = !ehUnico(S.doc) && S.dev === 'm' ? 'm' : 'd';
  let comSangria = papel && sangriaMm(S.doc) > 0, marcas = papel && sangriaMm(S.doc) > 0;      // projeto com sangria já sai "para gráfica"
  const info = h('p', { class: 'hint' }), avisos = h('div');

  const atualiza = () => {
    if (papel) {
      const f = folhaPdf(S.doc, { sangria: comSangria, marcas });
      const base = `Papel: ${rotuloDaPagina(S.doc.page)}. Folha do PDF: ${f.folhaMm.w} × ${f.folhaMm.h} mm`;
      info.textContent = marcas || comSangria
        ? `${base}${comSangria ? ', com a sangria' : ''}${marcas ? ' e marcas de corte nos 4 cantos' : ''}.`
        : `${base} (só a página final, recortada no corte).`;
      const av = avisosDeImpressao(S.doc), n = av.foraDaMargem.length + av.semSangria.length + av.foraDaPagina.length;
      avisos.replaceChildren(n ? h('p', { class: 'aviso-imp' }, `A conferência para a gráfica tem ${n} ${n > 1 ? 'avisos' : 'aviso'} (painel “Sangria e margem segura”, com a página selecionada). Dá para exportar assim, mas vale resolver antes.`) : '');
    } else {
      const { w, h: alt } = tamanhoPagina(S.doc, dev);
      const real = Math.round(pageH(S.doc, dev === 'm' && !ehUnico(S.doc) ? 'm' : 'd'));
      info.textContent = `Papel do tamanho da página: ${w} × ${alt} px — ${real > ALTURA_MAX ? 'passa do limite de uma página de PDF, então continua em mais de uma página' : 'uma página só'}. O PDF mostra a página como ela fica depois que tudo apareceu (animações no quadro final).`;
    }
  };

  const corpo = [];
  const tg = h('div');                                         // chave das marcas de corte (redesenhada quando a escolha muda)
  const renderToggle = () => tg.replaceChildren(toggle({ label: 'Marcas de corte nos 4 cantos', value: marcas, onChange: (v) => { marcas = v; atualiza(); } }));
  if (papel) {
    const temSangria = sangriaMm(S.doc) > 0;
    corpo.push(
      h('p', { class: 'hint' }, temSangria ? `Este arquivo tem sangria de ${sangriaMm(S.doc)} mm${margemMm(S.doc) > 0 ? ` e margem segura de ${margemMm(S.doc)} mm` : ''}.` : 'Este arquivo não tem sangria. Para gráfica, defina a sangria no painel da página (3 mm é o padrão).'),
      seg({ value: comSangria ? 's' : 'f', options: [['f', 'Página final', 'Só o papel, recortado no corte'], ['s', 'Para gráfica (com sangria)', 'Inclui a área além do corte']], onChange: (v) => { comSangria = v === 's' && temSangria; if (v === 's' && !temSangria) toast('Este arquivo não tem sangria: defina no painel da página.', 'err'); atualiza(); renderToggle(); } }),
    );
    renderToggle();
    corpo.push(tg);
  } else if (!ehUnico(S.doc)) {
    corpo.push(h('p', { class: 'hint' }, 'Versão da página:'), seg({ value: dev, options: [['d', icon('monitor') + ' Computador', 'Layout de PC (1200 px)'], ['m', icon('phone') + ' Celular', 'Layout de celular (390 px)']], onChange: (v) => { dev = v; atualiza(); } }));
  }
  corpo.push(info, avisos);
  if (S.doc.kind === 'site') corpo.push(h('p', { class: 'hint' }, `Projeto de site: sai a aba aberta (“${S.doc.abas.find((a) => a.id === S.doc.abaAtiva)?.nome || ''}”). Para as outras, abra cada aba e exporte de novo.`));
  atualiza();

  const gerar = async () => {
    // abre a aba já, no clique (senão o bloqueador de pop-up segura): a página só carrega o rascunho depois de salvar
    const aba = window.open('about:blank', '_blank');
    if (!aba) return toast('O navegador bloqueou a nova aba. Libere pop-ups para este site e tente de novo.', 'err');
    try {
      await saveNow();
      aba.location.href = urlImpressao({ base: new URL(BASE, location.href).href, query: viewerQuery(S.slug, S.doc), dev, rascunho: true, auto: true, sangria: papel && comSangria, marcas: papel && marcas, aba: S.doc.kind === 'site' ? S.doc.abaAtiva : null });
      m.close();
    } catch (e) { aba.close(); toast('Não consegui preparar o PDF: ' + (e?.message || e), 'err'); }
  };

  const m = modal({
    title: 'Exportar PDF',
    body: [
      ...corpo,
      h('ul', { class: 'hint' },
        h('li', {}, 'Vai abrir uma aba com a janela de impressão. Em “Destino”, escolha “Salvar como PDF”.'),
        h('li', {}, 'Desligue “Cabeçalhos e rodapés” e deixe as margens em “Nenhuma”; o tamanho do papel já vem certo.'),
        h('li', {}, 'O texto continua selecionável e os links continuam clicáveis.')),
    ],
    actions: [btn({ label: 'Cancelar', onClick: () => m.close() }), btn({ label: 'Gerar PDF', ic: 'download', cls: 'primary', onClick: gerar })],
  });
}
