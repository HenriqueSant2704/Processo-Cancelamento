# Processo-Cancelamento

Sistema de apoio ao setor financeiro para acompanhar clientes bloqueados por falta de
pagamento, do aviso de negativação até a regularização ou o cancelamento do contrato.

A ideia: o funcionário chega na empresa, abre o sistema e já vê **quem precisa contatar hoje**
e **o que precisa ser feito**, com os próximos dias já agendados.

## Como funciona o processo

O gatilho é o cliente **bloqueado (suspenso) há 1 dia ou mais** no SGP. O SGP bloqueia
o cliente quando a fatura passa de 15 dias vencida.

```
Bloqueado há 1 dia
  └─ Notificação de negativação
       abrir ocorrência no SGP + 3 contatos em dias úteis alternados (ex.: seg, qua, sex)
       └─ Regularizou?
            ├─ sim → liberar o serviço, encerrar a ocorrência  (FIM: regularizado)
            └─ não → negativar + notificar a negativação
                      └─ aguardar 15 dias → Regularizou?
                           ├─ sim → retirar negativação, desbloquear, encerrar  (FIM: regularizado)
                           └─ não → aviso de cancelamento
                                    abrir ocorrência + 2 contatos em dias úteis alternados
                                    → no dia útil seguinte: Regularizou?
                                      ├─ sim → retirar negativação, desbloquear  (FIM: regularizado)
                                      └─ não → cancelar contrato, notificar, multa se houver
                                               fidelidade, abrir OS de retirada de equipamentos
                                               └─ 30 dias → Equipamentos devolvidos?
                                                    ├─ sim → classificar e finalizar  (FIM: cancelado)
                                                    └─ não → cobrar indenização, finalizar  (FIM: cancelado)
```

Em cada pergunta "Regularizou?", o funcionário responde **sim** ou **não** e explica
o que foi feito ou o motivo. A resposta pode ser dada antes da data prevista
(ex.: o cliente pagou depois do 1º contato); os contatos que faltavam são cancelados.

**Tudo isso é configurável** em [`src/config/cronograma.json`](src/config/cronograma.json):
quantidade de tentativas, intervalos, prazos, textos das tarefas e feriados.

## Tecnologias

- **JavaScript + Node.js** (22 ou superior)
- **Postgres no Neon** para guardar os dados (dependência: `pg`)
- **Render** para publicar a tela na internet
- Sem framework: o servidor usa o módulo `http` do Node e a tela é HTML, CSS e JavaScript puro

## Tela do financeiro

```bash
npm install
npm run demo     # tela com clientes FICTÍCIOS (dados em data/demo, sem banco e sem login)
npm start        # tela de verdade (o mesmo que npm run web) (Neon com login, ou arquivo local se não houver DATABASE_URL)
```

Depois acesse http://localhost:3000. Na tela:

- **Resumo do dia**: tarefas para hoje, atrasadas, perguntas "regularizou?" pendentes e clientes em acompanhamento.
- **Lista de clientes de hoje**, com os atrasados primeiro, cada tarefa com o botão **Feito** e as decisões com **Sim** ou **Não** (a explicação é obrigatória).
- **Próximos dias**: quantos clientes e contatos vêm nos próximos 5 dias úteis.
- **Detalhe do cliente**: etapas do processo, cronograma completo e histórico.
- **Todos os clientes**: em andamento e finalizados, com busca.
- **Agenda por dia**: acima da fila, Hoje, Amanhã e os próximos dias úteis, com quantos clientes há em cada um.
- **Valor em aberto** de cada contrato (faturas em aberto no SGP), atualizado a cada sincronização.
- **Ajustar etapa**: para clientes já tratados antes do sistema; informa a etapa, quantos avisos já foram e a data real, e o cronograma é recalculado a partir dela.
- No modo demonstração dá para **simular outro dia** para ver o cronograma andar.

## Banco no Neon

1. Crie um projeto em https://neon.tech e copie a **connection string** (Dashboard > Connect).
2. Cole no arquivo `.env`, na linha `DATABASE_URL=`.
3. Rode `npm run migrar` para criar as tabelas (o servidor também faz isso sozinho ao iniciar).
4. Crie os usuários dos funcionários:

```bash
npm run cli -- criar-usuario jessica --nome "Jessica Silva"
```

O comando mostra uma **senha temporária** uma única vez. Passe para a pessoa por um canal privado;
ela pode trocar a senha na própria tela (menu no nome dela > Trocar senha).
Outros: `redefinir-senha <login>`, `desativar-usuario <login>`, `usuarios`.

Com `DATABASE_URL` preenchida, a tela **exige login** e o nome de quem concluiu cada tarefa
vem do login (ninguém registra em nome de outra pessoa).

## Publicar no Render

O arquivo [`render.yaml`](render.yaml) já descreve o serviço.

