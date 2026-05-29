import { describe, it, expect } from 'vitest'
import { buildJob, formatPrecoBR, cp1252Encode, cp850Encode, transliterate, type LabelData } from './ppla'

/**
 * Apêndice A do IMPRESSAO_ETIQUETAS.md — 155 bytes, captura do Hiper para
 * 1 produto "P COLAR MOISSANITE" (ref FSO05429, R$ 1.072,00, código 15519).
 * O gerador deve bater BIT A BIT com isto.
 */
const APENDICE_A_HEX = `
6E 0A 02 4D 30 35 30 30 0A 02 4F 30 32 32 30 0A
02 56 30 0A 02 66 32 32 30 0A 01 44 0A 02 4C 0A
44 31 31 0A 41 32 0A 31 45 34 32 30 32 37 30 30
31 30 30 30 31 33 42 31 35 35 31 39 0A 31 39 31
31 41 30 38 30 30 33 35 30 31 31 30 50 20 43 4F
4C 41 52 20 4D 4F 49 53 53 41 4E 49 54 45 0A 31
39 31 31 41 30 38 30 30 32 33 30 31 31 30 46 53
4F 30 35 34 32 39 0A 31 39 31 31 41 31 30 30 30
30 37 30 31 31 30 52 24 20 31 2E 30 37 32 2C 30
30 0A 0A 51 30 30 30 31 0A 45 0A
`

/**
 * Apêndice B com a normalização que o doc valida (e que nosso script de
 * referência produz): SEM <STX> inicial e COM linha em branco antes do Q0001.
 * O Hiper original tem essas 2 diferenças mas a impressora aceita ambas
 * (doc confirma textualmente). Nosso gerador segue o estilo do script
 * PowerShell do Apêndice D, que foi testado fisicamente.
 *
 * Dados: 3 brincos —
 *   col 0: BRINCO CITRINO, FZA05599, R$ 188,00, 15521
 *   col 1: BRINCO STAR,    FZA05595, R$ 168,00, 15520
 *   col 2: BRINCO TORRE,   FSP0560,  R$ 422,00, 15522
 */
const APENDICE_B_NORMALIZADO_HEX = `
6E 0A 02 4D 30 35 30 30 0A 02 4F 30 32 32 30
0A 02 56 30 0A 02 66 32 32 30 0A 01 44 0A 02 4C
0A 44 31 31 0A 41 32 0A 31 39 31 31 41 30 36 30
30 35 38 30 30 31 35 42 52 49 4E 43 4F 20 43 49
54 52 49 4E 4F 0A 31 39 31 31 41 30 36 30 30 34
33 30 30 31 35 46 5A 41 30 35 35 39 39 0A 31 39
31 31 41 30 38 30 30 32 37 30 30 31 35 52 24 20
31 38 38 2C 30 30 0A 31 45 34 32 30 30 39 30 30
30 34 30 30 33 33 43 31 35 35 32 31 0A 31 39 31
31 41 30 36 30 30 35 38 30 31 34 32 42 52 49 4E
43 4F 20 53 54 41 52 0A 31 39 31 31 41 30 36 30
30 34 33 30 31 34 32 46 5A 41 30 35 35 39 35 0A
31 39 31 31 41 30 38 30 30 32 37 30 31 34 32 52
24 20 31 36 38 2C 30 30 0A 31 45 34 32 30 30 39
30 30 30 34 30 31 36 30 43 31 35 35 32 30 0A 31
39 31 31 41 30 36 30 30 35 38 30 32 37 30 42 52
49 4E 43 4F 20 54 4F 52 52 45 0A 31 39 31 31 41
30 36 30 30 34 33 30 32 37 30 46 53 50 30 35 36
30 0A 31 39 31 31 41 30 38 30 30 32 37 30 32 37
30 52 24 20 34 32 32 2C 30 30 0A 31 45 34 32 30
30 39 30 30 30 34 30 32 38 38 43 31 35 35 32 32
0A 0A 51 30 30 30 31 0A 45 0A
`

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0) throw new Error('Hex inválido (length ímpar)')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

describe('formatPrecoBR', () => {
  it('formata inteiros com separador de milhar', () => {
    expect(formatPrecoBR(1072)).toBe('1.072,00')
    expect(formatPrecoBR(188)).toBe('188,00')
    expect(formatPrecoBR(1234567.5)).toBe('1.234.567,50')
  })

  it('preserva 2 casas decimais', () => {
    expect(formatPrecoBR(89.9)).toBe('89,90')
    expect(formatPrecoBR(0.5)).toBe('0,50')
    expect(formatPrecoBR(99.99)).toBe('99,99')
  })
})

