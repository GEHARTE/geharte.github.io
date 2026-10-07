// Página de ferramentas: o cartão do editor leva ao painel de arquivos (com sessão) ou ao login, que volta a ele.
import { session } from './core/auth.js';

const card = document.getElementById('card-editor');
if (card && session()) {
  card.href = '../arquivos/';
  document.getElementById('acao-editor').textContent = 'Abrir o editor';
}
