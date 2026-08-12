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
      {/*
        Aplica o tema antes de qualquer render para evitar flash.
        Invertido em 12/08/2026: o claro passou a ser o padrão, então o atributo
        só é marcado quando a preferência salva é 'dark'. Quem já tinha 'light'
        salvo continua no claro — que agora é o padrão de qualquer forma.
      */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('fv-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
