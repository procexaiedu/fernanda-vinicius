import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Raiz do workspace fixada nesta pasta para o Turbopack não inferir a errada
// (existe um package-lock.json órfão em C:\Antigravity\Fernanda-vinicius).
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  allowedDevOrigins: ['192.168.56.1'],
}

export default nextConfig
