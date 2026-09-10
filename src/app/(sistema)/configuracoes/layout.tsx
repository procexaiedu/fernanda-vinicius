import { requireProfile, podeConfigurarRede } from '@/lib/auth'
import ConfigNavTabs from './ConfigNavTabs'
import styles from './layout.module.css'

export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()

  /*
   * Lojas, Metas e Negócio valem para a REDE; Usuários e Impressão, não.
   * Mostrar aba que devolve a pessoa para a home faz o sistema parecer
   * quebrado — some com ela em vez de deixar o clique falhar.
   */
  return (
    <div className={styles.layout}>
      <ConfigNavTabs daRede={podeConfigurarRede(profile)} />
      {children}
    </div>
  )
}
