// Modelos de página do ArtAtk — lógica PURA (sem DOM, sem rede): validar, criar a partir de uma página,
// aplicar a um documento, GERAR a partir de uma especificação e guardar "meus modelos".
//
// Um modelo é um JSON aberto e versionado (ED-11):
//   { format:'artatk-modelo', v:1, id, nome, descricao, categoria, origem, doc:{ page, elements } }
// Não leva imagens enviadas (ficariam sem arquivo): vira um quadro "Imagem" para a pessoa trocar.
// A especificação (spec) é uma descrição declarativa de seções (topo, hero, cards…) que o gerador converte nos
// elementos do canvas, com layout de PC (1200) e de celular (390). É por ela que se produz um modelo novo a
// partir de um briefing — por exemplo, o do setor de design do MUVVI — sem desenhar elemento por elemento.
import { newDoc, makeElement, W, garantirSite, ABAS_PADRAO } from './model.js';
import { guardarAbaAtual, carregarAbaAtiva, docDeAba } from './sites.js';
import { uid, clone } from './util.js';

export const FORMATO = 'artatk-modelo';
export const MODELO_V = 1;
const TIPOS = ['text', 'shape', 'path', 'image', 'svg', 'abas'];
const MAX_ELEMENTOS = 400;
const ID_OK = /^[a-z0-9][a-z0-9-]{0,59}$/;

// ---------- validação ----------
export function validarModelo(m) {
  const erros = [];
  if (!m || typeof m !== 'object') return { ok: false, erros: ['O arquivo está vazio ou não é um modelo.'] };
  if (m.format !== FORMATO) erros.push(`Formato desconhecido (esperado "${FORMATO}").`);
  if (m.v !== MODELO_V) erros.push(`Versão do modelo não suportada (${m.v}).`);
  if (!ID_OK.test(String(m.id || ''))) erros.push('O id do modelo deve ter só letras minúsculas, números e hífen.');
  if (!String(m.nome || '').trim()) erros.push('O modelo precisa de um nome.');
  const d = m.doc;
  const elementos = (lista, onde) => {
    if (!Array.isArray(lista)) { erros.push(`${onde}: falta a lista de elementos.`); return 0; }
    lista.slice(0, MAX_ELEMENTOS).forEach((e, i) => {
      if (!TIPOS.includes(e?.t)) erros.push(`${onde}, elemento ${i + 1}: tipo "${e?.t}" não é suportado.`);
      else if (![e.f?.d?.x, e.f?.d?.y, e.f?.d?.w, e.f?.d?.h].every(Number.isFinite)) erros.push(`${onde}, elemento ${i + 1}: posição ou tamanho inválidos.`);
      else if (e.t === 'image' && e.asset) erros.push(`${onde}, elemento ${i + 1}: modelos não levam imagens enviadas.`);
    });
    return lista.length;
  };
  const pagina = (pg, onde) => { if (!pg?.bg || !(pg?.h?.d > 0)) erros.push(`${onde}: sem fundo ou altura.`); };
  if (!d || typeof d !== 'object') erros.push('O modelo não tem página (doc).');
  else if (d.kind === 'site') {
    // projeto de site: abas + compartilhados, em forma consolidada
    if (!Array.isArray(d.abas) || !d.abas.length) erros.push('O projeto de site precisa de pelo menos uma aba.');
    else {
      const ids = new Set();
      let total = 0;
      for (const a of d.abas) {
        if (!ID_OK.test(String(a?.id || ''))) erros.push(`Aba "${a?.nome}": id inválido.`);
        if (ids.has(a?.id)) erros.push(`Aba repetida: ${a.id}.`); ids.add(a?.id);
        pagina(a?.page, `Aba "${a?.nome}"`); total += elementos(a?.elements, `Aba "${a?.nome}"`);
      }
      if (!ids.has(d.abaAtiva)) erros.push('abaAtiva não é uma das abas.');
      if (!(d.comum?.hRef?.d > 0)) erros.push('Falta a altura de referência do rodapé (comum.hRef).');
      total += elementos(d.comum?.elements, 'Compartilhados');
      if (total > MAX_ELEMENTOS * 4) erros.push(`Elementos demais (${total}).`);
    }
  } else {
    pagina(d.page, 'A página');
    if (elementos(d.elements, 'A página') > MAX_ELEMENTOS) erros.push(`Elementos demais (máximo ${MAX_ELEMENTOS}).`);
  }
  return { ok: !erros.length, erros };
}

// ---------- página ↔ modelo ----------
const PLACEHOLDER_IMG = '#d9d4c7';

