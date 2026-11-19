// Tela do financeiro: fila de trabalho à esquerda e ficha do cliente à direita.
// JavaScript puro, sem bibliotecas. Todo texto entra via textContent (seguro).
(() => {
  'use strict';

  // ---------- Estado ----------
  const estado = {
    data: null, // só no modo demonstração (simular outro dia)
    vista: 'hoje',
    aba: 'todos', // passo escolhido no seletor (id do grupo) ou 'todos'
    filtro: null, // filtro rápido: atrasadas | retorno | perguntar | autorizacao | autorizados
    busca: '',
    abaClientes: 'ativos',
    faseClientes: null,
    filtroEtapa: null, // { etapa, passo } na tela Etapas (null = todas)
    etapas: null, // mapa de etapas e passos (vem do servidor)
    painel: null,
    processos: null,
    selecionado: null, // id do processo aberto na ficha
    dia: null, // dia escolhido na agenda (null = hoje)
    agenda: null, // clientes com tarefas no dia escolhido
    usuario: lerLocal('temis.usuario') || '',
    comLogin: false,
  };

  function lerLocal(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
  }
  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ }
  }

  // ---------- Tema ----------
  function aplicarTema(tema) {
    document.documentElement.dataset.tema = tema;
  }
  aplicarTema(lerLocal('temis.tema') || (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro'));

  // ---------- Utilidades ----------
  const $ = (s) => document.querySelector(s);
  function el(tag, atributos = {}, ...filhos) {
    const no = document.createElement(tag);
    for (const [k, v] of Object.entries(atributos)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') no.className = v;
      else if (k.startsWith('on')) no.addEventListener(k.slice(2), v);
      else if (k === 'html') no.innerHTML = v; // SÓ para os ícones fixos abaixo
      else no.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) {
      if (f === null || f === undefined || f === false) continue;
      no.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return no;
  }
  const ICONES = {
    contato: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
    acao: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/></svg>',
    decisao: '<svg viewBox="0 0 24 24"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    checks: '<svg viewBox="0 0 24 24"><path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    traco: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    voltar: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    alerta: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    relogio: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/></svg>',
    sol: '<svg viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    enviar: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/></svg>',
    lua: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  };
  const ico = (nome) => el('span', { html: ICONES[nome], style: 'display:contents', 'aria-hidden': 'true' });

  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const DIAS_C = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const paraData = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
  const dataCurta = (iso) => { const d = paraData(iso); return `${DIAS_C[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const dataExtenso = (iso) => { const d = paraData(iso); const t = `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; return t[0].toUpperCase() + t.slice(1); };
  const diasEntre = (a, b) => Math.round((paraData(b) - paraData(a)) / 86400000);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hoje = () => (estado.painel && estado.painel.hoje) || estado.data;
  const nivelDias = (d) => (d > 30 ? 'critico' : d > 15 ? 'alto' : '');
  const titulo = (nome) => String(nome).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, e, l) => e + l.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (p) => p.toLowerCase());

  // Hora local de um instante ISO (ex.: "09:00").
  const horaDe = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  // Aviso enviado e esperando o cliente; "perguntar" = já passou a hora de perguntar se teve retorno.
  const avisoEnviado = (t) => t.tipo === 'contato' && t.retorno && t.retorno.enviadoEm;
  const perguntarRetorno = (t) => avisoEnviado(t) && new Date(t.retorno.proximaChecagem) <= new Date();
  const esperandoRetorno = (c) => c.paraHoje.some(avisoEnviado);
  const deveRetorno = (c) => c.paraHoje.some(perguntarRetorno);

  const dinheiro = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 1000 ? 0 : 2 });

  function chipDias(dias) {
    return el('span', { class: `dias ${nivelDias(dias)}`, title: 'Dias suspenso no SGP' }, String(dias), el('small', {}, dias === 1 ? 'dia' : 'dias'));
  }
  function saudacao() {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  // ---------- API ----------
  async function api(caminho, opcoes = {}) {
    const url = new URL(caminho, location.origin);
    if (estado.data) url.searchParams.set('data', estado.data);
    const post = opcoes.method === 'POST';
    const r = await fetch(url, { ...opcoes, body: post ? opcoes.body || '{}' : undefined, headers: post ? { 'Content-Type': 'application/json' } : undefined });
    if (r.status === 401 && estado.comLogin) {
      location.replace('/login.html');
      throw new Error('Sessão expirada. Entre de novo.');
    }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || 'Não foi possível falar com o servidor.');
    return corpo;
  }

  function avisar(texto, tipo = '') {
    // Com uma janela aberta, o erro aparece dentro dela (o aviso normal ficaria escondido atrás da janela).
    const janela = document.querySelector('dialog[open]');
    const form = janela && janela.querySelector('form');
    if (tipo === 'erro' && form && form.querySelector('.janela-acoes')) {
      let caixa = form.querySelector('.janela-erro');
      if (!caixa) { caixa = el('p', { class: 'janela-erro', role: 'alert' }); form.querySelector('.janela-acoes').before(caixa); }
      caixa.replaceChildren(ico('alerta'), el('span', {}, texto));
      caixa.scrollIntoView({ block: 'nearest' });
      return;
    }
    const t = el('div', { class: `toast ${tipo}`, role: 'status' }, ico(tipo === 'erro' ? 'alerta' : 'check'), texto);
    $('#avisos').append(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- Carregar ----------
  async function carregarPainel() {
    estado.painel = await api('/api/painel');
    desenharTopo();
    desenharHoje();
    desenharSino();
  }

  // ---------- Sino: respostas do Lucas ----------
  function desenharSino() {
    const lucas = estado.painel.notificacoes || [];
    const retornos = (estado.painel.clientes || []).filter(deveRetorno);
    const total = lucas.length + retornos.length;
    $('#sino-total').hidden = !total;
    $('#sino-total').textContent = String(total);
    $('#sino').classList.toggle('tem', total > 0);
    // replaceChildren não abre listas: tudo vai num array "achatado" (senão aparece [object HTMLButtonElement]).
    $('#sino-lista').replaceChildren(...[
      el('div', { class: 'sino-titulo' }, 'Teve retorno do cliente?'),
      retornos.length
        ? retornos.map((c) => {
            const t = c.paraHoje.find(perguntarRetorno);
            return el('button', { class: 'sino-item', onclick: () => abrirNotificacao({ id: c.id }) },
              el('span', { class: 'selo-mini aut-aguardando' }, 'Perguntar agora'),
              el('strong', {}, titulo(c.cliente.nome)),
              el('span', { class: 'sino-texto' }, `${t.descricao} · enviado às ${horaDe(t.retorno.enviadoEm)}`));
          })
        : el('p', { class: 'suave sino-vazio' }, 'Nenhum aviso esperando pergunta agora.'),
      el('div', { class: 'sino-titulo' }, 'Respostas do Lucas'),
      lucas.length
        ? lucas.map((n) => el('button', { class: `sino-item aut-${n.status}`, onclick: () => abrirNotificacao(n) },
            el('span', { class: `selo-mini aut-${n.status}` }, n.nome),
            el('strong', {}, titulo(n.cliente)),
            n.resposta && n.resposta.texto ? el('span', { class: 'sino-texto' }, `"${n.resposta.texto.slice(0, 140)}${n.resposta.texto.length > 140 ? '…' : ''}"`) : null))
        : el('p', { class: 'suave sino-vazio' }, 'Nenhuma resposta nova.'),
    ].flat());
    // Aviso do navegador quando surge uma pergunta nova (só se a Jéssica permitiu).
    const novos = retornos.map((c) => c.id).filter((id) => !(estado.jaAvisados || new Set()).has(id));
    estado.jaAvisados = new Set(retornos.map((c) => c.id));
    if (novos.length && estado.notificouUmaVez && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Têmis · teve retorno?', { body: `${plural(novos.length, 'cliente', 'clientes')} esperando você perguntar se respondeu ao aviso.`, tag: 'temis-retorno' }); } catch { /* sem notificação */ }
    }
    estado.notificouUmaVez = true;
  }

  function alternarSino(abrir) {
    const aberto = abrir ?? $('#sino-lista').hidden;
    $('#sino-lista').hidden = !aberto;
    $('#sino').setAttribute('aria-expanded', String(aberto));
  }
  async function abrirNotificacao(n) {
    alternarSino(false);
    if (estado.vista !== 'hoje') trocarVista('hoje');
    estado.aba = 'todos';
    estado.filtro = null;
    desenharHoje();
    await selecionar(n.id, true);
  }
  setInterval(() => { if (!document.hidden && estado.painel) carregarPainel().catch(() => {}); }, 120000);
  // A cada minuto revê quem já passou da hora de perguntar "teve retorno?" (sem ir ao servidor).
  setInterval(() => { if (estado.painel && !document.querySelector('dialog[open]')) { desenharSino(); desenharMetricas(); } }, 60000);
  async function carregarClientes() {
    const r = await api('/api/processos');
    estado.processos = r.processos;
    estado.etapas = r.etapas;
    if (estado.vista === 'etapas') desenharEtapas(); else desenharClientes();
  }
  async function recarregar() {
    try {
      if (estado.dia) estado.agenda = (await api(`/api/agenda?dia=${estado.dia}`)).clientes;
      await carregarPainel();
      if (estado.vista === 'clientes' || estado.vista === 'etapas') await carregarClientes();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  // ---------- Topo ----------
  function desenharTopo() {
    const p = estado.painel;
    $('#data-extenso').textContent = dataExtenso(p.hoje) + (p.hoje !== p.hojeReal ? ' · dia simulado' : '');
    const nome = estado.usuario ? estado.usuario.split(' ')[0] : '';
    $('#saudacao').textContent = estado.vista === 'clientes' ? 'Todos os clientes' : estado.vista === 'etapas' ? 'Clientes por etapa' : `${saudacao()}${nome ? `, ${nome}` : ''}`;
    $('#simular').hidden = !p.modoDemo;
    if (p.modoDemo && !$('#campo-data').value) $('#campo-data').value = p.hoje;
    const total = p.resumo.paraHoje + p.resumo.atrasadas;
    $('#badge-hoje').textContent = total ? String(total) : '';
    // Gráfico compacto de clientes por etapa, no espaço livre do topo (ao lado da saudação).
    const funil = p.funil || [];
    const emAndamento = funil.reduce((s, f) => s + f.total, 0);
    $('#funil-topo').replaceChildren(
      el('span', { class: 'ft-cabeca' },
        el('span', { class: 'ft-barra', 'aria-hidden': 'true' }, funil.map((f, i) => (f.total ? el('i', { class: `f${i}`, style: `flex:${f.total}`, title: `${f.fase}: ${f.total}` }) : null))),
        el('b', {}, `${emAndamento} em andamento`)),
      el('span', { class: 'ft-legenda' }, funil.map((f, i) => el('span', { class: `ft-item${f.total ? '' : ' vazio'}`, title: `${f.fase}: ${f.total}` },
        el('small', {}, el('i', { class: `f${i}` }), f.fase), el('b', {}, String(f.total))))));
    document.title = total ? `(${total}) Têmis · Cobrança` : 'Têmis · Cobrança';
  }

  function desenharFunil(alvo, { clicavel = false } = {}) {
    const funil = estado.painel.funil;
    const total = funil.reduce((s, f) => s + f.total, 0);
    alvo.replaceChildren(
      el('div', { class: 'funil-titulo' }, el('span', {}, 'Clientes por etapa'), el('b', {}, `${total} em andamento`)),
      el('div', { class: 'funil-barra', 'aria-hidden': 'true' },
        funil.map((f, i) => (f.total ? el('i', { class: `f${i}`, style: `flex:${f.total}`, title: `${f.fase}: ${f.total}` }) : null))),
      el('div', { class: 'funil-legenda' },
        funil.map((f, i) => el(clicavel ? 'button' : 'div', {
          class: `funil-item${f.total ? '' : ' vazio'}`,
          title: clicavel ? `Ver clientes em ${f.fase}` : null,
          onclick: clicavel ? () => { estado.faseClientes = estado.faseClientes === f.fase ? null : f.fase; desenharClientes(); } : null,
        }, el('span', {}, el('i', { class: `f${i}` }), f.fase), el('b', {}, String(f.total))))));
  }

  // ---------- Vista "Hoje" ----------
  // A fila é organizada por PASSO (ex.: "Notificação de negativação · 1ª mensagem"), para a Jéssica
  // poder trabalhar um grupo de cada vez. "Atrasados" é um filtro à parte.
  const ORDEM_PASSO = { 'msg-1': 1, 'msg-2': 2, 'msg-3': 3, promessa: 4, decisao: 5, espera: 6, acoes: 0 };
  // Quem espera o Lucas fica num grupo só (por situação), no topo da fila.
  const chaveGrupo = (c) => (c.parado ? `aut:${c.passo.id}` : c.etapa ? `${c.etapa.id}:${c.passo ? c.passo.id : 'x'}` : 'outros');
  const nomeGrupo = (c) => (c.parado ? c.passo.nome : c.etapa ? `${c.etapa.nome}${c.passo ? ` · ${c.passo.nome}` : ''}` : 'Outros');
  const ordemGrupo = (c) => (c.parado ? [-1, { 'aut-respondido': 0, 'aut-negado': 1, 'aut-aguardando': 2 }[c.passo.id] ?? 3] : [c.faseIndice ?? 99, c.passo ? ORDEM_PASSO[c.passo.id] ?? 9 : 9]);
  const autorizadoNovo = (c) => c.autorizacao && c.autorizacao.status === 'autorizado' && !c.parado && c.paraHoje.some((t) => t.etapa === c.autorizacao.etapa);
  const FILTROS = {
    atrasadas: (c) => c.paraHoje.some((t) => t.atrasada),
    retorno: esperandoRetorno,
    perguntar: deveRetorno,
    autorizacao: (c) => c.parado,
    autorizados: autorizadoNovo,
  };
  const passaFiltro = (c) => !estado.filtro || !FILTROS[estado.filtro] || FILTROS[estado.filtro](c);
  const passaAba = (c) => (estado.aba === 'todos' || chaveGrupo(c) === estado.aba) && passaFiltro(c);

  // Hoje: a fila do painel. Outro dia: a agenda daquele dia.
  const clientesBase = () => (estado.dia ? estado.agenda || [] : estado.painel.clientes);

  function clientesVisiveis() {
    const termo = normalizar(estado.busca);
    return clientesBase()
      .filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo))
      .filter(passaAba);
  }

  // Grupos (passos) presentes na fila, na ordem do processo.
  function gruposDaFila(base) {
    const mapa = new Map();
    for (const c of base) {
      const k = chaveGrupo(c);
      if (!mapa.has(k)) mapa.set(k, { id: k, nome: nomeGrupo(c), ordem: ordemGrupo(c), itens: [] });
      mapa.get(k).itens.push(c);
    }
    return [...mapa.values()].sort((a, b) => a.ordem[0] - b.ordem[0] || a.ordem[1] - b.ordem[1] || a.nome.localeCompare(b.nome));
  }

  // Faixa do topo: números do dia, que também servem de filtro rápido da fila.
  function desenharMetricas() {
    const r = estado.painel.resumo;
    const base = estado.painel.clientes || [];
    const n = (f) => base.filter(FILTROS[f]).length;
    const item = ({ cor, rotulo, valor, detalhe, filtro }) => el(filtro ? 'button' : 'div', {
      class: `faixa-item${valor ? '' : ' zero'}${filtro && estado.filtro === filtro ? ' ativa' : ''}`,
      style: `--cor: var(${cor})`,
      title: filtro ? (estado.filtro === filtro ? 'Tirar o filtro' : `Mostrar só: ${rotulo.toLowerCase()}`) : null,
      onclick: filtro ? () => trocarFiltro(estado.filtro === filtro ? null : filtro) : null,
    }, el('i'), el('span', { class: 'faixa-rotulo' }, rotulo), el('b', {}, String(valor)), detalhe ? el('small', {}, detalhe) : null);
    $('#metricas').replaceChildren(
      item({ cor: '--marca', rotulo: 'Para hoje', valor: r.paraHoje, detalhe: plural(r.clientesHoje, 'cliente', 'clientes') }),
      item({ cor: '--perigo', rotulo: 'Atrasadas', valor: r.atrasadas, filtro: 'atrasadas' }),
      item({ cor: '--alerta', rotulo: 'Perguntar retorno', valor: n('perguntar'), filtro: 'perguntar' }),
      item({ cor: '--contato', rotulo: 'Aguardando retorno', valor: n('retorno'), filtro: 'retorno' }),
      item({ cor: '--decisao', rotulo: 'Esperando o Lucas', valor: r.aguardandoAutorizacao || 0, filtro: 'autorizacao' }),
      item({ cor: '--sucesso', rotulo: 'Autorizados', valor: r.autorizados || 0, filtro: 'autorizados' }),
    );
  }

  // Seletor de passo + filtros rápidos (atrasados, retorno).
  function desenharAbas() {
    const base = clientesBase();
    const grupos = gruposDaFila(base);
    // Se o passo escolhido sumiu (ex.: terminou), volta para "Todos".
    if (estado.aba !== 'todos' && !grupos.some((g) => g.id === estado.aba)) estado.aba = 'todos';
    $('#filtro-passo').replaceChildren(
      el('option', { value: 'todos' }, `Todos os passos (${base.length})`),
      ...grupos.map((g) => el('option', { value: g.id }, `${g.nome} (${g.itens.length})`)));
    $('#filtro-passo').value = estado.aba;
    const chip = (id, nome, cor) => {
      const qtd = base.filter(FILTROS[id]).length;
      if (!qtd && estado.filtro !== id) return null;
      return el('button', { class: `aba${estado.filtro === id ? ' ativa' : ''}`, 'aria-pressed': String(estado.filtro === id), onclick: () => trocarFiltro(estado.filtro === id ? null : id) },
        el('i', { style: `background:${cor}` }), nome, el('b', {}, String(qtd)));
    };
    $('#abas').replaceChildren(...[
      chip('atrasadas', 'Atrasados', 'var(--perigo)'),
      chip('perguntar', 'Perguntar retorno', 'var(--alerta)'),
      chip('retorno', 'Aguardando retorno', 'var(--contato)')].filter(Boolean));
  }

  function trocarAba(id) {
    estado.aba = id;
    desenharHoje();
  }
  function trocarFiltro(id) {
    estado.filtro = id;
    desenharHoje();
  }

  function linhaCliente(c) {
    const atrasada = c.paraHoje.some((t) => t.atrasada);
    const etapaTxt = c.etapa ? c.etapa.fase + (c.contatos.total ? ` ${c.contatos.feitos + 1 > c.contatos.total ? c.contatos.total : c.contatos.feitos + 1}/${c.contatos.total}` : '') : '';
    return el('button', {
      class: `linha-cliente${atrasada ? ' atrasada' : ''}${estado.selecionado === c.id ? ' selecionada' : ''}`,
      role: 'option', 'aria-selected': String(estado.selecionado === c.id), 'data-id': c.id,
      onclick: () => selecionar(c.id, true),
    },
    el('span', { class: 'avatar' }, iniciais(c.cliente.nome)),
    el('span', { style: 'min-width:0' },
      el('span', { class: 'lc-nome' }, titulo(c.cliente.nome)),
      el('span', { class: 'lc-meta' },
        el('span', { class: 'pontos', title: plural(c.paraHoje.length, 'tarefa no dia', 'tarefas no dia') },
          c.paraHoje.map((t) => el('i', { class: t.atrasada ? 'p-atrasada' : `p-${t.tipo}` }))),
        el('span', { class: 'mono' }, `#${c.cliente.contrato}`), '·', c.parado ? el('span', { class: `selo-mini aut-${c.autorizacao.status}` }, c.passo.nome)
          : deveRetorno(c) ? el('span', { class: 'selo-mini aut-aguardando' }, 'Teve retorno?')
            : esperandoRetorno(c) ? el('span', { class: 'selo-mini retorno' }, 'Aguardando retorno') : etapaTxt)),
    el('span', { class: 'lc-direita' },
      chipDias(c.diasBloqueado),
      c.financeiro && c.financeiro.valorAberto ? el('span', { class: 'mono valor', title: 'Em aberto no SGP' }, dinheiro(c.financeiro.valorAberto)) : null));
  }

  // Tira de dias: Hoje, Amanhã e os próximos dias úteis, com quantos clientes há em cada um.
  function desenharDias() {
    const p = estado.painel;
    const amanha = p.proximosDias[0] && p.proximosDias[0].data;
    const chip = (data, rotulo, n, alerta) => el('button', {
      class: `dia-chip${(estado.dia || p.hoje) === data ? ' ativo' : ''}${alerta ? ' alerta' : ''}`,
      onclick: () => escolherDia(data === p.hoje ? null : data),
      title: plural(n, 'cliente', 'clientes'),
    }, el('span', {}, rotulo), el('b', {}, String(n)));
    $('#dias-agenda').replaceChildren(
      chip(p.hoje, 'Hoje', p.resumo.clientesHoje, p.resumo.atrasadas > 0),
      ...p.proximosDias.map((d) => chip(d.data, d.data === amanha && diasEntre(p.hoje, d.data) === 1 ? 'Amanhã' : dataCurta(d.data), d.clientes)));
  }

  async function escolherDia(dia) {
    estado.dia = dia;
    estado.agenda = null;
    estado.selecionado = null;
    if (dia) {
      try {
        estado.agenda = (await api(`/api/agenda?dia=${dia}`)).clientes;
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    }
    desenharHoje();
  }

  function desenharHoje() {
    desenharMetricas();
    desenharDias();
    desenharAbas();
    const lista = clientesVisiveis();

    // Grupos por passo; dentro de cada um, atrasados primeiro e depois quem está há mais dias.
    const grupos = gruposDaFila(lista);
    const atrasado = (c) => (c.paraHoje.some((t) => t.atrasada) ? 0 : 1);
    for (const g of grupos) g.itens.sort((x, y) => atrasado(x) - atrasado(y) || y.diasBloqueado - x.diasBloqueado || x.cliente.nome.localeCompare(y.cliente.nome));

    if (!lista.length) {
      const nada = !estado.painel.clientes.length;
      $('#fila').replaceChildren(el('div', { class: 'fila-vazia' },
        el('strong', {}, nada ? 'Fila zerada' : 'Nada com esse filtro'),
        nada ? 'Nenhum cliente para atender hoje.' : 'Troque o filtro ou limpe a busca.'));
    } else {
      $('#fila').replaceChildren(...grupos.flatMap((g) => [
        el('div', { class: 'grupo' }, el('span', {}, g.nome), el('b', {}, String(g.itens.length))),
        ...g.itens.map(linhaCliente),
      ]));
    }

    // Mantém a seleção; se o cliente saiu da fila, abre o próximo.
    const ordem = grupos.flatMap((g) => g.itens.map((c) => c.id));
    estado.ordemFila = ordem;
    // Nunca troca de cliente sozinho: só abre o primeiro quando NINGUÉM está aberto na ficha.
    // (O cliente aberto continua na ficha mesmo que saia da fila ou do filtro.)
    if (!estado.selecionado) {
      if (ordem.length && (telaLarga.matches || innerWidth > 900)) selecionar(ordem[0]);
      else if (!ordem.length && !estado.fichaFixa) desenharFichaVazia();
    }
  }

  // ---------- Ficha ----------
  function desenharFichaVazia() {
    estado.selecionado = null;
    $('#ficha').classList.remove('aberta');
    $('#ficha').replaceChildren(el('div', { class: 'ficha-vazia' },
      el('div', { class: 'icone-grande', html: ICONES.checks }),
      el('h3', {}, 'Tudo em dia por aqui'),
      el('p', {}, 'Selecione um cliente na fila para ver o cronograma e registrar o atendimento.')));
  }

  async function selecionar(id, foco = false) {
    estado.selecionado = id;
    document.querySelectorAll('.linha-cliente').forEach((b) => {
      const sel = b.dataset.id === id;
      b.classList.toggle('selecionada', sel);
      b.setAttribute('aria-selected', String(sel));
      if (sel && foco) b.scrollIntoView({ block: 'nearest' });
    });
    $('#ficha').classList.add('aberta');
    try {
      const d = await api(`/api/processos/${id}`);
      if (estado.selecionado === id) desenharFicha(d);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  function fecharFicha() {
    $('#ficha').classList.remove('aberta');
    if (estado.vista === 'clientes' || matchMedia('(max-width: 900px)').matches) estado.selecionado = null;
  }

  function linhaTarefa(d, t) {
    const enviado = avisoEnviado(t);
    const perguntar = perguntarRetorno(t);
    const checagens = enviado ? t.retorno.checagens || [] : [];
    const quando = t.atrasada && !enviado
      ? el('small', { class: 'atrasada' }, `Atrasada desde ${dataCurta(t.data)} (${plural(diasEntre(t.data, hoje()), 'dia', 'dias')})`, (() => { const prox = t.tipo === 'contato' && (d.tarefas || []).find((x) => x.dataProjetada && x.etapa === t.etapa && x.tipo === 'contato'); return prox ? el('span', { class: 'proximo-aviso' }, ` · fazendo hoje, o próximo aviso fica para ${dataCurta(prox.dataProjetada)}`) : null; })())
      : enviado
        ? el('small', { class: perguntar ? 'perguntar' : '' }, `Enviado às ${horaDe(t.retorno.enviadoEm)}${t.retorno.enviadoPor ? ` por ${t.retorno.enviadoPor}` : ''} · `, perguntar ? el('b', {}, 'hora de perguntar: teve retorno?') : `nova pergunta às ${horaDe(t.retorno.proximaChecagem)}`)
        : el('small', {}, t.anexoObrigatorio ? 'Ação no SGP · precisa anexar o arquivo (print ou PDF)' : { contato: 'Envie o aviso e marque "Enviei"', acao: 'Ação no SGP', decisao: 'Responda para o processo seguir' }[t.tipo]);
    let acoes;
    if (t.tipo === 'decisao') {
      acoes = el('div', { class: 'acoes-tarefa' },
        el('button', { class: 'botao sim', onclick: () => abrirDecisao(d, t, 'sim') }, ico('check'), 'Sim'),
        el('button', { class: 'botao nao', onclick: () => abrirDecisao(d, t, 'nao') }, ico('x'), 'Não'));
    } else if (t.tipo === 'contato' && !enviado) {
      acoes = el('div', { class: 'acoes-tarefa' },
        decisaoDaEtapa(d, t) ? el('button', { class: 'botao sim pequeno-txt', title: 'O cliente pagou: encerra os avisos', onclick: () => abrirDecisao(d, decisaoDaEtapa(d, t), 'sim') }, 'Regularizou') : null,
        el('button', { class: 'botao promessa', title: 'O cliente prometeu pagar numa data', onclick: () => abrirPromessa(d) }, ico('relogio'), 'Promessa'),
        el('button', { class: 'botao primario', title: 'Marca que o aviso foi enviado agora. Depois o sistema pergunta se o cliente respondeu.', onclick: (e) => marcarEnviado(d, t, e.currentTarget) }, ico('enviar'), 'Enviei'));
    } else if (t.tipo === 'contato') {
      acoes = el('div', { class: 'acoes-tarefa' },
        el('button', { class: 'botao sim', title: 'O cliente respondeu: regularizou, prometeu ou disse outra coisa', onclick: () => abrirRetorno(d, t) }, ico('contato'), 'Teve retorno'),
        el('button', { class: 'botao fantasma borda', title: 'Pergunta de novo mais tarde', onclick: (e) => semRetorno(d, t, e.currentTarget) }, ico('relogio'), 'Sem retorno'),
        el('button', { class: 'botao feito', title: 'Encerra este aviso: registra as tentativas de contato e o print', onclick: () => abrirRegistro(d, t) }, ico('check'), 'Finalizar aviso'));
    } else {
      acoes = el('div', { class: 'acoes-tarefa' },
        t.ocorrenciaTipo && estado.criarOcorrencia ? el('button', { class: 'botao sgp', title: `Cria a ocorrência "${t.ocorrenciaTipo}" no SGP`, onclick: () => abrirOcorrencia(d, t) }, ico('acao'), 'Criar no SGP') : null,
        el('button', { class: 'botao feito', title: 'Feito', onclick: () => feitoComMensagem(d, [t]) }, ico('check'), 'Feito'));
    }
    return el('div', { class: `tarefa ${t.tipo}${t.atrasada && !enviado ? ' atrasada' : ''}${enviado ? ' enviado' : ''}${perguntar ? ' perguntar' : ''}`, 'data-tarefa': t.id },
      el('span', { class: 'icone', html: ICONES[enviado ? 'relogio' : t.tipo] }),
      el('div', { class: 'tarefa-texto' }, el('strong', {}, t.descricao), quando,
        checagens.length ? el('ul', { class: 'checagens' }, checagens.map((c) => el('li', { class: c.resultado },
          el('time', {}, horaDe(c.em)), c.resultado === 'retorno' ? c.texto : 'Sem retorno'))) : null),
      acoes);
  }

  // ---------- Dados do cliente (vindos do SGP) ----------
  const dataNum = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };
  const soDigitos = (t) => String(t).replace(/\D/g, '');
  const FREQUENCIA = {
    raro: ['Costuma pagar em dia', 'sucesso'],
    'as-vezes': ['Atrasa às vezes', 'alerta'],
    frequente: ['Atrasa com frequência', 'perigo'],
    'sem-historico': ['Sem histórico no último ano', ''],
  };

  function copiar(texto, rotulo) {
    navigator.clipboard.writeText(texto).then(() => avisar(`${rotulo} copiado`), () => avisar('Não foi possível copiar', 'erro'));
  }

  function situacaoFatura(f) {
    if (f.status === 'aberto') return el('span', { class: `selo ${f.diasAtraso > 0 ? 'perigo' : ''}` }, f.diasAtraso > 0 ? `Em aberto · ${plural(f.diasAtraso, 'dia', 'dias')}` : 'A vencer');
    if (f.diasAtraso > 0) return el('span', { class: 'selo alerta' }, `Paga ${dataNum(f.pagoEm)} · ${plural(f.diasAtraso, 'dia', 'dias')} de atraso`);
    return el('span', { class: 'selo sucesso' }, f.pagoEm ? `Paga em dia · ${dataNum(f.pagoEm)}` : 'Paga');
  }

  function blocoCliente(dc) {
    if (!dc) {
      return el('section', {}, el('div', { class: 'secao-titulo' }, el('span', {}, 'Dados do cliente')),
        el('p', { class: 'suave dc-vazio' }, 'Os dados do SGP (CPF, telefones, plano e faturas) aparecem depois da próxima sincronização.'));
    }
    const fq = dc.frequencia || {};
    const [rotulo, cor] = FREQUENCIA[fq.nivel] || FREQUENCIA['sem-historico'];
    const resumoFq = fq.faturas
      ? `Nos últimos 12 meses, ${plural(fq.faturas, 'fatura', 'faturas')}: ` + [`${fq.emDia} paga${fq.emDia === 1 ? '' : 's'} em dia`, fq.pagasComAtraso ? `${fq.pagasComAtraso} com atraso (média de ${plural(fq.atrasoMedio, 'dia', 'dias')})` : null, fq.emAberto ? `${fq.emAberto} em aberto` : null].filter(Boolean).join(' · ')
      : 'Nenhuma fatura vencida nos últimos 12 meses.';
    const item = (rotuloItem, ...conteudo) => el('div', { class: 'dc-item' }, el('small', {}, rotuloItem), el('div', { class: 'dc-valor' }, ...conteudo));
    const botaoCopiar = (texto, nome) => el('button', { class: 'link-mini', title: `Copiar ${nome}`, onclick: () => copiar(texto, nome) }, 'copiar');

    return el('section', { class: 'dados-cliente' },
      el('div', { class: 'secao-titulo' }, el('span', {}, 'Dados do cliente'), dc.em ? el('span', { class: 'dc-atualizado' }, `SGP · ${dataNum(dc.em)}`) : null),
      el('div', { class: `dc-frequencia ${cor}` }, el('strong', {}, rotulo), el('span', {}, resumoFq)),
      el('div', { class: 'dc-grade' },
        item(dc.tipoPessoa === 'J' ? 'CNPJ' : 'CPF', dc.documento ? el('span', { class: 'dc-linha' }, el('span', { class: 'mono' }, dc.documento), botaoCopiar(dc.documento, dc.tipoPessoa === 'J' ? 'CNPJ' : 'CPF')) : '—'),
        item('Plano', dc.plano || '—'),
        item('Telefones', dc.telefones && dc.telefones.length
          ? el('div', { class: 'dc-lista' }, dc.telefones.map((t) => {
              const n = soDigitos(t);
              const zap = n.length >= 10 && n.length <= 11 ? `55${n}` : n.length >= 12 ? n : '';
              return el('span', { class: 'dc-linha' }, el('a', { class: 'mono', href: `tel:${n}` }, t),
                zap ? el('a', { class: 'link-mini', href: `https://wa.me/${zap}`, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp') : null,
                botaoCopiar(t, 'Telefone'));
            }))
          : '—'),
        item('E-mail', dc.emails && dc.emails.length
          ? el('div', { class: 'dc-lista' }, dc.emails.map((m) => el('span', { class: 'dc-linha' }, el('a', { href: `mailto:${m}` }, m), botaoCopiar(m, 'E-mail'))))
          : '—'),
        item('Vencimento', dc.diaVencimento ? `Todo dia ${dc.diaVencimento}` : '—', dc.formaCobranca ? el('span', { class: 'suave' }, ` · ${dc.formaCobranca}`) : null),
        item('Cliente desde', dc.clienteDesde ? dataNum(dc.clienteDesde) : '—')),
      dc.faturas && dc.faturas.length
        ? el('details', { class: 'dc-faturas' },
            el('summary', {}, `Últimas faturas · ${dc.faturas.length}`),
            el('table', { class: 'tabela-faturas' },
              el('thead', {}, el('tr', {}, el('th', {}, 'Vencimento'), el('th', {}, 'Valor'), el('th', {}, 'Situação'))),
              el('tbody', {}, dc.faturas.map((f) => el('tr', {}, el('td', { class: 'mono' }, dataNum(f.vencimento)), el('td', { class: 'mono' }, dinheiro(f.valor)), el('td', {}, situacaoFatura(f)))))))
        : null);
  }

  function cartaoAutorizacao(d) {
    const a = d.autorizacao;
    if (!a || d.status !== 'ativo') return null;
    if (a.status === 'autorizado' && !d.paraHoje.some((t) => t.etapa === a.etapa)) return null;
    // Abriu a ficha: a resposta do Lucas foi vista (some do sino).
    if (a.visto === false) api(`/api/processos/${d.id}/autorizacao`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, acao: 'visto' }) }).then(() => carregarPainel()).catch(() => {});
    const textos = {
      aguardando: `O cliente não regularizou em "${a.etapaAnteriorNome}". O Lucas foi perguntado na ocorrência se pode seguir para "${a.etapaNome}". A etapa só começa depois da resposta dele.`,
      negado: `O Lucas não autorizou seguir para "${a.etapaNome}". O cliente continua parado aqui.`,
      respondido: `O Lucas respondeu, mas não deu para entender se autorizou. Confirme abaixo.`,
      autorizado: `Autorizado. A etapa "${a.etapaNome}" começou no dia da autorização.`,
    };
    const acao = (nome, rotulo, classe, pergunta) => el('button', { class: `botao pequeno ${classe}`, onclick: (e) => responderAutorizacao(d, nome, pergunta, e.currentTarget) }, rotulo);
    return el('section', { class: `cartao-aut aut-${a.status}` },
      el('div', { class: 'cartao-aut-topo' }, el('span', { class: `selo-mini aut-${a.status}` }, d.passo && d.parado ? d.passo.nome : 'Autorizado'), a.pedidoEm ? el('small', {}, `Pedido em ${dataCurta(a.pedidoEm)}`) : null),
      el('p', {}, textos[a.status]),
      a.resposta && a.resposta.texto ? el('blockquote', {}, a.resposta.texto, el('cite', {}, `${a.resposta.por === 'admin' ? 'Lucas' : a.resposta.por || ''}${a.resposta.em ? ` · ${dataCurta(a.resposta.em)}` : ''}`)) : null,
      d.parado ? el('div', { class: 'cartao-aut-acoes' },
        acao('autorizar', a.status === 'aguardando' ? 'Lucas autorizou por fora' : 'Está autorizado', 'sim', 'Como o Lucas autorizou? (opcional)'),
        a.status === 'respondido' ? acao('negar', 'Não autorizou', 'nao', 'Observação (opcional)') : null,
        a.status !== 'aguardando' ? acao('pedir', 'Pedir de novo ao Lucas', 'fantasma', 'Mensagem para o Lucas (opcional)') : null) : null);
  }
  async function responderAutorizacao(d, acaoNome, pergunta, botao) {
    if (!garantirUsuario()) return;
    if (acaoNome === 'pedir') {
      abrirMensagem({
        d, titulo: 'Pedir autorização ao Lucas', texto: (d.modelos || {}).autorizacao || '', botao: 'Enviar pedido',
        aoEnviar: async (mensagem, marcar) => {
          await api(`/api/processos/${d.id}/autorizacao`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, acao: 'pedir', mensagem, marcar }) });
          avisar('Pedido registrado na ocorrência');
          aposAcao();
        },
      });
      return;
    }
    const observacao = prompt(pergunta, '');
    if (observacao === null) return;
    botao.disabled = true;
    try {
      await api(`/api/processos/${d.id}/autorizacao`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, acao: acaoNome, observacao }) });
      avisar({ autorizar: 'Autorizado: a próxima etapa começa hoje', negar: 'Marcado como não autorizado', pedir: 'Pedido enviado de novo ao Lucas' }[acaoNome]);
      await aposAcao();
    } catch (erro) {
      botao.disabled = false;
      avisar(erro.message, 'erro');
    }
  }

  function desenharFicha(d) {
    const fim = d.status !== 'ativo';
    const simples = d.paraHoje.filter((t) => t.tipo === 'acao' && !t.anexoObrigatorio);
    const proxima = d.proxima;

    const etapas = el('div', { class: 'etapas', style: `--n:${d.fases.length}` }, d.fases.map((nome, k) => {
      const classe = fim ? (d.resultado === 'cancelado' ? 'feita' : '') : k < d.faseIndice ? 'feita' : k === d.faseIndice ? 'atual' : '';
      return el('div', { class: `etapa ${classe}` }, el('i'), el('span', { title: nome }, nome));
    }));

    // Cronograma agrupado por etapa
    const itens = [];
    let anterior = null;
    const canceladas = d.tarefas.filter((t) => t.status === 'cancelada').length;
    for (const t of d.tarefas) {
      if (t.status === 'cancelada' && !estado.verCanceladas) continue;
      if (t.etapa !== anterior) { itens.push(el('li', { class: 'lt-grupo' }, t.etapaNome)); anterior = t.etapa; }
      const atrasada = t.status === 'pendente' && t.data < hoje();
      const sub = t.status === 'concluida' ? `Feito por ${t.concluidaPor} em ${dataCurta(t.concluidaEm)}` : t.status === 'cancelada' ? 'Não foi necessário' : atrasada ? 'Atrasada' : 'Previsto';
      itens.push(el('li', { class: `lt-item ${t.status}${atrasada ? ' atrasada' : ''}` },
        el('span', { class: 'lt-ponto', html: t.status === 'concluida' ? ICONES.check : t.status === 'cancelada' ? ICONES.traco : '' }),
        el('div', { class: 'lt-corpo' },
          el('strong', {}, t.descricao), el('small', {}, sub),
          t.observacao && t.observacao.includes('\n') && !t.resposta
            ? el('details', { class: 'lt-detalhe' }, el('summary', {}, 'Ver detalhes de como foi feito'), el('div', { class: 'lt-nota registro' }, t.observacao))
            : t.resposta || t.observacao ? el('div', { class: 'lt-nota' }, t.resposta ? el('b', { class: t.resposta }, t.resposta === 'sim' ? 'Sim. ' : 'Não. ') : null, t.observacao || '') : null,
          ...(d.anexos || []).filter((a) => a.tarefaId === t.id).map((a) => el('a', { class: 'lt-print', href: `/api/anexos/${a.id}`, target: '_blank', rel: 'noopener', title: a.enviadoSgpEm ? 'Print (anexado na ocorrência)' : 'Print do aviso' },
            a.tipo === 'application/pdf' ? el('span', { class: 'lt-pdf' }, 'PDF') : el('img', { src: `/api/anexos/${a.id}`, alt: 'Print do aviso', loading: 'lazy' }),
            el('span', {}, `${a.tipo === 'application/pdf' ? 'Arquivo' : 'Print'}${a.enviadoSgpEm ? ' · na ocorrência' : ''}`))),
          // Pergunta agendada para o futuro: dá para responder antes (ex.: equipamentos já devolvidos).
          t.status === 'pendente' && t.tipo === 'decisao' && t.data > hoje() && !fim
            ? el('div', { class: 'lt-acoes' }, el('span', {}, 'Já aconteceu? Responder agora:'),
                el('button', { class: 'botao sim pequeno', onclick: () => abrirDecisao(d, t, 'sim') }, ico('check'), 'Sim'),
                el('button', { class: 'botao nao pequeno', onclick: () => abrirDecisao(d, t, 'nao') }, ico('x'), 'Não'))
            : null),
        t.dataProjetada
          ? el('span', { class: 'lt-data projetada', title: `Era ${dataCurta(t.data)}. Fazendo hoje o aviso atrasado, passa para ${dataCurta(t.dataProjetada)}.` }, el('s', {}, dataCurta(t.data)), dataCurta(t.dataProjetada))
          : el('span', { class: 'lt-data' }, dataCurta(t.data))));
    }

    const situacao = fim
      ? el('span', { class: `selo ${d.resultado === 'regularizado' ? 'sucesso' : d.resultado === 'saiu-da-suspensao' ? '' : 'perigo'}` }, d.resultado === 'regularizado' ? 'Regularizado' : d.resultado === 'saiu-da-suspensao' ? 'Não está mais suspenso' : 'Cancelado')
      : el('span', { class: 'selo marca' }, d.etapa.nome);

    const numeros = el('div', { class: 'numeros quatro' },
      el('div', { class: `numero ${fim ? '' : nivelDias(d.diasBloqueado)}` },
        el('small', {}, fim ? 'Finalizado em' : d.fluxo === 'pos-cancelamento' ? 'Ocorrência aberta há' : 'Suspenso há'),
        fim ? el('strong', {}, dataCurta(d.finalizadoEm)) : el('strong', {}, String(d.diasBloqueado), el('span', {}, d.diasBloqueado === 1 ? 'dia' : 'dias'))),
      el('div', { class: 'numero', title: d.financeiro ? `Atualizado em ${dataCurta(d.financeiro.em)}` : 'Ainda sem informação do SGP' },
        el('small', {}, 'Em aberto'),
        el('strong', {}, d.financeiro ? dinheiro(d.financeiro.valorAberto || 0) : '—', d.financeiro ? el('span', {}, plural(d.financeiro.faturasAbertas || 0, 'fatura', 'faturas')) : null)),
      el('div', { class: 'numero' }, el('small', {}, 'Etapa'), el('strong', {}, fim ? '—' : `${d.faseIndice + 1}/${d.fases.length}`, el('span', {}, fim ? '' : d.etapa.fase))),
      el('div', { class: 'numero' }, el('small', {}, 'Próximo passo'), el('strong', {}, d.paraHoje.length ? 'Hoje' : proxima ? dataCurta(proxima.data) : '—')));

    $('#ficha').replaceChildren(
      el('div', { class: 'ficha-cabeca' },
        el('button', { class: 'voltar', 'aria-label': 'Voltar para a fila', onclick: fecharFicha, html: ICONES.voltar }),
        el('span', { class: 'avatar grande' }, iniciais(d.cliente.nome)),
        el('div', { style: 'min-width:0;flex:1' },
          el('h2', {}, titulo(d.cliente.nome)),
          el('div', { class: 'lc-meta' }, el('span', { class: 'mono' }, `Contrato #${d.cliente.contrato}`), '·', el('span', { class: 'mono' }, `Processo ${d.id}`),
            d.ocorrencia && d.ocorrencia.numero ? ['·', el('span', { class: 'mono', title: 'Ocorrência no SGP' }, `Ocorrência ${d.ocorrencia.numero}`)] : null)),
        situacao,
        d.ocorrencia && d.ocorrencia.numero ? el('button', { class: 'botao fantasma pequeno', title: 'Anotação que fica aqui e vai para a ocorrência, sem marcar ninguém', onclick: () => abrirAnotacao(d) }, 'Registrar') : null,
        fim ? null : el('button', { class: 'botao fantasma pequeno', title: 'Para clientes já tratados antes do sistema', onclick: () => abrirAjuste(d) }, 'Ajustar etapa')),
      el('div', { class: 'ficha-corpo' },
        // O que fazer vem primeiro; o resto fica em duas colunas (processo | cliente).
        d.paraHoje.length ? el('section', { class: 'para-fazer' },
          el('div', { class: 'secao-titulo' }, el('span', {}, `Para fazer agora · ${d.paraHoje.length}`)),
          el('div', { class: 'tarefas' },
            d.paraHoje.map((t) => linhaTarefa(d, t)),
            simples.length > 1 ? el('button', { class: 'botao fantasma pequeno botao-todas', onclick: () => feitoComMensagem(d, simples) }, ico('checks'), `Marcar as ${simples.length} ações como feitas`) : null)) : null,
        cartaoAutorizacao(d),
        numeros,
        el('section', {}, el('div', { class: 'secao-titulo' }, el('span', {}, 'Etapas do processo')), etapas),
        el('div', { class: 'ficha-colunas' },
          el('section', { class: 'coluna-cronograma' },
            el('div', { class: 'secao-titulo' }, el('span', {}, 'Cronograma'),
              canceladas ? el('button', { class: 'link-mini', onclick: () => { estado.verCanceladas = !estado.verCanceladas; desenharFicha(d); } }, estado.verCanceladas ? 'Esconder canceladas' : `Mostrar canceladas (${canceladas})`) : null),
            el('ul', { class: 'linha-tempo' }, itens)),
          el('div', { class: 'coluna-cliente' },
            blocoCliente(d.dadosCliente),
            el('details', { class: 'historico' },
              el('summary', {}, el('div', { class: 'secao-titulo' }, el('span', {}, `Histórico · ${d.historico.length}`))),
              el('ul', { class: 'historico-lista' }, d.historico.map((h) => el('li', {}, el('time', {}, dataCurta(h.data)), el('span', {}, `${h.por === 'sistema' ? 'Sistema' : h.por}: ${h.detalhes}`)))))))));
  }

  // ---------- Ações ----------
  function garantirUsuario() {
    if (estado.usuario) return true;
    abrirUsuario();
    return false;
  }

  // Conclui uma ou várias tarefas (não-decisão) em sequência.
  async function concluir(tarefas, botao) {
    if (!garantirUsuario()) return;
    botao.disabled = true;
    try {
      for (const t of tarefas) {
        await api(`/api/tarefas/${t.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario }) });
        const linha = document.querySelector(`[data-tarefa="${CSS.escape(t.id)}"]`);
        if (linha) linha.classList.add('saindo');
      }
      avisar(tarefas.length > 1 ? `${tarefas.length} tarefas concluídas` : 'Tarefa concluída');
      await aposAcao();
    } catch (erro) {
      botao.disabled = false;
      avisar(erro.message, 'erro');
      await aposAcao();
    }
  }

  // Depois de uma ação: atualiza tudo; se o cliente não tem mais nada hoje, vai para o próximo da fila.
  async function aposAcao() {
    const id = estado.selecionado;
    const ordemAntes = estado.ordemFila || [];
    await recarregar();
    // Depois de qualquer ação, continua no MESMO cliente (pedido do Miguel): trocar sozinho fazia a
    // Jéssica agir no cliente errado. Ela vai para o próximo quando clicar nele na fila.
    void ordemAntes;
    if (id) return selecionar(id);
  }

  // ---------- Ajustar etapa (cliente tratado antes do sistema) ----------
  let ajusteAtual = null;
  function abrirAjuste(d) {
    if (!garantirUsuario()) return;
    ajusteAtual = d;
    const f = $('#form-ajuste');
    f.reset();
    $('#ajuste-cliente').textContent = titulo(d.cliente.nome);
    f.etapa.replaceChildren(...d.etapasAjustaveis.map((e) => el('option', { value: e.id }, e.nome)));
    f.etapa.value = d.etapa && d.etapasAjustaveis.some((e) => e.id === d.etapa.id) ? d.etapa.id : d.etapasAjustaveis[0].id;
    f.dataReferencia.max = hoje();
    camposAjuste();
    $('#janela-ajuste').showModal();
  }
  function camposAjuste() {
    const f = $('#form-ajuste');
    const etapa = ajusteAtual.etapasAjustaveis.find((e) => e.id === f.etapa.value);
    const feitos = Number(f.contatosFeitos.value || 0);
    $('#ajuste-avisos').hidden = etapa.tipo !== 'contatos';
    f.contatosFeitos.max = String(etapa.tentativas || 0);
    const precisaData = etapa.tipo === 'aguardo' || (etapa.tipo === 'contatos' && feitos > 0);
    $('#ajuste-data').hidden = !precisaData;
    f.dataReferencia.required = precisaData;
    $('#ajuste-data-rotulo').textContent = etapa.tipo === 'aguardo' ? 'Data em que a espera começou (ex.: dia da negativação)' : 'Data em que o último aviso foi enviado';
    $('#ajuste-efeito').textContent = etapa.tipo === 'contatos'
      ? feitos > 0
        ? `Os ${feitos} primeiros avisos ficam como feitos e os próximos são calculados a partir da data informada.`
        : 'A etapa começa hoje, do 1º aviso.'
      : etapa.tipo === 'aguardo' ? 'A pergunta "regularizou?" é marcada contando os dias a partir da data informada.' : 'As ações desta etapa ficam para hoje.';
  }
  async function enviarAjuste(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await api(`/api/processos/${ajusteAtual.id}/ajustar`, {
        method: 'POST',
        body: JSON.stringify({ por: estado.usuario, etapa: f.etapa.value, contatosFeitos: Number(f.contatosFeitos.value || 0), dataReferencia: f.dataReferencia.value || null, observacao: f.observacao.value }),
      });
      $('#janela-ajuste').close();
      avisar('Etapa ajustada e cronograma recalculado');
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Quem marcar na ocorrência ----------
  // Ninguém vem marcado: só é notificado no SGP quem a pessoa escolher.
  function prepararMarcar(form) {
    let area = form.querySelector('.marcar-area');
    if (!area) {
      area = el('div', { class: 'marcar-area' });
      form.querySelector('.janela-acoes').before(area);
    }
    const pessoas = estado.pessoas || [];
    area.hidden = !pessoas.length;
    area.replaceChildren(
      el('span', { class: 'marcar-titulo' }, 'Marcar na ocorrência ', el('em', { class: 'opcional' }, '(só quem for marcado recebe a notificação no SGP)')),
      el('div', { class: 'marcar-lista' }, pessoas.map((p) => el('label', { class: 'marcar-pessoa' },
        el('input', { type: 'checkbox', name: 'marcar', value: p.username }), el('span', {}, p.nome)))));
  }
  const marcadosEm = (form) => [...form.querySelectorAll('input[name=marcar]:checked')].map((i) => i.value);

  // ---------- Arquivos anexados (vários por vez) ----------
  // Cada janela tem sua lista: registro (aviso), mensagem (ação com arquivo) e retorno (prova do retorno).
  const ARQUIVOS = {
    registro: { lista: [], alvo: '#print-alvo', previa: '#print-previa', dica: '#print-dica' },
    mensagem: { lista: [], alvo: '#anexo-alvo', previa: '#anexo-previa', dica: '#anexo-dica' },
    retorno: { lista: [], alvo: '#retorno-alvo', previa: '#retorno-previa', dica: '#retorno-dica' },
  };
  const TIPOS_ARQUIVO = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  const MAX_ARQUIVOS = 8;
  function desenharArquivos(chave) {
    const a = ARQUIVOS[chave];
    $(a.previa).hidden = true;
    $(a.dica).textContent = a.lista.length
      ? `${plural(a.lista.length, 'arquivo anexado', 'arquivos anexados')} · clique ou cole com Ctrl+V para adicionar mais`
      : 'Clique para escolher os arquivos ou cole o print com Ctrl+V (pode mais de um)';
    let caixa = $(a.alvo).parentElement.querySelector('.arquivos-lista');
    if (!caixa) { caixa = el('div', { class: 'arquivos-lista' }); $(a.alvo).after(caixa); }
    caixa.replaceChildren(...a.lista.map((arq, i) => el('div', { class: 'arquivo-item', title: arq.nome },
      arq.tipo === 'application/pdf' ? el('span', { class: 'lt-pdf' }, 'PDF') : el('img', { src: arq.base64, alt: arq.nome }),
      el('span', { class: 'arquivo-nome' }, arq.nome),
      el('button', { type: 'button', class: 'arquivo-remover', title: 'Tirar este arquivo', 'aria-label': `Tirar ${arq.nome}`, onclick: () => { a.lista.splice(i, 1); desenharArquivos(chave); }, html: ICONES.x }))));
  }
  function limparArquivos(chave) { ARQUIVOS[chave].lista = []; desenharArquivos(chave); }
  function adicionarArquivos(chave, arquivos) {
    const a = ARQUIVOS[chave];
    for (const arquivo of arquivos) {
      if (!arquivo) continue;
      if (!TIPOS_ARQUIVO.includes(arquivo.type)) { avisar('O arquivo precisa ser uma imagem (PNG, JPG ou WEBP) ou um PDF.', 'erro'); continue; }
      if (arquivo.size > 4 * 1024 * 1024) { avisar(`O arquivo ${arquivo.name || ''} passou de 4 MB.`, 'erro'); continue; }
      if (a.lista.length >= MAX_ARQUIVOS) { avisar(`No máximo ${MAX_ARQUIVOS} arquivos por vez.`, 'erro'); break; }
      const leitor = new FileReader();
      leitor.onload = () => {
        const n = a.lista.length + 1;
        a.lista.push({ nome: arquivo.name && arquivo.name !== 'image.png' ? arquivo.name : (arquivo.type === 'application/pdf' ? `arquivo-${n}.pdf` : `print-${n}.png`), tipo: arquivo.type, base64: String(leitor.result) });
        desenharArquivos(chave);
      };
      leitor.readAsDataURL(arquivo);
    }
  }
  // Liga escolher (vários), colar (Ctrl+V) e teclado de uma janela à sua lista.
  function ligarArquivos(chave, input, janela) {
    input.multiple = true;
    input.accept = TIPOS_ARQUIVO.join(',');
    input.addEventListener('change', (e) => { adicionarArquivos(chave, [...e.target.files]); e.target.value = ''; });
    $(ARQUIVOS[chave].alvo).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    janela.addEventListener('paste', (e) => {
      if (chave === 'mensagem' && (!mensagemAtual || !mensagemAtual.anexo)) return;
      const arquivos = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile());
      if (arquivos.length) { e.preventDefault(); adicionarArquivos(chave, arquivos); }
    });
  }

  // ---------- Mensagem pronta (ação feita, pedido ao Lucas) ----------
  let mensagemAtual = null; // { aoEnviar(mensagem, marcar, arquivos), anexo }
  function abrirMensagem({ d, titulo: tituloJanela, texto, botao = 'Salvar', aoEnviar, anexo = false }) {
    if (!garantirUsuario()) return;
    const f = $('#form-mensagem');
    f.reset();
    mensagemAtual = { aoEnviar, anexo };
    $('#mensagem-anexo').hidden = !anexo;
    limparArquivos('mensagem');
    $('#mensagem-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#mensagem-titulo').textContent = tituloJanela;
    $('#mensagem-confirmar').textContent = botao;
    f.mensagem.value = texto || '';
    prepararMarcar(f);
    $('#janela-mensagem').showModal();
    f.mensagem.focus();
  }
  async function enviarMensagem(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (mensagemAtual.anexo && !ARQUIVOS.mensagem.lista.length) { avisar('Anexe o arquivo (print ou PDF) antes de marcar como feito.', 'erro'); $('#anexo-alvo').focus(); return; }
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await mensagemAtual.aoEnviar(f.mensagem.value, marcadosEm(f), [...ARQUIVOS.mensagem.lista]);
      $('#janela-mensagem').close();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }
  // Ação "Feito" (uma ou várias): a mensagem e quem marcar vão com a última.
  function feitoComMensagem(d, tarefas) {
    const ultima = tarefas[tarefas.length - 1];
    abrirMensagem({
      d,
      titulo: tarefas.length > 1 ? `Marcar as ${tarefas.length} ações como feitas` : ultima.descricao,
      texto: (d.modelos || {})[ultima.id] || '',
      botao: 'Marcar como feito',
      anexo: Boolean(ultima.anexoObrigatorio),
      aoEnviar: async (mensagem, marcar, arquivos) => {
        for (const t of tarefas) {
          const extra = t === ultima ? { mensagem, marcar, prints: arquivos && arquivos.length ? arquivos : undefined } : {};
          await api(`/api/tarefas/${t.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, ...extra }) });
        }
        avisar(tarefas.length > 1 ? `${tarefas.length} tarefas concluídas` : 'Tarefa concluída');
        aposAcao();
      },
    });
  }

