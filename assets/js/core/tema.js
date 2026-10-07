// Tema claro/noturno do painel de Arquivos — lógica PURA. A pessoa escolhe no botão do topo; sem escolha vale o do sistema.
export const CHAVE_TEMA = 'artatk.tema';
export const normalizarTema = (v) => (v === 'claro' || v === 'escuro' ? v : null);
export const temaEfetivo = (guardado, sistemaEscuro) => normalizarTema(guardado) || (sistemaEscuro ? 'escuro' : 'claro');
export const alternarTema = (atual) => (atual === 'escuro' ? 'claro' : 'escuro');