// Imagem enviada → quadro "Imagem" (modelos não levam arquivos). Devolve o elemento novo e registra o aviso.
function semImagem(e, avisos) {
  if (e.t !== 'image') return e;
  avisos.push(`A imagem "${e.name || 'sem nome'}" virou um quadro: modelos não levam imagens enviadas.`);
  const q = makeElement('shape', { name: `${e.name || 'Imagem'} (troque)`, shape: 'rect', label: 'Imagem', s: { fill: PLACEHOLDER_IMG, radius: e.s?.radius || 0 }, ls: { fontFamily: 'Inter', fontSize: 18, fontWeight: 500, color: '#6a6458' } }, e.f.d);
  if (e.f.m) q.f.m = { fs: 14, ...e.f.m };
  return q;
}

// Copia a página (ou o projeto de site inteiro) de um documento para um modelo.
export function modeloDeDoc(doc, meta = {}) {
  const avisos = [];
  let d;
  if (doc.kind === 'site') {
    const c = clone(doc); garantirSite(c); guardarAbaAtual(c);
    d = { kind: 'site', abaAtiva: c.abaAtiva, comum: { hRef: c.comum.hRef, elements: c.comum.elements.map((e) => semImagem(e, avisos)) },
      abas: c.abas.map((a) => ({ id: a.id, nome: a.nome, titulo: a.titulo, page: a.page, elements: a.elements.map((e) => semImagem(e, avisos)) })) };
  } else {
    d = clone({ page: doc.page, elements: doc.elements });
    d.elements = d.elements.map((e) => semImagem(e, avisos));
  }
  const modelo = {
    format: FORMATO, v: MODELO_V,
    id: meta.id || slugModelo(meta.nome || doc.title || 'modelo'),
    nome: String(meta.nome || doc.title || 'Modelo').trim(),
    descricao: String(meta.descricao || '').trim(),
    categoria: String(meta.categoria || 'Meus modelos').trim(),
    origem: meta.origem || 'pagina',
    doc: d,
  };
  return { modelo, avisos };
}

export const slugModelo = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'modelo';
export const ehModeloDeSite = (m) => m?.doc?.kind === 'site';

// Conteúdo do modelo, com ids novos (para aplicar a um documento sem colidir com nada).
// Página: { page, elements }. Projeto de site: { site:true, abas, comum, abaAtiva }.
export function conteudoDoModelo(modelo) {
  const c = clone(modelo.doc);
  if (c.kind === 'site') {
    for (const a of c.abas) for (const e of a.elements) e.id = uid();
    for (const e of c.comum.elements) e.id = uid();
    return { site: true, abas: c.abas, comum: c.comum, abaAtiva: c.abaAtiva };
  }
  for (const e of c.elements) e.id = uid();
  return { page: c.page, elements: c.elements };
}

// Aplica o modelo a um documento existente (altera `doc`). Modelo de site → o documento vira projeto de site; modelo de página →
// substitui a página (num projeto de site, só a aba aberta: o topo e o rodapé compartilhados ficam). Devolve false se não pode (ex.: perfil).
export function aplicarModeloAoDoc(doc, modelo) {
  const c = conteudoDoModelo(modelo);
  if (c.site) {
    if (doc.kind !== 'site' && doc.kind !== 'artigo') return false;
    doc.kind = 'site'; doc.abas = c.abas; doc.comum = c.comum; doc.abaAtiva = c.abaAtiva;
    carregarAbaAtiva(doc);
    return true;
  }
  if (doc.kind === 'site') { const comuns = doc.elements.filter((e) => e.comum); doc.elements = [...c.elements, ...comuns]; }
  else doc.elements = c.elements;
  doc.page = c.page;
  return true;
}

// Documento novo (artigo, perfil ou — se o modelo é de site — projeto de site) com o conteúdo do modelo.
export function docDeModelo(modelo, owner, { id, title, kind = 'artigo' } = {}) {
  const site = ehModeloDeSite(modelo);
  const doc = newDoc(owner, title || modelo.nome, site ? 'site' : kind, id);
  const c = conteudoDoModelo(modelo);
  if (c.site) { doc.abas = c.abas; doc.comum = c.comum; doc.abaAtiva = c.abaAtiva; carregarAbaAtiva(doc); }
  else { doc.page = c.page; doc.elements = c.elements; }
  return doc;
}

