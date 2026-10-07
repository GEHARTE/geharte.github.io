// Menu superior do blog e das ferramentas (compartilhado por home/ e ferramentas/).
// Uso: <header id="site-nav" data-site-nav data-active="inicio|ferramentas" data-next="home/"></header>
//   data-next: para onde o Login volta depois de entrar (caminho relativo à raiz do site).
import { h } from './core/dom.js';
import { session, logout } from './core/auth.js';
import { BASE } from './core/util.js';

const U = (p) => BASE + p;
const el = document.querySelector('[data-site-nav]');

function build(host) {
  const active = host.dataset.active || '';
  const next = host.dataset.next || 'home/';
  const sess = session();

  const link = (label, href, key) => h('li', {}, h('a', { href: U(href), 'aria-current': key && key === active ? 'page' : null }, label));

  // ---- Ferramentas ▾ ----
  const toolsId = 'sn-tools';
  const dd = h('li', { class: 'sn-dd' + (active === 'ferramentas' ? ' on' : '') });
  const ddBtn = h('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': toolsId }, 'Ferramentas', h('i', { class: 'sn-caret', 'aria-hidden': 'true' }));
  const editorHref = sess ? U('documentos/') : U('login.html?next=documentos/');
  const sub = h('ul', { class: 'sn-sub', id: toolsId, 'aria-label': 'Ferramentas' },
    h('li', {}, h('a', { href: editorHref }, 'Editor de páginas', h('small', {}, sess ? 'Documentos, perfil e artigos, com animações em SVG' : 'Entre para usar — perfil e artigos'))),
    h('li', {}, h('span', { class: 'sn-soon', 'aria-disabled': 'true' }, 'Oficina de letras', h('small', {}, 'em breve'))),
    h('li', { class: 'sep' }, h('a', { href: U('ferramentas/') }, 'Todas as ferramentas →')));
  dd.append(ddBtn, sub);

  const links = h('ul', { class: 'sn-links' },
    link('Início', 'home/', 'inicio'),
    link('Artigos', 'home/#artigos'),
    link('Páginas', 'home/#paginas'),
    link('Exposições', 'home/#exposicoes'),
    link('Sobre', 'home/#sobre'),
    dd);

  // ---- Login / Meu espaço ----
  const user = h('div', { class: 'sn-user' });
  if (sess) {
    user.append(
      h('span', { class: 'sn-quem', title: sess.nome }, sess.nome),
      h('a', { class: 'sn-btn solid', href: U('documentos/') }, 'Meu espaço'),
      h('button', { class: 'sn-btn', type: 'button', onclick: () => { logout(); location.reload(); } }, 'Sair'));
  } else {
    user.append(h('a', { class: 'sn-btn solid', href: U(`login.html?next=${next}`) }, 'Login'));
  }

  const menu = h('nav', { class: 'sn-menu', id: 'sn-menu', 'aria-label': 'Principal' }, links, user);
  const burger = h('button', { class: 'sn-burger', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'sn-menu' }, h('span'));
  host.className = 'sn';
  host.replaceChildren(h('div', { class: 'sn-in' },
    h('a', { class: 'sn-brand', href: U('home/'), 'aria-label': 'Gehrarte — início do blog' }, h('img', { src: U('assets/lettering/gehrarte.svg'), alt: '', width: 131, height: 51 })),
    menu, burger));

  // ---- comportamento ----
  const items = () => [...sub.querySelectorAll('a')];
  let pinned = false;   // aberto por clique/teclado (o hover abre sem "fixar")
  const setDD = (open, focus) => {
    if (!open) pinned = false;
    dd.classList.toggle('open', open);
    ddBtn.setAttribute('aria-expanded', String(open));
    if (open && focus) items()[0]?.focus();
  };
  ddBtn.addEventListener('click', () => { pinned = !pinned; setDD(pinned); if (pinned) pinned = true; });
  ddBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pinned = true; setDD(true, true); }
    if (e.key === 'Escape') setDD(false);
  });
  sub.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { setDD(false); ddBtn.focus(); }
  });
  dd.addEventListener('focusout', (e) => { if (!dd.contains(e.relatedTarget)) setDD(false); });
  dd.addEventListener('mouseenter', () => { if (matchMedia('(min-width:901px)').matches) setDD(true); });
  dd.addEventListener('mouseleave', () => { if (matchMedia('(min-width:901px)').matches && !pinned && !dd.contains(document.activeElement)) setDD(false); });
  document.addEventListener('pointerdown', (e) => { if (!dd.contains(e.target)) setDD(false); });

  const setMenu = (open) => {
    host.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  };
  burger.addEventListener('click', () => setMenu(!host.classList.contains('open')));
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && host.classList.contains('open')) { setMenu(false); burger.focus(); } });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });   // âncora na mesma página: fecha o menu
  addEventListener('resize', () => { if (innerWidth > 900) setMenu(false); });

  // sublinha a seção da página em que se está (home/): Artigos, Páginas, Exposições, Sobre
  const secs = ['artigos', 'paginas', 'exposicoes', 'sobre'];
  if (active === 'inicio' && 'IntersectionObserver' in window) {
    const anchors = Object.fromEntries(secs.map((s) => [s, links.querySelector(`a[href$="#${s}"]`)]));
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        Object.entries(anchors).forEach(([s, a]) => a && (s === e.target.id ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
      }
    }, { rootMargin: '-35% 0px -55% 0px' });
    secs.forEach((s) => { const n = document.getElementById(s); if (n) io.observe(n); });
  }
}

if (el) build(el);
