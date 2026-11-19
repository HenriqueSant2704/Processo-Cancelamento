const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { carregarCronograma } = require('../src/config');
const { criarApp } = require('../src/web/app');
const { RepositorioJson } = require('../src/processos/repositorio');
const { criarFonteExemplo } = require('../src/integracoes/sgp/exemplo');
const { criarProcesso } = require('../src/cronograma/motor');
const { lerPrint } = require('../src/processos/prints');
const { criarSessaoWeb } = require('../src/integracoes/sgp/sessaoWeb');

// PNG mínimo (1x1).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const print = { nome: 'conversa.png', tipo: 'image/png', base64: `data:image/png;base64,${PNG.toString('base64')}` };

test('lerPrint aceita só imagem de verdade', () => {
  const p = lerPrint(print);
  assert.strictEqual(p.nome, 'conversa.png');
  assert.ok(p.dados.equals(PNG));
  assert.throws(() => lerPrint(null), /Anexe o print/);
  assert.throws(() => lerPrint({ tipo: 'text/html', base64: 'PGh0bWw+' }), /PNG, JPG ou WEBP/);
  assert.throws(() => lerPrint({ tipo: 'image/png', base64: Buffer.from('<html>').toString('base64') }), /não é uma imagem/);
  assert.strictEqual(lerPrint({ ...print, nome: '<script>.png' }).nome, 'script.png');
});

function subir(t, opcoes) {
  const servidor = http.createServer(criarApp({ cronograma: carregarCronograma(), criarSgp: criarFonteExemplo, modoDemo: true, ...opcoes })).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return async (caminho, corpo) => {
    const r = await fetch(base + caminho, { method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined, headers: corpo ? { 'Content-Type': 'application/json' } : {} });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch { /* imagem */ }
    return { status: r.status, json, buf, tipo: r.headers.get('content-type') };
  };
}

test('print obrigatório no aviso: guarda, mostra na ficha e anexa na ocorrência', async (t) => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const anexados = [];
  const chamar = subir(t, { repositorio, printObrigatorio: true, anexarOcorrenciaSgp: async (a) => { anexados.push(a); } });
  const d = '?data=2026-11-16';
  assert.strictEqual((await chamar(`/api/eu${d}`)).json.printObrigatorio, true);
  const aviso = p.tarefas.find((x) => x.tipo === 'contato');

  let r = await chamar(`/api/tarefas/${aviso.id}/concluir${d}`, { por: 'Jessica', observacao: 'Ligação feita', registro: true });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.erro, /Anexe o print/);

  r = await chamar(`/api/tarefas/${aviso.id}/concluir${d}`, { por: 'Jessica', observacao: 'Ligação feita', registro: true, print });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.anexos.length, 1);
  assert.strictEqual(r.json.anexos[0].tarefaId, aviso.id);

  const img = await chamar(`/api/anexos/${r.json.anexos[0].id}`);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.tipo, 'image/png');
  assert.ok(img.buf.equals(PNG));
  assert.strictEqual((await chamar('/api/anexos/99')).status, 404);

  await new Promise((r2) => setTimeout(r2, 20));
  assert.strictEqual(anexados.length, 1);
  assert.strictEqual(anexados[0].numero, '999');
  assert.ok(anexados[0].dados.equals(PNG));
  assert.ok((await repositorio.listarAnexos('1'))[0].enviadoSgpEm);

  // Ações (não avisos) seguem sem print.
  const acao = p.tarefas.find((x) => x.tipo === 'acao' && x.status === 'pendente');
  if (acao) assert.strictEqual((await chamar(`/api/tarefas/${acao.id}/concluir${d}`, { por: 'Jessica' })).status, 200);
});