// Documento de UMA página para pré-visualizar (miniatura): a primeira aba, com topo e rodapé.
export function paginaDoModelo(modelo) {
  if (!ehModeloDeSite(modelo)) return { page: modelo.doc.page, elements: modelo.doc.elements, assets: {} };
  const d = docDeModelo(modelo, 'x', { id: 'previa' });
  return docDeAba(d, d.abas[0].id);
}

// ---------- gerador a partir de especificação ----------
export const TEMA_PADRAO = {
  fundo: '#ffffff', texto: '#17161d', suave: '#5a5766', escuro: '#17161d', sobreEscuro: '#ffffff',
  acento: '#e4572e', sobreAcento: '#ffffff', superficie: '#f1ede4', fonteTitulo: 'Playfair Display', fonteTexto: 'Inter', raio: 16,
};
const D = { mx: 100, cw: 1000, pad: 88 };      // PC: margem, largura útil, respiro vertical
const M = { mx: 24, cw: 342, pad: 44 };        // celular

// Altura estimada de um texto (o editor refaz a medida real ao abrir: `ah`). Largura média de caractere ≈ 0,52 em.
export function alturaTexto(texto, size, lh, largura) {
  const linhas = String(texto).split('\n').reduce((n, p) => n + Math.max(1, Math.ceil((p.length * size * 0.52) / Math.max(40, largura))), 0);
  return Math.ceil(linhas * size * lh);
}

