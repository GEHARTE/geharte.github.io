// Landing: só ajusta o botão quando já há sessão.
import { session } from './core/auth.js';

const s = session();
const a = document.getElementById('login');
if (s && a) { a.textContent = 'Meu editor'; a.href = 'editor/'; }
