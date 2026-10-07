// Registro dos modos do criador de SVG animado. Fica num arquivo próprio para um modo novo poder se registrar sem importar a janela
// (criador-svg.js importa os modos; se os modos importassem a janela haveria import circular).
//
// Um modo é { id, rotulo, montar(container, ctx) → { exportarSvg(): string, destruir(), temAlteracoes(): boolean, nome?(): string } }.
// O modo "pinos" (core/pinos.js) entra com UMA linha: em criador-svg.js, `import './criador-svg-pinos.js';`, e o módulo dele chama
// `registrarModo({ id: 'pinos', rotulo: 'Pinos de deformação', montar })` no fim.
export const MODOS = [];
export function registrarModo(modo) {
  if (!modo?.id || typeof modo.montar !== 'function') throw new Error('Modo inválido: precisa de id e montar().');
  const i = MODOS.findIndex((m) => m.id === modo.id);
  if (i >= 0) MODOS[i] = modo; else MODOS.push(modo);
  return modo;
}