// Motor de layout: transforma uma lista de seções em elementos, a partir de um cursor vertical `inicio` (PC e celular).
// `site` (opcional) traz { abas:[{id,nome}] } para a barra de abas do topo e os links entre abas.
function motor(spec, T, inicio = { d: 0, m: 0 }, site = null) {
  const els = [];
  const cur = { d: inicio.d, m: inicio.m };      // cursor vertical de cada dispositivo
  let n = 0;

  const el = (t, nome, props, d, m) => {
    const e = makeElement(t, { name: nome, ...props }, d);
    if (m) e.f.m = { r: 0, ...m };
    els.push(e);
    return e;
  };
  const estilo = (fam, size, w, cor, extra = {}) => ({ fontFamily: fam, fontSize: size, fontWeight: w, color: cor, lh: 1.3, ...extra });
  const entra = (e, delay) => { e.an = { in: { k: 'fade-up', dur: 0.7, delay, ease: 'ease-out' } }; };
  const anim = spec.animar !== false;
  // ligação de um item: texto = endereço; { aba } = outra aba do projeto; { href } = endereço
  const lnk = (x) => (typeof x === 'string' ? { href: x, blank: false } : x?.aba ? { aba: x.aba } : x?.href ? { href: x.href, blank: false } : null);

  // texto com frame de PC e de celular; devolve as alturas usadas
  const texto = (nome, txt, estD, estM, dx, dy, dw, mx, my, mw, extra = {}) => {
    const hd = alturaTexto(txt, estD.fontSize, estD.lh, dw), hm = alturaTexto(txt, estM.fontSize, estM.lh, mw);
    const e = el('text', nome, { text: txt, s: estD, ...extra }, { x: dx, y: dy, w: dw, h: hd }, { x: mx, y: my, w: mw, h: hm, fs: estM.fontSize });
    return { e, hd, hm };
  };
  const faixa = (nome, cor, yd, hd, ym, hm) => el('shape', nome, { shape: 'rect', s: { fill: cor, radius: 0, stroke: null, sw: 0 } }, { x: 0, y: yd, w: W.d, h: hd }, { x: 0, y: ym, w: W.m, h: hm });
  const botao = (rotulo, lig, yd, ym, centrado = false, invertido = false) => el('shape', `Botão ${rotulo}`, { shape: 'rect', label: rotulo, link: lnk(lig), s: { fill: invertido ? T.escuro : T.acento, radius: 9999, stroke: null, sw: 0 }, ls: { fontFamily: T.fonteTexto, fontSize: 20, fontWeight: 600, color: invertido ? T.sobreEscuro : T.sobreAcento } },
    { x: centrado ? (W.d - 240) / 2 : D.mx, y: yd, w: 240, h: 56 }, { x: centrado ? (W.m - 220) / 2 : M.mx, y: ym, w: 220, h: 50, fs: 17 });
  const quadroImagem = (nome, d, m, rotulo = 'Imagem') => el('shape', nome, { shape: 'rect', label: rotulo, s: { fill: PLACEHOLDER_IMG, radius: T.raio, stroke: null, sw: 0 }, ls: { fontFamily: T.fonteTexto, fontSize: 18, fontWeight: 500, color: '#6a6458' } }, d, { fs: 14, ...m });

  const secoes = {
    // barra do topo: marca à esquerda e links à direita; no celular os links quebram em linhas sob a marca
    topo(s) {
      if (s.abas && site) {
        // topo de projeto de site: marca em cima e, embaixo, a BARRA DE ABAS funcional (quebra em linhas se não couber)
        const nomes = site.abas.map((x) => x.nome);
        const linhas = (fs, largura, gap) => { let x = 0, n = 1; for (const nm of nomes) { const w = Math.ceil(nm.length * fs * 0.56) + 4; if (x + w > largura && x > 0) { n++; x = 0; } x += w + gap; } return n; };
        const rd = linhas(15, D.cw, 22), rm = linhas(14, M.cw, 19);
        const hd = 64 + rd * 34 + 12, hm = 56 + rm * 30 + 12, yd = cur.d, ym = cur.m;
        faixa('Barra do topo', T.escuro, yd, hd, ym, hm);
        texto('Marca', s.marca || 'Marca', estilo(T.fonteTitulo, 26, 700, T.sobreEscuro, { lh: 1.1 }), estilo(T.fonteTitulo, 22, 700, T.sobreEscuro, { lh: 1.1 }), D.mx, yd + 20, 600, M.mx, ym + 14, M.cw);
        el('abas', 'Barra de abas', { ls: { fontFamily: T.fonteTexto, fontSize: 15, fontWeight: 600, color: T.sobreEscuro }, abas: { ...ABAS_PADRAO, estilo: 'sublinhado', corAtiva: T.acento, gap: 22 } },
          { x: D.mx, y: yd + 64, w: D.cw, h: rd * 34 }, { x: M.mx, y: ym + 56, w: M.cw, h: rm * 30, fs: 14 });
        cur.d += hd; cur.m += hm;
        return;
      }
      const links = (s.links || []).map((l) => (typeof l === 'string' ? { rotulo: l } : l));
      const larg = (l, fs) => Math.ceil(l.rotulo.length * fs * 0.56) + 4;
      // celular: distribui os links em linhas de até M.cw
      const pos = []; let x = M.mx, linha = 0;
      for (const l of links) { const w = larg(l, 14); if (x + w > M.mx + M.cw && x > M.mx) { x = M.mx; linha++; } pos.push({ x, linha, w }); x += w + 18; }
      const linhasM = links.length ? linha + 1 : 0;
      const hd = 72, hm = 58 + linhasM * 28 + (linhasM ? 8 : 0), yd = cur.d, ym = cur.m;
      faixa('Barra do topo', T.escuro, yd, hd, ym, hm);
      texto('Marca', s.marca || 'Marca', estilo(T.fonteTitulo, 26, 700, T.sobreEscuro, { lh: 1.1 }), estilo(T.fonteTitulo, 22, 700, T.sobreEscuro, { lh: 1.1 }), D.mx, yd + 22, 400, M.mx, ym + 18, M.cw);
      let xd = W.d - D.mx;
      const dx = []; for (let i = links.length - 1; i >= 0; i--) { const w = larg(links[i], 15); xd -= w; dx[i] = { x: xd, w }; xd -= 26; }   // do último para o primeiro: o primeiro fica mais à esquerda
      links.forEach((l, i) => {
        el('text', `Link ${l.rotulo}`, { text: l.rotulo, link: lnk(l), s: estilo(T.fonteTexto, 15, 500, T.sobreEscuro, { lh: 1.2 }) },
          { x: dx[i].x, y: yd + 26, w: dx[i].w, h: 20 }, { x: pos[i].x, y: ym + 58 + pos[i].linha * 28, w: pos[i].w, h: 20, fs: 14 });
      });
      cur.d += hd; cur.m += hm;
    },

    hero(s) {
      const fundo = s.fundo === 'claro' ? null : s.fundo === 'acento' ? T.acento : T.escuro;
      const cor = fundo ? (s.fundo === 'acento' ? T.sobreAcento : T.sobreEscuro) : T.texto;
      const suave = fundo ? cor : T.suave;
      const yd = cur.d, ym = cur.m;
      const colD = s.imagem ? 560 : D.cw, colM = M.cw;
      let dd = yd + D.pad, dm = ym + M.pad;
      const itens = [];
      if (s.kicker) { const k = texto('Etiqueta', s.kicker, estilo(T.fonteTexto, 15, 700, fundo ? T.sobreEscuro : T.acento, { upper: true, ls: 0.18, lh: 1.2 }), estilo(T.fonteTexto, 13, 700, fundo ? T.sobreEscuro : T.acento, { upper: true, ls: 0.18, lh: 1.2 }), D.mx, dd, colD, M.mx, dm, colM); itens.push(k.e); dd += k.hd + 18; dm += k.hm + 12; }
      const t = texto('Título', s.titulo, estilo(T.fonteTitulo, 64, 700, cor, { lh: 1.08, ls: -0.015 }), estilo(T.fonteTitulo, 34, 700, cor, { lh: 1.12 }), D.mx, dd, colD, M.mx, dm, colM);
      itens.push(t.e); dd += t.hd + 24; dm += t.hm + 16;
      if (s.texto) { const p = texto('Texto', s.texto, estilo(T.fonteTexto, 21, 400, suave, { lh: 1.55 }), estilo(T.fonteTexto, 17, 400, suave, { lh: 1.55 }), D.mx, dd, colD, M.mx, dm, colM); itens.push(p.e); dd += p.hd + 36; dm += p.hm + 28; }
      if (s.botao) { itens.push(botao(s.botao.rotulo, s.botao, dd, dm, false, s.fundo === 'acento')); dd += 56 + 8; dm += 50 + 8; }
      const hdTotal = Math.max(dd + D.pad - yd, s.imagem ? 480 : 0), hmTotal = dm + M.pad - ym + (s.imagem ? 220 + 28 : 0);
      if (fundo) { const f = faixa('Fundo do destaque', fundo, yd, hdTotal, ym, hmTotal); els.splice(els.indexOf(f), 1); els.splice(els.length - itens.length, 0, f); }
      if (s.imagem) { const q = quadroImagem('Imagem do destaque', { x: 680, y: yd + 48, w: 420, h: hdTotal - 96 }, { x: M.mx, y: dm, w: M.cw, h: 220 }, s.imagemRotulo || 'Imagem'); itens.push(q); }
      if (anim) itens.forEach((e, i) => entra(e, i * 0.12));
      cur.d = yd + hdTotal; cur.m = ym + hmTotal;
    },

    texto(s) {
      let dd = cur.d + D.pad, dm = cur.m + M.pad;
      if (s.titulo) { const t = texto('Título da seção', s.titulo, estilo(T.fonteTitulo, 42, 700, T.texto, { lh: 1.15 }), estilo(T.fonteTitulo, 28, 700, T.texto, { lh: 1.15 }), D.mx, dd, D.cw, M.mx, dm, M.cw); dd += t.hd + 22; dm += t.hm + 16; }
      (s.paragrafos || []).forEach((p, i) => { const t = texto(`Parágrafo ${i + 1}`, p, estilo(T.fonteTexto, 20, 400, T.texto, { lh: 1.7 }), estilo(T.fonteTexto, 17, 400, T.texto, { lh: 1.7 }), D.mx, dd, Math.min(D.cw, 760), M.mx, dm, M.cw); dd += t.hd + 18; dm += t.hm + 14; });
      cur.d = dd - 18 + D.pad; cur.m = dm - 14 + M.pad;
    },

    cards(s) {
      const itens = s.itens || [], col = Math.max(1, Math.min(4, s.colunas || Math.min(3, itens.length || 1)));
      const gap = 24, wd = Math.floor((D.cw - gap * (col - 1)) / col), pad = 26;
      let dd = cur.d + D.pad, dm = cur.m + M.pad;
      if (s.titulo) { const t = texto('Título da seção', s.titulo, estilo(T.fonteTitulo, 42, 700, T.texto, { lh: 1.15 }), estilo(T.fonteTitulo, 28, 700, T.texto, { lh: 1.15 }), D.mx, dd, D.cw, M.mx, dm, M.cw); dd += t.hd + 36; dm += t.hm + 24; }
      const altD = Math.ceil(Math.max(...itens.map((c) => 26 * 1.2 * Math.ceil(alturaTexto(c.titulo, 26, 1, wd - 2 * pad) / 26) + alturaTexto(c.texto || '', 18, 1.55, wd - 2 * pad) + 2 * pad + 18), 160));
      const linhas = Math.ceil(itens.length / col);
      itens.forEach((c, i) => {
        const cx = D.mx + (i % col) * (wd + gap), cy = dd + Math.floor(i / col) * (altD + gap);
        const hm = alturaTexto(c.titulo, 22, 1.2, M.cw - 2 * 20) + alturaTexto(c.texto || '', 16, 1.55, M.cw - 2 * 20) + 2 * 20 + 12;
        el('shape', `Cartão ${i + 1}`, { shape: 'rect', s: { fill: T.superficie, radius: T.raio, stroke: null, sw: 0 } }, { x: cx, y: cy, w: wd, h: altD }, { x: M.mx, y: dm, w: M.cw, h: hm });
        const t = texto(`Cartão ${i + 1} — título`, c.titulo, estilo(T.fonteTitulo, 26, 700, T.texto, { lh: 1.2 }), estilo(T.fonteTitulo, 22, 700, T.texto, { lh: 1.2 }), cx + pad, cy + pad, wd - 2 * pad, M.mx + 20, dm + 20, M.cw - 40, lnk(c) ? { link: lnk(c) } : {});
        if (c.texto) texto(`Cartão ${i + 1} — texto`, c.texto, estilo(T.fonteTexto, 18, 400, T.suave, { lh: 1.55 }), estilo(T.fonteTexto, 16, 400, T.suave, { lh: 1.55 }), cx + pad, cy + pad + t.hd + 12, wd - 2 * pad, M.mx + 20, dm + 20 + t.hm + 10, M.cw - 40);
        dm += hm + 16;
      });
      cur.d = dd + linhas * altD + (linhas - 1) * gap + D.pad; cur.m = dm - 16 + M.pad;
    },

    faixa(s) {
      const hd = 56, hm = Math.max(48, alturaTexto(s.texto, 14, 1.4, M.cw) + 24), yd = cur.d, ym = cur.m;
      faixa('Faixa', s.fundo === 'acento' ? T.acento : T.escuro, yd, hd, ym, hm);
      texto('Texto da faixa', s.texto, estilo(T.fonteTexto, 15, 500, s.fundo === 'acento' ? T.sobreAcento : T.sobreEscuro, { lh: 1.2, align: 'center', ls: 0.02 }), estilo(T.fonteTexto, 14, 500, s.fundo === 'acento' ? T.sobreAcento : T.sobreEscuro, { lh: 1.4, align: 'center' }), D.mx, yd + 18, D.cw, M.mx, ym + 12, M.cw);
      cur.d += hd; cur.m += hm;
    },

    galeria(s) {
      const qtd = Math.max(1, Math.min(12, s.quantidade || 6)), col = Math.max(2, Math.min(4, s.colunas || 3)), gap = 20;
      let dd = cur.d + D.pad, dm = cur.m + M.pad;
      if (s.titulo) { const t = texto('Título da seção', s.titulo, estilo(T.fonteTitulo, 42, 700, T.texto, { lh: 1.15 }), estilo(T.fonteTitulo, 28, 700, T.texto, { lh: 1.15 }), D.mx, dd, D.cw, M.mx, dm, M.cw); dd += t.hd + 32; dm += t.hm + 20; }
      const w = Math.floor((D.cw - gap * (col - 1)) / col), h = Math.round(w * 0.75), wm = Math.floor((M.cw - 12) / 2), hm = Math.round(wm * 0.8);
      for (let i = 0; i < qtd; i++) {
        quadroImagem(`Imagem ${i + 1}`, { x: D.mx + (i % col) * (w + gap), y: dd + Math.floor(i / col) * (h + gap), w, h }, { x: M.mx + (i % 2) * (wm + 12), y: dm + Math.floor(i / 2) * (hm + 12), w: wm, h: hm });
      }
      cur.d = dd + Math.ceil(qtd / col) * (h + gap) - gap + D.pad; cur.m = dm + Math.ceil(qtd / 2) * (hm + 12) - 12 + M.pad;
    },

    chamada(s) {
      const yd = cur.d, ym = cur.m;
      let dd = yd + D.pad, dm = ym + M.pad;
      const itens = [];
      const t = texto('Título', s.titulo, estilo(T.fonteTitulo, 44, 700, T.sobreEscuro, { lh: 1.15, align: 'center' }), estilo(T.fonteTitulo, 28, 700, T.sobreEscuro, { lh: 1.15, align: 'center' }), D.mx + 100, dd, D.cw - 200, M.mx, dm, M.cw);
      itens.push(t.e); dd += t.hd + 18; dm += t.hm + 14;
      if (s.texto) { const p = texto('Texto', s.texto, estilo(T.fonteTexto, 20, 400, T.sobreEscuro, { lh: 1.55, align: 'center' }), estilo(T.fonteTexto, 17, 400, T.sobreEscuro, { lh: 1.55, align: 'center' }), D.mx + 150, dd, D.cw - 300, M.mx, dm, M.cw); itens.push(p.e); dd += p.hd + 30; dm += p.hm + 24; }
      if (s.botao) { itens.push(botao(s.botao.rotulo, s.botao, dd, dm, true)); dd += 56; dm += 50; }
      const hdT = dd + D.pad - yd, hmT = dm + M.pad - ym;
      const f = faixa('Fundo da chamada', T.escuro, yd, hdT, ym, hmT); els.splice(els.indexOf(f), 1); els.splice(els.length - itens.length, 0, f);
      if (anim) itens.forEach((e, i) => entra(e, i * 0.12));
      cur.d = yd + hdT; cur.m = ym + hmT;
    },

    rodape(s) {
      const yd = cur.d, ym = cur.m, hd = 150, hm = 170;
      faixa('Rodapé', T.escuro, yd, hd, ym, hm);
      texto('Rodapé — texto', s.texto || '', estilo(T.fonteTexto, 15, 400, T.sobreEscuro, { lh: 1.5, align: 'center' }), estilo(T.fonteTexto, 14, 400, T.sobreEscuro, { lh: 1.5, align: 'center' }), D.mx, yd + 40, D.cw, M.mx, ym + 36, M.cw);
      if ((s.links || []).length) {
        const ls = s.links.map((l) => (typeof l === 'string' ? { rotulo: l } : l)).map((l) => l.rotulo).join('   ·   ');
        texto('Rodapé — links', ls, estilo(T.fonteTexto, 14, 500, T.sobreEscuro, { lh: 1.4, align: 'center' }), estilo(T.fonteTexto, 13, 500, T.sobreEscuro, { lh: 1.5, align: 'center' }), D.mx, yd + 90, D.cw, M.mx, ym + 96, M.cw);
      }
      cur.d += hd; cur.m += hm;
    },
  };

  const avisos = [];
  // roda uma lista de seções sobre o cursor atual
  const executar = (lista) => {
    for (const s of lista || []) {
      const f = secoes[s?.tipo];
      if (!f) { avisos.push(`Seção ${++n} ignorada: tipo "${s?.tipo}" não existe (use ${Object.keys(secoes).join(', ')}).`); continue; }
      n++; f(s);
    }
  };
  return { els, cur, avisos, executar };
}

