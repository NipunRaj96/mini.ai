import type { ReactNode } from 'react'
import { DitherGradient } from '../components/ui/dither-gradient'

/** Centered card shell shared by Login and Signup. Matches the sidebar's
 * "mini.ai" wordmark treatment, and adds one restrained componentry.dev
 * accent (a slow, low-intensity dithered gradient) behind the card instead
 * of a flat background -- grayscale values pulled straight from this
 * project's own tokens, so it reads as a soft light source rather than a
 * second color system. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas p-[var(--space-lg)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]"
      >
        <DitherGradient colorFrom="#121316" colorMid="#1e2025" colorTo="#0e0f12" intensity={0.06} speed={0.6} angle={135} />
      </div>

      <div className="relative z-10 flex w-full max-w-96 flex-col items-center gap-[var(--space-lg)]">
        <span className="inline-flex items-center gap-1.5 font-display text-lg tracking-[-0.02em] text-on-surface">
          mini.ai
          <span className="h-1.5 w-1.5 rounded-full bg-accent opacity-80" aria-hidden="true" />
        </span>

        <div className="flex w-full flex-col gap-[var(--space-md)] rounded-lg border border-surface-border bg-surface p-[var(--space-xl)] shadow-[var(--shadow-level3)]">
          <h1 className="font-display text-xl font-medium tracking-[-0.02em] text-on-surface">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  )
}
