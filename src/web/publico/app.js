// Tela do financeiro: fila de trabalho à esquerda e ficha do cliente à direita.
// JavaScript puro, sem bibliotecas. Todo texto entra via textContent (seguro).
(() => {
  'use strict';

  // ---------- Estado ----------
  const estado = {
    data: null, // só no modo demonstração (simular outro dia)
    vista: 'hoje',
    aba: 'todos',
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
    const t = el('div', { class: `toast ${tipo}`, role: 'status' }, ico(tipo === 'erro' ? 'alerta' : 'check'), texto);
    $('#avisos').append(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- Carregar ----------
  async function carregarPainel() {
    estado.painel = await api('/api/painel');
    desenharTopo();
    desenharHoje();
  }
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
  const ABAS = [
    { id: 'todos', nome: 'Todos', cor: null },
    { id: 'atrasadas', nome: 'Atrasados', cor: 'var(--perigo)' },
    { id: 'decisao', nome: 'Regularizou?', cor: 'var(--decisao)' },
    { id: 'contato', nome: 'Contatos', cor: 'var(--contato)' },
    { id: 'acao', nome: 'Ações SGP', cor: 'var(--acao)' },
  ];
  const passaAba = (t) => estado.aba === 'todos' || (estado.aba === 'atrasadas' ? t.atrasada : t.tipo === estado.aba);

  // Hoje: a fila do painel. Outro dia: a agenda daquele dia.
  const clientesBase = () => (estado.dia ? estado.agenda || [] : estado.painel.clientes);

  function clientesVisiveis() {
    const termo = normalizar(estado.busca);
    return clientesBase()
      .filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo))
      .filter((c) => c.paraHoje.some(passaAba));
  }

  function desenharMetricas() {
    const r = estado.painel.resumo;
    const m = ({ cor, rotulo, valor, detalhe, aba }) => el(aba ? 'button' : 'div', {
      class: `metrica${valor ? '' : ' zero'}${aba && estado.aba === aba ? ' ativa' : ''}`,
      style: `--cor: var(${cor})`,
      onclick: aba ? () => trocarAba(estado.aba === aba ? 'todos' : aba) : null,
    }, el('span', { class: 'metrica-rotulo' }, el('i'), rotulo), el('span', { class: 'metrica-valor' }, String(valor)), el('span', { class: 'metrica-detalhe' }, detalhe));
    $('#metricas').replaceChildren(
      m({ cor: '--marca', rotulo: 'Para hoje', valor: r.paraHoje, detalhe: plural(r.clientesHoje, 'cliente', 'clientes') }),
      m({ cor: '--perigo', rotulo: 'Atrasadas', valor: r.atrasadas, detalhe: r.atrasadas ? 'de dias anteriores' : 'tudo em dia', aba: 'atrasadas' }),
      m({ cor: '--decisao', rotulo: 'Regularizou?', valor: r.decisoes, detalhe: 'para responder', aba: 'decisao' }),
      m({ cor: '--alerta', rotulo: 'Em aberto', valor: dinheiro(r.valorAberto || 0), detalhe: `${plural(r.regularizados, 'regularizado', 'regularizados')} · ${plural(r.cancelados, 'cancelado', 'cancelados')}` }),
    );
  }

  function desenharAbas() {
    const base = clientesBase();
    const conta = (id) => (id === 'todos' ? base.length : base.filter((c) => c.paraHoje.some((t) => (id === 'atrasadas' ? t.atrasada : t.tipo === id))).length);
    $('#abas').replaceChildren(...ABAS.map((a) => el('button', {
      class: `aba${estado.aba === a.id ? ' ativa' : ''}`, role: 'tab', 'aria-selected': String(estado.aba === a.id), onclick: () => trocarAba(a.id),
    }, a.cor ? el('i', { style: `background:${a.cor}` }) : null, a.nome, el('b', {}, String(conta(a.id))))));
  }

  function trocarAba(id) {
    estado.aba = id;
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
        el('span', { class: 'mono' }, `#${c.cliente.contrato}`), '·', etapaTxt)),
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
    desenharFunil($('#funil'));
    desenharDias();
    desenharAbas();
    const lista = clientesVisiveis();

    // Grupos por prioridade: atrasados, decisões, demais.
    const grupos = [
      { nome: 'Atrasados', itens: lista.filter((c) => c.paraHoje.some((t) => t.atrasada)) },
      { nome: 'Responder "regularizou?"', itens: lista.filter((c) => !c.paraHoje.some((t) => t.atrasada) && c.paraHoje.some((t) => t.tipo === 'decisao')) },
      { nome: estado.dia ? `Agendados para ${dataCurta(estado.dia)}` : 'Para hoje', itens: lista.filter((c) => !c.paraHoje.some((t) => t.atrasada || t.tipo === 'decisao')) },
    ].filter((g) => g.itens.length);
    for (const g of grupos) g.itens.sort((a, b) => b.diasBloqueado - a.diasBloqueado || a.cliente.nome.localeCompare(b.cliente.nome));

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
    if (!estado.selecionado || !ordem.includes(estado.selecionado)) {
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
    const quando = t.atrasada
      ? el('small', { class: 'atrasada' }, `Atrasada desde ${dataCurta(t.data)} (${plural(diasEntre(t.data, hoje()), 'dia', 'dias')})`)
      : el('small', {}, { contato: 'Contato com o cliente', acao: 'Ação no SGP', decisao: 'Responda para o processo seguir' }[t.tipo]);
    const acoes = t.tipo === 'decisao'
      ? el('div', { class: 'acoes-tarefa' },
          el('button', { class: 'botao sim', onclick: () => abrirDecisao(d, t, 'sim') }, ico('check'), 'Sim'),
          el('button', { class: 'botao nao', onclick: () => abrirDecisao(d, t, 'nao') }, ico('x'), 'Não'))
      : el('div', { class: 'acoes-tarefa' }, el('button', { class: 'botao feito', onclick: (e) => concluir([t], e.currentTarget) }, ico('check'), 'Feito'));
    return el('div', { class: `tarefa ${t.tipo}${t.atrasada ? ' atrasada' : ''}`, 'data-tarefa': t.id },
      el('span', { class: 'icone', html: ICONES[t.tipo] }),
      el('div', { class: 'tarefa-texto' }, el('strong', {}, t.descricao), quando),
      acoes);
  }

  function desenharFicha(d) {
    const fim = d.status !== 'ativo';
    const simples = d.paraHoje.filter((t) => t.tipo !== 'decisao');
    const proxima = d.proxima;

    const etapas = el('div', { class: 'etapas' }, d.fases.map((nome, k) => {
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
          t.resposta || t.observacao ? el('div', { class: 'lt-nota' }, t.resposta ? el('b', { class: t.resposta }, t.resposta === 'sim' ? 'Sim. ' : 'Não. ') : null, t.observacao || '') : null),
        el('span', { class: 'lt-data' }, dataCurta(t.data))));
    }

    const situacao = fim
      ? el('span', { class: `selo ${d.resultado === 'regularizado' ? 'sucesso' : 'perigo'}` }, d.resultado === 'regularizado' ? 'Regularizado' : 'Cancelado')
      : el('span', { class: 'selo marca' }, d.etapa.nome);

    $('#ficha').replaceChildren(
      el('div', { class: 'ficha-cabeca' },
        el('button', { class: 'voltar', 'aria-label': 'Voltar para a fila', onclick: fecharFicha, html: ICONES.voltar }),
        el('span', { class: 'avatar grande' }, iniciais(d.cliente.nome)),
        el('div', { style: 'min-width:0;flex:1' },
          el('h2', {}, titulo(d.cliente.nome)),
          el('div', { class: 'lc-meta' }, el('span', { class: 'mono' }, `Contrato #${d.cliente.contrato}`), '·', el('span', { class: 'mono' }, `Processo ${d.id}`),
            d.ocorrencia && d.ocorrencia.numero ? ['·', el('span', { class: 'mono', title: 'Ocorrência no SGP' }, `Ocorrência ${d.ocorrencia.numero}`)] : null)),
        situacao,
        fim ? null : el('button', { class: 'botao fantasma pequeno', title: 'Para clientes já tratados antes do sistema', onclick: () => abrirAjuste(d) }, 'Ajustar etapa')),
      el('div', { class: 'ficha-corpo' },
        el('div', { class: 'numeros quatro' },
          el('div', { class: `numero ${fim ? '' : nivelDias(d.diasBloqueado)}` },
            el('small', {}, fim ? 'Finalizado em' : d.fluxo === 'pos-cancelamento' ? 'Ocorrência aberta há' : 'Suspenso há'),
            fim ? el('strong', {}, dataCurta(d.finalizadoEm)) : el('strong', {}, String(d.diasBloqueado), el('span', {}, d.diasBloqueado === 1 ? 'dia' : 'dias'))),
          el('div', { class: 'numero', title: d.financeiro ? `Atualizado em ${dataCurta(d.financeiro.em)}` : 'Ainda sem informação do SGP' },
            el('small', {}, 'Em aberto'),
            el('strong', {}, d.financeiro ? dinheiro(d.financeiro.valorAberto || 0) : '—', d.financeiro ? el('span', {}, plural(d.financeiro.faturasAbertas || 0, 'fatura', 'faturas')) : null)),
          el('div', { class: 'numero' }, el('small', {}, 'Etapa'), el('strong', {}, fim ? '—' : `${d.faseIndice + 1}/${d.fases.length}`, el('span', {}, fim ? '' : d.etapa.fase))),
          el('div', { class: 'numero' }, el('small', {}, 'Próximo passo'), el('strong', {}, d.paraHoje.length ? 'Hoje' : proxima ? dataCurta(proxima.data) : '—'))),
        el('section', {}, el('div', { class: 'secao-titulo' }, el('span', {}, 'Etapas do processo')), etapas),
        d.paraHoje.length ? el('section', {},
          el('div', { class: 'secao-titulo' }, el('span', {}, `Para fazer agora · ${d.paraHoje.length}`)),
          el('div', { class: 'tarefas' },
            d.paraHoje.map((t) => linhaTarefa(d, t)),
            simples.length > 1 ? el('button', { class: 'botao fantasma pequeno botao-todas', onclick: (e) => concluir(simples, e.currentTarget) }, ico('checks'), `Marcar as ${simples.length} ações como feitas`) : null)) : null,
        el('section', {},
          el('div', { class: 'secao-titulo' }, el('span', {}, 'Cronograma'),
            canceladas ? el('button', { class: 'link-mini', onclick: () => { estado.verCanceladas = !estado.verCanceladas; desenharFicha(d); } }, estado.verCanceladas ? 'Esconder canceladas' : `Mostrar canceladas (${canceladas})`) : null),
          el('ul', { class: 'linha-tempo' }, itens)),
        el('details', { class: 'historico' },
          el('summary', {}, el('div', { class: 'secao-titulo' }, el('span', {}, `Histórico · ${d.historico.length}`))),
          el('ul', { class: 'historico-lista' }, d.historico.map((h) => el('li', {}, el('time', {}, dataCurta(h.data)), el('span', {}, `${h.por === 'sistema' ? 'Sistema' : h.por}: ${h.detalhes}`)))))));
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
    if (estado.vista !== 'hoje') { if (id) selecionar(id); return; }
    const aindaNaFila = (estado.ordemFila || []).includes(id);
    if (aindaNaFila) return selecionar(id);
    const proximo = ordemAntes.slice(ordemAntes.indexOf(id) + 1).find((x) => estado.ordemFila.includes(x)) || estado.ordemFila[0];
    if (proximo) {
      avisar('Cliente em dia. Indo para o próximo.');
      selecionar(proximo, true);
    } else desenharFichaVazia();
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

  let decisaoAtual = null;
  function abrirDecisao(d, tarefa, resposta) {
    if (!garantirUsuario()) return;
    decisaoAtual = { d, tarefa };
    const f = $('#form-decisao');
    f.reset();
    f.resposta.value = resposta;
    $('#decisao-cliente').textContent = titulo(d.cliente.nome);
    $('#decisao-pergunta').textContent = tarefa.descricao;
    efeitoDecisao();
    $('#janela-decisao').showModal();
    f.observacao.focus();
  }
  function efeitoDecisao() {
    const r = $('#form-decisao').resposta.value;
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
      await api(`/api/tarefas/${decisaoAtual.tarefa.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario, resposta: f.resposta.value, observacao: f.observacao.value }) });
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
    if (c.status !== 'ativo') return c.resultado === 'regularizado' ? el('span', { class: 'selo sucesso' }, ico('check'), 'Regularizado') : el('span', { class: 'selo perigo' }, 'Cancelado');
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
  $('#form-ajuste').addEventListener('submit', enviarAjuste);
  $('#form-ajuste').addEventListener('input', camposAjuste);
  $('#ajuste-cancelar').addEventListener('click', () => $('#janela-ajuste').close());
  $('#form-decisao').addEventListener('submit', enviarDecisao);
  $('#form-decisao').addEventListener('change', efeitoDecisao);
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
