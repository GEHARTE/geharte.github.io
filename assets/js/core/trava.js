// Trava de publicação: enquanto uma página está sendo publicada (do clique até o site mostrar a mudança), o editor dela fica
// bloqueado — mesmo que a pessoa saia e volte. O registro fica no localStorage (vale para todas as abas deste navegador).
//
// SALVAGUARDA: a trava NUNCA dura mais que TRAVA_MS (2 minutos). Passou disso, ou o vigia desistiu, ou qualquer coisa deu errado
// (registro ilegível, relógio estranho): o editor é liberado. Melhor liberar cedo do que deixar alguém sem conseguir editar.
export const TRAVA_MS = 120000;

const chave = (slug, docId) => `geharte.publicando.${slug}.${docId}`;
const seguro = (fn, d = null) => { try { return fn(); } catch { return d; } };

export function criarTrava({ storage = seguro(() => localStorage), now = () => Date.now(), ttl = TRAVA_MS } = {}) {
  const ler = (slug, docId) => {
    const rec = seguro(() => JSON.parse(storage.getItem(chave(slug, docId)) || 'null'));
    return rec && typeof rec === 'object' ? rec : null;
  };
  const gravar = (slug, docId, rec) => seguro(() => storage.setItem(chave(slug, docId), JSON.stringify(rec)));
  const apagar = (slug, docId) => seguro(() => storage.removeItem(chave(slug, docId)));

  return {
    // começa a trava; `info` = { dir, baseAt, titulo… } (o que o vigia precisa para reconhecer a página no ar)
    iniciar(slug, docId, info = {}) {
      const rec = { v: 1, slug, docId, t0: now(), fase: 'enviando', esperado: null, commit: null, ...info };
      gravar(slug, docId, rec);
      return rec;
    },
    marcar(slug, docId, patch) {
      const rec = ler(slug, docId);
      if (!rec) return null;
      const novo = { ...rec, ...patch };
      gravar(slug, docId, novo);
      return novo;
    },
    // 'livre' | 'travado' | 'expirou' (havia trava e passou do prazo: já foi removida) — com o registro e o tempo que resta
    estado(slug, docId) {
      const rec = ler(slug, docId);
      if (!rec) return { estado: 'livre', rec: null, restanteMs: 0 };
      const t0 = Number(rec.t0), idade = now() - t0;
      // relógio do futuro, t0 ilegível ou prazo vencido → libera
      if (!Number.isFinite(t0) || idade < -5000 || idade >= ttl) { apagar(slug, docId); return { estado: 'expirou', rec, restanteMs: 0 }; }
      return { estado: 'travado', rec, restanteMs: ttl - Math.max(0, idade) };
    },
    liberar: apagar,
    ttl,
  };
}