// ids estáveis (g1, g2…): a mesma especificação gera sempre o mesmo arquivo; ao USAR o modelo, conteudoDoModelo troca por ids novos
const atribuirIds = (...listas) => { let i = 0; for (const l of listas) for (const e of l) e.id = `g${++i}`; };
const temaDe = (spec) => ({ ...TEMA_PADRAO, ...(spec.tema || {}) });

function criar(spec) {
  const T = temaDe(spec), m = motor(spec, T);
  m.executar(spec.secoes);
  atribuirIds(m.els);
  return { page: { bg: { c: T.fundo, g: null }, h: { d: Math.ceil(m.cur.d), m: Math.ceil(m.cur.m) } }, elements: m.els, avisos: m.avisos };
}

// PROJETO DE SITE: topo e rodapé compartilhados + uma página por aba. O rodapé é desenhado ao fim da primeira aba (hRef) e
// acompanha o fim de cada aba (core/sites.js). Formato da especificação:
//   { tipo:'site', compartilhado:{ topo:[…seções], rodape:[…seções] }, abas:[ { id, nome, titulo, secoes:[…] } ] }
function criarSite(spec) {
  const T = temaDe(spec), comp = spec.compartilhado || {};
  const site = { abas: spec.abas.map((a) => ({ id: slugModelo(a.id || a.nome), nome: a.nome })) };
  const avisos = [];
  const mt = motor(spec, T, { d: 0, m: 0 }, site); mt.executar(comp.topo); avisos.push(...mt.avisos);
  const base = { d: mt.cur.d, m: mt.cur.m };
  const abas = spec.abas.map((a, i) => { const m = motor(spec, T, base, site); m.executar(a.secoes); avisos.push(...m.avisos.map((x) => `[${a.nome}] ${x}`)); return { id: site.abas[i].id, a, els: m.els, fim: { ...m.cur } }; });
  const ref = abas[0].fim;
  const mr = motor(spec, T, ref, site); mr.executar(comp.rodape); avisos.push(...mr.avisos);
  const altRod = { d: mr.cur.d - ref.d, m: mr.cur.m - ref.m };
  mt.els.forEach((e) => { e.comum = 'topo'; }); mr.els.forEach((e) => { e.comum = 'rodape'; });
  atribuirIds(mt.els, mr.els, ...abas.map((x) => x.els));
  const doc = {
    kind: 'site', abaAtiva: abas[0].id,
    comum: { hRef: { d: Math.ceil(mr.cur.d), m: Math.ceil(mr.cur.m) }, elements: [...mt.els, ...mr.els] },
    abas: abas.map(({ id, a, els, fim }) => ({ id, nome: a.nome, titulo: a.titulo || a.nome, page: { bg: { c: T.fundo, g: null }, h: { d: Math.ceil(fim.d + altRod.d), m: Math.ceil(fim.m + altRod.m) } }, elements: els })),
  };
  return { doc, avisos };
}

