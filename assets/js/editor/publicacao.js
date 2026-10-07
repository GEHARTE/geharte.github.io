// Tela de publicação: o diagrama do caminho (editor → Google → Publicador → GitHub → Pages → site) com o andamento ao vivo,
// e a TRAVA do editor enquanto a página está sendo publicada (ver core/trava.js e core/vigia.js).
import { h } from '../core/dom.js';
import { criarTrava, TRAVA_MS } from '../core/trava.js';
import { criarVigia, ate, etapasVazias, textoAtual, ETAPAS } from '../core/vigia.js';
import { S, emit, saveNow } from './state.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

export const trava = criarTrava();

// ---------- diagrama (mesma topologia de documentation/diagramas/publicacao.workflow.json, desenhada na mão para ter estados) ----------
const NW = 124, NH = 58, colX = (c) => 20 + c * 150;
const NOS = [
  // id, coluna, faixa, tipo, rótulo, sub-rótulo
  ['editor', 0, 0, 'frontend', 'Editor', 'botão Publicar'],
  ['publicador', 1, 0, 'backend', 'Publicador', 'confere e grava'],
  ['google', 2, 0, 'external', 'Google', 'quem é você'],
  ['commit', 1, 1, 'database', 'Commit', 'repo privado'],
  ['deploy', 2, 1, 'cloud', 'Deploy', 'testes + cópia'],
  ['copia', 3, 2, 'database', 'Site público', 'gehrarte.github.io'],
  ['pages', 4, 2, 'cloud', 'GitHub Pages', 'monta o site'],
  ['site', 5, 2, 'external', 'No ar', 'página nova'],
];
const FAIXAS = ['SEU LADO → SERVIDOR', 'GITHUB · REPO PRIVADO', 'GITHUB · REPO PÚBLICO'];
const faixaY = (f) => 28 + f * 120;
const nY = (f) => faixaY(f) + 26;
const centro = (id) => { const [, c, f] = NOS.find((n) => n[0] === id); return { x: colX(c) + NW / 2, y: nY(f) + NH / 2, l: colX(c), r: colX(c) + NW, t: nY(f), b: nY(f) + NH }; };
// aresta: de, para, caminho (ortogonal), tracejada?
const ARESTAS = [
  ['editor', 'publicador', () => `M${centro('editor').r},${centro('editor').y}H${centro('publicador').l}`],
  ['publicador', 'commit', () => `M${centro('publicador').x},${centro('publicador').b}V${centro('commit').t}`],
  ['commit', 'deploy', () => `M${centro('commit').r},${centro('commit').y}H${centro('deploy').l}`],
  ['deploy', 'copia', () => `M${centro('deploy').x},${centro('deploy').b}V${centro('copia').y}H${centro('copia').l}`],
  ['copia', 'pages', () => `M${centro('copia').r},${centro('copia').y}H${centro('pages').l}`],
  ['pages', 'site', () => `M${centro('pages').r},${centro('pages').y}H${centro('site').l}`],
  ['publicador', 'google', () => `M${centro('publicador').r},${centro('publicador').y}H${centro('google').l}`, true],
];

export function diagramaSvg() {
  const s = [];
  FAIXAS.forEach((t, f) => s.push(`<rect class="pd-lane" x="8" y="${faixaY(f)}" width="900" height="104" rx="14"/><text class="pd-lane-t" x="24" y="${faixaY(f) + 18}">${f + 1} / ${t}</text>`));
  for (const [de, para, caminho, dashed] of ARESTAS) s.push(`<path class="pd-edge${dashed ? ' dashed' : ''}" data-to="${para}" data-from="${de}" d="${caminho()}" marker-end="url(#pd-seta)"/>`);
  for (const [id, c, f, tipo, rot, sub] of NOS) {
    const x = colX(c), y = nY(f);
    s.push(`<g class="pd-node t-${tipo} st-pend" data-etapa="${id}" transform="translate(${x} ${y})">` +
      `<rect class="pd-box" width="${NW}" height="${NH}" rx="10"/>` +
      `<text class="pd-l" x="${NW / 2}" y="26">${rot}</text><text class="pd-s" x="${NW / 2}" y="43">${sub}</text>` +
      `<g class="pd-badge"><circle cx="${NW - 4}" cy="4" r="9"/><path class="b-ok" d="M${NW - 8},4l3,3l5,-6"/><path class="b-err" d="M${NW - 8},0l8,8M${NW},0l-8,8"/></g></g>`);
  }
  return `<svg class="pd" viewBox="0 0 916 388" role="img" aria-label="Caminho da publicação: editor, Google, Publicador, repositório privado, deploy, repositório público, GitHub Pages e site no ar">` +
    `<defs><marker id="pd-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="currentColor"/></marker></defs>${s.join('')}</svg>`;
}

