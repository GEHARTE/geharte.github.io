import { login, session, loadConfig, loginWithGoogle } from './core/auth.js';

if (session()) location.replace('editor/');

const form = document.getElementById('form'), err = document.getElementById('err'), go = document.getElementById('go');
const note = document.getElementById('g-note'), gbtn = document.getElementById('g-btn');

// ---- usuário e senha ----
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  go.disabled = true; go.textContent = 'Entrando…';
  try {
    await login(form.u.value, form.p.value);
    location.href = 'editor/';
  } catch (ex) {
    err.textContent = ex.message;
    go.disabled = false; go.textContent = 'Entrar';
  }
});

// ---- Entrar com Google ----
const G_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.2 5.6c4.3-4 6.8-9.9 6.8-17.1z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
const placeholder = (msg) => {
  gbtn.innerHTML = `<div class="gdisabled" aria-disabled="true">${G_ICON}<span>Entrar com Google</span></div>`;
  note.textContent = msg;
};

const cfg = await loadConfig();
if (!cfg.googleClientId) {
  placeholder('Login com Google em breve — por enquanto use usuário e senha.');
} else if (!window.isSecureContext) {
  placeholder('O login com Google só funciona em https. Use usuário e senha por aqui.');
} else {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onerror = () => placeholder('Não consegui carregar o Google. Verifique a conexão ou use usuário e senha.');
  s.onload = () => {
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async ({ credential }) => {
        err.textContent = ''; note.textContent = 'Verificando…';
        try { await loginWithGoogle(credential, cfg.googleClientId); location.href = 'editor/'; }
        catch (ex) { note.textContent = ''; err.textContent = ex.message; }
      },
    });
    google.accounts.id.renderButton(gbtn, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-BR', width: 320 });
  };
  document.head.append(s);
}

// ---- Só Google? (config.json: "loginSenha": false) ----
if (cfg.loginSenha === false) {
  document.querySelectorAll('#form label.f, #go, #ou').forEach((el) => { el.hidden = true; });
  if (!cfg.googleClientId) err.textContent = 'O login com Google ainda não foi configurado.';
}
