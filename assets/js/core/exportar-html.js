// Exportação em HTML: UM arquivo autônomo (.html) que abre com duplo clique, sem servidor e sem o editor.
// Mantém: as abas de um projeto de site (navegação por #/<aba>, topo e rodapé compartilhados), a versão de PC e a de celular
// (escolhida pela largura da janela), o ajuste de escala, as animações de entrada ao rolar e os links.
// Imagens vão embutidas (data:); as fontes vêm do Google Fonts (com internet; sem ela, o navegador usa uma fonte parecida).
// Este módulo é PURO (monta texto): quem chama renderiza as páginas (render.js) e entrega o HTML de cada uma.
//
// paginas: [{ id, titulo, bg, dispositivos: { d: { w, h, html }, m?: { w, h, html } } }]   (html = artboard já renderizado)
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// texto dentro de <script>/<style>: impede que um "</script>" ou "</style>" do conteúdo feche o bloco
const seguro = (t) => String(t).replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

// Programa que roda no arquivo exportado (sem dependências): escolhe a aba pelo endereço, o dispositivo pela largura, ajusta a escala
// e dispara as animações de entrada quando cada elemento aparece.
export const RUNTIME = `(function(){
var T=document.documentElement,B=document.body,root=document.getElementById('root'),NOME=root.getAttribute('data-nome')||'';
T.className+=' js-anim';
var pgs=[].slice.call(root.querySelectorAll('.pg')),io=null,atual=null,t=0,vistos={};
function disp(){return matchMedia('(max-width:720px)').matches?'m':'d';}
function abaDoHash(){var m=location.hash.match(/^#\\/([a-z0-9-]+)/);if(m)for(var i=0;i<pgs.length;i++)if(pgs[i].getAttribute('data-id')===m[1])return pgs[i];return pgs[0];}
function observar(stage,reiniciar){
  var itens=[].slice.call(stage.querySelectorAll('.an-pre,.an-go'));
  if(reiniciar)itens.forEach(function(n){n.classList.remove('an-go');n.classList.add('an-pre');});
  if(!('IntersectionObserver' in window)){itens.forEach(function(n){n.classList.remove('an-pre');n.classList.add('an-go');});return;}
  if(io)io.disconnect();
  io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;e.target.classList.add('an-go');e.target.classList.remove('an-pre');io.unobserve(e.target);});},{threshold:0.12});
  itens.forEach(function(n){if(n.classList.contains('an-pre'))io.observe(n);});
}
function desenha(troca){
  var pg=abaDoHash(),d=disp(),mudou=pg!==atual;
  pgs.forEach(function(p){p.hidden=p!==pg;});
  var stages=[].slice.call(pg.querySelectorAll('.stage')),alvo=null;
  stages.forEach(function(s){if(s.getAttribute('data-dev')===d)alvo=s;});
  if(!alvo)alvo=stages[0];
  stages.forEach(function(s){s.hidden=s!==alvo;});
  var w=+alvo.getAttribute('data-w'),h=+alvo.getAttribute('data-h'),vw=T.clientWidth,k=Math.min(vw/w,alvo.getAttribute('data-dev')==='d'?1.5:2);
  alvo.style.width=w*k+'px';alvo.style.height=h*k+'px';alvo.firstElementChild.style.transform='scale('+k+')';
  B.style.background=alvo.getAttribute('data-bg');
  document.title=pg.getAttribute('data-titulo')+(NOME?' — '+NOME:'');
  if(mudou||troca){observar(alvo,true);atual=pg;}
  else observar(alvo,false);
}
addEventListener('hashchange',function(){desenha(true);scrollTo(0,0);});
addEventListener('resize',function(){clearTimeout(t);t=setTimeout(function(){desenha(false);},120);});
desenha(true);
})();`;

const CSS_EXPORT = `.pg[hidden],.stage[hidden]{display:none!important}
.stage{position:relative;margin:0 auto;overflow:hidden}
.artboard{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
html,body{margin:0}body{min-height:100vh;overflow-x:hidden;font-family:system-ui,sans-serif}
.abas-item:focus-visible{outline:2px solid currentColor;outline-offset:3px}`;

// Devolve o texto do arquivo .html. `css` = anim.css (+ viewer.css) já lido; `fontes` = URL do Google Fonts ou null.
export function montarHtml({ titulo, nome = '', idioma = 'pt-BR', paginas, css = '', fontes = null }) {
  if (!Array.isArray(paginas) || !paginas.length) throw new Error('Não há página para exportar.');
  const secoes = paginas.map((p) => {
    const devs = Object.entries(p.dispositivos);
    if (!devs.length) throw new Error(`A página “${p.titulo}” não tem conteúdo.`);
    // o HTML das páginas vem do renderizador (texto escapado, SVG sanitizado): um <script> aqui seria falha de segurança, então recusa
    if (devs.some(([, v]) => /<script/i.test(v.html))) throw new Error(`A página “${p.titulo}” tem um script, que não pode ir no arquivo exportado.`);
    return `<section class="pg" data-id="${esc(p.id)}" data-titulo="${esc(p.titulo)}" hidden>\n${devs.map(([dev, v]) => `<div class="stage" data-dev="${dev}" data-w="${Math.round(v.w)}" data-h="${Math.round(v.h)}" data-bg="${esc(p.bg)}" hidden>${v.html}</div>`).join('\n')}\n</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="${esc(idioma)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="generator" content="ArtAtk">
${fontes ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${esc(fontes)}">\n` : ''}<style>
${seguro(css)}
${CSS_EXPORT}
</style>
</head>
<body class="viewer">
<main id="root" data-nome="${esc(nome)}">
${secoes}
</main>
<noscript><style>.pg:first-child,.pg:first-child .stage:first-child{display:block!important}</style></noscript>
<script>${seguro(RUNTIME)}</script>
</body>
</html>
`;
}

export const nomeDoArquivoHtml = (slug, doc) => `${slug}-${doc.id}-${new Date().toISOString().slice(0, 10)}.html`;