test('anexo pela tela do SGP: formulário em formset com dpb_token, vários arquivos num envio', async () => {
  const chamadas = [];
  let bloqueio = '';
  const buscar = async (url, op = {}) => {
    chamadas.push({ url, op });
    const cab = new Headers();
    if (url.endsWith('/accounts/login/') && !op.method) { cab.append('set-cookie', 'csrftoken=abc; Path=/'); return new Response('', { status: 200, headers: cab }); }
    if (url.endsWith('/accounts/login/')) { cab.append('set-cookie', 'sessionid=s1; Path=/'); return new Response(null, { status: 302, headers: cab }); }
    if (bloqueio) { cab.set('location', bloqueio); return new Response(null, { status: 302, headers: cab }); }
    if (!op.method) return new Response("<form><input type='hidden' name='dpb_token' value='tok123' /></form>", { status: 200 });
    cab.set('location', '/admin/atendimento/ocorrencia/11423/edit/');
    return new Response(null, { status: 302, headers: cab });
  };
  const sessao = criarSessaoWeb({ origem: 'https://sgp.exemplo', usuario: 'u', senha: 's', buscar });
  const r = await sessao.anexar({ ocorrenciaId: 11423, arquivos: [{ nome: 'a.png', tipo: 'image/png', dados: PNG, descricao: 'Print 1' }, { nome: 'b.pdf', tipo: 'application/pdf', dados: Buffer.from('%PDF-1') }] });
  assert.deepStrictEqual(r, { ok: true, enviados: 2 });
  const envio = chamadas.at(-1);
  assert.strictEqual(envio.url, 'https://sgp.exemplo/admin/atendimento/ocorrencia/11423/anexo/add/');
  const f = envio.op.body;
  assert.strictEqual(f.get('dpb_token'), 'tok123');
  assert.strictEqual(f.get('csrfmiddlewaretoken'), 'abc');
  assert.strictEqual(f.get('anexos-TOTAL_FORMS'), '2');
  assert.strictEqual(f.get('anexos-INITIAL_FORMS'), '0');
  assert.strictEqual(f.get('anexos-0-arquivo').name, 'a.png');
  assert.strictEqual(f.get('anexos-0-descricao'), 'Print 1');
  assert.strictEqual(f.get('anexos-1-arquivo').name, 'b.pdf');
  bloqueio = '/admin/cauth/password_change/';
  await assert.rejects(sessao.anexar({ ocorrenciaId: 1, nome: 'p.png', tipo: 'image/png', dados: PNG }), /trocar a senha/);
  bloqueio = '/403/?perm_name=admcore.access_atendimento';
  await assert.rejects(sessao.anexar({ ocorrenciaId: 1, nome: 'p.png', tipo: 'image/png', dados: PNG }), /permissão.*admcore.access_atendimento/);
});
test('negativar e retirar a negativação: só ficam feitos com arquivo (print ou PDF)', async (t) => {
  const { posicionar } = require('../src/cronograma/motor');
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-03', inicio: '2026-11-04', cronograma });
  posicionar(p, { etapaId: 'negativacao', por: 'Jessica', data: '2026-11-16' }, cronograma);
  p.ocorrencia = { numero: '999' };
  await repositorio.salvarProcesso(p);
  const anexados = [];
  const chamar = subir(t, { repositorio, anexarOcorrenciaSgp: async (a) => { anexados.push(a); } });
  const d = '?data=2026-11-16';
  let ficha = (await chamar(`/api/processos/1${d}`)).json;
  const negativar = ficha.paraHoje.find((x) => x.descricao === 'Negativar o cliente');
  assert.strictEqual(negativar.anexoObrigatorio, true);
  assert.strictEqual(ficha.paraHoje.find((x) => x.descricao !== 'Negativar o cliente').anexoObrigatorio, false);
  let r = await chamar(`/api/tarefas/${negativar.id}/concluir${d}`, { por: 'Jessica' });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.erro, /Anexe o arquivo/);
  const pdf = { nome: 'serasa.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF-1.4\n%fim').toString('base64') };
  r = await chamar(`/api/tarefas/${negativar.id}/concluir${d}`, { por: 'Jessica', print: pdf });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.anexos[0].tipo, 'application/pdf');
  const arq = await chamar(`/api/anexos/${r.json.anexos[0].id}`);
  assert.strictEqual(arq.tipo, 'application/pdf');
  await new Promise((r2) => setTimeout(r2, 20));
  assert.strictEqual(anexados[0].nome, 'serasa.pdf');
});

test('vários arquivos de uma vez: todos ficam guardados na tarefa', async (t) => {
  const cronograma = carregarCronograma();
  const repositorio = new RepositorioJson(null);
  const p = criarProcesso({ id: '1', cliente: { id: '50', nome: 'Cliente', contrato: '50' }, bloqueadoEm: '2026-11-15', inicio: '2026-11-16', cronograma });
  await repositorio.salvarProcesso(p);
  const chamar = subir(t, { repositorio, printObrigatorio: true });
  const aviso = p.tarefas.find((x) => x.tipo === 'contato');
  const pdf = { nome: 'email.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF-1.4\n%fim').toString('base64') };
  const r = await chamar(`/api/tarefas/${aviso.id}/concluir?data=2026-11-16`, { por: 'Jessica', observacao: 'Ligação e WhatsApp', registro: true, prints: [print, { ...print, nome: 'whatsapp.png' }, pdf] });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.anexos.map((a) => a.nome), ['conversa.png', 'whatsapp.png', 'email.pdf']);
  assert.ok(r.json.anexos.every((a) => a.tarefaId === aviso.id));
  const muitos = Array.from({ length: 9 }, () => print);
  const outro = p.tarefas.filter((x) => x.tipo === 'contato')[1];
  assert.strictEqual((await chamar(`/api/tarefas/${outro.id}/concluir?data=2026-11-16`, { por: 'Jessica', observacao: 'x', registro: true, prints: muitos })).status, 400);
});
