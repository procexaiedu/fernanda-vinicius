import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * As listas que alimentam formulário, já cortadas na loja de quem pediu.
 *
 * Existe porque o corte estava sendo escrito à mão em cada página, e em 04/09
 * o dono encontrou o furo na tela: no PDV a vendedora vinha com
 * `.eq('is_active', true)` e nada mais, então a Rosi, de Campinas, escolhia
 * Alba ou Rayane, de Brasília, como quem fez a venda.
 *
 * O artigo do vault sobre escopo de loja já avisava que o jeito nº 4 de errar é
 * "entregar metade e descrever como inteira" — quatro telas iguais, o corte em
 * duas. Com as consultas num lugar só, esquecer uma deixa de ser possível.
 *
 * `escopo` vem SEMPRE de `lojaDoEscopo(profile)`, nunca de um ternário sobre
 * `isAdmin`: papel e escopo são eixos diferentes, e admin de loja (a Eleandra,
 * em Brasília) é justamente quem o ternário deixava passar.
 *
 * `escopo === null` é só admin global — Fernanda e nós. Aí nada é cortado, e é
 * o que mantém de pé a compra em São Paulo, que abastece as duas lojas.
 */
export function listasDoEscopo(admin: SupabaseClient<any, any, any>, escopo: string | null) {
  return {
    /**
     * Paginado: o Supabase corta em 1000 linhas por requisição e já são 1.031
     * produtos ativos — 31 ficavam invisíveis para o leitor.
     * Ver lib/supabase/fetch-all.
     */
    produtos(de: number, ate: number) {
      let q = admin.from('products')
        .select('id, name, code, barcode_number, category, store_id, sale_price, promotional_price, promotional_active, cost_price, quantity_in_stock, is_service')
        .eq('is_active', true)
      if (escopo) q = q.eq('store_id', escopo)
      return q.order('name').range(de, ate)
    },

    /** Quem pode aparecer como vendedora da venda. */
    usuarios() {
      let q = admin.from('users').select('id, full_name, store_id').eq('is_active', true)
      if (escopo) q = q.eq('store_id', escopo)
      return q.order('full_name')
    },

    /**
     * Clientes da loja.
     *
     * Liga por `origin_store_id` — a coluna é "loja de origem", onde a pessoa
     * apareceu primeiro, e não existe outra.
     *
     * ATENÇÃO, ISTO REVERTE UMA DECISÃO ANTERIOR. Em 01/09 ficou escrito que
     * cliente seria da REDE, porque a mesma pessoa compra nas duas cidades. Em
     * 04/09 o dono decidiu separar mesmo assim, ciente do custo: cliente de
     * Brasília que comprar em Campinas não vai ser encontrada e será cadastrada
     * de novo, partindo o histórico. Não "conserte" de volta sem falar com ele.
     */
    clientes(limite = 400) {
      let q = admin.from('customers').select('id, name, phone, cpf, birthday')
      if (escopo) q = q.eq('origin_store_id', escopo)
      return q.order('name').limit(limite)
    },

    /**
     * As lojas que o formulário pode oferecer.
     *
     * Sem isto o corte vira enfeite: adiantaria pouco esconder a vendedora da
     * outra loja e deixar na tela um seletor para lançar a venda lá.
     */
    lojas() {
      let q = admin.from('stores').select('id, name, city').eq('is_active', true)
      if (escopo) q = q.eq('id', escopo)
      return q.order('name')
    },
  }
}
