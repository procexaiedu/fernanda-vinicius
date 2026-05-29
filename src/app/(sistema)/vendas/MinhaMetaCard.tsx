import type { MetaProgress } from '@/lib/metas/compute'
import styles from './MinhaMetaCard.module.css'

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function MinhaMetaCard({ progress, monthLabel }: { progress: MetaProgress; monthLabel: string }) {
  if (!progress.hasGoal) return null

  const pctValue = Math.min(progress.pct, 100)
  const faltam = Math.max(progress.target - progress.realized, 0)

  return (
    <div className={`${styles.card} ${progress.reached ? styles.reached : ''}`}>
      <div className={styles.header}>
        <span className={styles.label}>Sua meta · {monthLabel}</span>
        <span className={`${styles.pct} ${progress.reached ? styles.pctReached : ''}`}>
          {Math.round(progress.pct)}%
        </span>
      </div>

      <div className={styles.values}>
        <strong className={styles.realized}>{fmtBRL(progress.realized)}</strong>
        <span className={styles.target}>de {fmtBRL(progress.target)}</span>
      </div>

      <div className={styles.track}>
        <div
          className={`${styles.fill} ${progress.reached ? styles.fillReached : ''}`}
          style={{ width: `${pctValue}%` }}
        />
      </div>

      <div className={styles.footer}>
        {progress.reached ? (
          <span className={styles.success}>
            🎉 Meta batida!{progress.commission > 0 && <> Comissão: <strong>{fmtBRL(progress.commission)}</strong></>}
          </span>
        ) : (
          <span className={styles.muted}>Faltam <strong>{fmtBRL(faltam)}</strong> para a meta</span>
        )}
      </div>
    </div>
  )
}
