// Landing: (1) o botão vira "Entrar" (direto para o blog) quando já existe sessão válida; (2) nada rola:
// o texto provisório (e o oficial, depois) encolhe a fonte até caber no painel.
import { session } from './core/auth.js';
import { mountPublished } from './core/embed.js';

// Se alguém publicou a landing pelo editor (paginas/landing/page.json), ela substitui o painel original.
const host = document.getElementById('pagina-site');
try {
  host.hidden = false;
  const doc = await mountPublished(host, 'landing', { modo: 'tela', onBg: (bg) => { document.body.style.background = bg; } });
  if (doc) { document.body.classList.add('landing-doc'); document.title = `${doc.title || 'Gehrarte'} — Gehrarte`; }
  else host.hidden = true;
} catch { host.hidden = true; }
document.documentElement.classList.remove('chk');

const a = document.getElementById('entrar');
if (a && session()) {
  a.href = 'home/';
  a.setAttribute('aria-label', 'Entrar no blog do Gehrarte');
  a.querySelector('.rot').textContent = 'Entrar';
}

const box = document.querySelector('.texto-box');
const txt = document.getElementById('texto');
const MIN = 11;

function ajusta() {
  if (!box || !txt) return;
  txt.style.fontSize = '';                                  // volta ao tamanho ideal (CSS) e mede de novo
  let fs = parseFloat(getComputedStyle(txt).fontSize);
  while (fs > MIN && box.scrollHeight > box.clientHeight + 1) { fs -= 0.5; txt.style.fontSize = fs + 'px'; }
}

let t;
const agenda = () => { clearTimeout(t); t = setTimeout(ajusta, 80); };
ajusta();
addEventListener('resize', agenda);
addEventListener('orientationchange', agenda);
if (document.fonts?.ready) document.fonts.ready.then(ajusta);
addEventListener('load', ajusta);
