// Landing: (1) o botão vira "Entrar" (direto para o blog) quando já existe sessão válida; (2) nada rola:
// o texto provisório (e o oficial, depois) encolhe a fonte até caber no painel.
import { session } from './core/auth.js';

const a = document.getElementById('entrar');
if (a && session()) {
  a.href = 'home/';
  a.setAttribute('aria-label', 'Entrar no blog do Geharte');
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
