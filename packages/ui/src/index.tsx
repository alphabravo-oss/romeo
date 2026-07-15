import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`rm-button ${className}`.trim()} {...props} />
}

export function Panel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`rm-panel ${className}`.trim()} {...props} />
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rm-empty">
      <h2>{title}</h2>
      {children ? <div>{children}</div> : null}
    </div>
  )
}
