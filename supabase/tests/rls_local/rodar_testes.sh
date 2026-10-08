#!/usr/bin/env bash
# Roda os testes SQL de supabase/tests num Postgres LOCAL (container docker).
# Uso: bash supabase/tests/rls_local/rodar_testes.sh [container]   (padrão: fv-rls-teste)
# Cada teste termina em ROLLBACK; "OK" = nenhum ERROR.
#
# Os testes "contra dados reais" procuram lojas e peças que já existam; os
# outros contam linhas e precisam do banco VAZIO. Para os primeiros, o seed
# (seed_minimo.sql) entra na MESMA transação do teste: `BEGIN; seed; <teste>`.
# O BEGIN do teste só gera um WARNING e o ROLLBACK do fim leva o seed junto.
#
# O arquivo vai para o container por `docker exec -i` (stdin), não por
# `docker cp`: no Git Bash, com MSYS_NO_PATHCONV, um caminho /tmp do host não
# existe para o docker do Windows, o cp falhava calado e todo teste rodava o
# MESMO arquivo velho, com "OK" falso.
C="${1:-fv-rls-teste}"
cd "$(dirname "$0")/../../.."
falhas=0
for t in supabase/tests/*.sql; do
  case "$(basename "$t")" in
    20261001_venda_transacional_test.sql|20261001_transferencia_conferencia_test.sql|20261001_compra_transacional_test.sql)
      fonte() { echo 'BEGIN;'; cat supabase/tests/rls_local/seed_minimo.sql "$t"; }; modo=seed ;;
    *) fonte() { cat "$t"; }; modo=vazio ;;
  esac
  saida=$(fonte | docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1)
  st=$?
  r=$(echo "$saida" | grep -E "ERROR" | head -3)
  if [ $st -ne 0 ] || [ -n "$r" ]; then falhas=$((falhas+1)); echo "$(basename "$t") [$modo]: FALHOU ${r:-exit $st}"
  else echo "$(basename "$t") [$modo]: OK ($(echo "$saida" | grep -c NOTICE) notices)"; fi
done
exit $falhas
