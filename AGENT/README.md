# M5D AGENT DOCS
*Clean session docs — rebuilt 2026-04-24*

## Quick links
- BUILDOUT-PROGRESS → see AGENT1/BUILDOUT-PROGRESS.md (historical)
- System spec → AGENT1/SYSTEM-SPEC.md
- TV indicators → AGENT1/TV-INDICATORS-SYNTHESIS.MD
- Alpha search → AGENT1/ALPHA-SEARCH-DAILY.md

## Active sites
| Site | Folder | Port | Purpose |
|------|--------|------|---------|
| M5D  | m5d/   | :5556 | Co-trader — 4-page Palantir panel UI |
| M3D  | site/  | :5500 | Test bots, MaxCogViz, research |
| M4D  | M4D/   | :5555 | Legacy — keep running, do not extend |

## Launch
```bash
cd /Volumes/AI/AI-4D/M4D/m5d && npm run dev   # M5D :5556
cd /Volumes/AI/AI-4D/M4D/site && npm run dev   # M3D :5500
```
