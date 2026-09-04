-- ============================================================================
-- Busca de cliente passa a respeitar a loja
-- ============================================================================
--
-- A separação por loja de 04/09 cortou a LISTA inicial de clientes em toda
-- tela, mas a BUSCA continuava aberta: `search_customers` não olhava loja
-- nenhuma, então bastava digitar três letras no PDV para a base inteira voltar
-- — 2.838 clientes de Brasília para quem é de Campinas, e vice-versa.
--
-- Corte pela lista e deixe a busca aberta e você não cortou nada. Vale para
-- qualquer separação por tenant: a busca é a porta que fica encostada.
--
--
-- POR QUE UM PARÂMETRO E NÃO LER O PERFIL AQUI DENTRO
--
-- A função é SECURITY DEFINER e é chamada com service_role, que não carrega o
-- usuário. Quem sabe o escopo é o servidor do app, que já resolve isso com
-- `lojaDoEscopo(perfil, filtroDaTela)` — o mesmo lugar onde a regra mora para
-- todas as outras leituras. Duplicar a regra aqui criaria uma segunda verdade.
--
-- NULL continua devolvendo tudo, e é assim que a Fernanda (admin global)
-- pesquisa quando ainda não escolheu a loja da venda.
-- ============================================================================

DROP FUNCTION IF EXISTS fv.search_customers(text, integer);

CREATE OR REPLACE FUNCTION fv.search_customers(
  term         text,
  lim          integer DEFAULT 20,
  p_store_id   uuid    DEFAULT NULL
)
RETURNS TABLE(id uuid, name text, phone text, cpf text, birthday date)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'fv', 'public', 'extensions'
AS $function$
  select c.id, c.name, c.phone, c.cpf, c.birthday
  from fv.customers c
  where
    (p_store_id is null or c.origin_store_id = p_store_id)
    and (
      unaccent(c.name) ilike '%' || unaccent(coalesce(term, '')) || '%'
      or (
        regexp_replace(coalesce(term, ''), '\D', '', 'g') <> ''
        and (
          regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || regexp_replace(term, '\D', '', 'g') || '%'
          or regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') like '%' || regexp_replace(term, '\D', '', 'g') || '%'
        )
      )
    )
  order by c.name
  limit lim;
$function$;

COMMENT ON FUNCTION fv.search_customers(text, integer, uuid) IS
  'Busca de cliente por nome/telefone/CPF. p_store_id NULL = rede inteira (admin global); com valor, corta pela loja de origem.';

GRANT EXECUTE ON FUNCTION fv.search_customers(text, integer, uuid)
  TO authenticated, service_role;
