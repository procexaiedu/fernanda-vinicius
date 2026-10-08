# Postgres local para testar migrations do fv

Montado em 08/10/2026 para a migration de RLS por loja. Não usa o `fvtest-db`
(compartilhado com outros testes de tela): sobe um container próprio.

```bash
export MSYS_NO_PATHCONV=1   # Git Bash no Windows: senão /tmp vira C:/...
docker run -d --name fv-rls-teste -e POSTGRES_PASSWORD=teste -p 127.0.0.1:54340:5432 supabase/postgres:15.8.1.085

# auth.jwt() (vem do GoTrue, a imagem não traz) e unaccent em public
docker exec -i -e PGPASSWORD=teste fv-rls-teste psql -h localhost -U supabase_admin -d postgres <<'SQL'
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;
SQL

# Schema fv: dump SÓ de estrutura de um banco que já tem o fv (fvtest-db, ou produção, só leitura)
docker exec fvtest-db pg_dump -U postgres -s -n fv --no-owner > /tmp/fv_schema.sql
docker cp /tmp/fv_schema.sql fv-rls-teste:/tmp/fv_schema.sql
docker exec fv-rls-teste psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/fv_schema.sql

# Migrations novas, depois os testes
docker cp supabase/migrations/20261008_rls_por_loja.sql fv-rls-teste:/tmp/m.sql
docker exec fv-rls-teste psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/m.sql
bash supabase/tests/rls_local/rodar_testes.sh

# No fim, remover SÓ este container
docker rm -f fv-rls-teste
```

As migrations de `supabase/migrations` são incrementais (a primeira é de
06/2026, o schema base não está no repositório), por isso o ponto de partida é
um `pg_dump -s` e não as migrations.

A sessão do PostgREST é simulada nos testes com `SET ROLE authenticated` +
`request.jwt.claims` (`auth.uid()` lê o `sub` dali), igual ao Supabase.