// ---------- Aviso em dois passos ----------
  async function marcarEnviado(d, t, botao) {
    if (!garantirUsuario()) return;
    botao.disabled = true;
    // Pede uma vez para avisar no navegador quando for hora de perguntar.
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    try {
      const r = await api(`/api/tarefas/${t.id}/enviado`, { method: 'POST', body: JSON.stringify({ por: estado.usuario }) });
      const tt = r.tarefas.find((x) => x.id === t.id);
      avisar(`Aviso enviado. Pergunto às ${horaDe(tt.retorno.proximaChecagem)} se o cliente respondeu.`);
      await recarregar();
      selecionar(d.id);
    } catch (erro) {
      botao.disabled = false;
      avisar(erro.message, 'erro');
    }
  }
  async function semRetorno(d, t, botao) {
    if (!garantirUsuario()) return;
    botao.disabled = true;
    try {
      const r = await api(`/api/tarefas/${t.id}/retorno`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, resultado: 'sem-retorno' }) });
      const tt = r.tarefas.find((x) => x.id === t.id);
      avisar(`Anotado. Pergunto de novo às ${horaDe(tt.retorno.proximaChecagem)}.`);
      await recarregar();
      selecionar(d.id);
    } catch (erro) {
      botao.disabled = false;
      avisar(erro.message, 'erro');
    }
  }
  let retornoAtual = null;
  function abrirRetorno(d, t) {
    if (!garantirUsuario()) return;
    retornoAtual = { d, t };
    const f = $('#form-retorno');
    f.reset();
    $('#retorno-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#retorno-quando').textContent = `${t.descricao}, enviado às ${horaDe(t.retorno.enviadoEm)}.`;
    limparArquivos('retorno');
    prepararMarcar(f);
    efeitoRetorno();
    $('#janela-retorno').showModal();
  }
  function efeitoRetorno() {
    const tipo = $('#form-retorno').tipo.value;
    $('#retorno-efeito').textContent = {
      regularizou: 'Registra o retorno com a prova e abre a confirmação de regularização: os avisos desta etapa se encerram.',
      promessa: 'Registra o retorno com a prova e abre a promessa de pagamento: os próximos avisos ficam pausados até a data.',
      outro: 'Fica anotado aqui e na ocorrência, com a prova. O aviso continua aberto: finalize quando terminar as tentativas.',
    }[tipo] || '';
  }
  async function enviarRetorno(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const { d, t } = retornoAtual;
    if (!ARQUIVOS.retorno.lista.length) { avisar('Anexe a prova do retorno (print da conversa ou PDF).', 'erro'); $('#retorno-alvo').focus(); return; }
    const tipo = f.tipo.value;
    const rotulo = { regularizou: 'Regularizou', promessa: 'Fez promessa', outro: 'Retorno' }[tipo];
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      // Todo retorno fica registrado com o texto e a prova; depois abre o próximo passo, se houver.
      await api(`/api/tarefas/${t.id}/retorno`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, resultado: 'retorno', texto: `${rotulo}: ${f.texto.value}`, prints: [...ARQUIVOS.retorno.lista], marcar: marcadosEm(f) }) });
      const texto = f.texto.value;
      $('#janela-retorno').close();
      const atual = await api(`/api/processos/${d.id}`);
      if (tipo === 'regularizou') {
        const decisao = decisaoDaEtapa(atual, t);
        if (decisao) { abrirDecisao(atual, decisao, 'sim'); $('#form-decisao').observacao.value = texto; } else avisar('Esta etapa não tem a pergunta "regularizou?".', 'erro');
      } else if (tipo === 'promessa') {
        abrirPromessa(atual);
        $('#form-promessa').observacao.value = texto.slice(0, 300);
      } else {
        avisar('Retorno do cliente registrado');
      }
      await recarregar();
      if (tipo === 'outro') selecionar(d.id);
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Promessa de pagamento ----------
  // Decisão "regularizou?" pendente da mesma etapa do aviso (para o botão "Regularizou").
  const decisaoDaEtapa = (d, t) => (d.tarefas || []).find((x) => x.etapa === t.etapa && x.tipo === 'decisao' && x.status === 'pendente');
  let promessaAtual = null;
  function abrirPromessa(d) {
    if (!garantirUsuario()) return;
    promessaAtual = d;
    const f = $('#form-promessa');
    f.reset();
    f.dataPromessa.min = hoje();
    promessaAtual.editado = false;
    f.mensagem.value = (d.modelos || {}).promessa || '';
    prepararMarcar(f);
    $('#promessa-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#janela-promessa').showModal();
    f.dataPromessa.focus();
  }
  async function enviarPromessa(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await api(`/api/processos/${promessaAtual.id}/promessa`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, dataPromessa: f.dataPromessa.value, observacao: f.observacao.value, mensagem: f.mensagem.value.replace('{dataPromessa}', 'a data combinada'), marcar: marcadosEm(f) }) });
      $('#janela-promessa').close();
      avisar(`Promessa registrada para ${dataCurta(f.dataPromessa.value)}. Os avisos ficam pausados até lá.`);
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Registro de tentativas de contato ----------
  let registroAtual = null; // { d, t, editado }
  const horaBR = (h) => (h ? h.replace(':', 'h') : '');
  const agora = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };

  function montarTextoRegistro(f) {
    const linhas = ['REGISTRO DE TENTATIVAS DE CONTATO', ''];
    const as = (h) => (h ? ` às ${horaBR(h)}` : '');
    const para = (v) => (v ? ` para ${v}` : '');
    if (f.lig.checked) linhas.push(`Ligação realizada${as(f.ligHora.value)}${para(f.ligTel.value)}. ${f.ligRes.value}`, '');
    if (f.msg.checked) linhas.push(`Mensagem encaminhada${as(f.msgHora.value)}${para(f.msgTel.value)}. ${f.msgRes.value}`, '');
    if (f.mail.checked) linhas.push(`E-mail encaminhado${as(f.mailHora.value)}${para(f.mailEnd.value)}. ${f.mailRes.value}`, '');
    linhas.push(f.sms.checked ? `SMS encaminhado${as(f.smsHora.value)}.` : 'No momento, não há disponibilidade para envio de SMS.', '');
    if (f.prazo.value) {
      const [a, m, d] = f.prazo.value.split('-');
      linhas.push(`Prazo informado: No aviso encaminhado, foi informado que poderíamos aguardar a regularização até o dia ${d}/${m}/${a}.`);
    }
    return linhas.join('\n').trim();
  }

  // Print do aviso: escolhido no arquivo ou colado (Ctrl+V). Vai em base64 junto com o registro.
  function abrirRegistro(d, t) {
    if (!garantirUsuario()) return;
    const f = $('#form-registro');
    f.reset();
    registroAtual = { d, t, editado: false };
    const dc = d.dadosCliente || {};
    const opcoes = (sel, valores) => sel.replaceChildren(...(valores.length ? valores : ['']).map((v) => el('option', { value: v }, v || '(sem cadastro no SGP)')));
    opcoes(f.ligTel, dc.telefones || []);
    opcoes(f.msgTel, dc.telefones || []);
    opcoes(f.mailEnd, dc.emails || []);
    for (const k of ['ligHora', 'msgHora', 'mailHora', 'smsHora']) f[k].value = agora();
    f.lig.checked = f.msg.checked = f.mail.checked = true;
    $('#registro-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#registro-titulo').textContent = t.descricao;
    f.texto.value = montarTextoRegistro(f);
    limparArquivos('registro');
    prepararMarcar(f);
    $('#print-opcional').textContent = estado.printObrigatorio ? '(obrigatório)' : '(opcional)';
    $('#janela-registro').showModal();
  }

  function aoMudarRegistro(e) {
    const f = e.currentTarget;
    if (e.target === f.texto) { registroAtual.editado = true; return; }
    if (!registroAtual.editado) f.texto.value = montarTextoRegistro(f);
  }

  async function enviarRegistro(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    if (estado.printObrigatorio && !ARQUIVOS.registro.lista.length) { avisar('Anexe o print do aviso antes de salvar.', 'erro'); $('#print-alvo').focus(); return; }
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await api(`/api/tarefas/${registroAtual.t.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, observacao: f.texto.value, registro: true, prints: ARQUIVOS.registro.lista.length ? [...ARQUIVOS.registro.lista] : undefined, marcar: marcadosEm(f) }) });
      $('#janela-registro').close();
      avisar('Aviso registrado');
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Anotação livre na ocorrência ----------
  let anotacaoAtual = null;
  function abrirAnotacao(d) {
    if (!garantirUsuario()) return;
    anotacaoAtual = d;
    $('#form-anotacao').reset();
    prepararMarcar($('#form-anotacao'));
    $('#anotacao-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#janela-anotacao').showModal();
  }
  async function enviarAnotacao(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await api(`/api/processos/${anotacaoAtual.id}/registro`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, texto: f.texto.value, marcar: marcadosEm(f) }) });
      $('#janela-anotacao').close();
      avisar('Registro salvo');
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

// ---------- Criar ocorrência no SGP ----------
  let ocorrenciaAtual = null;
  function abrirOcorrencia(d, t) {
    if (!garantirUsuario()) return;
    ocorrenciaAtual = { d, t };
    const f = $('#form-ocorrencia');
    f.reset();
    $('#ocorrencia-cliente').textContent = `${titulo(d.cliente.nome)} · contrato #${d.cliente.contrato}`;
    $('#ocorrencia-tipo').textContent = t.ocorrenciaTipo;
    const valor = d.financeiro && d.financeiro.valorAberto ? ` Valor em aberto: ${dinheiro(d.financeiro.valorAberto)} (${plural(d.financeiro.faturasAbertas || 0, 'fatura', 'faturas')}).` : '';
    f.conteudo.value = `${t.ocorrenciaTipo}. Cliente suspenso há ${plural(d.diasBloqueado, 'dia', 'dias')} por inadimplência.${valor} Ocorrência aberta pelo sistema de cobrança (Têmis) por ${estado.usuario}.`;
    $('#janela-ocorrencia').showModal();
  }
  async function enviarOcorrencia(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      const r = await api(`/api/tarefas/${ocorrenciaAtual.t.id}/ocorrencia`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, conteudo: f.conteudo.value }) });
      $('#janela-ocorrencia').close();
      avisar(`Ocorrência ${r.protocolo} criada no SGP`);
      if (r.aviso) avisar(r.aviso, 'erro');
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  let decisaoAtual = null;
  function abrirDecisao(d, tarefa, resposta) {
    if (!garantirUsuario()) return;
    decisaoAtual = { d, tarefa };
    const f = $('#form-decisao');
    f.reset();
    f.resposta.value = resposta;
    decisaoAtual.editado = false;
    prepararMarcar(f);
    $('#decisao-cliente').textContent = titulo(d.cliente.nome);
    $('#decisao-pergunta').textContent = tarefa.descricao;
    efeitoDecisao();
    $('#janela-decisao').showModal();
    f.observacao.focus();
  }
  function efeitoDecisao(e) {
    const f = $('#form-decisao');
    const r = f.resposta.value;
    // Mensagem pronta do sim/não (troca junto com a resposta enquanto a pessoa não editou).
    if (e && e.target === f.mensagem) decisaoAtual.editado = true;
    else if (!decisaoAtual.editado) { const m = ((decisaoAtual.d.modelos || {})[decisaoAtual.tarefa.id]) || {}; f.mensagem.value = m[r] || ''; }
    $('#decisao-rotulo').textContent = r === 'sim' ? 'Como regularizou? (forma de pagamento, data...)' : 'O que foi feito e por que não regularizou?';
    $('#decisao-efeito').textContent = r === 'sim' ? 'O processo segue para a liberação do serviço e o encerramento.' : r === 'nao' ? 'O processo avança para a próxima etapa e as novas datas são geradas.' : '';
  }
  async function enviarDecisao(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await api(`/api/tarefas/${decisaoAtual.tarefa.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, resposta: f.resposta.value, observacao: f.observacao.value, mensagem: f.mensagem.value, marcar: marcadosEm(f) }) });
      $('#janela-decisao').close();
      avisar(f.resposta.value === 'sim' ? 'Regularização registrada' : 'Registrado. Próxima etapa agendada');
      await aposAcao();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Sincronização com o SGP ----------
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  function desenharSync(s) {
    const botao = $('#botao-sincronizar');
    botao.disabled = s.emAndamento;
    botao.classList.toggle('girando', s.emAndamento);
    const luz = $('#sync-luz');
    const u = s.ultima;
    luz.className = `sync-luz ${s.emAndamento ? 'rodando' : u ? (u.ok ? 'ok' : 'erro') : ''}`;
    let texto = 'SGP · ainda não sincronizado hoje';
    if (s.emAndamento) texto = 'Lendo o SGP…';
    else if (u && !u.ok) texto = `Falhou: ${u.erro}`;
    else if (u) texto = `SGP ${u.dia === hoje() ? 'hoje' : dataCurta(u.dia)} ${new Date(u.fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${u.total} suspensos${u.totalPosCancelamento ? ` · ${u.totalPosCancelamento} pós-cancelamento` : ''}`;
    $('#sync-texto').textContent = texto;
    $('#sync').title = texto;
  }
  async function acompanharSync(avisarFim) {
    let s = await api('/api/sincronizacao');
    desenharSync(s);
    while (s.emAndamento) {
      await esperar(4000);
      s = await api('/api/sincronizacao');
      desenharSync(s);
    }
    if (avisarFim && s.ultima) {
      if (s.ultima.ok) avisar(s.ultima.novos.length ? `${plural(s.ultima.novos.length, 'cliente novo entrou', 'clientes novos entraram')} no processo` : 'Nenhum cliente novo no SGP');
      else avisar(s.ultima.erro, 'erro');
      await recarregar();
    }
  }
  async function sincronizar() {
    try {
      desenharSync(await api('/api/sincronizar', { method: 'POST' }));
      await acompanharSync(true);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  // ---------- Vista "Todos os clientes" ----------
  function situacao(c) {
    if (c.status !== 'ativo') return c.resultado === 'regularizado' ? el('span', { class: 'selo sucesso' }, ico('check'), 'Regularizado') : c.resultado === 'saiu-da-suspensao' ? el('span', { class: 'selo' }, 'Não está mais suspenso') : el('span', { class: 'selo perigo' }, 'Cancelado');
    if (c.paraHoje.some((t) => t.atrasada)) return el('span', { class: 'selo perigo' }, ico('alerta'), 'Atrasado');
    if (c.paraHoje.length) return el('span', { class: 'selo marca' }, 'Tarefa hoje');
    return el('span', { class: 'selo' }, ico('relogio'), 'Aguardando');
  }

  function desenharClientes() {
    const todos = estado.processos || [];
    const grupos = [
      { id: 'ativos', nome: 'Em andamento', f: (c) => c.status === 'ativo' },
      { id: 'finalizados', nome: 'Finalizados', f: (c) => c.status !== 'ativo' },
      { id: 'todos', nome: 'Todos', f: () => true },
    ];
    $('#abas-clientes').replaceChildren(...grupos.map((g) => el('button', {
      class: `aba${estado.abaClientes === g.id ? ' ativa' : ''}`, onclick: () => { estado.abaClientes = g.id; desenharClientes(); },
    }, g.nome, el('b', {}, String(todos.filter(g.f).length)))));
    if (estado.painel) desenharFunil($('#funil-clientes'), { clicavel: true });

    const termo = normalizar(estado.busca);
    const lista = todos
      .filter(grupos.find((g) => g.id === estado.abaClientes).f)
      .filter((c) => !estado.faseClientes || (c.etapa && c.etapa.fase === estado.faseClientes))
      .filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo))
      .sort((a, b) => (a.status === b.status ? b.diasBloqueado - a.diasBloqueado : a.status === 'ativo' ? -1 : 1));

    if (!lista.length) {
      $('#tabela-clientes').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'suave' }, estado.faseClientes ? `Ninguém em "${estado.faseClientes}".` : 'Nenhum cliente encontrado.')));
      return;
    }
    $('#tabela-clientes').replaceChildren(...lista.map((c) => {
      const prox = c.paraHoje[0] || c.proxima;
      return el('tr', { tabindex: '0', onclick: () => abrirDaTabela(c.id), onkeydown: (e) => { if (e.key === 'Enter') abrirDaTabela(c.id); } },
        el('td', {}, el('div', { class: 'cliente-celula' }, el('span', { class: 'avatar' }, iniciais(c.cliente.nome)),
          el('div', {}, el('strong', {}, titulo(c.cliente.nome)), el('div', { class: 'suave mono' }, `#${c.cliente.contrato}`)))),
        el('td', {}, c.status === 'ativo' ? chipDias(c.diasBloqueado) : el('span', { class: 'suave' }, '—')),
        el('td', {}, c.etapa ? c.etapa.nome : el('span', { class: 'suave' }, 'Encerrado')),
        el('td', {}, prox ? el('div', {}, el('div', {}, prox.descricao), el('div', { class: 'suave mono' }, dataCurta(prox.data))) : el('span', { class: 'suave' }, '—')),
        el('td', {}, situacao(c)));
    }));
  }

  // Na lista de clientes, a ficha abre por cima (como no celular).
  // ---------- Vista "Etapas": clientes por etapa e passo ----------
  function desenharEtapas() {
    const ativos = (estado.processos || []).filter((c) => c.status === 'ativo');
    const termo = normalizar(estado.busca);
    const conta = (etapaId, passoId) => ativos.filter((c) => c.etapa && c.etapa.id === etapaId && (!passoId || (c.passo && c.passo.id === passoId))).length;
    const f = estado.filtroEtapa;
    const escolher = (etapa, passo) => { estado.filtroEtapa = etapa ? { etapa, passo } : null; desenharEtapas(); };

    // Menu à esquerda: cada etapa com seus passos e quantos clientes há em cada um.
    $('#etapas-menu').replaceChildren(
      el('button', { class: `em-todas${!f ? ' ativo' : ''}`, onclick: () => escolher(null) }, el('span', {}, 'Todas as etapas'), el('b', {}, String(ativos.length))),
      ...(estado.etapas || []).map((e) => {
        const total = conta(e.id);
        return el('div', { class: `em-etapa${total ? '' : ' vazia'}` },
          el('button', { class: `em-titulo${f && f.etapa === e.id && !f.passo ? ' ativo' : ''}`, onclick: () => escolher(e.id, null) },
            el('i', { class: `f${e.faseIndice}` }), el('span', {}, e.nome), el('b', {}, String(total))),
          e.passos.length > 1 ? el('div', { class: 'em-passos' }, e.passos.map((p) => {
            const n = conta(e.id, p.id);
            return el('button', { class: `em-passo${f && f.etapa === e.id && f.passo === p.id ? ' ativo' : ''}${n ? '' : ' vazio'}`, onclick: () => escolher(e.id, p.id) },
              el('span', {}, p.nome), el('b', {}, String(n)));
          })) : null);
      }));

    const etapaSel = f && (estado.etapas || []).find((e) => e.id === f.etapa);
    const passoSel = etapaSel && f.passo && etapaSel.passos.find((p) => p.id === f.passo);
    $('#etapas-caminho').textContent = etapaSel ? etapaSel.fase : 'Todas as etapas';
    $('#etapas-titulo').textContent = etapaSel ? `${etapaSel.nome}${passoSel ? ` · ${passoSel.nome}` : ''}` : 'Clientes em andamento';

    const lista = ativos
      .filter((c) => !f || (c.etapa && c.etapa.id === f.etapa && (!f.passo || (c.passo && c.passo.id === f.passo))))
      .filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo))
      .sort((a, b) => b.diasBloqueado - a.diasBloqueado);
    const soma = lista.reduce((s, c) => s + ((c.financeiro && c.financeiro.valorAberto) || 0), 0);
    $('#etapas-total').textContent = `${plural(lista.length, 'cliente', 'clientes')}${soma ? ` · ${dinheiro(soma)} em aberto` : ''}`;

    if (!lista.length) {
      $('#tabela-etapas').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'suave' }, 'Nenhum cliente neste passo.')));
      return;
    }
    $('#tabela-etapas').replaceChildren(...lista.map((c) => {
      const prox = c.paraHoje[0] || c.proxima;
      const atrasada = c.paraHoje.some((t) => t.atrasada);
      return el('tr', { tabindex: '0', onclick: () => abrirDaTabela(c.id), onkeydown: (e) => { if (e.key === 'Enter') abrirDaTabela(c.id); } },
        el('td', {}, el('div', { class: 'cliente-celula' }, el('span', { class: 'avatar' }, iniciais(c.cliente.nome)),
          el('div', {}, el('strong', {}, titulo(c.cliente.nome)), el('div', { class: 'suave mono' }, `#${c.cliente.contrato}`)))),
        el('td', {}, chipDias(c.diasBloqueado)),
        el('td', {}, el('div', {}, c.etapa.nome), el('div', { class: 'suave' }, c.passo ? `${c.passo.nome}${c.passo.ate ? ` · até ${dataCurta(c.passo.ate)}` : ''}` : '')),
        el('td', {}, prox
          ? el('div', {}, el('div', {}, prox.descricao), el('div', { class: `mono ${atrasada ? 'texto-perigo' : 'suave'}` }, `${atrasada ? 'Atrasada · ' : ''}${prox.data === hoje() ? 'Hoje' : dataCurta(prox.data)}`))
          : el('span', { class: 'suave' }, '—')),
        el('td', { class: 'mono' }, c.financeiro && c.financeiro.valorAberto ? dinheiro(c.financeiro.valorAberto) : el('span', { class: 'suave' }, '—')));
    }));
  }

  function abrirDaTabela(id) {
    trocarVista('hoje');
    selecionar(id, true);
  }

  function trocarVista(vista) {
    estado.vista = vista;
    document.querySelectorAll('.trilho-item[data-vista]').forEach((b) => b.classList.toggle('ativo', b.dataset.vista === vista));
    $('#vista-hoje').hidden = vista !== 'hoje';
    $('#vista-clientes').hidden = vista !== 'clientes';
    $('#vista-etapas').hidden = vista !== 'etapas';
    if (estado.painel) desenharTopo();
    if (vista === 'clientes' || vista === 'etapas') carregarClientes().catch((e) => avisar(e.message, 'erro'));
  }

  // ---------- Usuário ----------
  function abrirUsuario() {
    if (estado.comLogin) return alternarMenu();
    $('#form-usuario').nome.value = estado.usuario;
    $('#janela-usuario').showModal();
  }
  function alternarMenu() {
    const aberto = document.querySelector('.menu-usuario');
    if (aberto) return aberto.remove();
    const menu = el('div', { class: 'menu-usuario', role: 'menu' },
      el('div', { class: 'quem' }, el('small', {}, 'Conectado como'), el('strong', {}, estado.usuario)),
      el('button', { role: 'menuitem', onclick: () => { menu.remove(); $('#form-senha').reset(); $('#janela-senha').showModal(); } }, 'Trocar senha'),
      el('button', { role: 'menuitem', onclick: sair }, 'Sair'));
    $('.trilho-fim').append(menu);
    setTimeout(() => document.addEventListener('click', function fora(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', fora); }
    }), 0);
  }
  async function sair() {
    await api('/api/sair', { method: 'POST' }).catch(() => {});
    location.replace('/login.html');
  }
  async function trocarSenha(e) {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.novaSenha.value !== f.confirmar.value) return avisar('A confirmação não confere com a nova senha.', 'erro');
    try {
      await api('/api/senha', { method: 'POST', body: JSON.stringify({ senhaAtual: f.senhaAtual.value, novaSenha: f.novaSenha.value }) });
      $('#janela-senha').close();
      avisar('Senha alterada');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }
  function desenharUsuario() {
    $('#usuario-iniciais').textContent = iniciais(estado.usuario);
    $('#botao-usuario').title = estado.usuario ? `${estado.usuario}${estado.comLogin ? ' · trocar senha ou sair' : ' · trocar nome'}` : 'Identifique-se';
    if (estado.painel) desenharTopo();
  }

  // ---------- Eventos ----------
  document.querySelectorAll('.trilho-item[data-vista]').forEach((b) => b.addEventListener('click', () => trocarVista(b.dataset.vista)));
  $('#busca').addEventListener('input', (e) => {
    estado.busca = e.target.value;
    if (estado.vista === 'hoje') desenharHoje(); else if (estado.vista === 'etapas') desenharEtapas(); else desenharClientes();
  });
  $('#botao-sincronizar').addEventListener('click', sincronizar);
  $('#botao-usuario').addEventListener('click', abrirUsuario);
  $('#botao-tema').addEventListener('click', () => {
    const novo = document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro';
    aplicarTema(novo);
    gravarLocal('temis.tema', novo);
  });
  $('#campo-data').addEventListener('change', (e) => {
    estado.data = e.target.value || null;
    estado.selecionado = null;
    recarregar();
  });
  $('#form-promessa').addEventListener('submit', enviarPromessa);
  $('#funil-topo').addEventListener('click', () => trocarVista('etapas'));
  $('#form-retorno').addEventListener('submit', enviarRetorno);
  ligarArquivos('retorno', $('#form-retorno').anexo, $('#janela-retorno'));
  $('#form-retorno').addEventListener('change', efeitoRetorno);
  $('#retorno-cancelar').addEventListener('click', () => $('#janela-retorno').close());
  $('#filtro-passo').addEventListener('change', (e) => trocarAba(e.target.value));
  $('#sino').addEventListener('click', (e) => { e.stopPropagation(); alternarSino(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.sino-area')) alternarSino(false); });
  $('#form-registro').addEventListener('submit', enviarRegistro);
  $('#form-registro').addEventListener('input', (e) => { if (e.target.name !== 'print') aoMudarRegistro(e); });
  ligarArquivos('registro', $('#form-registro').print, $('#janela-registro'));
  $('#form-registro').addEventListener('change', (e) => { if (e.target.name !== 'print') aoMudarRegistro(e); });
  $('#registro-cancelar').addEventListener('click', () => $('#janela-registro').close());
  $('#form-anotacao').addEventListener('submit', enviarAnotacao);
  $('#anotacao-cancelar').addEventListener('click', () => $('#janela-anotacao').close());
  $('#promessa-cancelar').addEventListener('click', () => $('#janela-promessa').close());
  $('#form-ocorrencia').addEventListener('submit', enviarOcorrencia);
  $('#ocorrencia-cancelar').addEventListener('click', () => $('#janela-ocorrencia').close());
  $('#form-ajuste').addEventListener('submit', enviarAjuste);
  $('#form-ajuste').addEventListener('input', camposAjuste);
  $('#ajuste-cancelar').addEventListener('click', () => $('#janela-ajuste').close());
  $('#form-decisao').addEventListener('submit', enviarDecisao);
  $('#form-decisao').addEventListener('change', efeitoDecisao);
  $('#form-decisao').addEventListener('input', (e) => { if (e.target.name === 'mensagem') decisaoAtual.editado = true; });
  // Ao fechar uma janela, some o erro que ficou nela.
  document.querySelectorAll('dialog').forEach((dlg) => dlg.addEventListener('close', () => dlg.querySelectorAll('.janela-erro').forEach((x) => x.remove())));
  $('#form-mensagem').addEventListener('submit', enviarMensagem);
  ligarArquivos('mensagem', $('#form-mensagem').anexo, $('#janela-mensagem'));
  $('#mensagem-cancelar').addEventListener('click', () => $('#janela-mensagem').close());
  $('#form-promessa').addEventListener('input', (e) => {
    const f = e.currentTarget;
    if (e.target === f.mensagem) { promessaAtual.editado = true; return; }
    if (e.target === f.dataPromessa && !promessaAtual.editado && f.dataPromessa.value) f.mensagem.value = ((promessaAtual.modelos || {}).promessa || '').replace('{dataPromessa}', f.dataPromessa.value.split('-').reverse().join('/'));
  });
  $('#decisao-cancelar').addEventListener('click', () => $('#janela-decisao').close());
  $('#form-senha').addEventListener('submit', trocarSenha);
  $('#senha-cancelar').addEventListener('click', () => $('#janela-senha').close());
  $('#form-usuario').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = e.currentTarget.nome.value.trim();
    if (!nome) return;
    estado.usuario = nome;
    gravarLocal('temis.usuario', nome);
    $('#janela-usuario').close();
    desenharUsuario();
  });

  // Teclado: / busca, ↑ ↓ (ou j k) navegam na fila, Esc fecha a ficha no celular.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !digitando) { e.preventDefault(); $('#busca').focus(); return; }
    if (e.key === 'Escape') { if (digitando) document.activeElement.blur(); else fecharFicha(); return; }
    if (digitando || estado.vista !== 'hoje') return;
    const ordem = estado.ordemFila || [];
    if (!ordem.length) return;
    const i = ordem.indexOf(estado.selecionado);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); selecionar(ordem[Math.min(ordem.length - 1, i + 1)], true); }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); selecionar(ordem[Math.max(0, i - 1)], true); }
  });

  // Ao passar de celular para tela larga, abre o primeiro cliente da fila.
  const telaLarga = matchMedia('(min-width: 901px)');
  telaLarga.addEventListener('change', (e) => {
    if (e.matches && estado.vista === 'hoje' && !estado.selecionado && (estado.ordemFila || []).length) selecionar(estado.ordemFila[0]);
  });

  // ---------- Início ----------
  async function iniciar() {
    desenharFichaVazia();
    $('#fila').replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'esqueleto' })));
    try {
      const eu = await api('/api/eu');
      estado.comLogin = eu.comLogin;
      estado.criarOcorrencia = Boolean(eu.criarOcorrencia);
      estado.printObrigatorio = Boolean(eu.printObrigatorio);
      estado.pessoas = Array.isArray(eu.pessoas) ? eu.pessoas : [];
      if (eu.comLogin) estado.usuario = eu.nome;
    } catch { /* segue sem login */ }
    desenharUsuario();
    try {
      await carregarPainel();
    } catch (erro) {
      $('#fila').replaceChildren(el('div', { class: 'fila-vazia' }, el('strong', {}, 'Não foi possível carregar'), erro.message));
    }
    if (!estado.usuario) abrirUsuario();
    acompanharSync(false).catch(() => {});
  }
  iniciar();
})();
