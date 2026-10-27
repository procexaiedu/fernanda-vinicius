// Somente container descartável deste teste. Nenhum dado/segredo real.
import {execFileSync} from 'node:child_process'
const modes={
  promo:`UPDATE fv.products SET promotional_active=true,promotional_price=199,updated_at=clock_timestamp() WHERE barcode_number='12724';`,
  multi:`INSERT INTO fv.products(id,store_id,code,name,barcode_number,category,sale_price,photo_url)
    VALUES ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','VIZINHO','Anel fixture (imagem de teste)','12725','anel',10,'/brand/logo-fv.png');
    INSERT INTO fv.transfer_items(id,transfer_id,product_id,product_code,product_name,barcode_number,quantity_sent,unit_sale_price,unit_cost)
    VALUES ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','VIZINHO','Anel fixture (imagem de teste)','12725',2,10,5);`,
  received:`UPDATE fv.transfers SET status='recebida';`,
  reset:`DELETE FROM fv.transfer_items WHERE product_code='VIZINHO';DELETE FROM fv.products WHERE code='VIZINHO';
    UPDATE fv.products SET sale_price=237,promotional_price=NULL,promotional_active=false,updated_at=clock_timestamp() WHERE barcode_number='12724';
    UPDATE fv.transfer_items SET unit_sale_price=237;
    UPDATE fv.transfers SET status='enviada',totals=jsonb_set(totals,'{venda_total}','237.00'),updated_at=clock_timestamp();`,
  data:`SELECT jsonb_build_object('product',to_jsonb(p),'item',to_jsonb(i),'totals',t.totals,'movements',(SELECT count(*) FROM fv.stock_movements),'finance',(SELECT jsonb_agg(to_jsonb(f)) FROM fv.transactions f)) FROM fv.products p JOIN fv.transfer_items i ON i.product_id=p.id JOIN fv.transfers t ON t.id=i.transfer_id WHERE p.barcode_number='12724';`,
}
const sql=modes[process.argv[2]]
if(!sql)throw Error('Modo inválido: promo, multi, received, reset, data')
process.stdout.write(execFileSync('docker',['exec','-i','fv-romaneio-w14-db','psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'}))