function pintar(svg, etapas) {
  for (const id of ETAPAS) {
    const g = svg.querySelector(`[data-etapa="${id}"]`);
    if (g) g.setAttribute('class', g.getAttribute('class').replace(/\bst-\w+/g, '') + ' st-' + (etapas[id] || 'pend'));
  }
  svg.querySelectorAll('.pd-edge').forEach((e) => { e.dataset.st = etapas[e.dataset.to] || 'pend'; });
}

// ---------- tela cheia "publicando…" ----------
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function criarTela({ titulo, restanteMs = TRAVA_MS, onVoltar }) {
  const svgWrap = h('div', { class: 'pv-diagram', html: diagramaSvg() });
  const svg = svgWrap.firstChild;
  const msg = h('p', { class: 'pv-msg', 'aria-live': 'polite' });
  const timer = h('span', { class: 'pv-timer' });
  const acoes = h('footer', { class: 'pv-actions' });
  const dot = h('span', { class: 'pv-dot' });
  const sub = h('p', { class: 'pv-sub' }, 'O editor fica travado nesta página até o site mostrar a mudança. Você pode sair: ao voltar, ela continua aqui.');
  const head = h('header', {}, dot, h('h2', {}, `Publicando “${titulo || 'sem título'}”`), timer);
  const el = h('div', { id: 'pubview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Publicação em andamento' }, h('div', { class: 'pv-card' }, head, sub, svgWrap, msg, acoes));
  pintar(svg, etapasVazias());

  let fim = Date.now() + restanteMs, tick = setInterval(() => { timer.textContent = `Se algo travar, o editor é liberado sozinho em ${fmt(fim - Date.now())}`; }, 500);
  timer.textContent = `Se algo travar, o editor é liberado sozinho em ${fmt(restanteMs)}`;
  const voltar = h('a', { class: 'btn', href: '../arquivos/', html: icon('stack') + '<span>Voltar aos arquivos</span>' });
  acoes.append(voltar);

  const api = {
    el,
    etapas(m) { pintar(svg, m); const t = textoAtual(m); if (t) msg.textContent = t; },
    texto(t) { msg.textContent = t; },
    estado(kind, t) {                       // 'ok' | 'erro' | 'tempo'
      clearInterval(tick); timer.textContent = '';
      head.querySelector('h2').textContent = { ok: `Publicado: “${titulo || 'sem título'}”`, erro: 'A publicação não terminou', tempo: 'Publicação sem confirmação' }[kind] || 'Publicação encerrada';
      el.dataset.fim = kind; dot.className = 'pv-dot ' + kind;
      if (t) msg.textContent = t;
      sub.textContent = kind === 'ok' ? 'Publicação concluída.' : 'O editor foi liberado.';
    },
    botao(label, fn, cls = 'primary') { acoes.prepend(h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label)); },
    link(href, label) { acoes.prepend(h('a', { class: 'btn', href, target: '_blank', rel: 'noopener', html: icon('link') + `<span>${label}</span>` })); },
    fechar() { clearInterval(tick); el.remove(); },
  };
  return api;
}

