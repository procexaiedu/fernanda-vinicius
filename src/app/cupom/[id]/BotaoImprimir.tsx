'use client'

import styles from './cupom.module.css'

/** Some no papel (`@media print`). A impressora escolhida tem de ser a térmica, com papel 80mm. */
export default function BotaoImprimir() {
  return (
    <div className={styles.barra}>
      <button className={styles.imprimir} onClick={() => window.print()}>Imprimir cupom</button>
      <span>Escolha a impressora térmica (papel 80mm), margens: nenhuma.</span>
    </div>
  )
}
