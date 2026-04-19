// M2D API — M3D Rust :3030 and Django :8000 (proxied via vite)
export async function get(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

export async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

export const fetchAssets     = () => get('/api/v1/assets')
export const fetchAlgoDay    = () => get('/api/v1/algo-day')
export const fetchPulse      = () => get('/ds/v1/ai/pulse/')
export const triggerPulse    = () => post('/ds/v1/ai/pulse/run/', {})
export const fetchHolly      = () => get('/ds/v1/algo/holly/')
export const fetchStatArb    = () => get('/ds/v1/algo/stat-arb/')
export const fetchFunding    = () => get('/ds/v1/algo/funding/')
export const fetchSMC        = () => get('/ds/v1/algo/smc/')  // [[[NOT BUILT]]]
// XSocial — Grok × X mega scan
export const fetchXSocial       = () => get('/ds/v1/ai/xsocial/')
export const fetchXSocialAsset  = (sym) => get(`/ds/v1/ai/xsocial/${sym}/`)
export const runXSocialScan     = (watchlist) => post('/ds/v1/ai/xsocial/run/', watchlist ? { watchlist } : {})
// Risk Gate
export const fetchRiskStatus    = () => get('/ds/v1/risk/gate/')
export const runRiskGate        = (signals) => post('/ds/v1/risk/gate/', { signals })
// Trade-Ideas Scanner
export const fetchScanner       = (crypto=true, stocks=true) => get(`/ds/v1/scanner/?crypto=${crypto?1:0}&stocks=${stocks?1:0}`)
export const fetchScannerCrypto = () => get('/ds/v1/scanner/crypto/')
export const fetchScannerStocks = () => get('/ds/v1/scanner/stocks/')
