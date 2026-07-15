import X from 'lucide-react/dist/esm/icons/x.mjs'

import { useFocusTrap } from '../lib/use-focus-trap'

/**
 * Right-side detail sheet for row → detail flows (metadata, related data,
 * edit). Same backdrop + focus-trap behavior as the dialogs; slides in from
 * the right and keeps the list visible underneath. Controlled by the caller.
 *
 *   const [selected, setSelected] = useState<Row>()
 *   <Drawer open={selected !== undefined} title={selected?.name ?? ''} onClose={() => setSelected(undefined)}>
 *     …detail…
 *   </Drawer>
 */
export function Drawer(props: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
}): React.ReactNode {
  const { open, title, description, onClose, children } = props
  const ref = useFocusTrap({ active: open, onEscape: onClose })
  if (!open) return null

  return (
    <>
      <button aria-label="Close" className="rm-modal-backdrop" onClick={onClose} tabIndex={-1} type="button" />
      <div aria-labelledby="rm-drawer-title" aria-modal="true" className="rm-drawer" ref={ref} role="dialog">
        <header className="rm-drawer-head">
          <div className="min-w-0">
            <h2 className="rm-drawer-title" id="rm-drawer-title">
              {title}
            </h2>
            {description !== undefined ? <p className="rm-drawer-desc">{description}</p> : null}
          </div>
          <button aria-label="Close" className="rm-icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="rm-drawer-body">{children}</div>
      </div>
    </>
  )
}
