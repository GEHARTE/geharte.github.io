// Exportar a PÁGINA como imagem PNG/JPEG (REQ-RG, RG-14) — partes puras, sem DOM nem rede (testáveis em Node).
// O desenho em si usa o próprio navegador: a página é aberta no visualizador em modo "estado final" (o mesmo do PDF), vira um SVG com
// <foreignObject> que carrega o HTML + CSS + fontes + imagens JÁ EMBUTIDOS, e esse SVG é pintado num canvas na escala escolhida.
// Fica igual ao que se vê (texto, degradês, sombras, formas, imagens, SVG) sem biblioteca nem servidor. Aqui: contas de tamanho,
// reescrita de CSS (fontes só dos caracteres usados, URLs viram dados) e a montagem do SVG.

export const LIMITE_LADO = 16384;          // px: lado máximo de um canvas confiável nos navegadores
export const LIMITE_AREA = 100e6;          // px: área máxima (≈ 400 MB de memória em RGBA)
export const ESCALAS_TELA = [1, 2, 3];
export const PPIS_PAPEL = [72, 150, 300, 600];
export const FORMATOS = { png: { mime: 'image/png', ext: 'png', rotulo: 'PNG' }, jpeg: { mime: 'image/jpeg', ext: 'jpg', rotulo: 'JPEG' } };

export const escalaDePpi = (ppi) => (Number(ppi) > 0 ? Number(ppi) / 96 : 1);          // 1 px de documento = 1/96 pol

// Tamanho final em px para a escala pedida, reduzindo se passar dos limites do canvas. { escala, limitada, px:{w,h} }
export function escalaSegura({ w, h }, escala) {
  const e0 = Number(escala) > 0 ? Number(escala) : 1;
  const maxLado = LIMITE_LADO / Math.max(w, h), maxArea = Math.sqrt(LIMITE_AREA / (w * h));
  const e = Math.min(e0, maxLado, maxArea);
  const limitada = e < e0 - 1e-9;
  return { escala: limitada ? Math.floor(e * 1000) / 1000 : e0, limitada, px: { w: Math.round(w * (limitada ? Math.floor(e * 1000) / 1000 : e0)), h: Math.round(h * (limitada ? Math.floor(e * 1000) / 1000 : e0)) } };
}

export function nomeDoArquivo(titulo, { sufixo = '', formato = 'png' } = {}) {
  const base = String(titulo || 'pagina').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'pagina';
  return `${base}${sufixo ? '-' + sufixo : ''}.${(FORMATOS[formato] || FORMATOS.png).ext}`;
}

// ---------- CSS ----------
// unicode-range ("U+0000-00FF, U+0131, U+4??") → [[de, até], …]
export function lerUnicodeRange(texto) {
  const out = [];
  for (const parte of String(texto).split(',')) {
    const m = parte.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!m) continue;
    if (m[1].includes('?')) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)]);
    else out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
  }
  return out;
}
// Mantém só os @font-face cujo unicode-range cobre algum caractere do texto (o Google Fonts manda ~6 subconjuntos por família; embutir
// todos pesaria megabytes). @font-face sem unicode-range fica sempre.
export function filtrarFontFaces(css, texto) {
  const usados = new Set([...String(texto)].map((c) => c.codePointAt(0)));
  return css.replace(/@font-face\s*\{[^}]*\}/g, (bloco) => {
    const m = bloco.match(/unicode-range\s*:\s*([^;}]+)/i);
    if (!m) return bloco;
    const faixas = lerUnicodeRange(m[1]);
    return faixas.some(([a, b]) => { for (const c of usados) if (c >= a && c <= b) return true; return false; }) ? bloco : '';
  });
}

// url(...) do CSS → dados embutidos. `obter(urlAbsoluta)` devolve um data: URI (ou null para deixar como está).
export async function embutirUrlsDoCss(css, base, obter) {
  const achados = new Map();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const ref = m[2].trim();
    if (!ref || ref.startsWith('data:') || ref.startsWith('#')) continue;
    try { achados.set(ref, new URL(ref, base).href); } catch { /* endereço inválido: fica */ }
  }
  const dados = new Map(await Promise.all([...achados].map(async ([ref, abs]) => [ref, await Promise.resolve(obter(abs)).catch(() => null)])));
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (todo, _q, ref) => (dados.get(ref.trim()) ? `url("${dados.get(ref.trim())}")` : todo));
}

// O CSS da página fala de <html> e <body>; dentro do SVG o "chão" é uma <div>: os seletores passam a mirar nela.
export function reescreverRaiz(css, classe = '__raiz') {
  return css
    .replace(/html\.print-mode/g, `.${classe}`).replace(/body\.viewer/g, `.${classe}`)
    .replace(/(^|[\s,{}>+~])(?:html|body)(?=[\s,{.:#[>+~]|$)/g, `$1.${classe}`);
}

// Sem @import (não carregaria dentro do SVG) e sem animações: o estado final já foi gravado nos estilos dos elementos.
export const CSS_ESTATICO = '*,*::before,*::after{animation:none!important;transition:none!important}';
export const semImport = (css) => css.replace(/@import[^;]+;/g, '');

// ---------- SVG com foreignObject ----------
// `corpoXhtml`: o chão (<div class="__raiz" …>…</div>) já serializado como XHTML, com o <style> dentro.
export function montarSvg({ w, h, corpoXhtml }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${corpoXhtml}</foreignObject></svg>`;
}
