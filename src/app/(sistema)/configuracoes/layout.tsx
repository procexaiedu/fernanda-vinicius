import ConfigNavTabs from './ConfigNavTabs'
import styles from './layout.module.css'

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.layout}>
      <ConfigNavTabs />
      {children}
    </div>
  )
}
