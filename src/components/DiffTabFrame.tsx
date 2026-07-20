import type { ReactNode } from 'react'

// The chrome every standalone diff tab shares (ADR-0026): a full-window dark
// frame with a header bar and a scrolling body. Each page fills the header with
// its own subject and metadata and drops its content into the body.

export function DiffTabFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col bg-canvas font-sans text-[13px] text-fg">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raised px-4 py-2.5">
        {header}
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
    </div>
  )
}
