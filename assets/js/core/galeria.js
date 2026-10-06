// Galeria de modelos do ArtAtk: grade com miniatura real (a própria página, renderizada pequena), busca e categorias.
// Serve ao editor (aba Modelos) e ao painel de documentos (Novo a partir de um modelo). Quem usa decide o que "Usar" faz.
import { h } from './dom.js';
import { renderArtboard, usedFonts } from './render.js';
import { loadFonts } from './fonts.js';
import { pageW, bgCss } from './model.js';
import { downloadBlob } from './util.js';
import { validarModelo, paginaDoModelo, ehModeloDeSite } from './modelos.js';

const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Miniatura: o topo da página em escala (o que aparece de cima, como a capa de um documento).
export function miniaturaModelo(modelo) {
  const box = h('div', { class: 'gal-thumb', role: 'img', 'aria-label': `Prévia do modelo ${modelo.nome}` });
  const doc = paginaDoModelo(modelo);
  box.style.background = bgCss(doc.page.bg);
  loadFonts(usedFonts(doc));
  const ab = renderArtboard(doc, { dev: 'd', assetUrl: () => null, editing: false });
  ab.querySelectorAll('.an-pre').forEach((n) => n.classList.remove('an-pre'));
  Object.assign(ab.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
  box.append(ab);
  const fit = () => { const w = box.clientWidth; if (w) ab.style.transform = `scale(${w / pageW(doc, 'd')})`; };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(box);
  fit();
  return box;
}

export const baixarModelo = (modelo) => downloadBlob(`artatk-modelo-${modelo.id}.json`, new Blob([JSON.stringify(modelo, null, 1)], { type: 'application/json' }));

// Lê um arquivo .json de modelo escolhido pela pessoa. Lança Error com mensagem clara.
export async function lerArquivoDeModelo(file) {
  let m;
  try { m = JSON.parse(await file.text()); } catch { throw new Error('Esse arquivo não é um JSON válido.'); }
  const v = validarModelo(m);
  if (!v.ok) throw new Error(v.erros[0]);
  return m;
}

// opts: { catalogo: async () => modelos[], meus: criarMeusModelos(), onUsar(modelo), onGerar?(), compacta?, rotuloUsar? }
// Devolve { recarregar() }.
export function montarGaleria(raiz, opts) {
  const { catalogo, meus, onUsar, onGerar, compacta = false, rotuloUsar = 'Usar este modelo', extras = [], selecionavel = false, selecionado = null, onSelecionar } = opts;
  // extras: cartões "virtuais" (ex.: Em branco) com um símbolo no lugar da miniatura; selecionavel: clicar escolhe o cartão em vez de "Usar"
  let todos = [], busca = '', cat = 'Todos', erroImport = '', sel = selecionado;
  const doMeus = new Set();
  raiz.replaceChildren();
  raiz.classList.add('gal'); raiz.classList.toggle('compacta', compacta);
  const barra = h('div', { class: 'gal-barra' });
  const cats = h('div', { class: 'gal-cats', role: 'group', 'aria-label': 'Categorias' });
  const grade = h('div', { class: 'gal-grade' });
  const aviso = h('div', { class: 'gal-msg erro', role: 'alert', hidden: true });

  const input = h('input', { type: 'search', placeholder: 'Buscar modelos', 'aria-label': 'Buscar modelos', oninput: (e) => { busca = semAcento(e.target.value); pinta(); } });
  const arq = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
    const f = arq.files[0]; arq.value = '';
    if (!f) return;
    try { meus.salvar(await lerArquivoDeModelo(f)); aviso.hidden = true; await recarregar(); } catch (e) { aviso.textContent = e.message; aviso.hidden = false; }
  } });
  barra.append(input);
  if (onGerar) barra.append(h('button', { type: 'button', class: 'gal-btn', onclick: () => onGerar(recarregar) }, 'Gerar modelo…'));
  barra.append(h('button', { type: 'button', class: 'gal-btn', onclick: () => arq.click() }, 'Importar .json'), arq);
  raiz.append(barra, aviso, cats, grade);

  function card(m) {
    const meu = doMeus.has(m.id);
    const escolher = () => { sel = m.id; onSelecionar?.(m); pinta(); };
    const el = h('article', { class: 'gal-card' + (selecionavel ? ' escolhivel' : '') + (selecionavel && sel === m.id ? ' sel' : ''), 'aria-label': m.nome,
      ...(selecionavel ? { role: 'button', tabindex: '0', 'aria-pressed': String(sel === m.id), onclick: (e) => { if (!e.target.closest('.gal-acoes')) escolher(); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(); } } } : {}) },
      m.virtual ? h('div', { class: 'gal-thumb gal-virtual', 'aria-hidden': 'true' }, h('span', { class: 'gal-glifo' }, m.glifo || '▢')) : miniaturaModelo(m),
      h('div', { class: 'gal-corpo' },
        h('b', {}, m.nome),
        h('span', { class: 'gal-chip' }, [meu ? 'Meu modelo' : m.categoria, ehModeloDeSite(m) ? ' · projeto de site' : '']),
        compacta ? null : h('small', {}, m.descricao || ''),
        h('div', { class: 'gal-acoes' },
          selecionavel ? null : h('button', { type: 'button', class: 'gal-btn primario', onclick: () => onUsar(m) }, rotuloUsar),
          meu ? h('button', { type: 'button', class: 'gal-btn', title: 'Baixar o arquivo do modelo', onclick: () => baixarModelo(m) }, 'Baixar') : null,
          meu ? h('button', { type: 'button', class: 'gal-btn', onclick: () => { if (confirm(`Remover o modelo “${m.nome}” dos seus modelos?`)) { meus.remover(m.id); recarregar(); } } }, 'Remover') : null)));
    return el;
  }

  function pinta() {
    const nomes = ['Todos', ...new Set(todos.map((m) => (doMeus.has(m.id) ? 'Meus modelos' : m.categoria)))];
    if (!nomes.includes(cat)) cat = 'Todos';
    cats.replaceChildren(...nomes.map((n) => h('button', { type: 'button', class: 'gal-cat', 'aria-pressed': String(n === cat), onclick: () => { cat = n; pinta(); } }, n)));
    const lista = todos.filter((m) => (cat === 'Todos' || (doMeus.has(m.id) ? 'Meus modelos' : m.categoria) === cat) && (!busca || semAcento([m.nome, m.descricao, m.categoria].join(' ')).includes(busca)));
    grade.replaceChildren(...(lista.length ? lista.map(card) : [h('p', { class: 'gal-vazio' }, 'Nenhum modelo encontrado.')]));
  }

  async function recarregar() {
    const [base, mine] = await Promise.all([catalogo().catch(() => []), Promise.resolve(meus.listar())]);
    doMeus.clear(); mine.forEach((m) => doMeus.add(m.id));
    const ids = new Set(mine.map((m) => m.id));
    todos = [...extras.map((x) => ({ ...x, virtual: true })), ...mine, ...base.filter((m) => !ids.has(m.id))];
    pinta();
  }
  recarregar();
  return { recarregar };
}
