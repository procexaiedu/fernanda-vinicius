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
        Aplica tema E estado da sidebar antes de qualquer render, para evitar flash.

        O escuro voltou a ser o padrao em 12/08/2026 (a versao clara ficou sem vida),
        entao o atributo marca so o tema claro.

        `data-sidebar` existe porque a prioridade de colunas das tabelas depende da
        largura da AREA DE CONTEUDO, nao da janela: a sidebar come 240px aberta ou
        64px fechada. Sem saber disso antes do primeiro paint, a tabela nasceria
        transbordando e se ajustaria depois — visivel como um tranco.
        A regra aqui repete a do layout-client: <=1366px recolhe sozinha.
      */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('fv-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');var c=window.matchMedia('(max-width: 1366px)').matches||localStorage.getItem('fv-sidebar-collapsed')==='true';document.documentElement.setAttribute('data-sidebar',c?'collapsed':'expanded');}catch(e){}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
