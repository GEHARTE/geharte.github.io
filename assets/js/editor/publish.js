// Salvar fora do navegador: exportar/importar projeto, publicar no GitHub, preview PC/celular.
import { h } from '../core/dom.js';
import { BASE, blobToDataURL, dataURLToBlob, downloadBlob } from '../core/util.js';
import { Store } from '../core/store.js';
import { S, saveNow, emit } from './state.js';
import { normalizeDoc, PROFILE_ID, publishDir, viewerQuery, publisherName, KINDS } from '../core/model.js';
import { goToDoc } from './nav.js';
import { publishedUrl, siteHost } from '../core/site.js';
import { btn, modal, toast } from './ui.js';
import { icon } from './icons.js';

const usedAssetIds = () => [...new Set(S.doc.elements.filter((e) => e.t === 'image' && e.asset).map((e) => e.asset))];

// ---------- exportar / importar (backup e plano B de publicação) ----------
export async function buildProject() {
  const assets = {};
  for (const id of usedAssetIds()) {
    const a = S.assets.get(id);
    if (a) assets[id] = { ext: a.ext, mime: a.mime, w: a.w, h: a.h, data: await blobToDataURL(a.blob) };
  }
  return { format: 'geharte-projeto', v: 2, slug: S.slug, id: S.doc.id, kind: S.doc.kind, doc: S.doc, assets };
}

