// Painéis do editor que a pessoa organiza do jeito que quiser: arrastar entre as laterais, empilhar, redimensionar,
// soltar sobre o canvas, separar em outra janela do navegador — e, no celular (horizontal), gavetas sobre o canvas.
// O que está onde vem de dock-layout.js (puro, testado); aqui só se desenha e se trata o ponteiro.
import '../core/migracao.js';
import { h } from '../core/dom.js';
import { clamp, debounce } from '../core/util.js';
import * as D from './dock-layout.js';
import { icon } from './icons.js';
import { addDoc, dropDoc, setActiveDoc, activeDoc, winOf } from './docs.js';
import { toast } from './ui.js';
import { criarSincronia, montar, ler as lerPreferencias } from '../core/preferencias.js';
import { downloadBlob } from '../core/util.js';
import { ajustar, ancorar, caixaVisivel, telaDisponivel, posicaoJanela, corrigirJanela, retanguloJanela, instalar } from '../core/janelas.js';

const KEY = (slug) => `gehrarte.layout.${slug}`;
const COMPACT_Q = '(max-width: 720px), (pointer: coarse) and (max-height: 560px)';
// Celular: cada botão da gaveta abre um grupo de painéis (a biblioteca vira uma sanfona: um aberto por vez)
const DRAWER_SIDE = { lib: 'left', layers: 'right', props: 'right' };
const drawerKeyOf = (id) => Object.keys(D.DRAWER_GROUPS).find((k) => D.DRAWER_GROUPS[k].includes(id));
const WHERE = { left: 'à esquerda', right: 'à direita' };

