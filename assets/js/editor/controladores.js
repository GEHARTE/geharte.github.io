// Seção "Controladores" das Propriedades: faz o elemento reagir à ROLAGEM da página e marca blocos de texto para medir o TEMPO EM TELA.
// A tela só escolhe e grava: as contas ficam em core/anim-motor.js e core/leitura.js, o efeito de verdade roda no visualizador
// (core/anim-runtime.js). No editor o elemento fica parado — para ver, "Testar no visualizador".
import { h } from '../core/dom.js';
import { BASE } from '../core/util.js';
import { viewerQuery } from '../core/model.js';
import { PRESETS_ROLAGEM, NOMES_DE_PRESET, FAIXAS, controladorDePreset, normalizarControlador, normalizarControladores } from '../core/anim-motor.js';
import { estimarLeitura, contarPalavras } from '../core/leitura.js';
import { S, saveNow } from './state.js';
import { section, select, range, seg, toggle, num, btn, hint, row } from './ui.js';

const CURVAS_UI = [['linear', 'Linear'], ['suave', 'Suave'], ['ease-in', 'Começa devagar'], ['ease-out', 'Termina devagar'], ['ease-in-out', 'Devagar nas pontas']];

async function abrirNoVisualizador(extra) {
  await saveNow();
  window.open(`${BASE}perfil.html?${viewerQuery(S.slug, S.doc)}&src=draft&toolbar=1${extra}`, '_blank', 'noopener');
}