describe('cp1252Encode', () => {
  it('codifica ASCII como bytes idênticos', () => {
    expect(Array.from(cp1252Encode('ABC123'))).toEqual([0x41, 0x42, 0x43, 0x31, 0x32, 0x33])
  })

  it('codifica acentos pt-BR no byte único correto', () => {
    // 'ã' = U+00E3 → CP1252 0xE3 (mesma posição que ISO-8859-1)
    // 'ç' = U+00E7 → CP1252 0xE7
    expect(Array.from(cp1252Encode('ãç'))).toEqual([0xe3, 0xe7])
  })

  it('codifica € no byte 0x80', () => {
    expect(Array.from(cp1252Encode('€'))).toEqual([0x80])
  })
})

describe('cp850Encode (acentos pt-BR)', () => {
  it('codifica ASCII como bytes idênticos', () => {
    expect(Array.from(cp850Encode('ABC123'))).toEqual([0x41, 0x42, 0x43, 0x31, 0x32, 0x33])
  })

  it('codifica acentos minúsculos nos bytes CP850 corretos', () => {
    expect(Array.from(cp850Encode('á'))).toEqual([0xa0])
    expect(Array.from(cp850Encode('ç'))).toEqual([0x87])
    expect(Array.from(cp850Encode('ã'))).toEqual([0xc6])
    expect(Array.from(cp850Encode('õ'))).toEqual([0xe4])
  })

  it('codifica acentos maiúsculos nos bytes CP850 corretos', () => {
    expect(Array.from(cp850Encode('Á'))).toEqual([0xb5])
    expect(Array.from(cp850Encode('Ç'))).toEqual([0x80])
    expect(Array.from(cp850Encode('Ã'))).toEqual([0xc7])
    expect(Array.from(cp850Encode('Õ'))).toEqual([0xe5])
  })

  it('LILÁS em CP850', () => {
    // L I L Á S = 0x4C 0x49 0x4C 0xB5 0x53
    expect(Array.from(cp850Encode('LILÁS'))).toEqual([0x4c, 0x49, 0x4c, 0xb5, 0x53])
  })
})

describe('transliterate (plano B ASCII)', () => {
  it('remove acentos preservando a letra base', () => {
    expect(transliterate('Choker Lilás')).toBe('Choker Lilas')
    expect(transliterate('Coração')).toBe('Coracao')
    expect(transliterate('Pêssego')).toBe('Pessego')
    expect(transliterate('AÇÚCAR')).toBe('ACUCAR')
  })
})

describe('buildJob — maiúsculo automático', () => {
  it('converte nome e referência para maiúsculo', () => {
    const bytes = buildJob('A', [
      { name: 'Choker lilas', supplier_reference: 'fgs05', sale_price: 10, barcode_number: '11111' },
    ], 'ascii')
    const text = new TextDecoder('windows-1252').decode(bytes)
    expect(text).toContain('CHOKER LILAS')
    expect(text).toContain('FGS05')
    expect(text).not.toContain('Choker lilas')
  })

  it('CP850: nome com acento vira maiúsculo acentuado', () => {
    const bytes = buildJob('A', [
      { name: 'Choker Lilás', supplier_reference: 'FGS05', sale_price: 10, barcode_number: '11111' },
    ], 'cp850')
    // procura a sequência LILÁS codificada em CP850 (…0xB5…)
    const arr = Array.from(bytes)
    // 'LIL' + 0xB5 + 'S'
    const idx = arr.findIndex((b, i) =>
      b === 0x4c && arr[i+1] === 0x49 && arr[i+2] === 0x4c && arr[i+3] === 0xb5 && arr[i+4] === 0x53)
    expect(idx).toBeGreaterThan(-1)
  })
})

describe('buildJob — Layout A (90x13mm)', () => {
  it('bate bit a bit com o Apêndice A do doc', () => {
    const produtos: LabelData[] = [
      {
        name: 'P COLAR MOISSANITE',
        supplier_reference: 'FSO05429',
        sale_price: 1072.00,
        barcode_number: '15519',
      },
    ]
    const gerado = buildJob('A', produtos)
    const esperado = hexToBytes(APENDICE_A_HEX)

    if (bytesToHex(gerado) !== bytesToHex(esperado)) {
      // Mensagem de erro útil: compara byte a byte e aponta divergência
      const min = Math.min(gerado.length, esperado.length)
      for (let i = 0; i < min; i++) {
        if (gerado[i] !== esperado[i]) {
          throw new Error(
            `Divergência no byte ${i}: gerado=0x${gerado[i].toString(16)} ` +
              `esperado=0x${esperado[i].toString(16)}\n` +
              `Contexto gerado: ${bytesToHex(gerado.slice(Math.max(0, i - 4), i + 5))}\n` +
              `Contexto espera: ${bytesToHex(esperado.slice(Math.max(0, i - 4), i + 5))}`
          )
        }
      }
      throw new Error(`Tamanhos diferentes: gerado=${gerado.length} esperado=${esperado.length}`)
    }

    expect(gerado.length).toBe(155)
    expect(bytesToHex(gerado)).toBe(bytesToHex(esperado))
  })

  it('repete o format completo para múltiplos produtos (não usa Q0002)', () => {
    const produtos: LabelData[] = [
      { name: 'A', supplier_reference: 'R1', sale_price: 1, barcode_number: '00001' },
      { name: 'B', supplier_reference: 'R2', sale_price: 2, barcode_number: '00002' },
    ]
    const bytes = buildJob('A', produtos)
    const text = new TextDecoder('windows-1252').decode(bytes)
    // 2 ocorrências de "Q0001" — 1 por format
    expect((text.match(/Q0001/g) ?? []).length).toBe(2)
    // 2 ocorrências do "E\n" terminador
    expect((text.match(/E\n/g) ?? []).length).toBe(2)
  })
})

