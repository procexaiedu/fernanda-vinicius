-- Teste de 20261016_configs_por_loja.sql. Roda em transação e desfaz tudo.
begin;

do $$
declare
  v_a uuid; v_b uuid; v_prod uuid; v_cat text;
begin
  -- B = loja que tem admin de loja (para simular a sessão dela); A = a outra.
  select store_id into v_b from fv.users where role = 'admin' and store_id is not null and is_active limit 1;
  select id into v_a from fv.stores where id <> v_b order by name limit 1;

  -- Cada loja tem a sua cópia das regras (fora a meta, que é de uma loja só).
  assert (select count(*) from fv.settings where store_id = v_a and key not like 'meta_loja:%')
       = (select count(*) from fv.settings where store_id = v_b and key not like 'meta_loja:%'), 'mesmas chaves nas duas lojas';
  assert not exists (select 1 from fv.settings where key like 'meta_loja:%' and key <> 'meta_loja:' || store_id), 'meta na loja certa';

  -- Mudar uma loja não mexe na outra.
  update fv.settings set value = '7' where store_id = v_a and key = 'pix_discount_pct';
  assert (select value::text from fv.settings where store_id = v_b and key = 'pix_discount_pct') <> '7', 'desconto vazou para a outra loja';

  insert into fv.category_label_mapping (store_id, category, label_format) values (v_a, '__teste', 'A');
  assert not exists (select 1 from fv.category_label_mapping where store_id = v_b and category = '__teste'), 'etiqueta vazou';
  insert into fv.category_label_mapping (store_id, category, label_format) values (v_b, '__teste', 'B');  -- mesma categoria, outra loja: pode

  -- NFC-e: a classificação vem da categoria da LOJA da peça.
  select p.id, p.category into v_prod, v_cat from fv.products p
   where p.store_id = v_b and p.category is not null and p.codigo_ncm is null limit 1;
  if v_prod is not null then
    insert into fv.fiscal_categorias (store_id, categoria, codigo_ncm, cfop, csosn) values (v_b, v_cat, '71171900', '5102', '102')
      on conflict (store_id, categoria) do update set codigo_ncm = '71171900';
    update fv.fiscal_categorias set codigo_ncm = '71131900' where store_id = v_a and categoria = v_cat;
    assert (select codigo_ncm from fv.fiscal_do_produto where product_id = v_prod) = '71171900', 'NCM da loja da peça';
  end if;

  -- RLS: admin de loja só enxerga a dela (simula a sessão da Eleandra).
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fv.users where role = 'admin' and store_id = v_b and is_active limit 1), 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(distinct store_id) from fv.settings) = 1, 'admin de loja vê só a loja dela (settings)';
  assert (select count(*) from fv.settings where store_id = v_a) = 0, 'não lê a outra loja';
  update fv.settings set value = '99' where store_id = v_a and key = 'pix_discount_pct';
  reset role;
  assert (select value::text from fv.settings where store_id = v_a and key = 'pix_discount_pct') = '7', 'RLS deixou mudar a outra loja';

  raise notice 'OK: configs_por_loja';
end $$;

rollback;
