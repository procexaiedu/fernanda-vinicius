/**
 * Data de "hoje" (YYYY-MM-DD) no fuso de Brasília (America/Sao_Paulo).
 * Usar em vez de `new Date().toISOString().slice(0,10)` (que é UTC e vira o dia
 * seguinte no fim da noite no Brasil). en-CA formata como YYYY-MM-DD.
 */
export function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
