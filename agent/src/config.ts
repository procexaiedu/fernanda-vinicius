/**
 * Configuração do agente — sobrescrevível via variáveis de ambiente.
 * Defaults pensados para "instalou e rodou" sem mexer em arquivo.
 */
export const config = {
  port: parseInt(process.env.FV_AGENT_PORT ?? '17777', 10),
  host: process.env.FV_AGENT_HOST ?? '127.0.0.1',

  /**
   * Origins autorizadas. Produção: fevinicius.procexai.tech. localhost:3000 só dev.
   * Vazio = permite qualquer origin (CUIDADO — pra debug local apenas).
   */
  allowedOrigins: (process.env.FV_AGENT_ORIGINS ?? 'https://fevinicius.procexai.tech,http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean),

  /** URL do sistema (usada pelo atalho "Abrir configurações" da bandeja). */
  systemUrl: process.env.FV_AGENT_SYSTEM_URL ?? 'https://fevinicius.procexai.tech',

  /**
   * Token opcional. Se definido, `Authorization: Bearer <token>` é obrigatório.
   * Recomendado quando o agente é exposto na rede da loja (não só localhost).
   */
  token: process.env.FV_AGENT_TOKEN ?? null,
} as const

export const VERSION = '0.1.0'
