// Valores que vêm de FORA (um page.json publicado, um projeto importado) e vão parar dentro de SVG/HTML montado como TEXTO precisam ser
// reduzidos ao que é inofensivo ANTES de entrar na string. Sem isso, uma "cor" como `red" onmouseover="alert(1)` fecha o atributo e cria
// outro: é injeção de atributo (XSS). Regra aqui: lista de permitidos (só passa o que reconhecemos), nunca lista de proibidos.
// Tudo puro: recebe um valor, devolve um valor seguro (o padrão, se não reconhecer).

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCAO = /^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%\s,/a-z]{1,60}\)$/i;         // rgb(1 2 3 / 50%), hsl(120deg, 50%, 50%)
const NOME = /^[a-z]{3,30}$/i;                                                 // red, rebeccapurple, transparent, currentColor
const URL_INTERNA = /^url\(#[A-Za-z0-9_-]{1,80}\)$/;                            // só referência a algo do próprio SVG (gradiente)

// Cor de preenchimento/traço. Devolve o valor se for uma cor reconhecida, senão `padrao`.
export function corSegura(v, padrao = 'none') {
  const s = String(v ?? '').trim();
  if (!s || s.length > 80) return padrao;
  if (HEX.test(s) || FUNCAO.test(s) || NOME.test(s) || URL_INTERNA.test(s)) return s;
  return padrao;
}
// Identificador usado em id="…" e url(#…): letras, números, hífen e sublinhado.
export const idSeguro = (v, padrao = 'x') => (/^[A-Za-z0-9_-]{1,80}$/.test(String(v ?? '')) ? String(v) : padrao);
// Número finito (ou o padrão): para atributos como x, y, largura, ângulo.
export const numeroSeguro = (v, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };
// Dados de caminho (atributo d): só comandos e números. Qualquer outra coisa (aspas, <, >, letras fora dos comandos) derruba o caminho inteiro.
export const caminhoSeguro = (d, padrao = '') => (typeof d === 'string' && d.length <= 200000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/.test(d) ? d : padrao);
