import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/**
 * A loja está pronta para emitir nota?
 *
 * Duas condições, e as duas moram em `fiscal_emitentes`: existir a linha (a
 * loja tem CNPJ, IE, endereço e série cadastrados) e `habilitado` estar ligado
 * — a trava manual que impede emissão até alguém virar a chave de propósito.
 *
 * Existe para a TELA não oferecer o que o servidor vai recusar. Em 10/09 o
 * botão "Emitir nota" aparecia em toda venda de Campinas, que não tem emitente
 * nenhum: clicar só rendia "Esta loja não tem emitente fiscal configurado".
 * Convidar ao clique para devolver erro é pior que não ter o botão.
 *
 * NÃO é controle de acesso — a checagem de verdade está em `emitirNotaDaVenda`,
 * que roda no servidor e é quem de fato barra. Esconder botão nunca barrou nada.
 */
export async function lojaEmiteNota(admin: Admin, storeId: string | null): Promise<boolean> {
  if (!storeId) return false

  const { data } = await admin
    .from('fiscal_emitentes')
    .select('habilitado')
    .eq('store_id', storeId)
    .maybeSingle()

  return !!data?.habilitado
}