// Gera um modelo a partir de uma especificação. Não lança: devolve { modelo, avisos, erros }.
// Página: { nome, secoes:[…] }. Projeto de site: { nome, tipo:'site', compartilhado:{topo,rodape}, abas:[{id,nome,titulo,secoes}] }.
export function gerarDeSpec(spec) {
  const erros = [];
  if (!spec || typeof spec !== 'object') return { modelo: null, avisos: [], erros: ['A especificação está vazia ou não é um objeto JSON.'] };
  const site = spec.tipo === 'site' || Array.isArray(spec.abas);
  if (site) {
    if (!Array.isArray(spec.abas) || !spec.abas.length) erros.push('Um projeto de site precisa de "abas" (lista com pelo menos uma aba).');
    else spec.abas.forEach((a, i) => { if (!String(a?.nome || '').trim()) erros.push(`A aba ${i + 1} precisa de "nome".`); else if (!Array.isArray(a.secoes) || !a.secoes.length) erros.push(`A aba "${a.nome}" precisa de "secoes".`); });
  } else if (!Array.isArray(spec.secoes) || !spec.secoes.length) erros.push('A especificação precisa de "secoes" (lista com pelo menos uma seção).');
  const nome = String(spec.nome || '').trim();
  if (!nome) erros.push('A especificação precisa de "nome".');
  if (erros.length) return { modelo: null, avisos: [], erros };
  const r = site ? criarSite(spec) : criar(spec);
  const modelo = {
    format: FORMATO, v: MODELO_V,
    id: spec.id && ID_OK.test(spec.id) ? spec.id : slugModelo(nome),
    nome, descricao: String(spec.descricao || '').trim(), categoria: String(spec.categoria || 'Meus modelos').trim(), origem: 'spec',
    doc: site ? r.doc : { page: r.page, elements: r.elements },
  };
  const v = validarModelo(modelo);
  return { modelo: v.ok ? modelo : null, avisos: r.avisos, erros: v.erros };
}

