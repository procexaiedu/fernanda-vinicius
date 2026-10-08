-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK de 20261008_rls_por_loja.sql: volta as políticas do fv ao estado de
-- 07/10/2026 (fv.is_admin() sem corte de loja) e remove os helpers novos.
--
-- As políticas abaixo foram tiradas de `pg_dump -s -n fv` do banco de teste
-- montado no estado de produção pós-20261007. ANTES de aplicar a migration em
-- produção, salve o estado real (passo 0 do plano em
-- docs/plano_aplicacao_rls_por_loja.md) e compare com este arquivo: se
-- divergir, o que vale é o snapshot de produção.
--
-- Não mexe em suppliers, category_label_mapping nem fiscal_categorias (a
-- migration não tocou nelas).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
     where schemaname = 'fv'
       and tablename not in ('suppliers', 'category_label_mapping', 'fiscal_categorias')
  loop
    execute format('drop policy %I on fv.%I', p.policyname, p.tablename);
  end loop;
end $$;

CREATE POLICY cash_closings_admin_all ON fv.cash_closings TO authenticated USING (fv.is_admin());
CREATE POLICY cash_closings_operator ON fv.cash_closings TO authenticated USING ((store_id = fv.get_user_store_id()));
CREATE POLICY consignments_admin_all ON fv.consignments TO authenticated USING (fv.is_admin());
CREATE POLICY customers_admin_all ON fv.customers TO authenticated USING (fv.is_admin());
CREATE POLICY customers_operator_insert ON fv.customers FOR INSERT TO authenticated WITH CHECK (((NOT fv.is_admin()) AND (origin_store_id = fv.get_user_store_id())));
CREATE POLICY customers_operator_select ON fv.customers FOR SELECT TO authenticated USING ((NOT fv.is_admin()));
CREATE POLICY customers_operator_update ON fv.customers FOR UPDATE TO authenticated USING (((NOT fv.is_admin()) AND (origin_store_id = fv.get_user_store_id())));
CREATE POLICY disp_dest_admin_all ON fv.disparo_destinatarios TO authenticated USING (fv.is_admin());
CREATE POLICY disp_dest_operator_cud ON fv.disparo_destinatarios TO authenticated USING ((EXISTS ( SELECT 1
   FROM fv.disparos d
  WHERE ((d.id = disparo_destinatarios.disparo_id) AND (d.store_id = fv.get_user_store_id()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM fv.disparos d
  WHERE ((d.id = disparo_destinatarios.disparo_id) AND (d.store_id = fv.get_user_store_id())))));
CREATE POLICY disp_dest_operator_select ON fv.disparo_destinatarios FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM fv.disparos d
  WHERE ((d.id = disparo_destinatarios.disparo_id) AND (d.store_id = fv.get_user_store_id())))));
CREATE POLICY disparos_admin_all ON fv.disparos TO authenticated USING (fv.is_admin());
CREATE POLICY disparos_operator_insert ON fv.disparos FOR INSERT TO authenticated WITH CHECK ((store_id = fv.get_user_store_id()));
CREATE POLICY disparos_operator_select ON fv.disparos FOR SELECT TO authenticated USING ((store_id = fv.get_user_store_id()));
CREATE POLICY disparos_operator_update ON fv.disparos FOR UPDATE TO authenticated USING ((store_id = fv.get_user_store_id()));
CREATE POLICY exchange_items_admin_all ON fv.exchange_items TO authenticated USING (fv.is_admin());
CREATE POLICY exchanges_admin_all ON fv.exchanges TO authenticated USING (fv.is_admin());
CREATE POLICY exchanges_operator ON fv.exchanges TO authenticated USING ((store_id = fv.get_user_store_id()));
CREATE POLICY fiscal_emitentes_admin ON fv.fiscal_emitentes FOR SELECT TO authenticated USING (fv.is_admin());
CREATE POLICY fiscal_emitentes_operadora ON fv.fiscal_emitentes FOR SELECT TO authenticated USING ((store_id = fv.get_user_store_id()));
CREATE POLICY inventory_scans_leitura ON fv.inventory_scans FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (fv.inventory_sessions s
     JOIN fv.users u ON ((u.id = auth.uid())))
  WHERE ((s.id = inventory_scans.session_id) AND ((u.role = 'admin'::text) OR (u.store_id = s.store_id))))));
