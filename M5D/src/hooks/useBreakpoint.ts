import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | '4k'

function get(w: number): Breakpoint {
  if (w < 768)  return 'mobile'
  if (w < 1200) return 'tablet'
  if (w < 1800) return 'desktop'
  return '4k'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => get(window.innerWidth))
  useEffect(() => {
    const handler = () => setBp(get(window.innerWidth))
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return bp
}
