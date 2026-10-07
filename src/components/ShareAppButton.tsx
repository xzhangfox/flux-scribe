import React, { useState } from 'react';

// "Share Flux Scribe" — the family's share-this-app row (see the Flux UI guide,
// §5.4): the system share sheet with the app's own link, or, where there
// is none, the link copied with a short confirmation. Styled only with
// the theme variables, so it follows the active theme.
const APP_URL = 'https://flux-scribe-otzr.vercel.app/';

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="6" cy="12" r="2.3" />
    <circle cx="17.5" cy="6" r="2.3" />
    <circle cx="17.5" cy="18" r="2.3" />
    <path d="M8.1 10.8l7.3-3.6M8.1 13.2l7.3 3.6" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const ShareAppButton: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Flux Scribe', text: 'Flux Scribe — meeting minutes, written for you.', url: APP_URL });
        return;
      } catch (err) {
        // A dismissed share sheet isn't an error.
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // (clipboard blocked: nothing more to do)
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left border backdrop-blur-xl transition-all active:scale-95 hover:brightness-110"
      style={{ background: 'var(--surface-dark)', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'rgba(var(--primary-rgb), 0.15)', color: 'var(--primary)' }}
      >
        {copied ? <CheckIcon /> : <ShareIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: 'var(--text-main, #fff)' }}>{copied ? 'Link copied' : 'Share Flux Scribe'}</span>
        <span className="block truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>flux-scribe-otzr.vercel.app</span>
      </span>
    </button>
  );
};
