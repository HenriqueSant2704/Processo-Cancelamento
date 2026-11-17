(() => {
  'use strict';
  const form = document.getElementById('form-login');
  const erro = document.getElementById('login-erro');

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.textContent = '';
    if (!form.login.value.trim() || !form.senha.value) {
      erro.textContent = 'Preencha o login e a senha.';
      return;
    }
    const botao = form.querySelector('button');
    botao.disabled = true;
    try {
      const resposta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: form.login.value.trim(), senha: form.senha.value }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível entrar.');
      location.replace('/');
    } catch (e) {
      erro.textContent = e.message;
      form.senha.value = '';
      form.senha.focus();
    } finally {
      botao.disabled = false;
    }
  });
})();