// ---------- bloquear / liberar o editor ----------
let tela = null, vigia = null;

const alvosInertes = () => [document.getElementById('top'), document.getElementById('app')].filter(Boolean);
function bloquear(on) {
  S.locked = on;
  for (const el of alvosInertes()) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); }
  document.body.classList.toggle('publicando', on);
  S.dock?.setLocked?.(on);
  emit('lock', on);
}
export const bloqueado = () => !!S.locked;

// Abre a tela e põe o editor em modo "só olhar". `rec` = registro da trava. Devolve o controle da tela.
export function travar({ rec, cfg, restanteMs, onLiberou }) {
  if (tela) return tela;
  bloquear(true);
  tela = criarTela({ titulo: S.doc?.title, restanteMs: restanteMs ?? TRAVA_MS });
  document.body.append(tela.el);

  const liberar = (kind, texto, extra = {}) => {
    trava.liberar(rec.slug, rec.docId);
    vigia?.parar(); vigia = null;
    tela.estado(kind, texto);
    bloquear(false);
    onLiberou?.(kind, extra);
    return tela;
  };
  tela.liberar = liberar;
  tela.rec = rec;
  tela.fechar2 = () => { tela?.fechar(); tela = null; };
  return tela;
}

// Depois que o Publicador respondeu (ou ao retomar numa reabertura): vigia até o site mostrar a mudança.
export function acompanhar({ rec, cfg, onNoAr }) {
  const t = tela;
  if (!t || vigia) return;
  const siteUrl = (cfg.siteUrl || '').replace(/\/$/, '');
  const host = siteUrl.replace(/^https?:\/\//, '');
  const repoPublico = cfg.repoPublico || (host.endsWith('.github.io') ? `${host.split('.')[0]}/${host}` : '');
  vigia = criarVigia({
    dir: rec.dir, esperado: rec.esperado, baseAt: rec.baseAt, t0: rec.t0, siteUrl, repoPublico, apiBase: cfg.githubApi || undefined,
    onEtapas: (m) => t.etapas(m),
    onFim: async ({ tipo, msg, json }) => {
      if (tipo === 'ok') {
        await onNoAr?.(json);
        t.liberar('ok', msg);
        if (rec.url) t.link(rec.url, 'Abrir a página no ar');   // endereço de quem VÊ a página (perfil.html?u=…, home/…), não a pasta de dados
        t.botao('Voltar ao editor', () => { t.fechar2(); }, 'primary');
        toast('Publicado! A página já está no ar.', 'ok');
      } else if (tipo === 'erro') {
        t.liberar('erro', msg);
        t.botao('Voltar ao editor', () => t.fechar2());
      } else {
        t.liberar('tempo', msg);
        t.botao('Voltar ao editor', () => t.fechar2());
      }
    },
  });
  vigia.iniciar();
}

// Reabriu a página no meio de uma publicação: só o diagrama, até o site responder ou o prazo acabar.
export function retomar({ rec, restanteMs, cfg, onNoAr }) {
  const t = travar({ rec, cfg, restanteMs });
  t.etapas(ate(rec.esperado ? 'commit' : 'google'));
  acompanhar({ rec, cfg, onNoAr });
  return t;
}

// Desistir sem alarde (erro antes do commit, conflito): solta a trava e fecha a tela; quem chamou mostra o problema.
export function cancelar() {
  if (!tela) return;
  vigia?.parar(); vigia = null;
  trava.liberar(tela.rec.slug, tela.rec.docId);
  bloquear(false);
  tela.fechar(); tela = null;
}

// O site já mostra a versão nova: o que o editor guarda como "publicada" passa a ser exatamente o que está no ar.
export async function aplicarNoAr(j) {
  if (!j?.publishedAt || !S.doc || j.publishedAt === S.doc.publishedAt) return;
  S.doc.publishedAt = j.publishedAt; S.doc.publishedBy = j.publishedBy;
  await saveNow({ updatedAt: Date.parse(j.publishedAt) });
  emit('published');
}
