import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fernanda Vinícius',
  description: 'Sistema de gestão — Joias e Semi-Joias',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
