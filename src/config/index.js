// Configuração central: lê variáveis de ambiente e o cronograma de etapas.
// Credenciais NUNCA ficam no código, só no .env (local) ou no painel do Render.
const path = require('node:path');
const fs = require('node:fs');

function carregarCronograma() {
  const arquivo = path.join(__dirname, 'cronograma.json');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

const ambiente = process.env.NODE_ENV || 'development';
const lista = (texto) => texto.split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  ambiente,
  databaseUrl: process.env.DATABASE_URL || '',
  arquivoDados: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'processos.json'),
  web: {
    porta: Number(process.env.PORT) || 3000,
    // Local: só este computador. Produção (Render): aceita conexões externas.
    host: process.env.HOST || (ambiente === 'production' ? '0.0.0.0' : '127.0.0.1'),
  },
  sgp: {
    modo: process.env.SGP_MODO || 'exemplo',
    // SGP_BASE_URL é o nome antigo (do primeiro .env.example); aceito para não quebrar .env existentes.
    uraClientesUrl: process.env.SGP_URA_CLIENTES_URL || process.env.SGP_BASE_URL || '',
    token: process.env.SGP_TOKEN || '',
    app: process.env.SGP_APP || '',
    // Quais status do contrato contam como "suspenso" e quais motivos entram no processo.
    statusSuspenso: lista(process.env.SGP_STATUS_SUSPENSO || 'SUSPENSO'),
    motivos: lista(process.env.SGP_MOTIVOS_SUSPENSAO || ''),
    // Campo do contrato com a data da suspensão (se o SGP mandar). Vazio = o sistema anota o 1º dia em que viu.
    campoDataSuspensao: (process.env.SGP_CAMPO_DATA_SUSPENSAO || '').trim(),
    // Sem esse campo: data do bloqueio = vencimento da fatura em aberto mais antiga + N dias.
    diasBloqueioAposVencimento: Number(process.env.SGP_DIAS_BLOQUEIO_APOS_VENCIMENTO || 15),
    // Sincronização automática diária (só com SGP_MODO=api).
    sincronizacaoAutomatica: !/^(nao|não|false|0)$/i.test(process.env.SGP_SINCRONIZACAO_AUTOMATICA || 'sim'),
    horaSincronizacao: Number(process.env.SGP_HORA_SINCRONIZACAO || 7),
    // Botão "Criar no SGP" (GRAVA no SGP). Desligado por padrão; ligar com SGP_CRIAR_OCORRENCIA=sim.
    criarOcorrencia: /^(sim|true|1)$/i.test(process.env.SGP_CRIAR_OCORRENCIA || ''),
    usuarioOcorrencia: (process.env.SGP_USUARIO_OCORRENCIA || '').trim(), // username do SGP que aparece como quem abriu
    metodoOcorrencia: (process.env.SGP_METODO_OCORRENCIA || '').trim(), // código do método (ex.: 5 = WhatsApp)
    abrirOsJunto: /^(sim|true|1)$/i.test(process.env.SGP_ABRIR_OS || ''),
    // Responsável da ocorrência criada pelo sistema e quem é citado no comentário (username do SGP).
    responsavelOcorrencia: (process.env.SGP_RESPONSAVEL_OCORRENCIA || '').trim(),
    // Comentário automático na ocorrência a cada ação na tela (GRAVA no SGP).
    comentarOcorrencia: /^(sim|true|1)$/i.test(process.env.SGP_COMENTAR_OCORRENCIA || ''),
    // Quem é marcado para abrir a OS de retirada de equipamentos (username do SGP).
    responsavelOs: (process.env.SGP_RESPONSAVEL_OS || '').trim(),
    // Avisos automáticos na ocorrência marcando alguém (ex.: OS de retirada). Desligado: só marca quem a pessoa escolher na tela.
    avisosAutomaticos: /^(sim|true|1)$/i.test(process.env.SGP_AVISOS_AUTOMATICOS || ''),
    // Supervisor (ex.: Lucas): de quem o sistema lê a resposta de autorização (username do SGP).
    supervisor: (process.env.SGP_SUPERVISOR || '').trim(),
    // Antes de começar a próxima etapa (depois de um "não regularizou"), espera a resposta do supervisor na ocorrência.
    exigirAutorizacao: !/^(nao|não|false|0)$/i.test(process.env.SGP_EXIGIR_AUTORIZACAO || 'sim'),
    // Para encerrar uma etapa com "não regularizou", a ocorrência precisa estar Pendente no SGP (a Jéssica muda lá).
    exigirPendente: !/^(nao|não|false|0)$/i.test(process.env.SGP_EXIGIR_PENDENTE || 'sim'),
    // Print do aviso enviado como anexo da ocorrência (GRAVA no SGP). Nomes dos campos do formulário de anexo do SGP.
    enviarPrint: /^(sim|true|1)$/i.test(process.env.SGP_ENVIAR_PRINT || ''),
    camposAnexo: { arquivo: (process.env.SGP_ANEXO_CAMPO_ARQUIVO || 'arquivo').trim(), descricao: (process.env.SGP_ANEXO_CAMPO_DESCRICAO ?? 'descricao').trim() },
    // Nomes para a saudação dos comentários: "admin=Lucas,jessica_rasteiro=Jéssica".
    nomes: Object.fromEntries((process.env.SGP_NOMES || '').split(',').map((p) => p.split('=').map((x) => x.trim())).filter(([u, n]) => u && n)),
    // Usuário próprio da integração no SGP (para comentar em ocorrência pela rota da tela).
    usuarioIntegracao: (process.env.SGP_USUARIO_INTEGRACAO || '').trim(),
    senhaIntegracao: process.env.SGP_SENHA_INTEGRACAO || '',
  },
  // Cada aviso só pode ser marcado como feito com o print anexado (PRINT_OBRIGATORIO=nao desliga).
  printObrigatorio: !/^(nao|não|false|0)$/i.test(process.env.PRINT_OBRIGATORIO || 'sim'),
  carregarCronograma,
};
