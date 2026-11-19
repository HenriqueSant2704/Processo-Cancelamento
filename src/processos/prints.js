// Print (imagem) que comprova cada aviso feito ao cliente.
// Chega da tela em base64, fica guardado no banco (tabela anexos) e, quando ligado,
// é enviado como anexo da ocorrência no SGP.
const TIPOS = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const EXTENSAO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const TAMANHO_MAXIMO = 4 * 1024 * 1024; // 4 MB

// print: { nome, tipo, base64 } (base64 pode vir como data URL). Devolve { nome, tipo, dados: Buffer }.
function lerPrint(print) {
  if (!print || typeof print !== 'object') throw new Error('Anexe o print do aviso.');
  const tipo = String(print.tipo || '').toLowerCase();
  if (!TIPOS[tipo]) throw new Error('O print precisa ser uma imagem PNG, JPG ou WEBP.');
  const base64 = String(print.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Error('Não consegui ler a imagem do print.');
  const dados = Buffer.from(base64, 'base64');
  if (dados.length > TAMANHO_MAXIMO) throw new Error('O print passou de 4 MB. Recorte só a parte da conversa e tente de novo.');
  if (!TIPOS[tipo](dados)) throw new Error('O arquivo enviado não é uma imagem válida.');
  const limpo = String(print.nome || '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 80);
  const nome = limpo && /\.\w{3,4}$/.test(limpo) ? limpo : `print.${EXTENSAO[tipo]}`;
  return { nome, tipo, dados };
}

module.exports = { lerPrint, TAMANHO_MAXIMO };
