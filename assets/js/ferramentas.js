// Página de ferramentas: o cartão do editor leva ao editor (com sessão) ou ao login, que volta ao editor.
import { session } from './core/auth.js';

const card = document.getElementById('card-editor');
if (card && session()) {
  card.href = '../editor/';
  document.getElementById('acao-editor').textContent = 'Abrir o editor';
}
