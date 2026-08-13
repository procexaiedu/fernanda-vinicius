'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Check, Loader2, Merge } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { buscarFornecedoresDuplicados, mesclarFornecedores, type FornecedorDuplicado } from './actions'
import styles from './MesclarDuplicadosModal.module.css'

/**
 * Mesclagem de fornecedores cadastrados em duplicidade.
 *
 * O problema que resolve: o mesmo fornecedor cadastrado duas ou três vezes divide
 * os produtos, as compras e o total investido entre os cadastros — e aí não dá
 * para saber quanto se compra de cada um. Encontrados na base: SANTA PRATA em 3
 * cadastros, e PONTO K, BEE, IREAN e THE MADAM em 2 cada.
 *
 * Por que a decisão é da pessoa e não automática: só quem conhece o negócio sabe
 * se "PK" e "PONTO K" são a mesma empresa. O sistema propõe, ela confirma.
 *
 * O cadastro escolhido fica; os outros têm tudo movido para ele e são INATIVADOS,
 * nunca apagados — o histórico de compra precisa continuar rastreável, e inativar
 * dá para desfazer.
 */

interface Props {
  onClose: () => void
  onMesclado: () => void
}

export default function MesclarDuplicadosModal({ onClose, onMesclado }: Props) {
  const [carregando, setCarregando] = useState(true)
  const [grupos, setGrupos] = useState<FornecedorDuplicado[]>([])
  // Qual cadastro fica, por grupo. Pré-selecionado no que tem mais coisa presa.
  const [escolhido, setEscolhido] = useState<Record<string, string>>({})
  const [mesclando, setMesclando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [prontos, setProntos] = useState<Set<string>>(new Set())

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const dados = await buscarFornecedoresDuplicados()
    setGrupos(dados)
    // Sugere ficar com o cadastro que já tem mais produtos e compras: é o que
    // menos referência precisa mover, e normalmente é o "de verdade".
    const inicial: Record<string, string> = {}
    for (const g of dados) {
      const melhor = [...g.cadastros].sort((a, b) =>
        (b.produtos + b.compras + b.consignacoes) - (a.produtos + a.compras + a.consignacoes))[0]
      if (melhor) inicial[g.nomeNormalizado] = melhor.id
    }
    setEscolhido(inicial)
    setCarregando(false)
  }

  async function mesclar(g: FornecedorDuplicado) {
    const principal = escolhido[g.nomeNormalizado]
    if (!principal) return
    const absorvidos = g.cadastros.filter(c => c.id !== principal).map(c => c.id)

    setErro(null)
    setMesclando(g.nomeNormalizado)
    const r = await mesclarFornecedores(principal, absorvidos)
    setMesclando(null)

    if (!r.success) { setErro(r.error ?? 'Falha ao mesclar.'); return }
    setProntos(p => new Set(p).add(g.nomeNormalizado))
    onMesclado()
  }

  const pendentes = grupos.filter(g => !prontos.has(g.nomeNormalizado))

  return (
    <Modal isOpen onClose={onClose} title="Fornecedores cadastrados em duplicidade" size="lg">
      {carregando ? (
        <div className={styles.centro}><Loader2 size={20} className={styles.girando} /> Procurando…</div>
      ) : grupos.length === 0 ? (
        <div className={styles.centro}>
          <Check size={20} className={styles.ok} />
          Nenhum fornecedor duplicado encontrado.
        </div>
      ) : (
        <>
          <p className={styles.intro}>
            O mesmo fornecedor aparece mais de uma vez. Escolha qual cadastro fica — os
            produtos, compras e consignações dos outros passam para ele, e os cadastros
            antigos são <strong>inativados</strong> (não apagados).
          </p>

          {erro && (
            <div className={styles.erro}>
              <AlertTriangle size={14} /> {erro}
            </div>
          )}

          <div className={styles.grupos}>
            {grupos.map(g => {
              const feito = prontos.has(g.nomeNormalizado)
              const ocupado = mesclando === g.nomeNormalizado
              return (
                <section key={g.nomeNormalizado} className={`${styles.grupo} ${feito ? styles.grupoFeito : ''}`}>
                  <header className={styles.grupoTopo}>
                    <span className={styles.grupoNome}>{g.cadastros[0].name}</span>
                    <span className={styles.grupoContagem}>{g.cadastros.length} cadastros</span>
                  </header>

                  {feito ? (
                    <div className={styles.feito}><Check size={14} /> Mesclado</div>
                  ) : (
                    <>
                      <div className={styles.opcoes}>
                        {g.cadastros.map(c => (
                          <label key={c.id} className={styles.opcao}>
                            <input
                              type="radio"
                              name={`principal-${g.nomeNormalizado}`}
                              checked={escolhido[g.nomeNormalizado] === c.id}
                              onChange={() => setEscolhido(e => ({ ...e, [g.nomeNormalizado]: c.id }))}
                            />
                            <span className={styles.opcaoCorpo}>
                              <span className={styles.opcaoNome}>
                                {c.name}
                                <span className={styles.opcaoIniciais}>{c.initials}</span>
                                {!c.is_active && <span className={styles.tagInativo}>inativo</span>}
                              </span>
                              <span className={styles.opcaoMeta}>
                                {c.produtos} produto{c.produtos !== 1 ? 's' : ''}
                                {' · '}{c.compras} compra{c.compras !== 1 ? 's' : ''}
                                {c.consignacoes > 0 && <> · {c.consignacoes} consignação{c.consignacoes !== 1 ? 'ões' : ''}</>}
                                {' · criado em '}{c.created_at.slice(8, 10)}/{c.created_at.slice(5, 7)}/{c.created_at.slice(0, 4)}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>

                      <div className={styles.grupoAcao}>
                        <Button size="sm" onClick={() => mesclar(g)} loading={ocupado}>
                          <Merge size={14} />
                          Mesclar neste cadastro
                        </Button>
                      </div>
                    </>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}

      <div className={styles.rodape}>
        <Button variant="ghost" onClick={onClose}>
          {prontos.size > 0 && pendentes.length === 0 ? 'Concluir' : 'Fechar'}
        </Button>
      </div>
    </Modal>
  )
}
