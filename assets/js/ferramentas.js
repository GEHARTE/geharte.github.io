// Página de ferramentas: com sessão, cada cartão leva direto à ferramenta; sem sessão, ao login, que volta para ela.
import { session } from './core/auth.js';

const abrir = (idCartao, idAcao, href, rotulo) => {
  const card = document.getElementById(idCartao);
  if (!card) return;
  card.href = href;
  const acao = document.getElementById(idAcao);
  if (acao) acao.textContent = rotulo;
};

if (session()) {
  abrir('card-editor', 'acao-editor', '../arquivos/', 'Abrir o editor');
  abrir('card-animador', 'acao-animador', '../editor/?animador=1', 'Abrir o animador');
}
