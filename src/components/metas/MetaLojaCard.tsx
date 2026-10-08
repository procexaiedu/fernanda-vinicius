import { Target } from 'lucide-react'
import type { ProgressoLoja } from '@/lib/metas/loja'
import { monthLabel } from '@/lib/metas/compute'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './MetaLojaCard.module.css'

/*
 * Painel "Meta da loja" (reunião de 06/10/2026). O que a Eleandra fazia à mão
 * todo dia: quanto vendeu, quanto falta e quanto precisa vender por dia até o
 * fim do mês. Fica no topo da tela inicial de quem entra: o PDV para a
 * vendedora, o Dashboard para a admin.
 *
 * A meta é da LOJA: todas veem o mesmo número, porque ele decide a faixa de
 * comissão de todas. Mesmo visual do antigo cartão "Sua meta".
 */
export default function MetaLojaCard({ progresso, nomeLoja, erro }: {
  progresso: ProgressoLoja | null
  nomeLoja?: string | null
  erro?: string | null
}) {
  if (!progresso) {
    // Falha de leitura não derruba o PDV, mas também não finge "R$ 0".
    return erro ? <div className={`${styles.card} ${styles.cardErro}`}>{erro}</div> : null
  }

  const p = progresso
  const largura = Math.min(p.pct, 100)

  return (
    <section className={`${styles.card} ${p.bateu ? styles.bateu : ''}`} aria-label="Meta da loja">
      <div className={styles.topo}>
        <span className={styles.rotulo}>
          <Target size={14} /> Meta da loja · {monthLabel(p.mes)}{nomeLoja ? ` · ${nomeLoja}` : ''}
        </span>
        <span className={`${styles.pct} ${p.bateu ? styles.pctBateu : ''}`}>{Math.floor(p.pct)}%</span>
      </div>

      <div className={styles.valores}>
        <strong className={styles.realizado}>{formatarDinheiro(p.realizado)}</strong>
        <span className={styles.meta}>de {formatarDinheiro(p.meta)}</span>
      </div>

      <div className={styles.trilho}>
        <div className={`${styles.barra} ${p.bateu ? styles.barraBateu : ''}`} style={{ width: `${largura}%` }} />
      </div>

      <div className={styles.numeros}>
        {p.bateu ? (
          <div className={styles.numero}>
            <span className={styles.numRotulo}>Meta batida</span>
            <span className={`${styles.numValor} ${styles.ok}`}>+{formatarDinheiro(p.realizado - p.meta)}</span>
          </div>
        ) : (
          <div className={styles.numero}>
            <span className={styles.numRotulo}>Falta</span>
            <span className={styles.numValor}>{formatarDinheiro(p.falta)}</span>
          </div>
        )}

        <div className={styles.numero}>
          <span className={styles.numRotulo}>
            Média por dia{p.diasRestantes > 0 ? ` (${p.diasRestantes} ${p.diasRestantes === 1 ? 'dia' : 'dias'})` : ''}
          </span>
          <span className={styles.numValor}>
            {p.bateu ? '—' : p.diasRestantes > 0 ? formatarDinheiro(p.mediaDiaria) : 'mês encerrado'}
          </span>
        </div>

        <div className={styles.numero}>
          <span className={styles.numRotulo}>Comissão</span>
          <span className={`${styles.numValor} ${p.bateu ? styles.ok : ''}`}>
            {fmtPct(p.pctComissao)}
            <small className={styles.faixa}>
              {p.bateu ? ' meta batida' : ` · ${fmtPct(p.pctBateu)} se bater`}
            </small>
          </span>
        </div>
      </div>
    </section>
  )
}

function fmtPct(n: number): string {
  return `${String(n).replace('.', ',')}%`
}
