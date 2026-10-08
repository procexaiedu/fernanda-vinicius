'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, FileText, X, MessageCircle, Printer } from 'lucide-react'
import { emitirNotaDaVenda, vendaEmiteNota, type NotaDaVenda } from '@/app/(sistema)/vendas/fiscal'
import { linkDaNotaNoWhatsApp } from '@/lib/fiscal/enviarDanfe'
import { EMISSAO_NOTA_ATIVA, MSG_EMISSAO_EM_BREVE } from '@/lib/fiscal/emissaoAtiva'
import styles from './PainelNota.module.css'

/**
 * O que aparece depois de salvar: a venda registrada e a escolha da nota.
 *
 * **A nota é sob demanda, não automática.** Decisão do dono em 02/09, repetida
 * pela dona na reunião de 06/10: a venda é sempre registrada, e a nota só sai
 * se a vendedora clicar — conserto e alguns casos não levam nota. Não clicou,
 * a venda fica sem nota e dá para emitir depois pelo detalhe da venda.
 *
 * O painel FICA até fechar ou até a próxima venda — diferente do toast antigo,
 * que sumia em 2,2s. A NFC-e tem 5 minutos de janela: se a barra some antes de
 * a cliente pedir, a nota não sai mais na hora e vira problema do dia seguinte.
 *
 * Usado no PDV e na lista de Vendas (depois de lançar por /vendas/nova).
 */
export default function PainelNota({ saleId, aviso, onFechar }: { saleId: string; aviso?: string; onFechar: () => void }) {
  const [estado, setEstado] = useState<'pronta' | 'emitindo' | 'ok' | 'erro'>('pronta')
  /*
   * Esta venda pode ganhar nota?
   *
   * `null` enquanto a resposta não chega — e nesse tempo o botão NÃO aparece.
   * O contrário (mostrar e depois sumir) pisca um botão na cara de quem está
   * com a cliente na frente, e pior: alguém consegue clicar no piscar.
   */
  const [nota, setNota] = useState<NotaDaVenda | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [danfe, setDanfe] = useState<string | null>(null)
  /* Link pronto ANTES do clique: abrir o WhatsApp depois de um `await` é o que
   * o navegador barra como pop-up. */
  const [linkWhats, setLinkWhats] = useState<string | null>(null)
  /* O que ficou fora da nota sem impedir a emissão (o conserto). */
  const [avisos, setAvisos] = useState<string[]>([])

  useEffect(() => {
    let vivo = true
    vendaEmiteNota(saleId)
      .then(r => { if (vivo) setNota(r) })
      .catch(() => {
        if (vivo) setNota({
          emite: false, falhou: true,
          motivo: 'Não consegui conferir a nota agora. A venda está gravada; dá para emitir depois em Vendas, no detalhe da venda.',
        })
      })
    return () => { vivo = false }
  }, [saleId])

  async function emitir() {
    setEstado('emitindo'); setMensagem(null)
    const r = await emitirNotaDaVenda(saleId)
    setAvisos(r.avisos ?? [])
    if (r.success) {
      setEstado('ok')
      setDanfe(r.danfeUrl ?? null)
      setLinkWhats(linkDaNotaNoWhatsApp({
        telefone: r.telefone, danfeUrl: r.danfeUrl, nomeDaCliente: r.cliente, loja: r.loja,
      }))
    } else {
      setEstado('erro')
      /* As recusas da validação são mais úteis que a mensagem genérica: dizem
       * QUAL campo e o que fazer. Se houver, elas ganham a tela. */
      setMensagem(r.recusas?.length
        ? r.recusas.map(x => `${x.campo}: ${x.motivo}`).join(' · ')
        : (r.error ?? 'Não foi possível emitir.'))
    }
  }

  /* Enquanto a nota não sai, a venda está SEM nota — e isso é escolha, não
   * defeito. Dizer na tela evita a dúvida "a nota saiu?". */
  const semNota = estado !== 'ok'

  return (
    <div className={styles.painelVenda} data-novidade="painel-nota">
      <div className={styles.painelLinha}>
        <CheckCircle2 size={18} />
        <strong>{semNota ? 'Venda registrada sem nota fiscal' : 'Venda registrada'}</strong>

        {/* Fechar continua disponível em qualquer estado: a operadora não pode
            ficar presa a este painel com a próxima cliente esperando. */}
        <button className={styles.btnFechar} onClick={onFechar} aria-label="Fechar">
          <X size={16} />
        </button>
      </div>

      {/* Chave geral desligada (src/lib/fiscal/emissaoAtiva.ts): o botão fica no
          lugar, apagado, para a vendedora saber que vem aí e não procurar. */}
      {estado === 'pronta' && nota?.emite && !EMISSAO_NOTA_ATIVA && (
        <div className={styles.painelEscolha}>
          <span className={styles.painelInfo}>{MSG_EMISSAO_EM_BREVE}</span>
          <button className={styles.btnNota} disabled aria-disabled="true" data-novidade="emitir-nota-fiscal">
            <FileText size={14} /> Em breve
          </button>
        </div>
      )}
      {estado === 'pronta' && nota?.emite && EMISSAO_NOTA_ATIVA && (
        <div className={styles.painelEscolha}>
          <span className={styles.painelInfo}>A cliente quer nota?</span>
          <button className={styles.btnNota} onClick={emitir} data-novidade="emitir-nota-fiscal">
            <FileText size={14} /> Emitir nota fiscal
          </button>
        </div>
      )}
      {estado === 'pronta' && nota && !nota.emite && nota.motivo && (
        <div className={nota.falhou ? styles.painelAviso : styles.painelInfo}>{nota.motivo}</div>
      )}
      {estado === 'emitindo' && <span className={styles.painelInfo}>Emitindo a nota…</span>}
      {estado === 'ok' && <span className={styles.painelOk}>Nota fiscal autorizada</span>}

      {estado === 'ok' && (
        <div className={styles.painelLinks}>
          {/* Cupom 80mm para a térmica; o PDF da Focus continua ao lado. */}
          <a className={styles.painelDanfe} href={`/cupom/${saleId}`} target="_blank" rel="noopener noreferrer">
            <Printer size={13} /> Imprimir cupom
          </a>
          {danfe && (
            <a className={styles.painelDanfe} href={danfe} target="_blank" rel="noopener noreferrer">
              Abrir DANFE (PDF)
            </a>
          )}
          {/*
            Só aparece se a venda tem cliente COM telefone. Venda avulsa não
            tem para quem mandar, e um botão que abre o WhatsApp em branco no
            meio do balcão é pior que botão nenhum.
          */}
          {linkWhats && (
            <a className={styles.painelWhats} href={linkWhats} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={13} /> Mandar no WhatsApp
            </a>
          )}
        </div>
      )}

      {/* Venda gravada com pendência: o mesmo quadro de erro do painel, sem o
          "Tentar de novo" — não há o que repetir, e salvar de novo duplicaria. */}
      {aviso && <div className={styles.painelErro}>{aviso}</div>}
      {avisos.map((a, i) => <div key={i} className={styles.painelInfo}>{a}</div>)}

      {estado === 'erro' && (
        <div className={styles.painelErro}>
          {mensagem}
          {/* Falhar não pode ser o fim: quase toda recusa é corrigível e a
              janela de 5 minutos ainda pode estar aberta. */}
          <button className={styles.btnTentar} onClick={emitir}>Tentar de novo</button>
        </div>
      )}
    </div>
  )
}
