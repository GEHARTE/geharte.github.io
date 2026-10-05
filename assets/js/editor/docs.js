// Documentos (janelas) em que o editor desenha coisas. Um painel separado numa janela própria vive em OUTRO document:
// toasts, popovers e modais precisam aparecer na janela onde a pessoa está mexendo, não sempre na principal.
export const openDocs = new Set([document]);
let active = document;

export const activeDoc = () => (active.defaultView && !active.defaultView.closed ? active : document);
export const setActiveDoc = (d) => { active = d; };
export const addDoc = (d) => openDocs.add(d);
export const dropDoc = (d) => { openDocs.delete(d); if (active === d) active = document; };
export const winOf = (nodeOrDoc) => (nodeOrDoc.ownerDocument || nodeOrDoc).defaultView || window;
