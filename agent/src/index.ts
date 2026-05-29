import Fastify from 'fastify'
import cors from '@fastify/cors'
import { spawn } from 'node:child_process'
import { config, VERSION } from './config'
import { listPrinters, printRaw } from './printer'
import { setupTray, destroyTray } from './tray'

async function main() {
  const app = Fastify({
    logger: { level: process.env.FV_AGENT_LOG_LEVEL ?? 'info' },
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (config.allowedOrigins.length === 0) return cb(null, true)
      if (config.allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error('Origin não autorizada'), false)
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  // Private Network Access (Chrome/Edge): um site HTTPS público acessando
  // localhost (loopback) exige este header, senão o navegador bloqueia com
  // "Permission was denied ... loopback address space". Adicionamos em TODAS
  // as respostas (inclusive no preflight OPTIONS do @fastify/cors).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Access-Control-Allow-Private-Network', 'true')
    return payload
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!config.token) return
    if (req.method === 'OPTIONS') return
    const header = req.headers.authorization
    if (header !== `Bearer ${config.token}`) {
      reply.code(401).send({ ok: false, error: 'Unauthorized' })
    }
  })

  /* ---------------- Rotas ---------------- */

  app.get('/health', async () => ({
    ok: true,
    version: VERSION,
    agent: 'fv-print-agent',
    platform: process.platform,
  }))

  app.get('/printers', async () => ({
    ok: true,
    printers: await listPrinters(),
  }))

  interface PrintBody {
    printer: string
    jobBase64: string
    docName?: string
  }

  app.post<{ Body: PrintBody }>('/print', {
    schema: {
      body: {
        type: 'object',
        required: ['printer', 'jobBase64'],
        properties: {
          printer: { type: 'string', minLength: 1 },
          jobBase64: { type: 'string', minLength: 1 },
          docName: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { printer: printerName, jobBase64 } = req.body
    let data: Buffer
    try {
      data = Buffer.from(jobBase64, 'base64')
    } catch {
      return reply.code(400).send({ ok: false, error: 'jobBase64 inválido' })
    }
    if (data.length === 0) {
      return reply.code(400).send({ ok: false, error: 'job vazio' })
    }
    try {
      const written = await printRaw(printerName, data, req.body.docName ?? 'Etiquetas')
      return { ok: true, jobId: written, bytes: data.length }
    } catch (err) {
      req.log.error({ err }, 'Erro ao imprimir')
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  /* ---------------- Boot ---------------- */

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`fv-print-agent v${VERSION} ouvindo em http://${config.host}:${config.port}`)
    if (config.token) app.log.info('Auth: token Bearer obrigatório')
    else app.log.warn('Auth: nenhum token configurado (qualquer requisição local é aceita)')
    app.log.info(`Origins permitidas: ${config.allowedOrigins.join(', ') || '(qualquer)'}`)

    await setupTray({
      onRestart: () => {
        app.log.info('Reiniciando agente…')
        // Sobe uma nova instância destacada e encerra a atual
        spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref()
        destroyTray()
        process.exit(0)
      },
      onExit: () => {
        app.log.info('Encerrando agente (Sair na bandeja).')
        app.close().finally(() => process.exit(0))
      },
    })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Encerramento limpo
process.on('SIGINT', () => { destroyTray(); process.exit(0) })
process.on('SIGTERM', () => { destroyTray(); process.exit(0) })

// Blindagem: falhas do tray (ou qualquer async solto) NUNCA derrubam o servidor de impressão.
process.on('unhandledRejection', (reason) => {
  console.warn('[agente] unhandledRejection (ignorado):', reason)
})
process.on('uncaughtException', (err) => {
  console.warn('[agente] uncaughtException (ignorado):', (err as Error).message)
})

main()
