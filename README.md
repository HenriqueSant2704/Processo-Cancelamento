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

## Estrutura

```
src/
  index.js                 linha de comando (interface provisória)
  config/                  variáveis de ambiente e cronograma.json
  cronograma/motor.js      gera as tarefas com as datas e avança as etapas
  processos/               regras de uso (sincronizar, agenda, concluir) e armazenamento
  integracoes/sgp/         fonte dos clientes bloqueados (exemplo fictício / API real a fazer)
  auditoria/historico.js   histórico de tudo que foi feito (quem, o quê, quando)
  utils/datas.js           datas e dias úteis
tests/                     testes automatizados (node --test)
data/                      processos salvos em JSON (fora do git)
```

## Como usar

Requisitos: Node.js 22 ou superior. Não há dependências externas.

```bash
cp .env.example .env
npm run sincronizar      # busca os bloqueados no SGP e abre os processos
npm start                # agenda de hoje
npm test                 # testes
```

Outros comandos:

```bash
npm run cli -- processos                                   # processos ativos
npm run cli -- processo 1                                  # cronograma e histórico do processo 1
npm run cli -- concluir 1.2 --por Jessica                   # marca a tarefa 1.2 como feita
npm run cli -- decidir 1.5 sim --por Jessica --obs "Pagou via PIX"
npm run cli -- agenda --data 2026-11-20                    # simula outro dia
```

Por enquanto o SGP está em modo `exemplo` (clientes fictícios). A integração real
com a API do SGP entra quando tivermos a documentação e as credenciais.

## Segurança e LGPD

- Credenciais do SGP ficam **somente** no `.env` (que não vai para o git).
- A pasta `data/` e os logs são ignorados pelo git, pois contêm dados de clientes.
