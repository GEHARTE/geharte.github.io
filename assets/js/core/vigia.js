// Vigia da publicação: depois que o Publicador gravou o commit, acompanha o caminho até a página aparecer no ar.
//
//   Publicador → commit no repo PRIVADO → Deploy (Actions: testes + cópia) → repo PÚBLICO → GitHub Pages → site
//
// O que o navegador consegue enxergar sem token: o repo PÚBLICO (commits e execuções do "pages build and deployment", API do GitHub
// sem login, com CORS) e o próprio site. O repo privado e o deploy não dá para ver: são deduzidos (commit confirmado pelo Publicador;
// o deploy "acabou" quando o commit aparece no repo público).
// A prova final é sempre o site: o page.json publicado tem o `publishedAt` que o Publicador gravou.
import { TRAVA_MS } from './trava.js';

export const ETAPAS = ['editor', 'google', 'publicador', 'commit', 'deploy', 'copia', 'pages', 'site'];
export const NOMES = {
  editor: 'Editor', google: 'Google', publicador: 'Publicador', commit: 'Commit privado',
  deploy: 'Deploy', copia: 'Site público', pages: 'GitHub Pages', site: 'No ar',
};
export const TEXTOS = {
  google: 'Confirmando com o Google que é você…',
  publicador: 'O Publicador confere o seu acesso e prepara o commit…',
  commit: 'Gravando a página no repositório do projeto…',
  deploy: 'O GitHub está rodando os testes e copiando o site (cerca de 1 minuto)…',
  copia: 'Os arquivos chegaram ao repositório público. Aguardando o GitHub Pages…',
  pages: 'O GitHub Pages está montando o site…',
  site: 'Quase lá: conferindo se a página nova já está no ar…',
};

export const etapasVazias = () => Object.fromEntries(ETAPAS.map((e) => [e, 'pend']));
// 'feita' até a etapa `ate` (inclusive); a seguinte fica 'ativa'
export function ate(etapa, extra = {}) {
  const i = ETAPAS.indexOf(etapa), m = etapasVazias();
  ETAPAS.forEach((e, k) => { m[e] = k <= i ? 'feita' : k === i + 1 ? 'ativa' : 'pend'; });
  return { ...m, ...extra };
}

// Texto da etapa que está em andamento (para a legenda embaixo do diagrama)
export const textoAtual = (m) => TEXTOS[ETAPAS.find((e) => m[e] === 'ativa')] || '';

export function criarVigia({
  dir, esperado = null, baseAt = null, t0, siteUrl, repoPublico, apiBase = 'https://api.github.com',
  fetchImpl = (...a) => fetch(...a), now = () => Date.now(), espera = (ms) => new Promise((r) => setTimeout(r, ms)),
  ttl = TRAVA_MS, cadenciaSite = 4000, cadenciaApi = 8000,
  onEtapas = () => {}, onFim = () => {},
} = {}) {
  // sem `esperado` o Publicador ainda não respondeu (a pessoa fechou no meio do envio): não dá para afirmar que o commit existe
  const inicio = () => ate(esperado ? 'commit' : 'google');
  let parado = false, semApi = false, sha = null, ultimaApi = -1e12, etapas = inicio();
  const site = String(siteUrl || '').replace(/\/$/, ''), base = String(apiBase).replace(/\/$/, '');
  const emitir = (m) => { etapas = m; onEtapas(m); };

  async function json(url, opts) {
    const r = await fetchImpl(url, opts);
    if (r.status === 403 || r.status === 429) { semApi = true; return null; }   // limite do GitHub sem login: segue só pelo site
    if (!r.ok) return null;
    return r.json();
  }

  // a página já está no ar? o page.json publicado tem de ser o desta publicação
  async function noAr() {
    const j = await fetchImpl(`${site}/${dir}page.json?_=${now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!j?.publishedAt) return null;
    if (esperado ? j.publishedAt === esperado : (Date.parse(j.publishedAt) >= t0 - 30000 && j.publishedAt !== baseAt)) return j;
    return null;
  }

  async function olharGitHub() {
    if (semApi || !repoPublico) return;
    ultimaApi = now();
    if (!sha) {
      // o commit público desta publicação sempre vem DEPOIS do carimbo do Publicador (o deploy leva dezenas de segundos); uma
      // folga grande aqui faria o vigia confundir com a publicação anterior da mesma página, feita há menos de um minuto
      const desde = new Date(esperado ? Date.parse(esperado) : t0 - 5000).toISOString();
      const c = await json(`${base}/repos/${repoPublico}/commits?path=${encodeURIComponent(dir + 'page.json')}&since=${encodeURIComponent(desde)}&per_page=1`, { headers: { Accept: 'application/vnd.github+json' } });
      if (c?.[0]?.sha) { sha = c[0].sha; emitir(ate('copia')); }
      else if (c) emitir(inicio());
      return;
    }
    const r = await json(`${base}/repos/${repoPublico}/actions/runs?head_sha=${sha}&per_page=5`, { headers: { Accept: 'application/vnd.github+json' } });
    const run = r?.workflow_runs?.find((x) => /pages build/i.test(x.name || '')) || r?.workflow_runs?.[0];
    if (!run) return;
    if (run.status !== 'completed') emitir(ate('copia'));                           // Pages montando: a etapa "pages" fica ativa
    else if (run.conclusion === 'success') emitir(ate('pages'));                    // montou: falta o site responder com a versão nova
    else { emitir({ ...ate('copia'), pages: 'erro' }); fim('erro', 'O GitHub Pages falhou ao montar o site.'); }
  }

  let terminou = false;
  function fim(tipo, msg, j) { if (terminou) return; terminou = true; parado = true; onFim({ tipo, msg, json: j || null }); }

  async function ciclo() {
    emitir(inicio());
    while (!parado) {
      if (now() - t0 >= ttl) return fim('tempo', 'Passou de 2 minutos: liberei o editor. O site ainda pode estar atualizando — confira daqui a pouco.');
      const j = await noAr();
      if (parado) return;
      if (j) { emitir(Object.fromEntries(ETAPAS.map((e) => [e, 'feita']))); return fim('ok', 'A página nova já está no ar!', j); }
      if (now() - ultimaApi >= cadenciaApi) { try { await olharGitHub(); } catch { /* rede oscilou: tenta no próximo ciclo */ } }
      await espera(cadenciaSite);
    }
  }

  return {
    iniciar() { ciclo().catch((e) => fim('erro', 'O vigia falhou: ' + (e?.message || e))); },
    parar() { parado = true; },
    etapas: () => etapas,
  };
}
