// Quem pode editar o quê numa plataforma do ArtAtk — PURO (sem DOM, sem rede).
//
// O ArtAtk serve a mais de um lugar (o blog Gehrarte, o museu MUVVI, e o que vier). Em todos, a tela de Arquivos mostra o
// que está **publicado naquela plataforma** — e nem tudo que se vê se edita. A regra de quem pode mexer em quê mora aqui,
// num lugar só, para a tela e o editor responderem a mesma coisa.
//
// Três coisas decidem:
//   · a PESSOA  — `{ slug, perfil: 'completo' | 'simples' | 'leitura', podeSite }` (o que `host.identidade()` devolve);
//   · a PÁGINA  — `{ tipo, dono }`, onde `dono` é o slug de quem ela pertence (vazio = ninguém em especial);
//   · a CASA    — `host.capacidades`, que diz se aquela plataforma tem páginas de site e perfis de equipe.
//
// A regra em uma frase: **cada pessoa edita o que é seu; as páginas da plataforma, só quem a organiza.**

export const TIPOS_DA_PLATAFORMA = ['pagina'];                 // páginas do site: pertencem à casa, não a uma pessoa
export const TIPOS_DA_PESSOA = ['perfil', 'artigo', 'arquivo', 'site'];

// Devolve { pode, motivo }. `motivo` é o texto que a interface mostra quando não dá — em português, sem jargão.
export function permissao(pagina, sessao, capacidades = {}) {
  const tipo = pagina?.tipo || '';
  const dono = pagina?.dono || '';
  const eu = sessao?.slug || '';

  if (!sessao) return { pode: false, motivo: 'Entre para editar.' };
  if (sessao.perfil === 'leitura') return { pode: false, motivo: 'A sua conta é de leitura: dá para ver, não para editar.' };

  if (TIPOS_DA_PLATAFORMA.includes(tipo)) {
    if (!capacidades.paginasDoSite) return { pode: false, motivo: 'Esta plataforma não edita páginas do site por aqui.' };
    if (!sessao.podeSite) return { pode: false, motivo: 'Só quem organiza o site pode editar esta página. Você pode abrir e ver como ela está.' };
    return { pode: true, motivo: '' };
  }

  if (!dono || dono === eu) return { pode: true, motivo: '' };
  return { pode: false, motivo: `Esta página é de ${pagina.donoNome || 'outra pessoa'} — só quem fez edita.` };
}

export const podeEditar = (pagina, sessao, capacidades) => permissao(pagina, sessao, capacidades).pode;

// O texto do cabeçalho de "Páginas publicadas": muda com a plataforma e com o que a pessoa pode fazer nela.
export function resumoDaPlataforma(marca, sessao, capacidades = {}) {
  const nome = marca || 'nesta plataforma';
  const base = `O que já está no ar ${nome.startsWith('n') ? nome : `no ${nome}`}.`;
  if (!sessao || sessao.perfil === 'leitura') return `${base} Você pode abrir e ver como cada página está.`;
  if (capacidades.paginasDoSite && sessao.podeSite) return `${base} Você organiza o site: dá para editar as páginas daqui, e Publicar leva a mudança ao ar.`;
  return `${base} Você edita o que é seu; as páginas da plataforma são de quem a organiza, e aparecem aqui para ver.`;
}
