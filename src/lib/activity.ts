// While meetings are being processed: the tab title shows progress (handy
// when Scribe is in a background tab), the screen is kept awake while
// Scribe is on screen (a phone that locks itself suspends the page), and a
// notification says when the minutes are ready if you've switched away.

type WakeLock = { release: () => Promise<void> }
let base = ''
let lock: WakeLock | null = null
const busy = new Map<string, string>()

async function holdScreen() {
  if (!busy.size || lock || document.hidden) return
  try {
    lock = (await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } }).wakeLock?.request('screen')) ?? null
    ;(lock as unknown as EventTarget | null)?.addEventListener?.('release', () => (lock = null))
  } catch {
    lock = null
  }
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Back on screen: the browser released the wake lock when we left.
      void holdScreen()
      if (!busy.size && base) {
        document.title = base
        base = ''
      }
    }
  })

export function setBusy(id: string, label: string) {
  if (!base) base = document.title
  busy.set(id, label)
  document.title = `${label} · ${base}`
  void holdScreen()
}

export function setIdle(id: string, done?: string) {
  busy.delete(id)
  if (busy.size) {
    document.title = `${[...busy.values()].pop()} · ${base}`
    return
  }
  lock?.release().catch(() => {})
  lock = null
  if (!base) return
  // Leave "ready" in the tab title until they come back to it.
  if (done && document.hidden) document.title = `✓ ${done} · ${base}`
  else {
    document.title = base
    base = ''
  }
}

/** Asked once, from a tap (browsers require one), for long recordings. */
export function askToNotify() {
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  } catch {
    /* not available (e.g. iPhone Safari outside a home-screen app) */
  }
}

export function notify(title: string, body: string) {
  try {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, icon: '/icon-192.png', tag: 'flux-scribe' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}
