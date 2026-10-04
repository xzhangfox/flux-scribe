import { useEffect } from 'react'
import { ThemePicker } from './ThemePicker'
import { OtherApps } from './OtherApps'
import { IconX } from './icons'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label="Settings">
      <div className="glass-strong fade-up w-full max-w-lg space-y-7 rounded-t-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-white/10 hover:text-white">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <ThemePicker />
        <OtherApps />
        <p className="text-xs leading-relaxed text-muted">
          Recordings and transcripts are stored only in this browser. Audio is sent to Google Gemini once, for transcription, and deleted from it straight after.
        </p>
      </div>
    </div>
  )
}
