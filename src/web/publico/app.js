// Tela do financeiro: lê a API e desenha tudo. JavaScript puro, sem bibliotecas.
(() => {
  'use strict';

  // ---------- Estado ----------
  const estado = {
    data: null, // null = hoje de verdade; preenchido só ao simular um dia
    vista: 'hoje',
    filtro: 'todos',
    busca: '',
    filtroClientes: 'ativos',
    buscaClientes: '',
    painel: null,
    processos: null,
    abertoId: null,
    usuario: lerLocal('temis.usuario') || '',
  };

  function lerLocal(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
  }
  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ }
  }

  // ---------- Utilidades ----------
  const $ = (seletor) => document.querySelector(seletor);

  // Cria elementos com segurança (texto sempre via textContent).
  function el(tag, atributos = {}, ...filhos) {
    const no = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos)) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (chave === 'class') no.className = valor;
      else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
      else if (chave === 'html') no.innerHTML = valor; // usado SOMENTE com os ícones fixos abaixo
      else no.setAttribute(chave, valor === true ? '' : valor);
    }
    for (const filho of filhos.flat()) {
      if (filho === null || filho === undefined || filho === false) continue;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return no;
  }

  const ICONES = {
    contato: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
    acao: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/></svg>',
    decisao: '<svg viewBox="0 0 24 24"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    seta: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    relogio: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/></svg>',
    alerta: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7"/></svg>',
    lista: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    cancelada: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    festa: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  };
  const icone = (nome) => el('span', { class: 'ico', html: ICONES[nome], 'aria-hidden': 'true', style: 'display:contents' });

  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const paraData = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
  const dataCurta = (iso) => { const d = paraData(iso); return `${DIAS_CURTOS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const dataExtenso = (iso) => {
    const d = paraData(iso);
    const texto = `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    return texto[0].toUpperCase() + texto.slice(1);
  };
  const diasAtras = (de, ate) => Math.round((paraData(ate) - paraData(de)) / 86400000);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const iniciais = (nome) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hoje = () => (estado.painel && estado.painel.hoje) || estado.data;

  function saudacao() {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  // ---------- API ----------
  async function api(caminho, opcoes = {}) {
    const url = new URL(caminho, location.origin);
    if (estado.data) url.searchParams.set('data', estado.data);
    const resposta = await fetch(url, {
      ...opcoes,
      headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível falar com o servidor.');
    return corpo;
  }

  function avisar(texto, tipo = '') {
    const toast = el('div', { class: `toast ${tipo}`, role: 'status' }, tipo === 'erro' ? icone('alerta') : icone('check'), texto);
    $('#avisos').append(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  // ---------- Carregamento ----------
  async function carregarPainel() {
    try {
      estado.painel = await api('/api/painel');
      desenharTopo();
      desenharHoje();
    } catch (erro) {
      $('#lista-hoje').replaceChildren(el('div', { class: 'vazio' }, el('h3', {}, 'Não foi possível carregar'), el('p', {}, erro.message)));
    }
  }

  async function carregarClientes() {
    try {
      estado.processos = (await api('/api/processos')).processos;
      desenharClientes();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function recarregar() {
    await carregarPainel();
    if (estado.vista === 'clientes') await carregarClientes();
  }

  // ---------- Topo ----------
  function desenharTopo() {
    const p = estado.painel;
    $('#data-extenso').textContent = dataExtenso(p.hoje) + (p.hoje !== p.hojeReal ? '  ·  dia simulado' : '');
    $('#saudacao').textContent = estado.usuario ? `${saudacao()}, ${estado.usuario.split(' ')[0]}` : saudacao();
    $('#selo-demo').hidden = !p.modoDemo;
    $('#simular').hidden = !p.modoDemo;
    if (p.modoDemo && !$('#campo-data').value) $('#campo-data').value = p.hoje;
    const total = p.resumo.paraHoje + p.resumo.atrasadas;
    $('#contador-hoje').textContent = total ? String(total) : '';
    document.title = total ? `(${total}) Têmis · Cobrança` : 'Têmis · Cobrança';
  }

  // ---------- Vista "Hoje" ----------
  const FILTROS = [
    { id: 'todos', nome: 'Tudo', conta: (r) => r.paraHoje + r.atrasadas },
    { id: 'atrasadas', nome: 'Atrasadas', conta: (r) => r.atrasadas },
    { id: 'decisao', nome: 'Regularizou?', conta: (r) => r.decisoes },
    { id: 'contato', nome: 'Contatos', conta: null },
    { id: 'acao', nome: 'Ações no SGP', conta: null },
  ];

  function tarefaPassaFiltro(t) {
    if (estado.filtro === 'todos') return true;
    if (estado.filtro === 'atrasadas') return t.atrasada;
    return t.tipo === estado.filtro;
  }

  function desenharIndicadores() {
    const r = estado.painel.resumo;
    const indicador = ({ cor, ic, rotulo, valor, detalhe, filtro }) =>
      el(filtro ? 'button' : 'div', {
        class: `indicador${valor ? '' : ' zero'}`,
        style: `--cor: var(${cor})`,
        onclick: filtro ? () => { estado.filtro = filtro; desenharHoje(); } : null,
        title: filtro ? 'Filtrar a lista' : null,
      },
      el('span', { class: 'rotulo' }, icone(ic), rotulo),
      el('span', { class: 'valor' }, String(valor)),
      el('span', { class: 'detalhe' }, detalhe));

    $('#indicadores').replaceChildren(
      indicador({ cor: '--marca', ic: 'lista', rotulo: 'Para hoje', valor: r.paraHoje, detalhe: plural(r.clientesHoje, 'cliente para atender', 'clientes para atender'), filtro: 'todos' }),
      indicador({ cor: '--atrasada', ic: 'alerta', rotulo: 'Atrasadas', valor: r.atrasadas, detalhe: r.atrasadas ? 'deveriam ter sido feitas antes' : 'nada atrasado', filtro: 'atrasadas' }),
      indicador({ cor: '--decisao', ic: 'decisao', rotulo: 'Regularizou?', valor: r.decisoes, detalhe: 'respostas pendentes', filtro: 'decisao' }),
      indicador({ cor: '--acao', ic: 'pessoas', rotulo: 'Em acompanhamento', valor: r.ativos, detalhe: `${plural(r.regularizados, 'regularizado', 'regularizados')} · ${plural(r.cancelados, 'cancelado', 'cancelados')}` }),
    );
  }

  function desenharFiltros() {
    const r = estado.painel.resumo;
    const contagemTipo = (tipo) => estado.painel.clientes.flatMap((c) => c.paraHoje).filter((t) => t.tipo === tipo).length;
    $('#filtros').replaceChildren(...FILTROS.map((f) => {
      const n = f.conta ? f.conta(r) : contagemTipo(f.id);
      return el('button', {
        class: `filtro${estado.filtro === f.id ? ' ativo' : ''}`,
        role: 'tab',
        'aria-selected': String(estado.filtro === f.id),
        onclick: () => { estado.filtro = f.id; desenharHoje(); },
      }, f.nome, el('b', {}, String(n)));
    }));
  }

  function trilha(cliente, fases) {
    const i = cliente.faseIndice;
    return [
      el('div', { class: 'trilha', 'aria-hidden': 'true' }, fases.map((_, k) => el('i', { class: k < i ? 'feita' : k === i ? 'atual' : '' }))),
      el('div', { class: 'trilha-rotulos' },
        el('span', {}, 'Etapa ', el('b', {}, `${i + 1} de ${fases.length}`), ` · ${cliente.etapa ? cliente.etapa.nome : ''}`),
        cliente.contatos.total ? el('span', {}, `${cliente.contatos.feitos}/${cliente.contatos.total} contatos feitos`) : null),
    ];
  }

  function linhaTarefa(cliente, t) {
    const quando = t.atrasada
      ? el('small', { class: 'atrasada' }, `Atrasada · era ${dataCurta(t.data)} (${plural(diasAtras(t.data, hoje()), 'dia', 'dias')})`)
      : el('small', {}, { contato: 'Contato com o cliente', acao: 'Ação no SGP', decisao: 'Responda para o processo seguir' }[t.tipo]);

    const acoes = t.tipo === 'decisao'
      ? el('div', { class: 'botoes-decisao' },
          el('button', { class: 'botao sim', onclick: () => abrirDecisao(cliente, t, 'sim') }, icone('check'), 'Sim'),
          el('button', { class: 'botao nao', onclick: () => abrirDecisao(cliente, t, 'nao') }, icone('x'), 'Não'))
      : el('button', { class: 'botao feito', onclick: (e) => concluirSimples(t, e.currentTarget) }, icone('check'), 'Feito');

    return el('div', { class: `tarefa ${t.tipo}` },
      el('span', { class: 'icone', html: ICONES[t.tipo] }),
      el('div', { class: 'tarefa-texto' }, el('strong', {}, t.descricao), quando),
      acoes);
  }

  function cartaoCliente(cliente, fases) {
    const tarefas = cliente.paraHoje.filter(tarefaPassaFiltro);
    const atrasado = cliente.paraHoje.some((t) => t.atrasada);
    return el('article', { class: `cartao${atrasado ? ' tem-atraso' : ''}` },
      el('div', { class: 'cartao-topo' },
        el('span', { class: 'avatar' }, iniciais(cliente.cliente.nome)),
        el('div', { class: 'cartao-nome' },
          el('button', { onclick: () => abrirDetalhe(cliente.id) }, cliente.cliente.nome),
          el('div', { class: 'meta' },
            el('span', {}, `Contrato ${cliente.cliente.contrato}`),
            el('span', { class: 'sep' }, '•'),
            el('span', {}, `bloqueado há ${plural(cliente.diasBloqueado, 'dia', 'dias')}`))),
        atrasado ? el('span', { class: 'selo atrasada' }, icone('alerta'), 'Atrasado') : el('span', { class: 'selo' }, cliente.etapa.fase)),
      trilha(cliente, fases),
      el('div', { class: 'tarefas' }, tarefas.map((t) => linhaTarefa(cliente, t))),
      el('div', { class: 'cartao-rodape' },
        el('span', {}, cliente.proxima ? `Depois: ${dataCurta(cliente.proxima.data)} · ${cliente.proxima.descricao}` : 'Sem próximas tarefas agendadas'),
        el('button', { class: 'link', onclick: () => abrirDetalhe(cliente.id) }, 'Ver cronograma', icone('seta'))));
  }

  function desenharHoje() {
    const p = estado.painel;
    desenharIndicadores();
    desenharFiltros();

    const termo = normalizar(estado.busca);
    const clientes = p.clientes
      .filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo))
      .filter((c) => c.paraHoje.some(tarefaPassaFiltro));

    if (!clientes.length) {
      const semNada = !p.clientes.length;
      $('#lista-hoje').replaceChildren(el('div', { class: 'vazio' },
        el('div', { class: 'selo-grande', html: ICONES.festa }),
        el('h3', {}, semNada ? 'Tudo em dia por hoje!' : 'Nada com esse filtro'),
        el('p', {}, semNada ? 'Nenhum cliente para contatar. Clique em "Sincronizar SGP" para buscar novos bloqueados.' : 'Tente outro filtro ou limpe a busca.')));
    } else {
      $('#lista-hoje').replaceChildren(...clientes.map((c) => cartaoCliente(c, p.fases)));
    }

    const maximo = Math.max(1, ...p.proximosDias.map((d) => d.total));
    $('#proximos').replaceChildren(...p.proximosDias.map((d) => {
      const data = paraData(d.data);
      return el('li', {},
        el('div', { class: 'dia' }, el('b', {}, String(data.getDate())), el('span', {}, DIAS_CURTOS[data.getDay()])),
        el('div', { class: 'info' },
          el('strong', {}, d.total ? plural(d.clientes, 'cliente', 'clientes') : 'Livre'),
          d.total
            ? [
                d.contatos && plural(d.contatos, 'contato', 'contatos'),
                d.decisoes && plural(d.decisoes, 'decisão', 'decisões'),
                d.total - d.contatos - d.decisoes && plural(d.total - d.contatos - d.decisoes, 'ação', 'ações'),
              ].filter(Boolean).join(' · ')
            : 'nenhuma tarefa',
          el('div', { class: 'barra-mini' }, el('i', { style: `width:${(d.total / maximo) * 100}%` }))));
    }));
  }

  // ---------- Vista "Todos os clientes" ----------
  function situacao(c) {
    if (c.status !== 'ativo') {
      return c.resultado === 'regularizado'
        ? el('span', { class: 'selo sucesso' }, icone('check'), 'Regularizado')
        : el('span', { class: 'selo cancelado' }, 'Cancelado');
    }
    if (c.paraHoje.some((t) => t.atrasada)) return el('span', { class: 'selo atrasada' }, icone('alerta'), 'Atrasado');
    if (c.paraHoje.length) return el('span', { class: 'selo' }, 'Tarefa hoje');
    return el('span', { class: 'selo' }, icone('relogio'), 'Aguardando');
  }

  function desenharClientes() {
    const todos = estado.processos || [];
    const grupos = [
      { id: 'ativos', nome: 'Em andamento', filtro: (c) => c.status === 'ativo' },
      { id: 'finalizados', nome: 'Finalizados', filtro: (c) => c.status !== 'ativo' },
      { id: 'todos', nome: 'Todos', filtro: () => true },
    ];
    $('#filtros-clientes').replaceChildren(...grupos.map((g) => el('button', {
      class: `filtro${estado.filtroClientes === g.id ? ' ativo' : ''}`,
      onclick: () => { estado.filtroClientes = g.id; desenharClientes(); },
    }, g.nome, el('b', {}, String(todos.filter(g.filtro).length)))));

    const grupo = grupos.find((g) => g.id === estado.filtroClientes);
    const termo = normalizar(estado.buscaClientes);
    const lista = todos.filter(grupo.filtro).filter((c) => !termo || normalizar(`${c.cliente.nome} ${c.cliente.contrato}`).includes(termo));

    if (!lista.length) {
      $('#tabela-clientes').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'suave' }, 'Nenhum cliente encontrado.')));
      return;
    }
    $('#tabela-clientes').replaceChildren(...lista.map((c) => {
      const proxima = c.paraHoje[0] || c.proxima;
      return el('tr', { tabindex: '0', onclick: () => abrirDetalhe(c.id), onkeydown: (e) => { if (e.key === 'Enter') abrirDetalhe(c.id); } },
        el('td', {}, el('div', { class: 'cliente-celula' },
          el('span', { class: 'avatar pequeno' }, iniciais(c.cliente.nome)),
          el('div', {}, el('strong', {}, c.cliente.nome), el('small', {}, `Contrato ${c.cliente.contrato}`)))),
        el('td', {}, c.status === 'ativo' ? plural(c.diasBloqueado, 'dia', 'dias') : el('span', { class: 'suave' }, '—')),
        el('td', {}, c.etapa ? c.etapa.nome : el('span', { class: 'suave' }, 'Encerrado')),
        el('td', {}, proxima ? el('div', {}, el('div', {}, proxima.descricao), el('small', { class: 'suave' }, dataCurta(proxima.data))) : el('span', { class: 'suave' }, '—')),
        el('td', {}, situacao(c)));
    }));
  }

  // ---------- Detalhe (gaveta) ----------
  async function abrirDetalhe(id) {
    estado.abertoId = id;
    const gaveta = $('#gaveta');
    $('#gaveta-conteudo').replaceChildren(el('div', { class: 'gaveta-corpo' }, el('div', { class: 'esqueleto' })));
    $('#gaveta-fundo').hidden = false;
    gaveta.classList.add('aberta');
    gaveta.setAttribute('aria-hidden', 'false');
    gaveta.focus();
    try {
      desenharDetalhe(await api(`/api/processos/${id}`));
    } catch (erro) {
      avisar(erro.message, 'erro');
      fecharDetalhe();
    }
  }

  function fecharDetalhe() {
    estado.abertoId = null;
    $('#gaveta').classList.remove('aberta');
    $('#gaveta').setAttribute('aria-hidden', 'true');
    $('#gaveta-fundo').hidden = true;
  }

  function desenharDetalhe(d) {
    const iAtual = d.faseIndice;
    const finalizado = d.status !== 'ativo';
    const fases = el('div', { class: 'fases' }, d.fases.map((nome, k) => {
      const feita = finalizado ? d.resultado === 'cancelado' : k < iAtual;
      const classe = feita ? 'feita' : k === iAtual ? 'atual' : '';
      return el('div', { class: `fase ${classe}` }, el('span', { class: 'bolinha', html: feita ? ICONES.check : '' }), nome);
    }));

    let etapaAnterior = null;
    const eventos = [];
    for (const t of d.tarefas) {
      if (t.etapa !== etapaAnterior) {
        eventos.push(el('li', { class: 'grupo-etapa' }, t.etapaNome));
        etapaAnterior = t.etapa;
      }
      const atrasada = t.status === 'pendente' && t.data < hoje();
      const detalhe = t.status === 'concluida'
        ? `Feito em ${dataCurta(t.concluidaEm)} por ${t.concluidaPor}`
        : t.status === 'cancelada'
          ? 'Não foi necessário'
          : `${atrasada ? 'Atrasada · era ' : 'Previsto para '}${dataCurta(t.data)}`;
      const marcador = t.status === 'concluida' ? ICONES.check : t.status === 'cancelada' ? ICONES.cancelada : ICONES[t.tipo];
      eventos.push(el('li', { class: `evento ${t.status} ${t.tipo}${atrasada ? ' atrasada' : ''}` },
        el('span', { class: 'marcador', html: marcador }),
        el('div', { class: 'corpo' },
          el('strong', {}, t.descricao),
          el('small', {}, detalhe),
          t.resposta || t.observacao ? el('div', { class: 'nota' },
            t.resposta ? el('span', { class: `resposta ${t.resposta}` }, t.resposta === 'sim' ? 'Sim. ' : 'Não. ') : null,
            t.observacao || '') : null)));
    }

    const resultado = finalizado
      ? el('span', { class: `selo ${d.resultado === 'regularizado' ? 'sucesso' : 'cancelado'}` }, d.resultado === 'regularizado' ? 'Regularizado' : 'Cancelado')
      : el('span', { class: 'selo' }, d.etapa.fase);

    $('#gaveta-conteudo').replaceChildren(
      el('div', { class: 'gaveta-cabeca' },
        el('div', { class: 'linha1' },
          el('span', { class: 'avatar' }, iniciais(d.cliente.nome)),
          el('div', {}, el('h2', {}, d.cliente.nome), el('div', { class: 'meta' }, `Contrato ${d.cliente.contrato}`)),
          el('button', { class: 'fechar', 'aria-label': 'Fechar', onclick: fecharDetalhe, html: ICONES.x }))),
      el('div', { class: 'gaveta-corpo' },
        el('div', { class: 'dados' },
          el('div', { class: 'dado' }, el('small', {}, 'Bloqueado em'), el('strong', {}, dataCurta(d.bloqueadoEm))),
          el('div', { class: 'dado' }, el('small', {}, finalizado ? 'Finalizado em' : 'Bloqueado há'), el('strong', {}, finalizado ? dataCurta(d.finalizadoEm) : plural(d.diasBloqueado, 'dia', 'dias'))),
          el('div', { class: 'dado' }, el('small', {}, 'Situação'), resultado)),
        d.paraHoje.length ? el('section', {},
          el('h3', {}, 'Para fazer agora'),
          el('div', { class: 'cartao' }, el('div', { class: 'tarefas' }, d.paraHoje.map((t) => linhaTarefa(d, t))))) : null,
        el('section', {}, el('h3', {}, 'Etapas do processo'), fases),
        el('section', {}, el('h3', {}, 'Cronograma'), el('ul', { class: 'linha-tempo' }, eventos)),
        el('section', {}, el('h3', {}, 'Histórico'),
          el('ul', { class: 'historico' }, d.historico.map((h) => el('li', {},
            el('time', {}, dataCurta(h.data)),
            el('span', {}, `${h.por === 'sistema' ? 'Sistema' : h.por}: ${h.detalhes}`)))))));
  }

  // ---------- Ações ----------
  function garantirUsuario() {
    if (estado.usuario) return true;
    abrirUsuario();
    return false;
  }

  async function concluirSimples(tarefa, botao) {
    if (!garantirUsuario()) return;
    botao.disabled = true;
    try {
      const linha = botao.closest('.tarefa');
      const detalhe = await api(`/api/tarefas/${tarefa.id}/concluir`, { method: 'POST', body: JSON.stringify({ por: estado.usuario }) });
      if (linha) linha.classList.add('saindo');
      avisar('Tarefa concluída');
      setTimeout(async () => {
        await recarregar();
        if (estado.abertoId) desenharDetalhe(detalhe);
      }, 220);
    } catch (erro) {
      botao.disabled = false;
      avisar(erro.message, 'erro');
    }
  }

  let decisaoAtual = null;
  function abrirDecisao(cliente, tarefa, resposta) {
    if (!garantirUsuario()) return;
    decisaoAtual = { cliente, tarefa };
    const form = $('#form-decisao');
    form.reset();
    form.resposta.value = resposta;
    $('#decisao-cliente').textContent = cliente.cliente.nome;
    $('#decisao-pergunta').textContent = tarefa.descricao;
    atualizarEfeitoDecisao();
    $('#janela-decisao').showModal();
    form.observacao.focus();
  }

  function atualizarEfeitoDecisao() {
    const form = $('#form-decisao');
    const r = form.resposta.value;
    $('#decisao-rotulo').textContent = r === 'sim' ? 'Como regularizou? (forma de pagamento, data...)' : 'O que foi feito e por que não regularizou?';
    $('#decisao-efeito').textContent = r === 'sim'
      ? 'O processo segue para a liberação do serviço e o encerramento.'
      : r === 'nao' ? 'O processo avança para a próxima etapa do cronograma e as novas datas são geradas.' : '';
  }

  async function enviarDecisao(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;
    if (!form.reportValidity()) return;
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      const detalhe = await api(`/api/tarefas/${decisaoAtual.tarefa.id}/concluir`, {
        method: 'POST',
        body: JSON.stringify({ por: estado.usuario, resposta: form.resposta.value, observacao: form.observacao.value }),
      });
      $('#janela-decisao').close();
      avisar(form.resposta.value === 'sim' ? 'Regularização registrada' : 'Registrado. Próxima etapa agendada');
      await recarregar();
      if (estado.abertoId) desenharDetalhe(detalhe);
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  async function sincronizar() {
    const botao = $('#botao-sincronizar');
    botao.disabled = true;
    botao.classList.add('girando');
    try {
      const r = await api('/api/sincronizar', { method: 'POST' });
      avisar(r.novos.length ? `${plural(r.novos.length, 'novo cliente entrou', 'novos clientes entraram')} no processo` : 'Nenhum cliente novo no SGP');
      await recarregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
      botao.classList.remove('girando');
    }
  }

  function abrirUsuario() {
    const form = $('#form-usuario');
    form.nome.value = estado.usuario;
    $('#janela-usuario').showModal();
  }

  function desenharUsuario() {
    $('#usuario-nome').textContent = estado.usuario || 'Identifique-se';
    $('#usuario-iniciais').textContent = estado.usuario ? iniciais(estado.usuario) : '?';
    if (estado.painel) desenharTopo();
  }

  function trocarVista(vista) {
    estado.vista = vista;
    document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('ativo', b.dataset.vista === vista));
    $('#vista-hoje').hidden = vista !== 'hoje';
    $('#vista-clientes').hidden = vista !== 'clientes';
    if (vista === 'clientes') carregarClientes();
  }

  // ---------- Eventos ----------
  document.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('click', () => trocarVista(b.dataset.vista)));
  $('#busca').addEventListener('input', (e) => { estado.busca = e.target.value; desenharHoje(); });
  $('#busca-clientes').addEventListener('input', (e) => { estado.buscaClientes = e.target.value; desenharClientes(); });
  $('#botao-sincronizar').addEventListener('click', sincronizar);
  $('#botao-usuario').addEventListener('click', abrirUsuario);
  $('#gaveta-fundo').addEventListener('click', fecharDetalhe);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && estado.abertoId && !document.querySelector('dialog[open]')) fecharDetalhe(); });
  $('#campo-data').addEventListener('change', (e) => {
    estado.data = e.target.value || null;
    recarregar();
    if (estado.abertoId) abrirDetalhe(estado.abertoId);
  });
  $('#form-decisao').addEventListener('submit', enviarDecisao);
  $('#form-decisao').addEventListener('change', atualizarEfeitoDecisao);
  $('#decisao-cancelar').addEventListener('click', () => $('#janela-decisao').close());
  $('#form-usuario').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = e.currentTarget.nome.value.trim();
    if (!nome) return;
    estado.usuario = nome;
    gravarLocal('temis.usuario', nome);
    $('#janela-usuario').close();
    desenharUsuario();
  });

  // ---------- Início ----------
  $('#lista-hoje').replaceChildren(el('div', { class: 'esqueleto' }), el('div', { class: 'esqueleto' }));
  desenharUsuario();
  carregarPainel().then(() => { if (!estado.usuario) abrirUsuario(); });
})();