// ---------- menu pequeno (reaproveitado pelo ⋯ do painel e pelo botão Painéis) ----------
// itens: { label, icon?, checked?, hint?, disabled?, onClick } ou '-'
export function popMenu(anchor, items, at) {
  const doc = anchor?.ownerDocument || activeDoc(), win = doc.defaultView;
  doc.getElementById('pmenu')?.remove();
  const m = h('div', { id: 'pmenu', class: 'popover menu' }, items.map((it) => it === '-' ? h('hr') : h('button', {
    type: 'button', disabled: it.disabled, onclick: () => { close(); it.onClick?.(); },
    html: `<span class="mi">${it.checked != null ? (it.checked ? icon('check', 14) : '') : (it.icon ? icon(it.icon, 14) : '')}</span><span class="ml">${it.label}</span>${it.hint ? `<em class="mh">${it.hint}</em>` : ''}`,
  })));
  doc.body.append(m);
  const caixa = caixaVisivel(win);
  m.style.maxHeight = caixa.h - 16 + 'px'; m.style.overflowY = 'auto';
  const tam = { w: m.offsetWidth, h: m.offsetHeight };
  const p = anchor ? ancorar(anchor.getBoundingClientRect(), tam, caixa, { alinhar: 'fim' }) : ajustar({ x: at.x, y: at.y, ...tam }, caixa);
  m.style.left = p.x + 'px'; m.style.top = p.y + 'px';
  const away = (e) => { if (!m.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function close() { m.remove(); doc.removeEventListener('pointerdown', away, true); doc.removeEventListener('keydown', esc, true); }
  setTimeout(() => { doc.addEventListener('pointerdown', away, true); doc.addEventListener('keydown', esc, true); });
  return close;
}

export function initDock({ app, slug, panels, topY = 52, rotateEl, onDocument, onMode, onVisible, preferencias = null }) {
  const dockEl = { left: app.querySelector('#dock-left'), right: app.querySelector('#dock-right') };
  const floatsEl = app.querySelector('#floats'), drawerEl = app.querySelector('#drawer');
  const ids = Object.keys(panels);
  const mq = matchMedia(COMPACT_Q);
  const wins = new Map();            // id -> { win, tick }
  let compact = mq.matches, drawerOpen = null, drawerPick = null, drag = null, locked = false;
  const clickTimers = new Map();     // clique no cabeçalho recolhe/expande, mas espera um instante para não atrapalhar o duplo clique

  // ---------- persistência ----------
  // A disposição é da PESSOA (uma por usuário neste navegador), não do arquivo aberto: trocar de arquivo, fechar e voltar noutra hora
  // mostra tudo como foi deixado. Grava na hora (nada de espera que se perde ao fechar a aba), acompanha o que outra aba/janela do
  // editor mudou (senão a aba antiga sobrescreveria a disposição nova) e pede ao navegador para não descartar os dados do site.
  const chave = KEY(slug);
  let L = D.normalize(read(), ids);
  function read() { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } }
  let avisouFalha = false, pediuPersistencia = false;
  // O que vai para o navegador é a disposição + o carimbo `t` (quando a PESSOA mudou por último): é ele que decide, na conta, quem é mais novo.
  function gravarLocal(t) {
    try { localStorage.setItem(chave, JSON.stringify({ ...D.serialize(L), t })); return true; }
    catch { if (!avisouFalha) { avisouFalha = true; toast('Não consegui guardar a disposição dos painéis: o navegador bloqueou o armazenamento do site. Ela vale só nesta sessão.', 'err'); } return false; }
  }
  function persist() {
    const t = Date.now();
    if (!gravarLocal(t)) return;
    if (!pediuPersistencia) { pediuPersistencia = true; try { navigator.storage?.persisted?.().then((ok) => ok || navigator.storage.persist?.()).catch(() => {}); } catch { /* sem a API */ } }
    sync?.agendar(D.serialize(L), t);
  }
  // Troca a disposição inteira (outra aba, a conta ou um arquivo importado). Os painéis que esta janela separou continuam separados.
  // Devolve false se não mudou nada (ou se há um arraste em andamento).
  function aplicar(raw) {
    if (drag) return false;
    const nova = D.normalize(raw, ids);
    for (const id of wins.keys()) D.windowPanel(nova, id, L.windows.find((w) => w.id === id));
    if (JSON.stringify(D.serialize(nova)) === JSON.stringify(D.serialize(L))) return false;
    L = nova;
    render();
    return true;
  }
  const adotar = aplicar;

  // ---------- na conta da pessoa (host.preferencias) ----------
  // Opcional e por escolha: a pessoa liga em Painéis › "Guardar a disposição na conta". Daí em diante cada mudança sobe sozinha
  // (se o Drive estiver conectado nesta sessão) e, ao abrir o editor ou voltar à aba, a disposição mais nova da conta é adotada.
  const SYNC = `gehrarte.layout.sync.${slug}`;
  const syncLigada = () => { try { return localStorage.getItem(SYNC) === '1'; } catch { return false; } };
  const ctx = { slug };
  let avisouSync = false;
  const sync = preferencias ? criarSincronia({
    backend: preferencias, ctx, ligada: syncLigada,
    lerLocal: () => { const raw = read(); if (!raw) return null; const { t, ...layout } = raw; return { t: Number(t) > 0 ? Number(t) : 1, layout }; },   // sem carimbo = gravado por versão antiga: vale, mas perde para qualquer um com carimbo
    aoAdotar: (layout, t) => { if (aplicar(layout)) toast('Disposição dos painéis atualizada pela sua conta.', 'ok'); gravarLocal(t); },
    aoFalhar: (e) => { if (!avisouSync) { avisouSync = true; toast(`Não consegui sincronizar a disposição com a sua conta: ${e?.message || e}`, 'err'); } },
  }) : null;
  let ultimoPuxar = 0;
  async function puxarDaConta({ avisar = false } = {}) {
    if (!sync || !syncLigada()) return null;
    ultimoPuxar = Date.now();
    const r = await sync.puxar();
    if (avisar) {
      const msg = { adotado: null, enviado: 'Disposição enviada para a sua conta.', igual: 'A sua conta já está com a mesma disposição.', indisponivel: 'A conta não está conectada nesta sessão.' }[r.estado];
      if (msg) toast(msg, r.estado === 'indisponivel' ? 'err' : 'ok');
    } else if (r.estado === 'indisponivel' && !avisouSync) {
      avisouSync = true;
      toast(`A disposição está ligada à sua conta, mas o ${preferencias.rotulo || 'armazenamento'} não está conectado nesta sessão. Painéis › Sincronizar agora.`);
    }
    return r;
  }
  function ligarNaConta() {
    if (!preferencias) return;
    if (syncLigada()) { try { localStorage.removeItem(SYNC); } catch { /* ok */ } sync.cancelar(); toast('Desligado. A cópia que está na conta continua lá, mas deixa de ser atualizada.'); return; }
    // `conectar` abre o login do Google: tem de ser chamada direto do clique, antes de qualquer espera
    Promise.resolve(preferencias.conectar?.(ctx)).then(() => {
      try { localStorage.setItem(SYNC, '1'); } catch { toast('O navegador bloqueou o armazenamento: não deu para ligar.', 'err'); return; }
      return puxarDaConta({ avisar: true });
    }).catch((e) => toast(e?.message || String(e), 'err'));
  }
  function sincronizarAgora() {
    Promise.resolve(preferencias.conectar?.(ctx)).then(() => puxarDaConta({ avisar: true })).catch((e) => toast(e?.message || String(e), 'err'));
  }
  // Exportar/importar funciona sem conta nenhuma: é o mesmo arquivo que vai para a conta.
  function exportarDisposicao() {
    downloadBlob('artatk-disposicao.json', new Blob([JSON.stringify(montar(D.serialize(L), Date.now()), null, 1)], { type: 'application/json' }));
    toast('Disposição salva na pasta de Downloads.', 'ok');
  }
  function importarDisposicao() {
    const inp = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    inp.addEventListener('change', async () => {
      const r = lerPreferencias(await inp.files[0]?.text().catch(() => ''));
      inp.remove();
      if (!r) { toast('Esse arquivo não é uma disposição do ArtAtk.', 'err'); return; }
      if (aplicar(r.layout)) { persist(); toast('Disposição importada.', 'ok'); } else toast('A disposição já era essa.');
    });
    document.body.append(inp); inp.click();
  }
  addEventListener('storage', (e) => { if (e.key === chave && e.newValue) { try { adotar(JSON.parse(e.newValue)); } catch { /* valor ilegível: fica com o que tem */ } } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const r = read(); if (r) adotar(r);
    if (Date.now() - ultimoPuxar > 60e3) puxarDaConta();      // voltou à aba: vê se a conta tem algo mais novo (no máximo 1×/min)
  });

  // ---------- molduras ----------
  const frames = {};
  for (const id of ids) frames[id] = makeFrame(id, panels[id]);

  function makeFrame(id, p) {
    const b = (act, ic, title, cls = '') => h('button', { type: 'button', class: 'pnl-b ' + cls, 'data-act': act, title, 'aria-label': title, html: icon(ic, 14) });
    const head = h('header', { class: 'pnl-h' },
      h('span', { class: 'pnl-grip', title: 'Arraste para mover o painel', html: icon('grip', 14) }),
      h('b', { class: 'pnl-t' }, p.title || D.panelTitle(id)),
      h('span', { class: 'pnl-sp' }),
      b('redock', 'dockin', 'Devolver à janela principal', 'only-window'),
      b('collapse', 'chevD', 'Recolher / expandir', 'no-window'),
      b('detach', 'popout', 'Separar em outra janela', 'no-window no-narrow'),
      b('menu', 'more', 'Mais opções do painel', 'no-window'),
      b('close', 'x', 'Fechar', 'only-drawer'));
    const rz = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((k) => h('i', { class: 'rz rz-' + k, 'data-rz': k }));
    const f = h('section', { class: 'pnl', 'data-id': id }, head, h('div', { class: 'pnl-body' }, p.el), rz);
    head.addEventListener('pointerdown', (e) => onHeadDown(e, id));
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) { clearTimeout(clickTimers.get(id)); toggleFloat(id); } });
    head.addEventListener('click', (e) => { if (compact && !e.target.closest('button')) pickInDrawer(id); });
    head.addEventListener('contextmenu', (e) => { if (compact || wins.has(id)) return; e.preventDefault(); menuFor(id, null, { x: e.clientX, y: e.clientY }); });
    f.addEventListener('pointerdown', () => { if (D.locate(L, id)?.zone === 'float') raise(id); }, true);
    f.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (!a) return;
      if (a === 'collapse') { D.toggleCollapsed(L, id); change(); }
      else if (a === 'detach') detach(id);
      else if (a === 'redock') redock(id);
      else if (a === 'close') compact ? closeDrawer() : (D.hidePanel(L, id), change());
      else if (a === 'menu') menuFor(id, e.target.closest('button'));
    });
    f.querySelectorAll('.rz').forEach((r) => r.addEventListener('pointerdown', (e) => startFloatResize(e, id, r.dataset.rz)));
    return f;
  }

  // ---------- desenho ----------
  const keepScroll = (fn) => {
    const saved = [];
    for (const id of ids) for (const n of [panels[id].el, ...panels[id].el.children]) if (n.scrollTop) saved.push([n, n.scrollTop]);
    fn();
    for (const [n, t] of saved) n.scrollTop = t;
  };

  function render() {
    document.body.classList.toggle('compact', compact);
    keepScroll(() => (compact ? renderCompact() : renderDesktop()));
    for (const id of ids) {
      const f = frames[id], zone = D.locate(L, id)?.zone, inDrawer = compact && f.parentNode === drawerEl;
      // desktop: o que a pessoa recolheu; celular: na gaveta da biblioteca, só o painel escolhido fica aberto
      const collapsed = compact ? inDrawer && drawerGroup().length > 1 && id !== drawerPick : !!L.panels[id].collapsed;
      f.classList.toggle('is-collapsed', collapsed);
      f.classList.toggle('is-float', zone === 'float' && !compact);
      f.classList.toggle('in-window', wins.has(id));
      f.classList.toggle('is-drawer', inDrawer);
      f.classList.toggle('stack-rest', inDrawer && drawerGroup().length > 1 && id !== drawerGroup()[0]);   // só o primeiro da sanfona leva o botão de fechar a gaveta
      const vis = compact ? inDrawer : D.isVisible(L, id);
      onVisible?.(id, vis, vis && !collapsed);      // `open` = à vista e não recolhido (painéis pesados só montam o conteúdo aí)
    }
  }

  // O que se desenha é uma CÓPIA ajustada à janela de agora; o layout guardado (L) não encolhe só porque a janela ficou pequena
  // por um instante (ou o celular girou): ao voltar a ser grande, tudo reaparece como a pessoa deixou.
  const viewOf = () => {
    const c = caixaVisivel(window), barra = document.getElementById('top')?.offsetHeight || topY;
    return D.clampToViewport(JSON.parse(JSON.stringify(L)), c.w, c.h, barra);
  };
  let lastView = '';
  function renderDesktop() {
    const V = viewOf();
    lastView = JSON.stringify([V.docks, V.floats]);
    drawerEl.hidden = true; drawerEl.replaceChildren();
    for (const side of D.SIDES) {
      const el = dockEl[side];
      el.replaceChildren();
      el.classList.toggle('empty', !L.docks[side].length);
      L.docks[side].forEach((col, ci) => {
        const c = h('div', { class: 'dcol', style: { width: V.docks[side][ci].w + 'px' } });
        const shown = col.ids.filter((id) => !wins.has(id));
        shown.forEach((id, i) => {
          const f = frames[id];
          f.style.cssText = `flex:${L.panels[id].collapsed ? '0 0 auto' : `${L.panels[id].flex} 1 0`}`;
          c.append(f);
          const nx = shown[i + 1];
          if (nx && !L.panels[id].collapsed && !L.panels[nx].collapsed) c.append(h('div', { class: 'psplit', onpointerdown: (e) => startStackResize(e, id, nx) }));
        });
        c.append(h('i', { class: 'dcol-h', title: 'Arraste para mudar a largura', onpointerdown: (e) => startColResize(e, side, col, c) }));
        el.append(c);
      });
    }
    floatsEl.replaceChildren();
    V.floats.forEach((fl, z) => {
      const f = frames[fl.id];
      f.style.cssText = `left:${fl.x}px;top:${fl.y}px;width:${fl.w}px;height:${L.panels[fl.id].collapsed ? 'auto' : fl.h + 'px'};z-index:${z + 1}`;
      floatsEl.append(f);
    });
    for (const id of ids) if (D.locate(L, id)?.zone === 'hidden') frames[id].remove();
  }

  // No celular a barra de ferramentas fica sempre à vista e o resto abre em gaveta sobre o canvas.
  const drawerGroup = () => (drawerOpen ? D.DRAWER_GROUPS[drawerOpen].filter((id) => ids.includes(id)) : []);
  function renderCompact() {
    for (const side of D.SIDES) { dockEl[side].replaceChildren(); dockEl[side].classList.add('empty'); }
    floatsEl.replaceChildren();
    const rail = h('div', { class: 'dcol', style: { width: '52px' } });
    frames.rail.style.cssText = 'flex:1 1 0';
    rail.append(frames.rail);
    dockEl.left.replaceChildren(rail); dockEl.left.classList.remove('empty');
    drawerEl.replaceChildren();
    const group = drawerGroup();
    for (const id of ids) if (id !== 'rail' && !group.includes(id)) frames[id].remove();
    drawerEl.hidden = !group.length;
    if (group.length) {
      if (!group.includes(drawerPick)) drawerPick = group[0];
      drawerEl.dataset.side = DRAWER_SIDE[drawerOpen] || 'right';
      for (const id of group) {
        frames[id].style.cssText = group.length === 1 || id === drawerPick ? 'flex:1 1 0' : 'flex:0 0 auto';
        drawerEl.append(frames[id]);
      }
    }
    document.querySelectorAll('#drawerseg [data-drawer]').forEach((b) => b.classList.toggle('on', b.dataset.drawer === drawerOpen));
  }
  // toque no cabeçalho de um painel da gaveta: abre esse e recolhe os outros do grupo
  function pickInDrawer(id) { if (frames[id].classList.contains('is-drawer') && drawerGroup().length > 1 && drawerPick !== id) { drawerPick = id; render(); } }

  const change = () => { render(); persist(); };
  // só z-index: mexer no DOM no meio de um clique faria o navegador perder o clique dos botões do cabeçalho
  const raise = (id) => { if (L.floats[L.floats.length - 1]?.id === id) return; D.raiseFloat(L, id); L.floats.forEach((fl, z) => { frames[fl.id].style.zIndex = z + 1; }); persist(); };

  // ---------- menus ----------
  function menuFor(id, anchor, at) {
    const zone = D.locate(L, id)?.zone;
    const loc = D.locate(L, id), col = loc?.zone === 'dock' ? L.docks[loc.side][loc.col] : null;
    popMenu(anchor, [
      zone === 'float' ? { label: 'Encaixar de volta', icon: 'dockin', onClick: () => redock(id) } : { label: 'Soltar sobre o canvas', icon: 'floatwin', onClick: () => toggleFloat(id) },
      { label: 'Separar em outra janela', icon: 'popout', onClick: () => detach(id) },
      '-',
      // trocar de lugar sem arrastar: dentro da coluna, para a outra lateral (empilhando) ou numa coluna nova na borda
      { label: 'Subir na coluna', icon: 'up', disabled: !col || loc.idx === 0, onClick: () => { D.movePanel(L, id, -1); change(); } },
      { label: 'Descer na coluna', icon: 'down', disabled: !col || loc.idx === col.ids.length - 1, onClick: () => { D.movePanel(L, id, +1); change(); } },
      { label: 'Empilhar na coluna da esquerda', icon: 'chevR', onClick: () => stackSide(id, 'left') },
      { label: 'Empilhar na coluna da direita', icon: 'chevR', onClick: () => stackSide(id, 'right') },
      { label: 'Coluna nova à esquerda', icon: 'chevR', onClick: () => dockSide(id, 'left') },
      { label: 'Coluna nova à direita', icon: 'chevR', onClick: () => dockSide(id, 'right') },
      '-',
      { label: L.panels[id].collapsed ? 'Expandir' : 'Recolher', icon: 'chevD', onClick: () => { D.toggleCollapsed(L, id); change(); } },
      { label: 'Ocultar painel', icon: 'x', onClick: () => { D.hidePanel(L, id); change(); } },
    ], at);
  }
  function stackSide(id, side) { closeWin(id, false); D.dockInSide(L, id, side); change(); }
  function dockSide(id, side) { D.dockNewCol(L, id, side, side === 'left' ? L.docks.left.length : L.docks.right.length); closeWin(id, false); change(); }

  const where = (id) => {
    const at = D.locate(L, id);
    return !at ? '' : at.zone === 'dock' ? WHERE[at.side] : at.zone === 'float' ? 'solto' : at.zone === 'window' ? 'outra janela' : '';
  };
  function panelsMenu(anchor) {
    if (compact) return;
    popMenu(anchor, [
      ...ids.map((id) => ({ label: panels[id].title || D.panelTitle(id), checked: D.isVisible(L, id), hint: where(id), onClick: () => (D.isVisible(L, id) ? hide(id) : show(id)) })),
      '-',
      { label: 'Ocultar / mostrar todos', hint: 'Ctrl \\', icon: 'eye', onClick: toggleAll },
      { label: 'Restaurar disposição original', icon: 'reset', onClick: reset },
      '-',
      ...(preferencias ? [
        { label: 'Guardar a disposição na conta', checked: syncLigada(), hint: preferencias.rotulo, onClick: ligarNaConta },
        ...(syncLigada() ? [{ label: 'Sincronizar agora', icon: 'reset', onClick: sincronizarAgora }] : []),
      ] : []),
      { label: 'Exportar disposição (.json)', icon: 'download', onClick: exportarDisposicao },
      { label: 'Importar disposição…', icon: 'upload', onClick: importarDisposicao },
    ]);
  }
  const panelsBtn = document.getElementById('btn-panels');
  if (panelsBtn) panelsBtn.onclick = () => panelsMenu(panelsBtn);

  // ---------- ações ----------
  function show(id) {
    if (compact) { const k = drawerKeyOf(id); if (drawerOpen !== k) { drawerOpen = k; } drawerPick = id; return render(); }
    closeWin(id, false); D.showPanel(L, id); change();
  }
  // Mostra o painel, abre e (com `exclusive`) recolhe os que dividem a coluna com ele: usado quando o editor quer chamar a atenção para uma ferramenta.
  function reveal(id, { exclusive = false } = {}) {
    if (!ids.includes(id)) return;
    if (compact) return show(id);
    closeWin(id, false);
    D.showPanel(L, id);
    if (exclusive) D.expandOnly(L, id); else L.panels[id].collapsed = false;
    change();
  }
  function hide(id) { closeWin(id, false); D.hidePanel(L, id); change(); }
  function redock(id) { closeWin(id, false); D.dockBack(L, id); change(); }
  function toggleFloat(id) {
    if (compact) return;
    closeWin(id, false);
    if (D.locate(L, id)?.zone === 'float') D.dockBack(L, id);
    else { const r = frames[id].getBoundingClientRect(); D.floatPanel(L, id, { x: clamp(r.left + 24, 0, innerWidth - 200), y: clamp(r.top + 24, topY, innerHeight - 120) }); }
    change();
  }
  function toggleAll() {
    if (compact) { closeDrawer(); return; }
    for (const id of [...wins.keys()]) closeWin(id, false);
    D.toggleAll(L); change();
  }
  function reset() { for (const id of [...wins.keys()]) closeWin(id, false); L = D.normalize(null, ids); change(); }

  // ---------- gavetas (celular) ----------
  function openDrawer(key) { drawerOpen = drawerOpen === key ? null : key; render(); }
  function closeDrawer() { drawerOpen = null; render(); }
  document.querySelectorAll('#drawerseg [data-drawer]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));

  // ---------- redimensionar ----------
  const track = (e, move, up) => {
    e.preventDefault();
    const el = e.currentTarget, doc = el.ownerDocument;
    el.setPointerCapture?.(e.pointerId);
    doc.body.classList.add('resizing');
    const mv = (ev) => move(ev);
    const end = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); doc.body.classList.remove('resizing'); up?.(ev); persist(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };

  function startColResize(e, side, col, colEl) {
    const w0 = colEl.offsetWidth, x0 = e.clientX, dir = side === 'left' ? 1 : -1;
    const others = [...app.querySelectorAll('.dcol')].reduce((a, c) => a + c.offsetWidth, 0) - w0;
    const max = Math.max(D.MIN_COL, Math.min(D.MAX_COL, innerWidth - D.MIN_CENTER - others));
    track(e, (ev) => { D.setColWidth(L, side, L.docks[side].indexOf(col), clamp(w0 + dir * (ev.clientX - x0), D.MIN_COL, max)); colEl.style.width = col.w + 'px'; });
  }

  function startStackResize(e, a, b) {
    const fa = frames[a], fb = frames[b], ha = fa.offsetHeight, hb = fb.offsetHeight, y0 = e.clientY;
    const sum = L.panels[a].flex + L.panels[b].flex, MIN = 64;
    track(e, (ev) => {
      const da = clamp(ha + (ev.clientY - y0), MIN, ha + hb - MIN);
      D.setFlex(L, [[a, sum * da / (ha + hb)], [b, sum * (ha + hb - da) / (ha + hb)]]);
      fa.style.flex = `${L.panels[a].flex} 1 0`; fb.style.flex = `${L.panels[b].flex} 1 0`;
    });
  }

  function startFloatResize(e, id, k) {
    const fl = L.floats.find((x) => x.id === id);
    if (!fl || compact) return;
    e.stopPropagation();
    const fr = frames[id].getBoundingClientRect(), r0 = { x: fr.left, y: fr.top, w: fr.width, h: fr.height }, x0 = e.clientX, y0 = e.clientY, f = frames[id];
    track(e, (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let { x, y, w, h: hh } = r0;
      if (k.includes('e')) w = r0.w + dx;
      if (k.includes('s')) hh = r0.h + dy;
      if (k.includes('w')) { w = r0.w - dx; x = r0.x + dx; }
      if (k.includes('n')) { hh = r0.h - dy; y = Math.max(topY, r0.y + dy); hh = r0.h - (y - r0.y); }
      if (w < D.MIN_FLOAT_W) { if (k.includes('w')) x -= D.MIN_FLOAT_W - w; w = D.MIN_FLOAT_W; }
      if (hh < D.MIN_FLOAT_H) { if (k.includes('n')) y -= D.MIN_FLOAT_H - hh; hh = D.MIN_FLOAT_H; }
      Object.assign(fl, { x, y, w, h: hh });
      L.panels[id].box = { w, h: hh };
      Object.assign(f.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    });
  }

  // ---------- arrastar o painel pelo cabeçalho ----------
  function onHeadDown(e, id) {
    if (e.button !== 0 || compact || wins.has(id) || e.target.closest('button')) return;
    const head = e.currentTarget, frame = frames[id], r = frame.getBoundingClientRect();
    const wasFloat = D.locate(L, id)?.zone === 'float';
    const box = L.panels[id].box;
    const grab = wasFloat ? { dx: e.clientX - r.left, dy: e.clientY - r.top } : { dx: clamp(e.clientX - r.left, 16, Math.min(box.w, r.width) - 16), dy: 14 };
    const x0 = e.clientX, y0 = e.clientY;
    head.setPointerCapture(e.pointerId);
    let on = false, ghost = null, ind = null, target = null;

    const start = () => {
      on = true; drag = id;
      document.body.classList.add('dragging-panel');
      app.classList.add('dragging-panel');
      ind = h('div', { class: 'dock-ind' }); document.body.append(ind);
      if (wasFloat) frame.classList.add('is-moving');
      else { ghost = h('div', { class: 'pnl-ghost' }, panels[id].title || D.panelTitle(id)); document.body.append(ghost); }
    };
    const pick = (ev) => {
      const x = ev.clientX, y = ev.clientY;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { kind: 'window' };
      const ar = app.getBoundingClientRect();
      for (const side of D.SIDES) {
        const cols = [...dockEl[side].querySelectorAll(':scope > .dcol')];
        for (let ci = 0; ci < cols.length; ci++) {
          const cr = cols[ci].getBoundingClientRect();
          if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) continue;
          const edge = clamp(cr.width * 0.22, 12, 36);
          if (x < cr.left + edge) return { kind: 'col', side, at: ci, rect: { x: cr.left - 2, y: cr.top, w: 4, h: cr.height } };
          if (x > cr.right - edge) return { kind: 'col', side, at: ci + 1, rect: { x: cr.right - 2, y: cr.top, w: 4, h: cr.height } };
          const frs = [...cols[ci].querySelectorAll(':scope > .pnl')].filter((f) => f.dataset.id !== id);
          let idx = 0, ly = cr.top;
          for (const f of frs) { const fr = f.getBoundingClientRect(); if (y > fr.top + fr.height / 2) { idx++; ly = fr.bottom; } else { ly = fr.top; break; } }
          return { kind: 'stack', side, col: ci, idx, rect: { x: cr.left, y: ly - 2, w: cr.width, h: 4 } };
        }
        if (!cols.length) {
          const zx = side === 'left' ? ar.left : ar.right - 64;
          if (x >= zx && x <= zx + 64 && y >= ar.top && y <= ar.bottom) return { kind: 'col', side, at: 0, rect: { x: zx, y: ar.top, w: 64, h: ar.height } };
        }
      }
      const fx = clamp(x - grab.dx, 8 - box.w + 80, innerWidth - 80), fy = clamp(y - grab.dy, topY, innerHeight - 32);
      return { kind: 'float', x: fx, y: fy, rect: { x: fx, y: fy, w: box.w, h: Math.min(box.h, 160) } };
    };
    const paint = (ev) => {
      target = pick(ev);
      const t = target;
      if (ghost) { ghost.style.left = ev.clientX - grab.dx + 'px'; ghost.style.top = ev.clientY - grab.dy + 'px'; ghost.classList.toggle('to-window', t.kind === 'window'); ghost.dataset.msg = t.kind === 'window' ? 'Solte para abrir em outra janela' : ''; }
      if (t.kind === 'float' && wasFloat) { Object.assign(frame.style, { left: t.x + 'px', top: t.y + 'px' }); ind.style.display = 'none'; }
      else if (t.kind === 'window') ind.style.display = 'none';
      else { ind.style.display = 'block'; ind.className = 'dock-ind ' + (t.kind === 'float' ? 'is-float' : t.kind === 'col' ? 'is-col' : 'is-stack'); Object.assign(ind.style, { left: t.rect.x + 'px', top: t.rect.y + 'px', width: t.rect.w + 'px', height: t.rect.h + 'px' }); }
      frame.classList.toggle('is-moving', wasFloat && (t.kind !== 'float'));
    };
    const finish = (apply, ev) => {
      head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', key, true);
      ghost?.remove(); ind?.remove();
      frame.classList.remove('is-moving');
      document.body.classList.remove('dragging-panel'); app.classList.remove('dragging-panel');
      drag = null;
      if (!on) {
        if (wasFloat) raise(id);
        else if (apply) {                                    // clique simples no cabeçalho: recolhe/expande (o duplo clique solta o painel)
          clearTimeout(clickTimers.get(id));
          clickTimers.set(id, setTimeout(() => { clickTimers.delete(id); D.toggleCollapsed(L, id); change(); }, 230));
        }
        return;
      }
      if (!apply || !target) { render(); return; }
      const t = target;
      if (t.kind === 'col') { closeWin(id, false); D.dockNewCol(L, id, t.side, t.at); }
      else if (t.kind === 'stack') { closeWin(id, false); D.dockStack(L, id, t.side, t.col, t.idx); }
      else if (t.kind === 'float') { if (wasFloat) { Object.assign(L.floats.find((f) => f.id === id), { x: t.x, y: t.y }); } else D.floatPanel(L, id, { x: t.x, y: t.y, w: box.w, h: box.h }); }
      else if (t.kind === 'window') { if (detach(id, { x: ev.screenX, y: ev.screenY })) return; }
      change();
    };
    const mv = (ev) => { if (!on) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; start(); } paint(ev); };
    const up = (ev) => finish(true, ev);
    const cancel = (ev) => finish(false, ev);
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(false, ev); } };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', cancel);
    addEventListener('keydown', key, true);
  }

  // ---------- separar em outra janela do navegador ----------
  // O painel é o mesmo pedaço de DOM, só que movido para o document da janela nova: os botões continuam ligados ao
  // editor desta janela, então tudo (seleção, desfazer, cores) segue sincronizado sem mensagens entre janelas.
  function detach(id, at) {
    if (compact || locked || wins.has(id)) return false;
    const frame = frames[id], r = frame.getBoundingClientRect();
    const w = Math.round(clamp(r.width < 120 ? L.panels[id].box.w : r.width, 220, 900)), hh = Math.round(clamp(r.height || L.panels[id].box.h, 160, 1000));
    // posição em coordenadas da TELA, ajustada à área útil do monitor (nunca "muito abaixo", nunca com a barra de título fora)
    const pos = posicaoJanela({ left: at ? at.x - 40 : screenX + 80, top: at ? at.y - 20 : screenY + 120, width: w, height: hh }, telaDisponivel(window));
    const win = open('', 'gehrarte-painel-' + id, `popup=yes,width=${pos.width},height=${pos.height},left=${pos.left},top=${pos.top}`);
    if (!win) { toast('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.', 'err'); render(); return false; }
    const d = win.document;
    d.open();
    d.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title><style>html,body{margin:0;height:100%;background:#1b1a22}body{visibility:hidden}</style></head><body class="pnl-window"></body></html>');
    d.close();
    d.title = `${panels[id].title || D.panelTitle(id)} — ArtAtk`;
    let pend = 0;
    const reveal = () => { if (!pend) d.body.style.visibility = 'visible'; };
    for (const n of document.head.querySelectorAll('link[rel=stylesheet],style')) pend += cloneStyle(n, d, () => { pend--; reveal(); });
    setTimeout(() => { pend = 0; reveal(); }, 1500);
    d.documentElement.style.cssText = document.documentElement.style.cssText;
    instalar(win);
    // o navegador/sistema às vezes reposiciona a janela nova (DPI, vários monitores): confere onde ela foi parar e corrige uma vez
    setTimeout(() => { try { const fix = corrigirJanela(retanguloJanela(win), telaDisponivel(win)); if (fix) { win.resizeTo(fix.width, fix.height); win.moveTo(fix.left, fix.top); } } catch { /* sem permissão: segue */ } }, 350);

    D.windowPanel(L, id, { w, h: hh });
    const entry = { win, d, tick: setInterval(() => { if (win.closed) closed(id); }, 700) };
    wins.set(id, entry);
    frame.style.cssText = '';
    d.body.append(frame);
    addDoc(d);
    const mark = () => setActiveDoc(d);
    d.addEventListener('pointerdown', mark, true); d.addEventListener('focusin', mark, true); win.addEventListener('focus', mark);
    win.addEventListener('pagehide', () => closed(id));
    onDocument?.(d);
    mark();
    change();
    return true;
  }
  function cloneStyle(n, d, onLoad) {
    const c = n.cloneNode(true);
    if (n.href) c.href = n.href;                 // href absoluto: o document novo é about:blank
    d.head.append(c);
    if (c.tagName === 'LINK') { c.addEventListener('load', onLoad); c.addEventListener('error', onLoad); return 1; }
    return 0;
  }
  // fontes e estilos que o editor carregar depois (Google Fonts) também vão para as janelas abertas
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches?.('link[rel=stylesheet],style')) for (const { d } of wins.values()) cloneStyle(n, d, () => {});
  }).observe(document.head, { childList: true });

  // a janela fechou (pelo X dela ou pelo botão): o painel volta para a coluna de onde saiu
  function closed(id) {
    const w = wins.get(id);
    if (!w) return;
    wins.delete(id);
    clearInterval(w.tick);
    dropDoc(w.d);
    D.dockBack(L, id);
    change();
    try { w.win.close(); } catch { /* já fechada */ }
  }
  function closeWin(id, redraw = true) {
    const w = wins.get(id);
    if (!w) return;
    wins.delete(id); clearInterval(w.tick); dropDoc(w.d);
    if (D.locate(L, id)?.zone === 'window') D.dockBack(L, id);
    try { w.win.close(); } catch { /* ok */ }
    if (redraw) change();
  }
  addEventListener('pagehide', () => { for (const { win } of wins.values()) try { win.close(); } catch { /* ok */ } });

  // ---------- celular: só na horizontal ----------
  function syncMode() {
    const was = compact;
    compact = mq.matches;
    if (compact && !was) for (const id of [...wins.keys()]) closeWin(id, false);
    if (compact !== was) { render(); onMode?.(compact); }
    const portrait = compact && innerHeight > innerWidth;
    document.body.classList.toggle('portrait-block', portrait);
    if (rotateEl) rotateEl.hidden = !portrait;
  }
  mq.addEventListener('change', syncMode);
  addEventListener('orientationchange', () => setTimeout(syncMode, 150));
  const onResize = debounce(() => {
    syncMode();
    if (compact) return onMode?.(true, true);
    const V = viewOf();
    if (JSON.stringify([V.docks, V.floats]) !== lastView) render();
  }, 120);
  addEventListener('resize', onResize);
  rotateEl?.querySelector('[data-full]')?.addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); }
    catch { toast('Não consegui travar a tela: gire o aparelho para a horizontal.', 'err'); }
  });

  render();
  syncMode();
  if (sync && syncLigada()) setTimeout(() => puxarDaConta(), 800);      // ao abrir: a conta tem uma disposição mais nova?
  onDocument?.(document);
  document.addEventListener('pointerdown', () => setActiveDoc(document), true);

  return {
    show, reveal, hide, toggleAll, reset, redock, detach, panelsMenu, openDrawer, closeDrawer,
    // publicação em andamento: painéis em outra janela também ficam inertes
    setLocked(on) { locked = on; for (const { d } of wins.values()) d.body.toggleAttribute('inert', on); },
    isCompact: () => compact,
    layout: () => L,
  };
}
