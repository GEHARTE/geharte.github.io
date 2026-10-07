// Navegação entre o editor e o painel de arquivos.
import { S, saveNow } from './state.js';

// Troca de página = recarrega o editor com ?doc=<id> (estado limpo, histórico novo).
export async function goToDoc(id) {
  try { await saveNow(); } catch { /* segue mesmo assim */ }
  location.href = `${location.pathname}?doc=${encodeURIComponent(id)}`;
}

// Abre o painel de arquivos já com o diálogo "Novo arquivo em branco" (o rascunho é salvo antes).
export async function goToNovoArquivo() {
  if (S.doc) { try { await saveNow(); } catch { /* segue mesmo assim */ } }
  location.href = `${S.host?.urls.documentos || '../documentos/'}?novo=1`;
}

// Volta ao painel de arquivos (o rascunho é salvo antes).
export async function goToDocuments() {
  if (S.doc) { try { await saveNow(); } catch { /* segue mesmo assim */ } }
  location.href = S.host?.urls.documentos || '../documentos/';
}
