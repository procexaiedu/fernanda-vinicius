'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AtSign, AlertTriangle, Plus, Trash2, MessageCircle, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { createSupplier, updateSupplier, type SupplierFormData, type SupplierPhone } from './actions'
import type { SupplierWithCount } from './page'
import styles from './FornecedorFormModal.module.css'

interface NominatimResult {
  display_name: string
  address: {
    road?: string
    house_number?: string
    suburb?: string
    neighbourhood?: string
    quarter?: string
    city?: string
    town?: string
    village?: string
    state?: string
    postcode?: string
  }
}

const STATE_ABBR: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
  'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
  'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
  'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
  'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
}

const BR_STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
  'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
  'RS','RO','RR','SC','SP','SE','TO',
]

function formatCNPJ(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2)  return d
  if (d.length <= 5)  return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8)  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2)  return d.length ? `(${d}` : ''
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

function formatCEP(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0,5)}-${d.slice(5)}`
}

function validateCNPJ(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return false
  if (/^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0; let pos = len - 7
    for (let i = len; i >= 1; i--) {
      sum += parseInt(d.charAt(len - i)) * pos--
      if (pos < 2) pos = 9
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11)
  }
  return calc(12) === parseInt(d.charAt(12)) && calc(13) === parseInt(d.charAt(13))
}

const emptyForm: SupplierFormData = {
  name: '', initials: '', contact_name: '', phones: [],
  instagram: '', email: '', cnpj: '', accepts_consignment: false,
  address: '', neighborhood: '', city: 'São Paulo', state: 'SP', zip_code: '', notes: '',
}

interface Props {
  supplier: SupplierWithCount | null
  allInitials: { id: string; name: string; initials: string }[]
  onClose: () => void
}

export default function FornecedorFormModal({ supplier, allInitials, onClose }: Props) {
  const [form, setForm] = useState<SupplierFormData>(
    supplier ? {
      name:                supplier.name,
      initials:            supplier.initials,
      contact_name:        supplier.contact_name ?? '',
      phones:              supplier.phones ?? [],
      instagram:           supplier.instagram ?? '',
      email:               supplier.email ?? '',
      cnpj:                supplier.cnpj ?? '',
      accepts_consignment: supplier.accepts_consignment,
      address:             supplier.address ?? '',
      neighborhood:        supplier.neighborhood ?? '',
      city:                supplier.city ?? 'São Paulo',
      state:               supplier.state ?? 'SP',
      zip_code:            supplier.zip_code ?? '',
      notes:               supplier.notes ?? '',
    } : emptyForm
  )
  const [errors, setErrors] = useState<Partial<Record<keyof SupplierFormData, string>>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [dupeWarning, setDupeWarning] = useState<string | null>(null)
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)
  const [addressSuggestions, setAddressSuggestions] = useState<NominatimResult[]>([])
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false)
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)
  const addressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detectar iniciais duplicadas
  useEffect(() => {
    if (!form.initials) { setDupeWarning(null); return }
    const key = form.initials.toUpperCase()
    const match = allInitials.find(s => s.initials.toUpperCase() === key)
    setDupeWarning(match
      ? `As iniciais "${key}" já estão em uso por: ${match.name}. Os códigos de produto podem ficar ambíguos.`
      : null
    )
  }, [form.initials, allInitials])

  const set = useCallback(<K extends keyof SupplierFormData>(key: K, value: SupplierFormData[K]) => {
    setForm(f => ({ ...f, [key]: value }))
  }, [])

  // ─── ViaCEP lookup ───────────────────────────────────────────
  async function handleCEPChange(raw: string) {
    const formatted = formatCEP(raw)
    set('zip_code', formatted)
    setCepError(null)

    const digits = raw.replace(/\D/g, '')
    if (digits.length !== 8) return

    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) {
        setCepError('CEP não encontrado.')
      } else {
        setForm(f => ({
          ...f,
          zip_code:     formatted,
          address:      data.logradouro || f.address,
          neighborhood: data.bairro     || f.neighborhood,
          city:         data.localidade || f.city,
          state:        data.uf         || f.state,
        }))
      }
    } catch {
      setCepError('Erro ao buscar CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  // ─── Busca de endereço por texto (Nominatim) ─────────────────
  function handleAddressInput(value: string) {
    set('address', value)
    if (addressTimerRef.current) clearTimeout(addressTimerRef.current)
    if (!value || value.length < 5) {
      setAddressSuggestions([])
      setShowAddressSuggestions(false)
      return
    }
    addressTimerRef.current = setTimeout(async () => {
      setIsSearchingAddress(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&countrycodes=br&addressdetails=1&limit=5&accept-language=pt-BR`,
        )
        const data: NominatimResult[] = await res.json()
        setAddressSuggestions(data)
        setShowAddressSuggestions(data.length > 0)
      } catch {
        setAddressSuggestions([])
      } finally {
        setIsSearchingAddress(false)
      }
    }, 450)
  }

  function selectAddressSuggestion(item: NominatimResult) {
    const { road, house_number, suburb, neighbourhood, quarter, city, town, village, state, postcode } = item.address
    const street = [road, house_number].filter(Boolean).join(', ')
    const nbhd = suburb || neighbourhood || quarter || ''
    const cityName = city || town || village || ''
    const stateAbbr = state ? (STATE_ABBR[state] || state) : form.state
    const zip = postcode ? formatCEP(postcode.replace(/\D/g, '')) : form.zip_code
    setForm(f => ({
      ...f,
      address:      street || f.address,
      neighborhood: nbhd   || f.neighborhood,
      city:         cityName || f.city,
      state:        stateAbbr,
      zip_code:     zip,
    }))
    setShowAddressSuggestions(false)
  }

  // ─── Gerenciamento de telefones ──────────────────────────────
  function addPhone() {
    setForm(f => ({ ...f, phones: [...f.phones, { number: '', is_whatsapp: false }] }))
  }

  function removePhone(idx: number) {
    setForm(f => ({ ...f, phones: f.phones.filter((_, i) => i !== idx) }))
  }

  function updatePhone(idx: number, number: string) {
    setForm(f => ({
      ...f,
      phones: f.phones.map((p, i) => i === idx ? { ...p, number: formatPhone(number) } : p),
    }))
  }

  function toggleWhatsApp(idx: number) {
    setForm(f => ({
      ...f,
      phones: f.phones.map((p, i) => ({ ...p, is_whatsapp: i === idx ? !p.is_whatsapp : p.is_whatsapp })),
    }))
  }

  const isSinglePhone = form.phones.length === 1

  function validate(): boolean {
    const e: Partial<Record<keyof SupplierFormData, string>> = {}
    if (!form.name.trim()) e.name = 'Nome é obrigatório.'
    if (!form.initials.trim()) e.initials = 'Iniciais são obrigatórias.'
    if (form.initials.length > 2) e.initials = 'Máximo 2 caracteres.'
    if (form.cnpj && form.cnpj.replace(/\D/g,'').length > 0 && !validateCNPJ(form.cnpj))
      e.cnpj = 'CNPJ inválido.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = 'E-mail inválido.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    setActionError(null)
    const result = supplier
      ? await updateSupplier(supplier.id, form)
      : await createSupplier(form)
    setIsSubmitting(false)
    if (!result.success) { setActionError(result.error ?? 'Erro ao salvar.'); return }
    onClose()
    window.location.reload()
  }

  return (
    <Modal isOpen onClose={onClose} title={supplier ? 'Editar Fornecedor' : 'Novo Fornecedor'} size="lg">
      <form onSubmit={handleSubmit} className={styles.form} noValidate>

        {/* Nome + Iniciais */}
        <div className={styles.row}>
          <div className={styles.flex2}>
            <Input label="Nome *" value={form.name}
              onChange={e => set('name', e.target.value)} error={errors.name}
              placeholder="Ex: Moda Joia Atacado" autoFocus />
          </div>
          <div className={styles.initialsCol}>
            <Input label="Iniciais *" value={form.initials}
              onChange={e => set('initials', e.target.value.toUpperCase().slice(0, 2))}
              error={errors.initials} placeholder="MJ" maxLength={2} />
          </div>
        </div>

        {dupeWarning && (
          <div className={styles.dupeAlert}>
            <AlertTriangle size={14} />
            <span>{dupeWarning}</span>
          </div>
        )}

        {/* Responsável + Consignação */}
        <div className={styles.row}>
          <div className={styles.flex2}>
            <Input label="Responsável / Contato" value={form.contact_name}
              onChange={e => set('contact_name', e.target.value)} placeholder="Nome do contato" />
          </div>
          <div className={styles.flex1}>
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={form.accepts_consignment}
                onChange={e => set('accepts_consignment', e.target.checked)} className={styles.toggleInput} />
              Aceita consignação
            </label>
          </div>
        </div>

        {/* Telefones dinâmicos */}
        <div className={styles.fieldGroup}>
          <div className={styles.phonesHeader}>
            <label className={styles.fieldLabel}>Telefones</label>
            <button type="button" className={styles.addPhoneBtn} onClick={addPhone}>
              <Plus size={12} /> Adicionar
            </button>
          </div>
          {form.phones.length === 0 ? (
            <p className={styles.phonesEmpty}>Nenhum telefone adicionado.</p>
          ) : (
            <div className={styles.phonesList}>
              {form.phones.map((phone, idx) => (
                <div key={idx} className={styles.phoneRow}>
                  <input
                    className={styles.phoneInput}
                    value={phone.number}
                    onChange={e => updatePhone(idx, e.target.value)}
                    placeholder="(11) 99999-9999"
                    maxLength={15}
                  />
                  {isSinglePhone ? (
                    <span className={styles.waAuto} title="Único número — considerado WhatsApp automaticamente">
                      <MessageCircle size={15} />
                    </span>
                  ) : (
                    <button type="button"
                      className={`${styles.waToggle} ${phone.is_whatsapp ? styles.waActive : ''}`}
                      onClick={() => toggleWhatsApp(idx)}
                      title={phone.is_whatsapp ? 'É WhatsApp (clique para remover)' : 'Marcar como WhatsApp'}
                    >
                      <MessageCircle size={15} />
                    </button>
                  )}
                  <button type="button" className={styles.removePhoneBtn}
                    onClick={() => removePhone(idx)} title="Remover">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {form.phones.length > 1 && (
                <p className={styles.waHint}>
                  Clique em <MessageCircle size={11} style={{ display:'inline', verticalAlign:'middle' }} /> para marcar qual número é WhatsApp.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Instagram + Email */}
        <div className={styles.row}>
          <div className={styles.flex1}>
            <div className={styles.inputWithIcon}>
              <AtSign size={14} className={styles.inputIcon} />
              <Input label="Instagram" value={form.instagram}
                onChange={e => {
                  const v = e.target.value
                  set('instagram', v && !v.startsWith('@') ? `@${v}` : v)
                }}
                placeholder="@fornecedor" />
            </div>
          </div>
          <div className={styles.flex1}>
            <Input label="E-mail" type="email" value={form.email}
              onChange={e => set('email', e.target.value)} error={errors.email}
              placeholder="contato@fornecedor.com" />
          </div>
        </div>

        {/* CNPJ */}
        <Input label="CNPJ" value={form.cnpj}
          onChange={e => set('cnpj', formatCNPJ(e.target.value))}
          error={errors.cnpj} placeholder="00.000.000/0000-00" maxLength={18} />

        {/* Endereço — CEP primeiro, ViaCEP preenche o resto */}
        <div className={styles.row}>
          <div className={styles.cepCol}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                CEP
                {cepLoading && <Loader2 size={12} className={styles.cepSpinner} />}
              </label>
              <input
                className={`${styles.addressInput} ${cepError ? styles.addressInputError : ''}`}
                value={form.zip_code}
                onChange={e => handleCEPChange(e.target.value)}
                placeholder="00000-000"
                maxLength={9}
              />
              {cepError && <span className={styles.cepErrorMsg}>{cepError}</span>}
            </div>
          </div>
          <div className={styles.flex2}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                Logradouro
                {isSearchingAddress && <Loader2 size={12} className={styles.cepSpinner} />}
              </label>
              <div className={styles.addressWrapper}>
                <input
                  className={styles.addressInput}
                  value={form.address}
                  onChange={e => handleAddressInput(e.target.value)}
                  placeholder="Rua, número — ou comece a digitar para buscar"
                  onBlur={() => setTimeout(() => setShowAddressSuggestions(false), 150)}
                  autoComplete="off"
                />
                {showAddressSuggestions && (
                  <div className={styles.addressSuggestions}>
                    {addressSuggestions.map((item, i) => (
                      <button
                        key={i}
                        type="button"
                        className={styles.addressSuggestionItem}
                        onMouseDown={() => selectAddressSuggestion(item)}
                      >
                        {item.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.flex2}>
            <Input label="Bairro" value={form.neighborhood}
              onChange={e => set('neighborhood', e.target.value)} placeholder="Bairro" />
          </div>
          <div className={styles.flex1}>
            <Input label="Cidade" value={form.city}
              onChange={e => set('city', e.target.value)} placeholder="São Paulo" />
          </div>
          <div className={styles.stateCol}>
            <label className={styles.selectLabel} htmlFor="supplier-state">Estado</label>
            <select id="supplier-state" className={styles.select}
              value={form.state} onChange={e => set('state', e.target.value)}>
              {BR_STATES.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>

        {/* Notas */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Observações</label>
          <textarea className={styles.textarea} value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Condições especiais, produtos que trabalha, observações..."
            rows={3} />
        </div>

        {actionError && <p className={styles.actionError}>{actionError}</p>}

        <div className={styles.footer}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button type="submit" loading={isSubmitting}>
            {supplier ? 'Salvar Alterações' : 'Criar Fornecedor'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
