// CONTRATO "host" do ArtAtk — o que o editor pede ao lugar onde ele está instalado (Gehrarte, MUVVI ou nenhum).
// O ArtAtk funciona SOZINHO (host local: documentos e imagens no navegador, exportar/importar .json, sem Google nem
// GitHub). Para servir a outro site basta entregar um objeto `host`, definido ANTES de o editor carregar:
//     window.ARTATK_HOST = { id:'muvvi', identidade: async () => ({ slug, nome, perfil:'completo' }), … };
// ou com definirHost(h). Este arquivo é PURO (sem DOM nem rede): contrato, valores padrão e validação.
//
// {
//   id: 'gehrarte' | 'muvvi' | 'local' | …,
//   marca: { nome, editor:'ArtAtk' },                     // o que o visitante vê (nome do site) × o que quem edita vê
//   capacidades: { drive, publicar, paginasDoSite, perfisDaEquipe, modelos, perfilSimples },   // liga/desliga recursos
//   identidade(): Promise<null | { slug, nome, perfil:'completo'|'simples'|'leitura', podeSite? }>,
//                                                         // null = não há pessoa logada → o editor chama entrar()
//   entrar(proximo?): void,                               // leva ao login do host (no host local, não faz nada)
//   sair: null | () => void,                              // null = o host não tem conta (esconde "Sair")
//   urls: { documentos, inicio },                         // para onde voltar/sair (URLs absolutas)
//   acoes?: [{ id, rotulo, icone?, principal?, executar({ doc, slug, salvar }) }],
//                                                         // botões de saída no topo, no lugar do "Publicar" do Gehrarte
//                                                         // (MUVVI: "Salvar rascunho", "Enviar para curadoria"…)
//   modelos?: { catalogo(): Promise<modelo[]> },          // modelos extras do host (formato artatk-modelo v1)
//   preferencias?: {                                      // guarda as preferências da PESSOA (hoje: a disposição dos painéis) na conta dela
//     rotulo: 'Google Drive',                             //   nome do lugar, para o menu ("Guardar a disposição na conta (Google Drive)")
//     disponivel(ctx): Promise<boolean>,                  //   dá para ler/gravar agora? (no Gehrarte: o Drive está conectado nesta sessão)
//     conectar?(ctx): Promise<void>,                      //   prepara o acesso; chamada num CLIQUE (pode abrir a janela de login)
//     ler(ctx): Promise<string|null>,                     //   texto guardado (formato artatk-preferencias, core/preferencias.js) ou null
//     gravar(ctx, texto): Promise<void>,                  //   guarda o texto
//   },                                                    //   ctx = { slug }. Sem isto o editor guarda só neste navegador
//   fluxo?: …                                             // RESERVADO (ED-16): etapas da tela de acompanhamento da saída;
//                                                         // hoje só o fluxo do Gehrarte existe (Editor → … → No ar)
// }
// Armazenamento (docs/midia) é hoje o do navegador (core/store.js); trocá-lo pelo do host é a próxima etapa do contrato.

export const CAPACIDADES_PADRAO = { drive: false, publicar: false, paginasDoSite: false, perfisDaEquipe: false, modelos: true, perfilSimples: false };
export const PERFIS = ['completo', 'simples', 'leitura'];

// Completa um host com os valores padrão. Não altera o objeto recebido.
export function completar(h) {
  return {
    ...h,
    marca: { nome: 'ArtAtk', editor: 'ArtAtk', ...(h.marca || {}) },
    capacidades: { ...CAPACIDADES_PADRAO, ...(h.capacidades || {}) },
    sair: h.sair === undefined ? null : h.sair,
    entrar: h.entrar || (() => {}),
    urls: { documentos: '', inicio: '', ...(h.urls || {}) },
    acoes: Array.isArray(h.acoes) ? h.acoes : [],
  };
}

// Lista de problemas do host (vazia = serve). Usado ao definir o host e nos testes de quem implementa um.
export function validarHost(h) {
  const erros = [];
  if (!h || typeof h !== 'object') return ['O host precisa ser um objeto.'];
  if (!/^[a-z0-9-]{2,30}$/.test(String(h.id || ''))) erros.push('host.id deve ter 2–30 letras minúsculas, números ou hífen.');
  if (typeof h.identidade !== 'function') erros.push('host.identidade deve ser uma função (async) que devolve a pessoa ou null.');
  if (h.sair != null && typeof h.sair !== 'function') erros.push('host.sair deve ser função ou null.');
  if (h.entrar != null && typeof h.entrar !== 'function') erros.push('host.entrar deve ser função.');
  if (h.acoes != null) {
    if (!Array.isArray(h.acoes)) erros.push('host.acoes deve ser uma lista.');
    else h.acoes.forEach((a, i) => { if (!a?.id || !a?.rotulo || typeof a.executar !== 'function') erros.push(`host.acoes[${i}] precisa de id, rotulo e executar().`); });
  }
  if (h.modelos != null && typeof h.modelos.catalogo !== 'function') erros.push('host.modelos.catalogo deve ser uma função.');
  if (h.preferencias != null) {
    for (const f of ['disponivel', 'ler', 'gravar']) if (typeof h.preferencias[f] !== 'function') erros.push(`host.preferencias.${f} deve ser uma função.`);
    if (h.preferencias.conectar != null && typeof h.preferencias.conectar !== 'function') erros.push('host.preferencias.conectar deve ser uma função.');
  }
  if (h.capacidades != null) for (const k of Object.keys(h.capacidades)) if (!(k in CAPACIDADES_PADRAO)) erros.push(`Capacidade desconhecida: ${k}.`);
  return erros;
}

// Valida a identidade devolvida pelo host (para o editor não confiar cegamente).
export function identidadeValida(p) {
  return !!p && /^[a-z0-9_-]{1,40}$/i.test(String(p.slug || '')) && !!String(p.nome || '').trim() && (p.perfil == null || PERFIS.includes(p.perfil));
}

let atual = null;
export function definirHost(h) {
  const erros = validarHost(h);
  if (erros.length) throw new Error(`Host inválido: ${erros.join(' ')}`);
  atual = completar(h);
  return atual;
}
export const hostAtual = () => atual;
export const _zerarHost = () => { atual = null; };   // só para testes

// Resolve o host da página: o injetado (window.ARTATK_HOST) ou, pela config.json do site, o local ou o do Gehrarte.
// `carregarConfig` é injetado para manter este arquivo sem rede.
export async function carregarHost({ carregarConfig, global = globalThis } = {}) {
  if (atual) return atual;
  if (global.ARTATK_HOST) return definirHost(global.ARTATK_HOST);
  const cfg = (await carregarConfig?.()) || {};
  if (cfg.host === 'local') return definirHost((await import('./host-local.js')).criarHostLocal(cfg));
  return definirHost((await import('./host-gehrarte.js')).criarHostGehrarte(cfg));
}
