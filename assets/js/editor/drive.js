// Aba "Drive" da biblioteca: os materiais da pessoa, na pasta "Geharte — materiais" do Google Drive dela.
// Enviar (botão ou arrastar), ver, inserir imagem na página, importar projeto (.json) e abrir o resto no Drive.
import { h } from '../core/dom.js';
import { S } from './state.js';
import { btn, toast } from './ui.js';
import { icon } from './icons.js';
import { getDrive, uploadAll } from '../core/drive-ui.js';
import { FOLDER_NAME, folderUrl, humanSize, isImage, isProject } from '../core/drive.js';
import { insertImageFile } from './tools.js';
import { importProject } from './publish.js';

const fmtQuota = (c) => (c.limite ? `${humanSize(c.usado)} de ${humanSize(c.limite)} usados no seu Drive` : `${humanSize(c.usado)} usados no seu Drive`);

export function driveTab(body) {
  const view = h('div', { class: 'drv' });
  body.append(view);
  let drive = null, info = null, files = [], next = null, folder = null;
  const uploads = new Map();   // índice -> estado de cada arquivo em envio
  let alive = true;

  const fail = (e) => { if (alive) view.replaceChildren(h('p', { class: 'hint bad pad' }, e.message || String(e)), btn({ label: 'Tentar de novo', cls: 'sm', onClick: boot })); };

  async function connect() {
    try {
      info = await drive.connectAs();
      await load(true);
    } catch (e) { disconnected(e.message); }
  }

  function disconnected(erro) {
    view.replaceChildren(
      h('div', { class: 'pad drv-intro' },
        h('p', {}, h('b', {}, 'Seus materiais, sempre à mão.'), ' Imagens, fontes, PSD e PDF ficam no ', h('b', {}, 'seu Google Drive institucional'), `, na pasta “${FOLDER_NAME}” — e aparecem aqui enquanto você edita.`),
        h('p', { class: 'hint' }, 'O Geharte só enxerga o que for enviado por aqui. O resto do seu Drive continua invisível para o site.'),
        erro ? h('p', { class: 'hint bad' }, erro) : null,
        btn({ label: drive?.wasConnected() ? 'Reconectar ao Drive' : 'Conectar ao Google Drive', ic: 'cloud', cls: 'primary', onClick: connect })));
  }

  async function load(reset) {
    if (reset) { files = []; next = null; }
    view.replaceChildren(h('p', { class: 'hint pad' }, 'Abrindo o seu Drive…'));
    try {
      if (!info) info = await drive.about();
      folder ||= await drive.ensureFolder();
      const r = await drive.list({ pageToken: next });
      files = reset ? r.files : [...files, ...r.files]; next = r.next;
      if (alive) paint();
    } catch (e) {
      if (e.reason === 'expired' || e.reason === 'noToken') disconnected('A conexão com o Drive expirou. Conecte de novo.');
      else fail(e);
    }
  }

  async function send(list) {
    const arr = [...list];
    if (!arr.length) return;
    uploads.clear();
    paint();
    const ok = await uploadAll(drive, arr, (i, st) => { uploads.set(i, st); paintUploads(); });
    if (ok.length) toast(`${ok.length} arquivo${ok.length > 1 ? 's' : ''} no Drive.`, 'ok');
    uploads.clear();
    await load(true);
  }

  async function use(f) {
    try {
      if (isImage(f.mimeType)) {
        toast('Trazendo a imagem do Drive…');
        const blob = await drive.download(f.id);
        await insertImageFile(new File([blob], f.name, { type: f.mimeType }));
      } else if (isProject(f)) {
        toast('Trazendo o projeto do Drive…');
        const blob = await drive.download(f.id);
        await importProject(new File([blob], f.name, { type: 'application/json' }));
      } else if (f.webViewLink) window.open(f.webViewLink, '_blank', 'noopener');
    } catch (e) { toast(e.message, 'err'); }
  }

  const upBox = h('div', { class: 'drv-ups' });
  function paintUploads() {
    upBox.replaceChildren(...[...uploads.values()].map((u) => h('div', { class: `drv-up ${u.estado}` },
      h('span', {}, u.nome),
      u.estado === 'erro' ? h('em', {}, u.erro) : h('i', { style: { width: Math.round(u.progresso * 100) + '%' } }))));
  }

  function card(f) {
    const act = isImage(f.mimeType) ? 'Inserir na página' : isProject(f) ? 'Importar projeto' : 'Abrir no Drive';
    const thumb = h('div', { class: 'drv-th' });
    if (f.thumbnailLink) thumb.append(h('img', { src: f.thumbnailLink, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', onerror: (e) => e.target.replaceWith(h('span', { html: icon('image', 22) })) }));
    else thumb.append(h('span', { html: icon(isProject(f) ? 'stack' : 'download', 22) }));
    return h('button', { class: 'drv-file', title: `${f.name} — ${act}`, onclick: () => use(f) }, thumb,
      h('b', {}, f.name), h('small', {}, [humanSize(f.size), act].filter(Boolean).join(' · ')));
  }

  function paint() {
    const pick = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { send(pick.files); pick.value = ''; } });
    view.replaceChildren(
      h('div', { class: 'pad drv-head' },
        h('b', {}, info?.email || 'Google Drive'),
        h('span', { class: 'drv-sp' }),
        btn({ ic: 'reset', title: 'Atualizar a lista', cls: 'icon sm', onClick: () => load(true) }),
        btn({ ic: 'x', title: 'Desconectar o Drive neste navegador', cls: 'icon sm', onClick: () => { drive.disconnect(); info = null; folder = null; disconnected(); } })),
      info?.cota ? h('p', { class: 'hint pad' }, fmtQuota(info.cota)) : null,
      h('div', { class: 'pad' },
        btn({ label: 'Enviar arquivos', ic: 'upload', cls: 'primary', onClick: () => pick.click() }), pick,
        h('p', { class: 'hint' }, 'Ou arraste arquivos para cá. ', h('a', { href: folder ? folderUrl(folder) : '#', target: '_blank', rel: 'noopener' }, 'Abrir a pasta no Drive ↗'))),
      upBox,
      files.length ? h('div', { class: 'drv-grid' }, files.map(card)) : h('p', { class: 'hint pad' }, 'A pasta ainda está vazia. Envie os materiais que você vai usar nas suas páginas.'),
      next ? h('div', { class: 'pad' }, btn({ label: 'Mostrar mais', cls: 'sm', onClick: () => load(false) })) : null);
    paintUploads();
  }

  // arrastar arquivos para a aba
  body.addEventListener('dragover', (e) => { if (drive?.isConnected() && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); body.classList.add('drop'); } });
  body.addEventListener('dragleave', () => body.classList.remove('drop'));
  body.addEventListener('drop', (e) => { body.classList.remove('drop'); if (drive?.isConnected() && e.dataTransfer?.files?.length) { e.preventDefault(); send(e.dataTransfer.files); } });

  async function boot() {
    view.replaceChildren(h('p', { class: 'hint pad' }, 'Carregando…'));
    try { drive = await getDrive(S.slug); } catch (e) { return fail(e); }
    if (drive.isConnected()) load(true); else disconnected();
  }
  boot();
  return () => { alive = false; };   // chamado ao trocar de aba
}

// "Salvar cópia no Drive" (menu ⋯): grava o projeto como geharte-<usuário>-<id>.json na pasta de materiais.
export async function saveCopyToDrive(project) {
  const drive = await getDrive(S.slug);
  if (!drive.isConnected()) await drive.connectAs();
  const nome = `geharte-${S.slug}-${S.doc.id}.json`;
  await drive.saveText(nome, JSON.stringify(project));
  return nome;
}
