import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * A loja cuja CONFIGURAÇÃO vale nesta leitura.
 *
 * Desde 16/10/2026 `fv.settings`, `fv.category_label_mapping` e
 * `fv.fiscal_categorias` são por loja (regra do dev: na FV nada é global).
 * Toda leitura filtra por `store_id` — sem filtro viriam as linhas das duas
 * lojas e o valor dependeria de qual chegou por último.
 *
 * `escopo` é a loja da operação (lojaDoEscopo, ou a loja da venda/peça).
 * Nulo só para o admin global que ainda não escolheu a loja, e esse é mandado
 * para /escolher-loja antes de usar as telas; mesmo assim, para a leitura não
 * ficar ambígua, cai na primeira loja por nome.
 */
export async function lojaDaConfig(escopo: string | null | undefined): Promise<string> {
  if (escopo) return escopo
  const { data, error } = await createAdminClient()
    .from('stores').select('id').eq('is_active', true).order('name').limit(1).maybeSingle()
  if (error || !data) throw new Error('Não consegui descobrir a loja da configuração.')
  return data.id
}