export async function exportProject() {
  const out = await buildProject();
  downloadBlob(`geharte-${S.slug}-${S.doc.id}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
}

export async function importProject(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Esse arquivo não é um projeto válido.', 'err'); return; }
  if (data.format !== 'geharte-projeto' || !data.doc) { toast('Esse arquivo não é um projeto do Geharte.', 'err'); return; }
  for (const [id, a] of Object.entries(data.assets || {})) {
    const blob = await dataURLToBlob(a.data);
    const meta = { ext: a.ext, mime: a.mime, w: a.w, h: a.h };
    await Store.putAsset(S.slug, id, blob, meta);
    S.assets.set(id, { ...meta, blob, url: URL.createObjectURL(blob) });
  }
  const doc = normalizeDoc(data.doc, S.slug);
  doc.owner = S.slug;
  if (data.kind && KINDS[data.kind]) doc.kind = data.kind;
  if (doc.kind === 'pagina' && !S.canSite) { toast('Só quem organiza o site pode importar páginas do site.', 'err'); return; }
  if (data.id && doc.kind === 'artigo') doc.id = String(data.id).replace(/[^a-z0-9-]/g, '') || doc.id;
  if (doc.kind === 'perfil') doc.id = PROFILE_ID;
  normalizeDoc(doc, S.slug);
  await saveNow();                                   // não perder o que está aberto agora
  const existing = await Store.loadDoc(S.slug, doc.id);
  if (existing && !confirm(`Já existe “${existing.title || doc.id}” no seu inventário com este mesmo identificador. Substituir pela página importada?`)) return;
  if (doc.id === S.doc.id) S.deleted = true;           // o que está na tela vai ser substituído: não regravar por cima
  await Store.saveDoc(S.slug, doc);
  toast('Projeto importado para o seu inventário.', 'ok');
  await goToDoc(doc.id);
}

// ---------- publicar no GitHub ----------
const KEY = { token: 'geharte.ghtoken', repo: 'geharte.repo', branch: 'geharte.branch' };
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return ''; } };

async function siteConfig() {
  try { return await (await fetch(BASE + 'config.json', { cache: 'no-cache' })).json(); } catch { return {}; }
}

const ghApi = (repo, path) => `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const ghFail = async (r, what) => { let m = ''; try { m = (await r.json()).message; } catch { /* sem corpo */ } return new Error(`${what}: ${r.status}${m ? ' — ' + m : ''}`); };
const b64utf8 = (b) => decodeURIComponent(escape(atob(String(b).replace(/\s/g, ''))));

async function putFile({ repo, branch, token, path, b64, message, skipIfExists }) {
  const api = ghApi(repo, path), hd = ghHeaders(token);
  const g = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: hd });
  let sha;
  if (g.ok) { if (skipIfExists) return 'existe'; sha = (await g.json()).sha; }
  else if (g.status !== 404) throw await ghFail(g, 'Não consegui consultar o repositório');
  const r = await fetch(api, { method: 'PUT', headers: { ...hd, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64, branch, ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw await ghFail(r, 'Falha ao gravar ' + path);
  return 'ok';
}

// O que está gravado AGORA no repositório (não no site, que atrasa 1–2 min): serve para saber se outra pessoa publicou antes de nós.
async function getRepoJson({ repo, branch, token, path }) {
  const g = await fetch(`${ghApi(repo, path)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(token) });
  if (g.status === 404) return null;
  if (!g.ok) throw await ghFail(g, 'Não consegui consultar o repositório');
  try { return JSON.parse(b64utf8((await g.json()).content)); } catch { return null; }
}

const utf8b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const fmtWhen = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const row = (k, ...v) => h('div', { class: 'pub-row' }, h('span', {}, k), h('div', {}, ...v));

export async function openPublish() {
  await saveNow();
  const cfg = await siteConfig();
  const pagina = S.doc.kind === 'pagina';
  if (pagina && !S.canSite) { toast('Só quem organiza o site pode publicar páginas do site.', 'err'); return; }
  const derived = S.doc.elements.filter((e) => !e.f.m).length;
  const empty = !S.doc.elements.length;
  const dir = publishDir(S.slug, S.doc);
  const host = siteHost(cfg) || 'o site do Geharte';
  const url = publishedUrl(cfg, S.slug, S.doc, S.siteEntry);

  const repo = h('input', { value: ls(KEY.repo) || cfg.repo || '', placeholder: 'organizacao/repositorio' });
  const branch = h('input', { value: ls(KEY.branch) || cfg.branch || 'main' });
  const token = h('input', { type: 'password', value: ls(KEY.token), placeholder: 'github_pat_…', autocomplete: 'off' });
  const remember = h('input', { type: 'checkbox', checked: !!ls(KEY.token) });
  const log = h('pre', { class: 'plog' });
  const link = h('div', { class: 'plink' });
  const clash = h('div', { class: 'warnbox', hidden: true });

  const warn = [];
  if (empty) warn.push('A página está vazia.');
  if (derived && S.doc.elements.length) warn.push(`${derived} elemento(s) ainda seguem o layout do PC no celular. Confira na aba “Celular” (ou use “Empilhar elementos”).`);

  // quem publicou por último (a cópia local é a que esta pessoa abriu; o conflito de verdade é checado ao publicar)
  const last = S.doc.publishedAt
    ? `${publisherName(S.doc) ? 'por ' + publisherName(S.doc) + ' · ' : ''}${fmtWhen(S.doc.publishedAt)}`
    : pagina ? 'ainda não — hoje o site mostra a versão original' : 'ainda não foi publicada';

  const destino = h('div', { class: 'pubbox' },
    h('p', { class: 'pub-head', html: icon('upload', 15) + `<span>Esta publicação vai para <b>${host}</b> — o site público do Geharte.</span>` }),
    h('p', { class: 'pub-sub' }, pagina ? 'Qualquer pessoa na internet verá a mudança, não só a equipe.' : 'Qualquer pessoa na internet poderá ver esta página, não só a equipe.'),
    row('Onde', h('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace(/^https?:\/\//, ''))),
    row('Arquivo', h('code', {}, `${dir}page.json`)),
    pagina && S.siteEntry ? row('O que é', S.siteEntry.funcao) : null,
    row('Última publicação', last));

  let confirmedClash = false;
  const go = btn({ label: 'Publicar agora', cls: 'primary', ic: 'upload', onClick: async () => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.value.trim())) { toast('Informe o repositório no formato dono/nome.', 'err'); return; }
    if (!token.value.trim()) { toast('Cole o token do GitHub.', 'err'); creds.open = true; return; }
    ls(KEY.repo, repo.value.trim()); ls(KEY.branch, branch.value.trim() || 'main');
    ls(KEY.token, remember.checked ? token.value.trim() : null);
    go.disabled = true; log.textContent = '';
    const say = (t) => { log.textContent += t + '\n'; log.scrollTop = log.scrollHeight; };
    const base = { repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim() };
    const what = S.doc.kind === 'pagina' ? `página do site ${S.doc.id.replace(/^site-/, '')}` : S.doc.kind === 'artigo' ? `artigo ${S.slug}/${S.doc.id}` : `perfil ${S.slug}`;
    try {
      // páginas do site são de todos: se outra pessoa publicou depois da versão que esta aqui abriu, avisa antes de sobrescrever
      if (pagina && !confirmedClash) {
        const atual = await getRepoJson({ ...base, path: `${dir}page.json` });
        if (atual?.publishedAt && atual.publishedAt !== S.doc.publishedAt) {
          clash.replaceChildren(
            h('p', {}, h('b', {}, '⚠ Outra versão foi publicada depois da que você abriu.')),
            h('p', {}, `${publisherName(atual) ? publisherName(atual) + ' publicou' : 'Alguém publicou'} esta página em ${fmtWhen(atual.publishedAt)}. Publicar agora substitui o trabalho dessa pessoa. Para ver a versão dela antes, exporte o seu projeto (menu ⋯), descarte o seu rascunho local no painel de documentos e abra a página de novo.`));
          clash.hidden = false; confirmedClash = true;
          go.querySelector('span').textContent = 'Publicar mesmo assim';
          go.disabled = false;
          return;
        }
      }
      const ids = usedAssetIds().filter((id) => S.assets.has(id));
      const meta = {};
      for (const id of ids) {
        const a = S.assets.get(id);
        meta[id] = { ext: a.ext, mime: a.mime, w: a.w, h: a.h };
        say(`Imagem ${id}.${a.ext}…`);
        const b64 = (await blobToDataURL(a.blob)).split(',')[1];
        const r = await putFile({ ...base, path: `${dir}assets/${id}.${a.ext}`, b64, message: `${what}: imagem ${id}`, skipIfExists: true });
        say(`  ${r}`);
      }
      const now = Date.now(), by = { slug: S.slug, nome: S.user?.nome || S.slug };
      const pub = { ...S.doc, assets: meta, publishedAt: new Date(now).toISOString(), publishedBy: by };
      say('Página (page.json)…');
      await putFile({ ...base, path: `${dir}page.json`, b64: utf8b64(JSON.stringify(pub)), message: `${what}: atualização (${by.nome})` });
      // só depois do sucesso: a página passa a "Publicada" (e o carimbo local acompanha, para não parecer alterada)
      S.doc.publishedAt = pub.publishedAt; S.doc.publishedBy = by;
      await saveNow({ updatedAt: now });
      emit('published');
      say(`Pronto! Publicado em ${host}. O GitHub leva cerca de 1 a 2 minutos para o site mostrar a mudança.`);
      link.replaceChildren(h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Abrir a página publicada ↗'));
      go.querySelector('span').textContent = 'Publicar agora';
      confirmedClash = false; clash.hidden = true;
    } catch (e) {
      say('✗ ' + e.message);
      say('Verifique o token (precisa de permissão “Contents: read and write” neste repositório) e o nome do repositório.');
    } finally { go.disabled = false; }
  } });

  const creds = h('details', { class: 'creds', open: !ls(KEY.token) },
    h('summary', {}, 'Credenciais do GitHub'),
    h('p', { class: 'hint' }, 'Quem pode publicar é quem tem permissão de escrita no repositório do site — por isso é preciso um token.'),
    h('label', { class: 'fld' }, h('span', { class: 'fl' }, 'Repositório'), repo),
    h('label', { class: 'fld' }, h('span', { class: 'fl' }, 'Branch'), branch),
    h('label', { class: 'fld' }, h('span', { class: 'fl' }, 'Token do GitHub (fine-grained, com Contents: read/write)'), token),
    h('label', { class: 'tgl' }, remember, h('i'), h('span', {}, 'Lembrar o token neste navegador')),
    h('p', { class: 'hint' }, 'Sem token? Use “Exportar projeto” no menu ⋯ e envie o arquivo para quem administra o site.'));

  modal({ title: pagina ? 'Publicar página do site' : 'Publicar página', wide: true, body: [
    destino,
    warn.length ? h('div', { class: 'warnbox' }, warn.map((w) => h('p', {}, '⚠ ' + w))) : null,
    clash,
    creds, log, link,
  ], actions: [go] });
}

// ---------- preview PC / celular ----------
export async function openPreview(startDev = S.dev) {
  await saveNow();
  let dev = startDev;
  const url = () => `${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}&src=draft&embed=1&t=${Date.now()}`;
  const area = h('div', { class: 'pv-area' });
  const mk = (d, label, ic) => btn({ label, ic, cls: d === dev ? 'on' : '', onClick: () => { dev = d; draw(); bar.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === dev)); } });
  const bd = mk('d', 'PC', 'monitor'), bm = mk('m', 'Celular', 'phone');
  bd.dataset.d = 'd'; bm.dataset.d = 'm';
  const close = () => { back.remove(); removeEventListener('keydown', esc); removeEventListener('resize', draw); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const bar = h('div', { class: 'pv-bar' }, h('b', {}, 'Visualização'), h('div', { class: 'seg2' }, bd, bm),
    h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: `${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}&src=draft&toolbar=1`, html: icon('link') + '<span>Abrir em outra aba</span>' }),
    h('span', { class: 'spacer' }), btn({ label: 'Fechar', ic: 'x', onClick: close }));
  const back = h('div', { class: 'pv-back' }, bar, area);
  document.body.append(back);
  addEventListener('keydown', esc);

  function draw() {
    area.innerHTML = '';
    const aw = area.clientWidth - 32, ah = area.clientHeight - 32;
    if (dev === 'd') {
      const w = 1280, s = Math.min(1, aw / w), hh = ah / s;
      const fr = h('iframe', { src: url(), title: 'Preview PC', style: { width: w + 'px', height: hh + 'px', transform: `scale(${s})`, transformOrigin: '0 0' } });
      area.append(h('div', { class: 'pv-pc', style: { width: w * s + 'px', height: ah + 'px' } }, fr));
    } else {
      const w = 390, hh = Math.min(844, ah - 20), s = 1;
      area.append(h('div', { class: 'pv-phone', style: { width: w + 'px', height: hh + 'px' } }, h('iframe', { src: url(), title: 'Preview celular', style: { width: w + 'px', height: hh + 'px' } })));
    }
  }
  addEventListener('resize', draw);
  draw();
}
