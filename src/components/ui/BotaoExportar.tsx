'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import Button from './Button'
import type { ResultadoExportacao } from '@/app/(sistema)/produtos/exportar'

/**
 * Botão de exportar planilha.
 *
 * O arquivo é montado no SERVIDOR (ver produtos/exportar.ts) — aqui só chega o
 * texto pronto, que vira um Blob e um clique sintético em `<a download>`.
 *
 * O download é feito com `Blob` + `URL.createObjectURL` em vez de um `data:`
 * URI porque um CSV de milhares de linhas estoura o limite de tamanho de URL do
 * navegador e o download simplesmente não acontece, sem erro nenhum.
 *
 * O `type` inclui `charset=utf-8` e o conteúdo já vem com BOM: os dois juntos
 * são o que faz o Excel abrir com acento certo.
 */
export default function BotaoExportar({ exportar, rotulo = 'Exportar' }: {
  exportar: () => Promise<ResultadoExportacao>
  rotulo?: string
}) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function clicar() {
    setOcupado(true)
    setErro(null)

    const r = await exportar()

    if (!r.success) {
      setOcupado(false)
      setErro(r.error)
      return
    }

    const blob = new Blob([r.arquivo.conteudo], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.arquivo.nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Sem o revoke o Blob fica na memória até fechar a aba.
    URL.revokeObjectURL(url)

    setOcupado(false)
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={clicar} loading={ocupado} title="Baixar planilha com os filtros atuais">
        <Download size={14} />
        {rotulo}
      </Button>
      {erro && (
        <span role="status" style={{ fontSize: 11, color: 'var(--danger)', alignSelf: 'center' }}>
          {erro}
        </span>
      )}
    </>
  )
}
