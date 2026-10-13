/**
 * Regras da limpeza da lista de disparo (13/10/2026). Só decide; quem grava é
 * scripts/disparo-carga-exclusoes.mjs, e só em fv.disparo_exclusoes (nunca em
 * fv.customers).
 *
 * Conservador: só exclui no que é inequívoco. Na dúvida devolve `revisar`,
 * que vai para um CSV à parte e NÃO entra na lista.
 *
 *   emergencia           190/192/0800/4004... (serviço, central)
 *   invalido             número curto ou malformado (o envio já recusaria)
 *   sem_nome_utilizavel  o {{1}} não sai: a MESMA função do envio
 *                        (src/lib/nomeProprio.ts#primeiroNomeParaSaudacao) devolve null
 *   lugar                nome com palavra forte de estabelecimento (ltda, farmácia,
 *                        pizzaria...) e que NÃO comprou na loja
 *
 *   fixo_sem_whatsapp    telefone fixo (decisão do dono, 13/10/2026)
 *   estrangeiro          número de fora do Brasil (o envio só aceita +55)
 *
 * Vão para revisar: palavra fraca de lugar ("Maria Salão"), lugar que já
 * comprou, nome que começa por inicial solta.
 *
 * Roda com Node 23.6+ (importa o .ts direto, sem build).
 */

import { primeiroNomeParaSaudacao } from '../src/lib/nomeProprio.ts'

const sem = s => (s ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
const palavras = s => ' ' + sem(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' '

// Forte: excluir. Termo que quase só aparece em nome de estabelecimento.
const LUGAR_FORTE = [
  'loja', 'lojas', 'mercado', 'supermercado', 'minimercado', 'mercearia', 'hortifruti', 'acougue',
  'farmacia', 'drogaria', 'clinica', 'consultorio', 'laboratorio', 'hospital', 'odonto', 'odontologia',
  'escritorio', 'empresa', 'ltda', 'eireli', 'restaurante', 'pizzaria', 'padaria', 'panificadora',
  'lanchonete', 'churrascaria', 'hamburgueria', 'sorveteria', 'confeitaria', 'imobiliaria',
  'contabilidade', 'advocacia', 'cartorio', 'distribuidora', 'transportadora', 'condominio', 'portaria',
  'autopecas', 'auto pecas', 'oficina', 'borracharia', 'lava jato', 'lavajato', 'posto', 'hotel', 'pousada',
  'motel', 'vidracaria', 'serralheria', 'marcenaria', 'chaveiro', 'lavanderia', 'dedetizadora',
  'academia', 'petshop', 'pet shop', 'veterinaria', 'otica', 'papelaria', 'floricultura',
  'agropecuaria', 'material de construcao', 'construtora', 'seguradora', 'corretora', 'ifood',
]
// Fraco: pode ser pessoa ("Maria Salão", "João ME", "Jaci Vendedora"). Vai para revisar.
const LUGAR_FRACO = [
  'me', 'salao', 'banco', 'escola', 'colegio', 'igreja', 'comercio', 'studio', 'estudio', 'atelie',
  'boutique', 'store', 'shop', 'moda', 'modas', 'fornecedor', 'fornecedora', 'motoboy', 'taxi', 'uber',
  'delivery', 'entrega', 'joias', 'semijoias', 'acessorios', 'representante', 'vendedor', 'vendedora',
  'atacado', 'buffet', 'grafica', 'cabeleireiro', 'cabeleireira', 'manicure', 'barbearia', 'esmalteria',
  'cafe', 'eletrica', 'cameras', 'luxury', 'beauty', 'gourmet', 'sistema',
]

const EMERGENCIA = new Set(['100', '128', '153', '180', '181', '188', '190', '191', '192', '193', '194', '197', '198', '199'])

function achar(lista, nome) {
  const p = palavras(nome)
  return lista.find(t => p.includes(' ' + t + ' '))
}

/** @returns {{ acao: 'excluir'|'revisar'|'manter', motivo?: string, detalhe?: string }} */
export function classificar(nome, telefone, comprou = false) {
  const bruto = (telefone ?? '').trim()
  const d = bruto.replace(/\D/g, '')
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d

  // (b) emergência / serviço
  if (EMERGENCIA.has(d) || EMERGENCIA.has(local)) return { acao: 'excluir', motivo: 'emergencia', detalhe: `número de emergência ${local}` }
  if (/^0?(800|300|500|900)\d{6,7}$/.test(local)) return { acao: 'excluir', motivo: 'emergencia', detalhe: 'número 0800/0300 (serviço)' }
  if (/^(4004|4003|4020|4002|3003|3004)\d{4}$/.test(local)) return { acao: 'excluir', motivo: 'emergencia', detalhe: 'número 4004/3003 (central)' }

  // número que não é celular BR
  if (bruto.startsWith('+') && !d.startsWith('55') && d.length >= 10) {
    return { acao: 'excluir', motivo: 'estrangeiro', detalhe: `número estrangeiro (+${d.slice(0, 3)}...); o envio só aceita Brasil` }
  }
  if (local.length < 10) return { acao: 'excluir', motivo: 'invalido', detalhe: `número curto (${local.length} dígitos), não é celular` }
  if (local.length > 11) return { acao: 'excluir', motivo: 'invalido', detalhe: `número malformado (${local.length} dígitos)` }
  if (local[0] === '0' || local[1] === '0') return { acao: 'excluir', motivo: 'invalido', detalhe: 'DDD inválido' }
  if (local.length === 11 && local[2] !== '9') return { acao: 'excluir', motivo: 'invalido', detalhe: 'número malformado (11 dígitos sem o 9 de celular)' }
  if (local.length === 10 && /[2-5]/.test(local[2])) {
    return { acao: 'excluir', motivo: 'fixo_sem_whatsapp', detalhe: 'telefone fixo' }
  }

  // (c) sem primeiro nome utilizável: decide a mesma função que monta o {{1}}
  const n = (nome ?? '').trim()
  const primeiro = primeiroNomeParaSaudacao(n)
  if (!primeiro) {
    const det = !n ? 'nome vazio' : !/\p{L}/u.test(n) ? 'nome só com número/símbolo' : `nome genérico "${n}"`
    return { acao: 'excluir', motivo: 'sem_nome_utilizavel', detalhe: det }
  }

  // (a) lugar
  const forte = achar(LUGAR_FORTE, n)
  if (forte && comprou) return { acao: 'revisar', motivo: 'lugar', detalhe: `nome com "${forte}", mas já comprou na loja` }
  if (forte) return { acao: 'excluir', motivo: 'lugar', detalhe: `nome com "${forte}"` }
  const fraco = achar(LUGAR_FRACO, n)
  if (fraco) return { acao: 'revisar', motivo: 'lugar', detalhe: `nome com "${fraco}" (pode ser pessoa)` }

  // Começa por inicial solta ("M. Souza"): a saudação sairia com o sobrenome.
  const partes = n.split(/[(/|]/)[0].trim().split(/\s+/)
  const soletrado = partes.length >= 3 && partes.every(p => p.replace(/[^\p{L}]/gu, '').length === 1)
  if (!soletrado && partes[0].replace(/[^\p{L}]/gu, '').length === 1) {
    return { acao: 'revisar', motivo: 'sem_nome_utilizavel', detalhe: `começa com inicial; sairia "Oi ${primeiro}"` }
  }

  return { acao: 'manter', primeiro }
}
