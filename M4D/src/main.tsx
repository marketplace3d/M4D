import { createRoot } from 'react-dom/client'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import './index.css'
import App from './App.tsx'

// No <StrictMode>: TradingView (and similar) embeds run effects that inject scripts; in dev,
// StrictMode mounts → unmounts → remounts, which tears down iframes and reloads widgets (grey → color flash).

createRoot(document.getElementById('root')!).render(<App />)