describe('buildJob — Layout B (30x18mm, 3 por linha)', () => {
  it('bate bit a bit com a versão normalizada do Apêndice B', () => {
    const produtos: LabelData[] = [
      { name: 'BRINCO CITRINO', supplier_reference: 'FZA05599', sale_price: 188.00, barcode_number: '15521' },
      { name: 'BRINCO STAR',    supplier_reference: 'FZA05595', sale_price: 168.00, barcode_number: '15520' },
      { name: 'BRINCO TORRE',   supplier_reference: 'FSP0560',  sale_price: 422.00, barcode_number: '15522' },
    ]
    const gerado = buildJob('B', produtos)
    const esperado = hexToBytes(APENDICE_B_NORMALIZADO_HEX)

    if (bytesToHex(gerado) !== bytesToHex(esperado)) {
      const min = Math.min(gerado.length, esperado.length)
      for (let i = 0; i < min; i++) {
        if (gerado[i] !== esperado[i]) {
          throw new Error(
            `Divergência no byte ${i}: gerado=0x${gerado[i].toString(16)} ` +
              `esperado=0x${esperado[i].toString(16)}\n` +
              `Contexto gerado: ${bytesToHex(gerado.slice(Math.max(0, i - 4), i + 5))}\n` +
              `Contexto espera: ${bytesToHex(esperado.slice(Math.max(0, i - 4), i + 5))}`
          )
        }
      }
      throw new Error(`Tamanhos diferentes: gerado=${gerado.length} esperado=${esperado.length}`)
    }

    expect(bytesToHex(gerado)).toBe(bytesToHex(esperado))
  })

  it('preenche 9 produtos em 3 formats (3 linhas físicas)', () => {
    const produtos: LabelData[] = Array.from({ length: 9 }, (_, i) => ({
      name: `BRINCO ${i + 1}`,
      supplier_reference: `REF${i + 1}`,
      sale_price: (i + 1) * 10,
      barcode_number: `1560${i + 1}`,
    }))
    const bytes = buildJob('B', produtos)
    const text = new TextDecoder('windows-1252').decode(bytes)
    expect((text.match(/Q0001/g) ?? []).length).toBe(3)
  })

  it('omite colunas vazias na última linha (8 produtos = 2 formats cheios + 1 com 2 colunas)', () => {
    const produtos: LabelData[] = Array.from({ length: 8 }, (_, i) => ({
      name: `BRINCO ${i + 1}`,
      supplier_reference: null,
      sale_price: 50,
      barcode_number: `1570${i + 1}`,
    }))
    const bytes = buildJob('B', produtos)
    const text = new TextDecoder('windows-1252').decode(bytes)
    // 3 formats (3 linhas) — Q0001 aparece 3x
    expect((text.match(/Q0001/g) ?? []).length).toBe(3)
    // Marcadores únicos por coluna: barcode-prefixo é exclusivo de cada coluna
    //   col 0 → '1E4200900040033C'
    //   col 1 → '1E4200900040160C'
    //   col 2 → '1E4200900040288C'
    const formats = text.split('E\n').slice(0, -1)
    const ultimoFormat = formats[formats.length - 1]
    expect(ultimoFormat).toContain('1E4200900040033C') // col 0 presente
    expect(ultimoFormat).toContain('1E4200900040160C') // col 1 presente
    expect(ultimoFormat).not.toContain('1E4200900040288C') // col 2 omitida
  })

  it('lida com supplier_reference null deixando a linha em branco', () => {
    const produtos: LabelData[] = [
      { name: 'X', supplier_reference: null, sale_price: 10, barcode_number: '11111' },
    ]
    const bytes = buildJob('B', produtos)
    const text = new TextDecoder('windows-1252').decode(bytes)
    // Linha de referência: prefixo + 0 chars de dados
    expect(text).toContain('1911A0600430015\n')
  })
})

describe('buildJob — erros', () => {
  it('rejeita lista vazia', () => {
    expect(() => buildJob('A', [])).toThrow('Nenhum produto para imprimir')
  })
})
