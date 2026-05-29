'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Printer, ExternalLink } from 'lucide-react'
import { useLocalPrintAgent } from '@/lib/etiquetas/useLocalPrintAgent'
import {
  getAgentBaseUrl, setAgentBaseUrl,
  getAgentToken, setAgentToken,
  getDefaultPrinter,
} from '@/lib/etiquetas/printAgent'
import styles from './ImpressaoClient.module.css'

export default function ImpressaoClient() {
  const agent = useLocalPrintAgent()
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    setBaseUrl(getAgentBaseUrl())
    setToken(getAgentToken() ?? '')
  }, [])

  function handleSave() {
    setAgentBaseUrl(baseUrl.trim() || 'http://localhost:17777')
    setAgentToken(token.trim() || null)
    agent.refresh()
  }

  return (
    <div className={styles.container}>
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2>Status do agente</h2>
          <button type="button" className={styles.refreshBtn} onClick={agent.refresh}>
            <RefreshCw size={14} /> Verificar agora
          </button>
        </header>
        <StatusRow agent={agent} />
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2>Conexão</h2>
        </header>
        <div className={styles.formRow}>
          <label className={styles.label}>
            <span>Endereço do agente</span>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="http://localhost:17777"
              className={styles.input}
            />
            <small className={styles.hint}>
              Padrão: <code>http://localhost:17777</code>. Mude apenas se o agente estiver rodando em outra máquina/porta.
            </small>
          </label>

          <label className={styles.label}>
            <span>Token (opcional)</span>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="(deixe vazio se não configurou)"
              className={styles.input}
            />
            <small className={styles.hint}>
              Configure no agente via variável <code>FV_AGENT_TOKEN</code>. Recomendado quando o agente é exposto na rede.
            </small>
          </label>

          <button type="button" className={styles.btnPrimary} onClick={handleSave}>
            Salvar e testar
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2>Impressora padrão</h2>
        </header>
        {agent.status === 'online' && agent.printers.length > 0 ? (
          <div className={styles.formRow}>
            <label className={styles.label}>
              <span>Selecione a impressora</span>
              <select
                value={agent.selectedPrinter ?? ''}
                onChange={e => agent.setSelectedPrinter(e.target.value || null)}
                className={styles.input}
              >
                {agent.printers.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.isDefault ? ' (padrão do Windows)' : ''}
                  </option>
                ))}
              </select>
              <small className={styles.hint}>
                Salvo localmente neste navegador (<code>localStorage</code>). Cada operadora pode escolher a sua.
              </small>
            </label>
          </div>
        ) : (
          <p className={styles.emptyMsg}>
            Conecte o agente para listar as impressoras instaladas no Windows.
          </p>
        )}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2>Instalação do agente</h2>
        </header>
        <ol className={styles.steps}>
          <li>
            <strong>Baixe</strong> o <code>fv-print-agent.exe</code> da página de releases do repositório.
          </li>
          <li>
            <strong>Execute uma vez</strong> — se o Windows Defender pedir confirmação, escolha "Mais informações → Executar mesmo assim".
          </li>
          <li>
            Para iniciar junto com o Windows, crie um atalho do <code>.exe</code> em <code>shell:startup</code> (Win+R → digite e cole).
          </li>
          <li>
            Volte aqui e clique em <strong>Verificar agora</strong>. O status acima deve mudar para "Conectado".
          </li>
        </ol>
      </section>
    </div>
  )
}

function StatusRow({ agent }: { agent: ReturnType<typeof useLocalPrintAgent> }) {
  if (agent.status === 'checking') {
    return (
      <div className={`${styles.statusRow} ${styles.statusChecking}`}>
        <Loader2 size={16} className={styles.spin} />
        <span>Procurando agente em <code>{getAgentBaseUrl()}</code>…</span>
      </div>
    )
  }

  if (agent.status === 'offline') {
    return (
      <div className={`${styles.statusRow} ${styles.statusOffline}`}>
        <AlertCircle size={16} />
        <div>
          <strong>Não encontrado.</strong>
          <p>
            O agente local <code>fv-print-agent</code> precisa estar instalado e rodando nesta máquina.
            {agent.error ? <> Erro: <em>{agent.error}</em></> : null}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.statusRow} ${styles.statusOnline}`}>
      <CheckCircle2 size={16} />
      <div>
        <strong>Conectado.</strong>
        <p>
          <code>fv-print-agent v{agent.health?.version}</code> rodando em{' '}
          <code>{getAgentBaseUrl()}</code> · Plataforma: <code>{agent.health?.platform}</code> · {agent.printers.length} impressora(s) instalada(s)
        </p>
      </div>
    </div>
  )
}
