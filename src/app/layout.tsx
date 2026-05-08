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
      {/* Aplica o tema antes de qualquer render para evitar flash */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('fv-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
