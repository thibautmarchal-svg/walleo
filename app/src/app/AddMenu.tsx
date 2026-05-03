import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, FileText, ScanLine, X } from 'lucide-react'

interface AddMenuProps {
  open: boolean
  onClose: () => void
}

export function AddMenu({ open, onClose }: AddMenuProps) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const goScan = (): void => {
    onClose()
    navigate('/scan')
  }
  const goImport = (): void => {
    onClose()
    navigate('/import')
  }
  const goForm = (): void => {
    onClose()
    navigate('/add')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-label="Ajouter une carte"
        className="relative w-full max-w-md rounded-t-3xl bg-card p-5 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Ajouter une carte</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <MenuItem
            icon={<ScanLine className="h-5 w-5" />}
            label="Scanner avec la caméra"
            hint="Flashe un QR ou un code-barres en direct."
            onClick={goScan}
            primary
          />
          <MenuItem
            icon={<FileText className="h-5 w-5" />}
            label="Coller un email / PDF"
            hint="Ticketmaster, FNAC, See Tickets, SNCF…"
            onClick={goImport}
          />
          <MenuItem
            icon={<Camera className="h-5 w-5" />}
            label="Saisir / importer une image"
            hint="Photos, screenshots ou saisie manuelle."
            onClick={goForm}
          />
        </div>
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  primary = false,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
        primary
          ? 'border-walleo-yellow bg-walleo-yellow/10'
          : 'border-border bg-secondary/40'
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          primary
            ? 'bg-walleo-yellow text-walleo-black'
            : 'bg-secondary text-foreground'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </button>
  )
}
