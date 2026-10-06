// Google Drive: os materiais dos artistas (imagens, fontes, PSD, PDF…) ficam no Drive da conta Google
// INSTITUCIONAL de cada um, numa pasta "Gehrarte — materiais", e ficam à mão durante a edição.
//
// Escopo `drive.file`: o aplicativo só enxerga o que ele mesmo criou (a pasta e o que for enviado por aqui).
// Não é escopo sensível — não exige verificação do Google — e o Gehrarte nunca vê o resto do Drive de ninguém.
// Sem servidor: o navegador fala direto com a API do Drive usando um token de acesso de ~1 h (Google Identity Services).
//
// createDrive() recebe tudo que toca o navegador/rede como parâmetro (requestToken, fetchImpl, put, storage),
// então a lógica é testável em Node (tests/drive.test.mjs).
import './migracao.js';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'Gehrarte — materiais';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink';

export class DriveError extends Error {
  constructor(message, status = 0, reason = '') { super(message); this.name = 'DriveError'; this.status = status; this.reason = reason; }
}

export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
export const isImage = (mime) => /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(mime || '');
export const isProject = (f) => /^gehr?arte-.+\.json$/i.test(f?.name || '');
export const humanSize = (n) => {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${String(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).replace('.', ',')} ${u[i]}`;
};
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");   // aspas dentro de consultas do Drive

// Traduz o erro da API para algo que um artista consiga agir em cima.
export async function toDriveError(r) {
  let j = null;
  try { j = await r.json(); } catch { /* sem corpo */ }
  const msg = j?.error?.message || '';
  const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
  if (reason === 'accessNotConfigured' || /has not been used in project|is disabled|API has not been enabled/i.test(msg)) {
    return new DriveError('A API do Google Drive ainda não foi ativada no projeto do Gehrarte. Quem administra precisa ativar “Google Drive API” no Google Cloud (passo a passo em documentation/gestao/drive.md).', r.status, 'accessNotConfigured');
  }
  if (reason === 'storageQuotaExceeded') return new DriveError('O seu Drive está cheio. Libere espaço (ou apague arquivos grandes) e tente de novo.', r.status, reason);
  if (r.status === 403 && /insufficient|scope/i.test(msg + reason)) return new DriveError('Sem permissão para usar o Drive. Conecte de novo e aceite o acesso.', r.status, 'insufficientPermissions');
  if (r.status === 404) return new DriveError('Esse arquivo não está mais no Drive (foi apagado ou movido).', 404, 'notFound');
  if (r.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return new DriveError('O Google pediu para esperar um pouco. Tente de novo em instantes.', r.status, 'rateLimit');
  return new DriveError(`Erro do Drive (${r.status})${msg ? ': ' + msg : ''}`, r.status, reason);
}

// ---------- navegador (padrões) ----------
let gsi;
const loadGsi = () => (gsi ||= new Promise((res, rej) => {
  if (globalThis.google?.accounts?.oauth2) return res();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => res();
  s.onerror = () => { gsi = null; rej(new DriveError('Não consegui carregar o Google. Verifique a conexão.')); };
  document.head.append(s);
}));

// Pede o token de acesso (abre a janelinha do Google; precisa vir de um clique).
export async function gsiRequestToken({ clientId, scope = DRIVE_SCOPE, hint }) {
  await loadGsi();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope, ...(hint ? { login_hint: hint } : {}),
      callback: (r) => (r.error ? rej(new DriveError(r.error === 'access_denied' ? 'Você não autorizou o acesso ao Drive.' : `O Google recusou a conexão (${r.error}).`)) : res(r)),
      error_callback: (e) => rej(new DriveError(e?.type === 'popup_closed' ? 'A janela do Google foi fechada antes de terminar.' : e?.type === 'popup_failed_to_open' ? 'O navegador bloqueou a janela do Google. Libere pop-ups para este site.' : 'Não consegui conectar ao Google.')),
    });
    client.requestAccessToken();
  });
}

// Envia o arquivo para a sessão de upload retomável; com XHR dá para mostrar o progresso.
export function xhrPut(url, blob, { onProgress, type } = {}) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    if (type) x.setRequestHeader('Content-Type', type);
    if (onProgress) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? res(JSON.parse(x.responseText || '{}')) : rej(new DriveError(`Falha no envio (${x.status}).`, x.status)));
    x.onerror = () => rej(new DriveError('Falha de rede durante o envio. Tente de novo.'));
    x.send(blob);
  });
}

const safe = (get) => { try { return get(); } catch { return null; } };
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

export function createDrive({
  clientId, slug,
  requestToken = gsiRequestToken,
  fetchImpl = (...a) => fetch(...a),
  put = xhrPut,
  session = safe(() => sessionStorage) || memStore(),   // token (dura a aba, ~1 h)
  local = safe(() => localStorage) || memStore(),       // lembrar a pasta e que já conectou
  now = () => Date.now(),
  revoke = (t) => safe(() => google.accounts.oauth2.revoke(t, () => {})),
} = {}) {
  const K = { token: `gehrarte.drive.token.${slug}`, folder: `gehrarte.drive.folder.${slug}`, on: `gehrarte.drive.on.${slug}` };
  let tok = safe(() => JSON.parse(session.getItem(K.token) || 'null'));
  let folderId = null;

  const valid = () => !!tok && tok.exp > now() + 60e3;
  const saveTok = (t) => { tok = t; if (t) session.setItem(K.token, JSON.stringify(t)); else session.removeItem(K.token); };

  async function api(url, init = {}) {
    if (!valid()) throw new DriveError('Conecte ao Google Drive primeiro.', 401, 'noToken');
    const r = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok.access_token}` } });
    if (r.status === 401) { saveTok(null); throw new DriveError('A conexão com o Drive expirou. Conecte de novo.', 401, 'expired'); }
    if (!r.ok) throw await toDriveError(r);
    return r;
  }
  const json = async (url, init) => (await api(url, init)).json();

  const self = {
    isConnected: () => valid(),
    wasConnected: () => local.getItem(K.on) === '1',

    // Conecta (clique do usuário). `expectedHash` = hash do e-mail da conta com que a pessoa entrou no Gehrarte:
    // o Drive tem de ser da MESMA conta. Devolve { email, nome, cota }.
    async connect({ expectedHash, hashEmail } = {}) {
      if (!clientId) throw new DriveError('O login com Google ainda não foi configurado neste site.');
      const r = await requestToken({ clientId, scope: DRIVE_SCOPE });
      saveTok({ access_token: r.access_token, exp: now() + (Number(r.expires_in) || 3600) * 1000 });
      const info = await self.about();
      if (expectedHash && hashEmail && (await hashEmail(info.email)) !== expectedHash) {
        const t = tok.access_token;
        saveTok(null); revoke(t);
        throw new DriveError(`A conta do Google que você escolheu (${info.email}) não é a conta com que entrou no Gehrarte. Conecte com a sua conta institucional.`, 0, 'wrongAccount');
      }
      local.setItem(K.on, '1');
      return info;
    },
    disconnect() { const t = tok?.access_token; saveTok(null); folderId = null; local.removeItem(K.on); if (t) revoke(t); },

    async about() {
      const j = await json(`${API}/about?fields=${encodeURIComponent('user(emailAddress,displayName),storageQuota(limit,usage)')}`);
      const q = j.storageQuota || {};
      return { email: j.user?.emailAddress || '', nome: j.user?.displayName || '', cota: { usado: Number(q.usage) || 0, limite: q.limit ? Number(q.limit) : null } };
    },

    // A pasta "Gehrarte — materiais": reaproveita a lembrada/encontrada ou cria. Devolve o id.
    async ensureFolder() {
      if (folderId) return folderId;
      const cached = local.getItem(K.folder);
      if (cached) {
        try {
          const f = await json(`${API}/files/${encodeURIComponent(cached)}?fields=id,trashed`);
          if (!f.trashed) return (folderId = cached);
        } catch (e) { if (e.status !== 404) throw e; }
      }
      const q = `mimeType='${FOLDER_MIME}' and name='${esc(FOLDER_NAME)}' and trashed=false`;
      const found = await json(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`);
      let id = found.files?.[0]?.id;
      if (!id) {
        id = (await json(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }) })).id;
      }
      local.setItem(K.folder, id);
      return (folderId = id);
    },

    async list({ pageToken, pageSize = 60 } = {}) {
      const parent = await self.ensureFolder();
      const p = new URLSearchParams({ q: `'${parent}' in parents and trashed=false`, orderBy: 'modifiedTime desc', pageSize: String(pageSize), fields: `nextPageToken,files(${FILE_FIELDS})` });
      if (pageToken) p.set('pageToken', pageToken);
      const j = await json(`${API}/files?${p}`);
      return { files: j.files || [], next: j.nextPageToken || null };
    },

    // Envio retomável (aguenta arquivos grandes). onProgress(0..1).
    async upload(file, { onProgress, name = file.name } = {}) {
      const parent = await self.ensureFolder();
      const type = file.type || 'application/octet-stream';
      const init = await api(`${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) },
        body: JSON.stringify({ name, parents: [parent], mimeType: type }),
      });
      const loc = init.headers.get('Location');
      if (!loc) throw new DriveError('O Drive não abriu a sessão de envio. Tente de novo.');
      return put(loc, file, { onProgress, type });
    },

    async download(id) { return (await api(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob(); },
    async trash(id) { return json(`${API}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); },

    // Grava um texto (ex.: cópia do projeto .json) na pasta; se já existe arquivo com esse nome, atualiza.
    async saveText(name, text, mime = 'application/json') {
      const parent = await self.ensureFolder();
      const q = `'${parent}' in parents and name='${esc(name)}' and trashed=false`;
      const found = await json(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`);
      const id = found.files?.[0]?.id;
      const boundary = 'gehrarte' + now().toString(36);
      const meta = JSON.stringify(id ? { name } : { name, parents: [parent], mimeType: mime });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
      return json(`${UPLOAD}/files${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
    },
  };
  return self;
}