// ctx = { els: elementos selecionados, set(fn): aplica fn a todos, build(): redesenha o painel }
export function secControladores({ els, set, build }) {
  const primeiro = els[0];
  const lista = (e) => normalizarControladores(e.ctl);
  const rolagem = (e) => lista(e).find((c) => c.k === 'rolagem') || null;
  const tempo = (e) => lista(e).find((c) => c.k === 'tempo') || null;
  const r0 = rolagem(primeiro), t0 = tempo(primeiro);
  const igual = (get) => els.every((e) => JSON.stringify(get(e)) === JSON.stringify(get(primeiro)));

  // troca/remove o controlador de um tipo em todos os selecionados, mantendo os outros
  const gravar = (k, novo) => set((e) => {
    const resto = lista(e).filter((c) => c.k !== k);
    const l = novo ? [...resto, novo] : resto;
    if (l.length) e.ctl = l; else delete e.ctl;
  });
  const mudarRolagem = (patch) => {
    const base = rolagem(primeiro); if (!base) return;
    const novo = { ...base, ...patch };
    // com preset, a intensidade recalcula os números; sem preset (documento importado) só edita os campos
    const refeito = novo.preset && PRESETS_ROLAGEM[novo.preset] ? controladorDePreset(novo.preset, { intensidade: novo.intensidade ?? 1, faixa: novo.faixa, de: novo.de, ate: novo.ate, curva: novo.curva }) : normalizarControlador(novo);
    if (refeito) { refeito.id = base.id; if (novo.suave != null) refeito.suave = novo.suave; if (novo.dispositivos) refeito.dispositivos = novo.dispositivos; if (patch.dispositivos === null) delete refeito.dispositivos; }
    gravar('rolagem', refeito);
  };

  const corpo = [];
  // ----- rolagem -----
  corpo.push(h('div', { class: 'ah' }, 'Rolagem ', hint('(reage ao rolar a página)')));
  corpo.push(select({ value: igual(rolagem) ? (r0?.preset || (r0 ? '_custom' : '')) : '_misto', options: [['', 'Nenhum'], ...NOMES_DE_PRESET.map((id) => [id, PRESETS_ROLAGEM[id].nome]), ...(r0 && !r0.preset ? [['_custom', 'Personalizado']] : []), ...(igual(rolagem) ? [] : [['_misto', '— vários —']])],
    onChange: (v) => { if (v === '' ) gravar('rolagem', null); else if (PRESETS_ROLAGEM[v]) gravar('rolagem', controladorDePreset(v)); build(); } }));
  if (r0 && igual(rolagem)) {
    if (r0.preset) corpo.push(range({ label: 'Intensidade', value: r0.intensidade ?? 1, min: 0, max: 2, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (v) => mudarRolagem({ intensidade: v }) }));
    corpo.push(select({ label: 'Quando', value: r0.faixa, options: Object.entries(FAIXAS), onChange: (v) => mudarRolagem({ faixa: v }) }));
    corpo.push(row(num({ label: 'De', unit: '%', value: Math.round(r0.de * 100), min: 0, max: 100, step: 5, onChange: (v) => mudarRolagem({ de: v / 100 }) }), num({ label: 'Até', unit: '%', value: Math.round(r0.ate * 100), min: 0, max: 100, step: 5, onChange: (v) => mudarRolagem({ ate: v / 100 }) })));
    corpo.push(select({ label: 'Curva', value: r0.curva, options: CURVAS_UI.some(([k]) => k === r0.curva) ? CURVAS_UI : [...CURVAS_UI, [r0.curva, r0.curva]], onChange: (v) => mudarRolagem({ curva: v }) }));
    corpo.push(range({ label: 'Inércia', value: r0.suave || 0, min: 0, max: 0.9, step: 0.05, fmt: (v) => (v ? `${Math.round(v * 100)}%` : 'sem'), onChange: (v) => mudarRolagem({ suave: v }) }));
    corpo.push(seg({ value: (r0.dispositivos || []).length === 1 ? r0.dispositivos[0] : '', options: [['', 'Todos'], ['d', 'Só PC'], ['m', 'Só celular']], onChange: (v) => mudarRolagem({ dispositivos: v ? [v] : null }) }));
    corpo.push(hint('Com “reduzir movimento” ligado no aparelho, só a opacidade e o desfoque são aplicados.'));
  }

  // ----- tempo em tela -----
  const texto = primeiro.t === 'text' ? (primeiro.text || '') : (primeiro.t === 'shape' && primeiro.label ? primeiro.label : '');
  corpo.push(h('div', { class: 'ah' }, 'Tempo em tela ', hint('(o texto está sendo lido?)')));
  corpo.push(toggle({ label: 'Medir o tempo que fica na tela', value: igual(tempo) && !!t0, onChange: (v) => { gravar('tempo', v ? normalizarControlador({ k: 'tempo', meta: 'auto' }) : null); build(); } }));
  if (t0 && igual(tempo)) {
    const auto = t0.meta === 'auto', est = estimarLeitura(texto);
    corpo.push(seg({ value: auto ? 'auto' : 'fixa', options: [['auto', 'Estimar pelo texto'], ['fixa', 'Tempo fixo']], onChange: (v) => { gravar('tempo', normalizarControlador({ ...t0, meta: v === 'auto' ? 'auto' : (est || 10) })); build(); } }));
    if (auto) corpo.push(hint(est ? `Meta estimada: ${String(est).replace('.', ',')} s (${contarPalavras(texto)} palavras, ~200 por minuto).` : 'Sem texto neste elemento: a meta será só “apareceu na tela”.'));
    else corpo.push(num({ label: 'Meta', unit: 's', value: t0.meta, min: 0.5, max: 3600, step: 1, onChange: (v) => gravar('tempo', normalizarControlador({ ...t0, meta: v })) }));
  }
  corpo.push(h('div', { class: 'btnrow' },
    btn({ label: 'Testar rolagem', ic: 'play', title: 'Abre a página no visualizador para ver o efeito ao rolar', onClick: () => abrirNoVisualizador('') }),
    btn({ label: 'Testar leitura', ic: 'eye', title: 'Painel ao vivo com o tempo de cada bloco de texto na tela', onClick: () => abrirNoVisualizador('&leitura=1') })));
  return section('Controladores', corpo);
}
