// The Flux Scribe emblem: the family ring framing five harmonic bars — a
// voice waveform — drawn in the active theme's 5-stop metallic gradient.
export function Logo({ className = 'h-9 w-9', animate = true }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={`${className} ${animate ? 'emblem-flash' : ''}`} aria-hidden>
      <defs>
        <linearGradient id="scribeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--grad-1)" />
          <stop offset="25%" stopColor="var(--grad-2)" />
          <stop offset="50%" stopColor="var(--grad-3)" />
          <stop offset="75%" stopColor="var(--grad-4)" />
          <stop offset="100%" stopColor="var(--grad-5)" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" stroke="url(#scribeGrad)" strokeWidth="7" />
      <g stroke="url(#scribeGrad)" strokeWidth="7.5" strokeLinecap="round">
        <line x1="29" y1="45" x2="29" y2="55" />
        <line x1="39.5" y1="37" x2="39.5" y2="63" />
        <line x1="50" y1="29" x2="50" y2="71" />
        <line x1="60.5" y1="39" x2="60.5" y2="61" />
        <line x1="71" y1="46" x2="71" y2="54" />
      </g>
    </svg>
  )
}
