import { useEffect } from 'react'

// A confirmation for actions that can't be undone, in the app's own sheet
// style (the browser's confirm() can't be themed, and some in-app browsers
// block it).
export function ConfirmSheet({ title, body, action, danger = true, onConfirm, onCancel }: { title: string; body: string; action: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onCancel} role="alertdialog" aria-modal aria-label={title}>
      <div className="glass-strong fade-up w-full max-w-sm space-y-5 rounded-t-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="glass flex-1 rounded-2xl py-3 text-sm font-semibold">
            Cancel
          </button>
          <button type="button" autoFocus onClick={onConfirm} className={`flex-1 rounded-2xl py-3 text-sm font-bold active:scale-[0.98] ${danger ? 'bg-danger text-white' : 'bg-primary text-black'}`}>
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}
