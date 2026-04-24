export type UiTheme = 'dark-hc' | 'navy-subtle' | 'warm'
export type UiSize = 's' | 'm' | 'l' | 'x'
export type UiProfile = 'mb' | '1080' | '4k'
export type UiGlow = 'off' | 'low' | 'med' | 'high'

export type UiPrefs = {
  theme: UiTheme
  size: UiSize
  profile: UiProfile
  glow: UiGlow
  vibrantLock: boolean
  audioOn: boolean
  locked: boolean
}

const KEY = 'm4d.ui.prefs.v1'

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: 'navy-subtle',
  size: 'm',
  profile: '1080',
  glow: 'low',
  vibrantLock: true,
  audioOn: true,
  locked: false,
}

const sizeFactor: Record<UiSize, number> = { s: 0.92, m: 1.0, l: 1.12, x: 1.28 }
const profileFactor: Record<UiProfile, number> = { mb: 0.95, '1080': 1.0, '4k': 1.45 }
const glowFactor: Record<UiGlow, number> = { off: 0, low: 0.5, med: 0.8, high: 1.15 }

export function computeUiScale(size: UiSize, profile: UiProfile): number {
  return sizeFactor[size] * profileFactor[profile]
}

export function computeUiGlow(glow: UiGlow): number {
  return glowFactor[glow]
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_UI_PREFS
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      theme: parsed.theme ?? DEFAULT_UI_PREFS.theme,
      size: parsed.size ?? DEFAULT_UI_PREFS.size,
      profile: parsed.profile ?? DEFAULT_UI_PREFS.profile,
      glow: parsed.glow ?? DEFAULT_UI_PREFS.glow,
      vibrantLock: typeof parsed.vibrantLock === 'boolean' ? parsed.vibrantLock : DEFAULT_UI_PREFS.vibrantLock,
      audioOn: typeof parsed.audioOn === 'boolean' ? parsed.audioOn : DEFAULT_UI_PREFS.audioOn,
      locked: typeof parsed.locked === 'boolean' ? parsed.locked : DEFAULT_UI_PREFS.locked,
    }
  } catch {
    return DEFAULT_UI_PREFS
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore storage errors
  }
}
