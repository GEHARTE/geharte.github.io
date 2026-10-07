// Botão "Opções" (logo depois da logo, na barra de cima): o que se faz com o ARQUIVO e onde ficam os dados da pessoa.
//   Novo arquivo · Salvar em PDF · Exportar/Importar projeto · Salvar cópia no Drive · Onde ficam os meus dados
// "Onde ficam os meus dados" mostra, sem jargão, o que está neste navegador (rascunhos, imagens, preferências, disposição dos
// painéis), o que está fora (Drive, site publicado) e se o navegador protege tudo isso de uma limpeza automática.
import { h } from '../core/dom.js';
import { Store } from '../core/store.js';
import { descreverDados } from '../core/dados-locais.js';
import { chaveLayout, chaveSync } from './dock-layout.js';
import { S } from './state.js';
import { popMenu } from './dock.js';
import { modal, btn, toast } from './ui.js';
import { goToNovoArquivo } from './nav.js';
import { openExportPdf } from './pdf.js';
import { exportProject, importProject, buildProject } from './publish.js';
import { saveCopyToDrive } from './drive.js';

const lerLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const tamanhoJson = (o) => { try { return JSON.stringify(o).length; } catch { return 0; } };

// Mede o que o editor guarda neste navegador (nada sai daqui).
export async function medirDados() {
  const slug = S.slug;
  const [docs, imgs] = await Promise.all([Store.listDocs(slug).catch(() => []), Store.listAssets(slug).catch(() => [])]);
  let uso = null, persistente = null;
  try { const e = await navigator.storage?.estimate?.(); if (e && Number.isFinite(e.usage)) uso = { usado: e.usage, cota: e.quota || 0 }; } catch { /* sem a API */ }
  try { persistente = (await navigator.storage?.persisted?.()) ?? null; } catch { /* sem a API */ }
  let modelos = 0; try { const m = JSON.parse(lerLS('artatk.meusmodelos') || '[]'); modelos = Array.isArray(m) ? m.length : Object.keys(m?.modelos || m || {}).length; } catch { /* vazio */ }
  const prefs = S.host?.preferencias;
  return {
    origem: location.host || location.origin,
    docs: { n: docs.length, bytes: docs.reduce((s, d) => s + tamanhoJson(d.doc), 0) },
    imagens: { n: imgs.length, bytes: imgs.reduce((s, a) => s + (a.blob?.size || 0), 0) },
    modelos, layout: { gravado: !!lerLS(chaveLayout(slug)), conta: prefs && lerLS(chaveSync(slug)) === '1' ? (prefs.rotulo || 'conta') : null },
    regua: !!lerLS('artatk.regua'), secoes: !!lerLS('artatk.secoes'), sessao: !!S.host?.sair,
    drive: S.host?.capacidades.drive ? { conectado: await driveConectado() } : null, publicar: !!S.host?.capacidades.publicar,
    uso, persistente,
  };
}
async function driveConectado() { try { const { getDrive } = await import('../core/drive-ui.js'); return (await getDrive(S.slug)).isConnected(); } catch { return false; } }

export async function abrirDadosLocais() {
  const corpo = h('div', {}, h('p', { class: 'hint' }, 'Medindo…'));
  const m = modal({ title: 'Onde ficam os meus dados', body: corpo, wide: true, actions: [] });
  const pintar = async () => {
    const info = await medirDados(), d = descreverDados(info);
    const tab = (s) => [h('h4', { class: 'dados-sec' }, s.titulo), h('table', { class: 'dados-tab' }, h('tbody', {}, s.linhas.map((l) => h('tr', {},
      h('th', { scope: 'row' }, l.rotulo), h('td', {}, h('b', {}, l.onde), h('small', { class: l.estado === 'ok' ? 'dados-ok' : l.estado === 'aviso' ? 'dados-aviso' : '' }, l.detalhe))))))];
    const acoes = [btn({ label: 'Exportar projeto (.json)', ic: 'download', onClick: () => exportProject() })];
    if (info.drive) acoes.push(btn({ label: 'Salvar cópia no Drive', ic: 'cloud', onClick: copiarParaDrive }));
    if (info.persistente === false && navigator.storage?.persist) acoes.push(btn({ label: 'Proteger estes dados', ic: 'lock', onClick: async () => { const ok = await navigator.storage.persist().catch(() => false); toast(ok ? 'Pronto: o navegador não vai apagar estes dados sozinho.' : 'O navegador não concordou agora. Ele costuma aceitar depois de você usar o site por um tempo.', ok ? 'ok' : ''); pintar(); } }));
    corpo.replaceChildren(h('p', { class: 'dados-nota' }, d.nota), ...d.secoes.flatMap(tab), h('div', { class: 'btnrow', style: { marginTop: '14px' } }, acoes));
  };
  pintar().catch((e) => corpo.replaceChildren(h('p', { class: 'hint bad' }, `Não consegui medir: ${e?.message || e}`)));
  return m;
}

async function copiarParaDrive() {
  try { toast('Salvando no seu Drive…'); const nome = await saveCopyToDrive(await buildProject()); toast(`Cópia salva no Drive: ${nome}`, 'ok'); } catch (e) { toast(e.message || String(e), 'err'); }
}
function importar() {
  const inp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); if (f) importProject(f); });
  document.body.append(inp); inp.click();
}

export function abrirOpcoes(ancora) {
  const conta = S.host?.preferencias && lerLS(chaveSync(S.slug)) === '1';
  popMenu(ancora, [
    { label: 'Novo arquivo…', icon: 'plus', onClick: goToNovoArquivo },
    { label: 'Salvar em PDF…', icon: 'download', onClick: openExportPdf },
    '-',
    { label: 'Exportar projeto (.json)', icon: 'download', onClick: () => exportProject() },
    { label: 'Importar projeto…', icon: 'upload', onClick: importar },
    ...(S.host?.capacidades.drive ? [{ label: 'Salvar cópia no Drive', icon: 'cloud', onClick: copiarParaDrive }] : []),
    '-',
    // o que o editor guarda e onde: um clique em qualquer linha abre os detalhes
    { label: 'Rascunhos e imagens', icon: 'folder', hint: 'neste navegador', onClick: abrirDadosLocais },
    { label: 'Disposição dos painéis', icon: 'panels', hint: conta ? 'neste navegador e na conta' : 'neste navegador', onClick: abrirDadosLocais },
    { label: 'Preferências do editor', icon: 'wand', hint: 'neste navegador', onClick: abrirDadosLocais },
    { label: 'Onde ficam os meus dados…', icon: 'eye', onClick: abrirDadosLocais },
  ]);
}
