// Os templates agora vêm dinâmicos da WABA (via listarTemplates em actions.ts).
// Aqui fica só o helper de pré-visualização do corpo.
export type { TemplateMeta } from './actions'

/** Substitui {{1}} {{2}} {{3}} pelo texto (ou mantém o placeholder se vazio). */
export function renderPreview(bodyText: string, p1: string, p2: string, p3: string): string {
  return (bodyText || '')
    .replaceAll('{{1}}', p1 || '{{1}}')
    .replaceAll('{{2}}', p2 || '{{2}}')
    .replaceAll('{{3}}', p3 || '{{3}}')
}