CREATE POLICY inventory_sessions_leitura ON fv.inventory_sessions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM fv.users u
  WHERE ((u.id = auth.uid()) AND ((u.role = 'admin'::text) OR (u.store_id = inventory_sessions.store_id))))));
CREATE POLICY products_admin_all ON fv.products TO authenticated USING (fv.is_admin());
CREATE POLICY purchase_items_admin_all ON fv.purchase_items TO authenticated USING (fv.is_admin());
CREATE POLICY purchase_payments_admin_all ON fv.purchase_payments TO authenticated USING (fv.is_admin());
CREATE POLICY purchases_admin_all ON fv.purchases TO authenticated USING (fv.is_admin());
CREATE POLICY recurring_expenses_admin_all ON fv.recurring_expenses TO authenticated USING (fv.is_admin());
CREATE POLICY sale_items_admin_all ON fv.sale_items TO authenticated USING (fv.is_admin());
CREATE POLICY sale_payments_admin_all ON fv.sale_payments TO authenticated USING (fv.is_admin());
CREATE POLICY sale_payments_operator ON fv.sale_payments TO authenticated USING ((EXISTS ( SELECT 1
   FROM fv.sales
  WHERE ((sales.id = sale_payments.sale_id) AND (sales.store_id = fv.get_user_store_id())))));
CREATE POLICY sales_admin_all ON fv.sales TO authenticated USING (fv.is_admin());
CREATE POLICY sales_operator_insert ON fv.sales FOR INSERT TO authenticated WITH CHECK ((store_id = fv.get_user_store_id()));
CREATE POLICY seller_goals_admin_all ON fv.seller_goals USING (fv.is_admin());
CREATE POLICY seller_goals_operator_self ON fv.seller_goals FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY settings_admin_all ON fv.settings TO authenticated USING (fv.is_admin());
CREATE POLICY settings_operator_select ON fv.settings FOR SELECT USING ((NOT fv.is_admin()));
CREATE POLICY stock_movements_leitura ON fv.stock_movements FOR SELECT USING ((EXISTS ( SELECT 1
   FROM fv.users u
  WHERE ((u.id = auth.uid()) AND ((u.role = 'admin'::text) OR (u.store_id = ( SELECT p.store_id
           FROM fv.products p
          WHERE (p.id = stock_movements.product_id))))))));
CREATE POLICY stock_transfers_admin_all ON fv.stock_transfers TO authenticated USING (fv.is_admin());
CREATE POLICY stock_transfers_operator_select ON fv.stock_transfers FOR SELECT TO authenticated USING (((from_store_id = fv.get_user_store_id()) OR (to_store_id = fv.get_user_store_id())));
CREATE POLICY stores_admin_all ON fv.stores TO authenticated USING (fv.is_admin());
CREATE POLICY stores_operator_select ON fv.stores FOR SELECT TO authenticated USING ((id = fv.get_user_store_id()));
CREATE POLICY transactions_admin_all ON fv.transactions TO authenticated USING (fv.is_admin());
CREATE POLICY transfer_items_admin_select ON fv.transfer_items FOR SELECT TO authenticated USING (fv.is_admin());
CREATE POLICY transfers_admin_select ON fv.transfers FOR SELECT TO authenticated USING (fv.is_admin());
CREATE POLICY users_admin_all ON fv.users TO authenticated USING (fv.is_admin());
CREATE POLICY users_operator_self ON fv.users FOR SELECT TO authenticated USING ((id = auth.uid()));

drop function if exists fv.edita_compra(uuid);
drop function if exists fv.ve_compra(uuid);
drop function if exists fv.ve_transferencia(uuid);
drop function if exists fv.loja_da_pessoa(uuid);
drop function if exists fv.loja_da_conferencia(uuid);
drop function if exists fv.loja_do_disparo(uuid);
drop function if exists fv.loja_do_produto(uuid);
drop function if exists fv.loja_da_troca(uuid);
drop function if exists fv.loja_da_venda(uuid);
drop function if exists fv.pode_ver_loja(uuid);
drop function if exists fv.e_admin_global();
drop function if exists fv.loja_do_usuario();

do $$
declare n integer;
begin
  select count(*) into n from pg_policies where schemaname = 'fv';
  if n <> 50 then
    raise exception 'rollback rls_por_loja: esperava 50 políticas no fv, ficaram %', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
