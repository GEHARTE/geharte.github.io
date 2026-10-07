// "Onde ficam os meus dados" — lógica PURA (sem DOM, sem armazenamento): transforma o que o editor mediu (quantos arquivos, quanto
// espaço, o que está ligado à conta) em linhas legíveis. Quem mede é editor/opcoes.js; aqui só se decide o que dizer, e isso é testado.
import { humanSize } from './drive.js';

const pl = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const tam = (b) => (b > 0 ? ` · ${humanSize(b)}` : '');

// info: { origem, docs:{n,bytes}, imagens:{n,bytes}, modelos:n, layout:{gravado, conta:null|'Google Drive'}, regua:bool, secoes:bool,
//         sessao:bool, drive:null|{ conectado }, publicar:bool, uso:null|{usado,cota}, persistente:null|bool }
export function descreverDados(info) {
  const aqui = 'Neste navegador';
  const sec = [];
  sec.push({
    titulo: `Neste navegador (${info.origem})`,
    linhas: [
      { rotulo: 'Rascunhos das páginas', onde: aqui, detalhe: info.docs.n ? `${pl(info.docs.n, 'arquivo', 'arquivos')}${tam(info.docs.bytes)}. O que você edita é salvo aqui a cada mudança.` : 'Nenhum arquivo ainda. O que você editar é salvo aqui a cada mudança.' },
      { rotulo: 'Imagens enviadas', onde: aqui, detalhe: info.imagens.n ? `${pl(info.imagens.n, 'imagem', 'imagens')}${tam(info.imagens.bytes)}` : 'Nenhuma imagem enviada ainda.' },
      { rotulo: 'Disposição dos painéis', onde: info.layout.conta ? `${aqui} e na sua conta (${info.layout.conta})` : aqui, detalhe: info.layout.gravado ? 'Guardada. Vale para qualquer arquivo que você abrir.' : 'Ainda é a de fábrica: ela só é guardada depois da sua primeira mudança.' },
      { rotulo: 'Preferências do editor', onde: aqui, detalhe: [info.regua ? 'réguas, grade e alvo de tela' : null, info.secoes ? 'seções abertas e fechadas' : null].filter(Boolean).join(' · ') || 'Nada personalizado ainda.' },
      { rotulo: 'Meus modelos', onde: aqui, detalhe: info.modelos ? pl(info.modelos, 'modelo seu', 'modelos seus') : 'Nenhum modelo seu guardado.' },
      { rotulo: 'Seu login', onde: aqui, detalhe: info.sessao ? 'A sessão fica guardada enquanto você não sair.' : 'Este editor não pede login.' },
    ],
  });
  const fora = [];
  if (info.drive) fora.push({ rotulo: 'Materiais e cópias', onde: 'No seu Google Drive', detalhe: info.drive.conectado ? 'Conectado nesta sessão (pasta "Gehrarte — materiais").' : 'Não conectado nesta sessão. Conecte na ferramenta Drive para enviar e salvar cópias.' });
  if (info.publicar) fora.push({ rotulo: 'Páginas publicadas', onde: 'No site do Gehrarte', detalhe: 'O que você publica vai para o site; o rascunho continua aqui.' });
  if (fora.length) sec.push({ titulo: 'Fora deste navegador', linhas: fora });

  const prot = [];
  if (info.uso) prot.push({ rotulo: 'Espaço usado por este site', onde: aqui, detalhe: `${humanSize(info.uso.usado)}${info.uso.cota ? ` de ${humanSize(info.uso.cota)} disponíveis` : ''}` });
  prot.push({ rotulo: 'Proteção contra limpeza automática', onde: aqui, estado: info.persistente === true ? 'ok' : 'aviso',
    detalhe: info.persistente === true ? 'Ativa: o navegador não apaga estes dados sozinho quando falta espaço.' : info.persistente === false ? 'Desligada: se o computador ficar sem espaço, o navegador pode apagar estes dados. Salve cópias (Exportar projeto) dos arquivos importantes.' : 'Este navegador não informa.' });
  sec.push({ titulo: 'Segurança dos dados', linhas: prot });

  return {
    secoes: sec,
    nota: `Estes dados pertencem a este navegador e a este endereço (${info.origem}): em outro computador, outro navegador ou outro endereço você verá tudo vazio. Limpar os dados do site apaga tudo isto.`,
  };
}
