# Processo-Cancelamento

Sistema para acompanhar clientes bloqueados por falta de pagamento através de um
**cronograma de etapas** padronizado, até a regularização ou o cancelamento por inadimplência.
Integração futura com o **SGP** (sistema de gestão do provedor).

## Objetivo

- Saber, para cada cliente bloqueado, **qual etapa** ele está, **o que fazer** e **até quando**.
- Registrar tudo que foi feito (histórico/auditoria).
- Manter as regras de prazos **configuráveis**, sem precisar mexer no código.

## Regras já conhecidas

| Etapa | Gatilho | Ação |
|---|---|---|
| 1 | Cliente bloqueado há mais de 16 dias sem pagamento | Enviar notificação de atraso |
| 2 | 15 dias após a notificação sem resposta | Avança para a próxima etapa (a definir) |

As demais etapas serão adicionadas a partir do cronograma oficial, em `src/config/cronograma.json`.

## Estrutura

```
src/
  index.js              ponto de entrada
  config/               variáveis de ambiente e cronograma de etapas (JSON)
  cronograma/           motor que calcula a próxima etapa de cada cliente
  integracoes/sgp/      cliente da API do SGP (futuro)
  auditoria/            histórico de ações por cliente
  utils/                funções auxiliares (datas etc.)
tests/                  testes automatizados (node --test)
docs/                   documentação do processo
data/                   dados locais (ignorado no git)
```

## Como rodar

Requisitos: Node.js 22 ou superior.

```bash
cp .env.example .env   # preencha as variáveis
npm start              # roda o sistema
npm run dev            # roda recarregando ao salvar
npm test               # roda os testes
```

O projeto ainda não tem dependências externas; usa apenas recursos nativos do Node.

## Segurança e LGPD

- Credenciais do SGP ficam **somente** no `.env` (que não vai para o git).
- A pasta `data/` e logs são ignorados, pois podem conter dados pessoais de clientes.