1. Suba o código para o GitHub (`git push`).
2. No Render: **New > Blueprint**, escolha o repositório `Processo-Cancelamento`.
3. Quando pedir `DATABASE_URL`, cole a connection string do Neon.
4. Depois do deploy, crie os usuários (rodando o comando `criar-usuario` no seu computador com o mesmo `DATABASE_URL` no `.env`).

Observação: no plano grátis do Render o serviço "dorme" depois de um tempo sem acesso; o primeiro acesso do dia pode demorar uns 30 a 60 segundos.

## Estrutura

```
src/
  index.js                 linha de comando (agenda, tarefas, usuários)
  web/                     servidor da tela (app.js, visao.js) e a tela em si (publico/)
  demo/                    gera clientes fictícios para demonstração
  config/                  variáveis de ambiente e cronograma.json
  cronograma/motor.js      gera as tarefas com as datas e avança as etapas
  processos/               regras de uso (sincronizar, agenda, concluir) e armazenamento
                           (repositorioPostgres.js no Neon, repositorio.js em arquivo local)
  banco/                   conexão com o Postgres e esquema.sql (tabelas)
  auth/usuarios.js         login: usuários, senhas (hash scrypt) e sessões
  integracoes/sgp/         fonte dos clientes bloqueados (exemplo fictício / API real a fazer)
  auditoria/historico.js   histórico de tudo que foi feito (quem, o quê, quando)
  utils/datas.js           datas e dias úteis
tests/                     testes automatizados (node --test; o banco é testado com PGlite, um Postgres em memória)
render.yaml                configuração do Render
```

## Linha de comando

```bash
npm run sincronizar      # busca os bloqueados no SGP e abre os processos
npm run agenda           # agenda de hoje no terminal
npm test                 # testes
npm run cli -- processos                                   # processos ativos
npm run cli -- processo 1                                  # cronograma e histórico do processo 1
npm run cli -- concluir 1.2 --por Jessica                   # marca a tarefa 1.2 como feita
npm run cli -- decidir 1.5 sim --por Jessica --obs "Pagou via PIX"
```

No PowerShell do Windows, use `npm.cmd` no lugar de `npm`.

## Integração com o SGP

O sistema lê o SGP pela **rota URA de clientes** (a mesma usada no NeticoCam), só para consulta:
`POST SGP_URA_CLIENTES_URL` com `{ app, token, offset, limit }`, de 100 em 100 clientes.
Cada contrato com status **SUSPENSO** vira um processo (um cliente com dois contratos suspensos tem dois processos).

Configuração no `.env` (ou no painel do Render):

```
SGP_MODO=api
SGP_URA_CLIENTES_URL=...
SGP_APP=...
SGP_TOKEN=...
SGP_MOTIVOS_SUSPENSAO=          # opcional: só estes motivos entram (ex.: FINANCEIRO)
SGP_CAMPO_DATA_SUSPENSAO=       # opcional: campo com a data da suspensão, se o SGP mandar
```

Para ver o que o SGP devolve **sem expor dados de clientes** (só nomes de campos e contagens):

```bash
npm run cli -- sgp-diagnostico
```

**Negativação pós-cancelamento:** além dos suspensos, o sistema lê as ocorrências **abertas** do tipo
"Financeiro - Negativação pós Cancelamento" (rota URA `Ocorrência – Listar`) e abre um processo do fluxo
`pos-cancelamento` para cada contrato: 3 notificações em dias úteis alternados, "regularizou?" e o encerramento
da ocorrência. O tipo é encontrado pelo nome (rota `GET /api/os/ocorrencia/tipo/list/`).

Se o SGP não mandar a data da suspensão, o sistema anota o **primeiro dia em que viu** o contrato
suspenso. Na prática o SGP não manda essa data, então o sistema usa o **vencimento da fatura em aberto
mais antiga + 15 dias** (venceu dia 1, bloqueia dia 16, o processo começa dia 17), configurável em
`SGP_DIAS_BLOQUEIO_APOS_VENCIMENTO`.

**Sincronização:** com `SGP_MODO=api`, o servidor sincroniza sozinho uma vez por dia a partir das 7h
(`SGP_HORA_SINCRONIZACAO`). O botão "Sincronizar SGP" também funciona e roda em segundo plano, porque a
leitura completa do SGP leva vários minutos. No plano grátis do Render o serviço dorme; a sincronização
do dia acontece no primeiro acesso depois das 7h.

## Segurança e LGPD

- Credenciais (Neon, SGP) ficam **somente** no `.env` ou no painel do Render, nunca no git.
- Com o banco configurado, a tela exige login; senhas e sessões são guardadas só como hash.
- O servidor se recusa a abrir para a rede sem login.
- Tentativas de login são limitadas (10 a cada 15 minutos por IP).
- A pasta `data/` e os logs são ignorados pelo git, pois contêm dados de clientes.
