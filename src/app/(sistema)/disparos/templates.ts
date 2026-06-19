// Catálogo de templates aprovados na YCloud.
// Por enquanto há 1. Ao aprovar novos, adicione aqui (name = nome EXATO na YCloud,
// language = idioma EXATO do template, body = texto para a pré-visualização).
export interface TemplateDef {
  name: string
  label: string
  language: string
  /** Texto do corpo com {{1}} {{2}} {{3}} — usado só para o preview. */
  body: string
  footer?: string
}

export const TEMPLATES: TemplateDef[] = [
  {
    name: 'aviso_clientes_fevinicius',
    label: 'Aviso aos clientes (Utility)',
    language: 'pt_BR',
    body: 'Olá {{1}}, tudo bem? Aqui é a fevinicius. Estamos entrando em contato sobre {{2}}. {{3}} Qualquer dúvida, estamos à disposição.',
    footer: 'fevinicius',
  },
]

export function renderPreview(tpl: TemplateDef, p1: string, p2: string, p3: string): string {
  return tpl.body
    .replaceAll('{{1}}', p1 || '{{1}}')
    .replaceAll('{{2}}', p2 || '{{2}}')
    .replaceAll('{{3}}', p3 || '{{3}}')
}
