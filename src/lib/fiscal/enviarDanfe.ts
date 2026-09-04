import { normalizePhoneBR } from '@/lib/ycloud'

/**
 * O link de WhatsApp que entrega a nota para a cliente.
 *
 * NÃO é disparo por API, e a diferença importa. Os disparos do sistema
 * (`src/lib/disparo/`) saem pela YCloud e exigem template aprovado pela Meta,
 * porque partem da loja para quem não está falando com ela. Aqui é a vendedora
 * mandando de dentro da conversa, do próprio aparelho, logo depois de a cliente
 * comprar no balcão: `wa.me` abre o WhatsApp com o texto pronto e quem aperta
 * "enviar" é uma pessoa. Sem template, sem aprovação, sem fila.
 *
 * O QUE VAI NO LINK é o DANFE hospedado pela Focus — documento fiscal de
 * verdade, com a chave de acesso e o QR code da SEFAZ. Conferido em 04/09 numa
 * aba sem cookie nenhum: **abre sem login**, que é a condição para poder mandar.
 * Por isso não construímos página nossa aqui, como foi feito no comprovante do
 * SM Imports: lá o documento era nosso, aqui ele é da Receita.
 *
 * Devolve `null` quando não dá para montar — sem nota autorizada ou sem
 * telefone. Quem chama esconde o botão nesse caso, em vez de oferecer algo que
 * abre o WhatsApp em branco.
 */
export function linkDaNotaNoWhatsApp(opcoes: {
  telefone: string | null | undefined
  danfeUrl: string | null | undefined
  nomeDaCliente?: string | null
  loja?: string | null
}): string | null {
  const { telefone, danfeUrl, nomeDaCliente, loja } = opcoes
  if (!danfeUrl) return null

  const numero = normalizePhoneBR(telefone ?? '')
  if (!numero) return null

  // O `wa.me` quer só dígitos — o "+" do normalizador quebra o link.
  const digitos = numero.replace(/\D/g, '')

  const primeiroNome = (nomeDaCliente ?? '').trim().split(/\s+/)[0]
  const saudacao = primeiroNome ? `Oi, ${primeiroNome}!` : 'Oi!'
  const assinatura = loja ? `\n\n${loja}` : ''

  /*
   * SEM EMOJI, de propósito.
   *
   * A primeira versão tinha um diamante na saudação. Aberto o link no
   * navegador em 04/09, ele chega ao WhatsApp como "�": o par substituto se
   * perde no redirecionamento do `wa.me` para o `api.whatsapp.com`.
   * Caractere quebrado numa mensagem que leva documento fiscal passa a
   * impressão errada, e o emoji não dizia nada que o texto já não diga.
   */
  const texto =
    `${saudacao} Segue a nota fiscal da sua compra.\n\n${danfeUrl}` +
    `\n\nÉ só abrir o link para ver ou salvar.${assinatura}`

  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}