// ---------- "meus modelos" (guardados neste navegador; chave nova, prefixo artatk.) ----------
export const CHAVE_MEUS = 'artatk.meusmodelos';
const MAX_MEUS = 40;

export function criarMeusModelos(storage = globalThis.localStorage) {
  const ler = () => { try { const a = JSON.parse(storage.getItem(CHAVE_MEUS) || '[]'); return Array.isArray(a) ? a.filter((m) => validarModelo(m).ok) : []; } catch { return []; } };
  const gravar = (lista) => { storage.setItem(CHAVE_MEUS, JSON.stringify(lista)); };
  return {
    listar: ler,
    // Salva (ou troca, se o id já existe). Lança Error com a mensagem para a pessoa se o modelo for inválido ou não couber.
    salvar(modelo) {
      const v = validarModelo(modelo);
      if (!v.ok) throw new Error(v.erros[0]);
      const lista = ler().filter((m) => m.id !== modelo.id);
      if (lista.length >= MAX_MEUS) throw new Error(`Você já tem ${MAX_MEUS} modelos salvos. Remova algum antes de salvar outro.`);
      lista.unshift(modelo);
      try { gravar(lista); } catch { throw new Error('Não deu para guardar o modelo neste navegador (sem espaço ou armazenamento bloqueado). Baixe o arquivo .json para não perdê-lo.'); }
      return modelo;
    },
    remover(id) { try { gravar(ler().filter((m) => m.id !== id)); } catch { /* sem armazenamento */ } },
  };
}

// ---------- catálogo publicado (modelos/modelos.json + modelos/<id>/modelo.json) ----------
// `getJson(caminho)` devolve o JSON relativo à raiz do site (core/site.js) ou null.
export async function carregarCatalogo(getJson) {
  const idx = await getJson('modelos/modelos.json').catch(() => null);
  const lista = Array.isArray(idx?.modelos) ? idx.modelos : [];
  const out = await Promise.all(lista.map(async (e) => {
    const m = await getJson(`modelos/${e.id}/modelo.json`).catch(() => null);
    return m && validarModelo(m).ok ? m : null;
  }));
  return out.filter(Boolean);
}
