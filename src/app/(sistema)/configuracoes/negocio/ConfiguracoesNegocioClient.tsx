'use client'

import { useState, useCallback } from 'react'
import { CreditCard, Tag, TrendingUp, Check, AlertCircle } from 'lucide-react'
import Button from '@/components/ui/Button'
import type { SettingRow } from './page'
import { updateSetting } from './actions'
import styles from './ConfiguracoesNegocioClient.module.css'

// ─── Definição estática das seções ────────────────────────────────────────────

interface SettingDef {
  key: string
  label: string
  unit: string
  unitPosition: 'prefix' | 'suffix'
  min: number
  max: number
  step: number
  hint: string
}

interface SectionDef {
  id: string
  title: string
  description: string
  icon: React.ElementType
  settings: SettingDef[]
}

const SECTIONS: SectionDef[] = [
  {
    id: 'pagamentos',
    title: 'Pagamentos',
    description: 'Regras de desconto e parcelamento aplicadas automaticamente no PDV.',
    icon: CreditCard,
    settings: [
      {
        key: 'pix_discount_pct',
        label: 'Desconto Pix',
        unit: '%', unitPosition: 'suffix',
        min: 0, max: 100, step: 0.5,
        hint: 'Percentual concedido automaticamente em pagamentos via Pix.',
      },
      {
        key: 'max_installments_default',
        label: 'Máx. parcelas padrão',
        unit: 'x', unitPosition: 'suffix',
        min: 1, max: 24, step: 1,
        hint: 'Limite de parcelas sem juros para compras abaixo do valor limite.',
      },
      {
        key: 'max_installments_above_3k',
        label: 'Máx. parcelas acima do limite',
        unit: 'x', unitPosition: 'suffix',
        min: 1, max: 24, step: 1,
        hint: 'Limite de parcelas para compras que excedem o valor limite abaixo.',
      },
      {
        key: 'installment_threshold',
        label: 'Limite para parcelas extras',
        unit: 'R$', unitPosition: 'prefix',
        min: 0, max: 999999, step: 100,
        hint: 'Valor de compra a partir do qual o máximo de parcelas aumenta.',
      },
    ],
  },
  {
    id: 'politicas',
    title: 'Políticas de Venda',
    description: 'Regras comerciais aplicadas automaticamente no atendimento ao cliente.',
    icon: Tag,
    settings: [
      {
        key: 'birthday_discount_pct',
        label: 'Desconto aniversário',
        unit: '%', unitPosition: 'suffix',
        min: 0, max: 100, step: 0.5,
        hint: 'Desconto automático para clientes que comprarem no mês do aniversário.',
      },
      {
        key: 'exchange_deadline_days',
        label: 'Prazo de troca',
        unit: 'dias', unitPosition: 'suffix',
        min: 1, max: 365, step: 1,
        hint: 'Janela de tempo após a venda dentro da qual uma troca é aceita.',
      },
    ],
  },
  {
    id: 'precificacao',
    title: 'Precificação',
    description: 'Parâmetros para sugestão automática de preços ao cadastrar produtos.',
    icon: TrendingUp,
    settings: [
      {
        key: 'default_markup_pct',
        label: 'Markup padrão de venda',
        unit: '%', unitPosition: 'suffix',
        min: 0, max: 10000, step: 10,
        hint: 'Percentual sobre o custo usado para sugerir o preço de venda ao cadastrar um produto.',
      },
    ],
  },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingRow[]
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ConfiguracoesNegocioClient({ settings }: Props) {
  // rawValues armazena a string do input (permite campo vazio enquanto o usuário digita)
  // numericValues armazena o último valor numérico válido (usado no save)
  const initialRaw = Object.fromEntries(settings.map(s => [s.key, String(s.value)]))
  const initialNumeric = Object.fromEntries(settings.map(s => [s.key, s.value]))
  const [rawValues, setRawValues] = useState<Record<string, string>>(initialRaw)
  const [numericValues, setNumericValues] = useState<Record<string, number>>(initialNumeric)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = useCallback((key: string, raw: string) => {
    // Sempre atualiza o raw para permitir campo vazio durante digitação
    setRawValues(prev => ({ ...prev, [key]: raw }))
    // Só atualiza o numérico se for válido
    const n = parseFloat(raw)
    if (!isNaN(n)) setNumericValues(prev => ({ ...prev, [key]: n }))
  }, [])

  const handleSave = useCallback(async (section: SectionDef) => {
    setSaving(prev => new Set([...prev, section.id]))
    setErrors(prev => { const n = { ...prev }; delete n[section.id]; return n })

    const results = await Promise.all(
      section.settings.map(s => updateSetting(s.key, numericValues[s.key] ?? 0))
    )
    const failed = results.find(r => !r.success)

    if (failed) {
      setErrors(prev => ({ ...prev, [section.id]: failed.error ?? 'Erro ao salvar.' }))
    } else {
      setSaved(prev => new Set([...prev, section.id]))
      setTimeout(() => setSaved(prev => {
        const n = new Set(prev); n.delete(section.id); return n
      }), 2500)
    }

    setSaving(prev => { const n = new Set(prev); n.delete(section.id); return n })
  }, [numericValues])

  return (
    <div className={styles.sections}>
      {SECTIONS.map(section => {
        const Icon = section.icon
        const isSaving = saving.has(section.id)
        const isSaved = saved.has(section.id)
        const sectionError = errors[section.id]

        return (
          <div key={section.id} className={styles.card}>
            {/* Cabeçalho da seção */}
            <div className={styles.cardHeader}>
              <div className={styles.cardIconWrap}>
                <Icon size={16} className={styles.cardIcon} />
              </div>
              <div>
                <div className={styles.cardTitle}>{section.title}</div>
                <div className={styles.cardDesc}>{section.description}</div>
              </div>
            </div>

            {/* Linhas de configuração */}
            <div className={styles.settingsList}>
              {section.settings.map(def => {
                return (
                  <div key={def.key} className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>{def.label}</span>
                      <span className={styles.settingHint}>{def.hint}</span>
                    </div>
                    <div className={styles.inputWrap}>
                      {def.unitPosition === 'prefix' && (
                        <span className={styles.unit}>{def.unit}</span>
                      )}
                      <input
                        type="number"
                        className={styles.input}
                        value={rawValues[def.key] ?? ''}
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        onChange={e => handleChange(def.key, e.target.value)}
                      />
                      {def.unitPosition === 'suffix' && (
                        <span className={styles.unit}>{def.unit}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Rodapé da seção */}
            <div className={styles.cardFooter}>
              {sectionError && (
                <span className={styles.errorMsg}>
                  <AlertCircle size={13} />
                  {sectionError}
                </span>
              )}
              {isSaved && !sectionError && (
                <span className={styles.savedMsg}>
                  <Check size={13} />
                  Salvo com sucesso
                </span>
              )}
              {!isSaved && !sectionError && <span />}
              <Button
                variant="primary"
                size="sm"
                loading={isSaving}
                onClick={() => handleSave(section)}
              >
                Salvar
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
