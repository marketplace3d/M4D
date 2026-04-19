import React from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '@blueprintjs/core'

const TABS = [
  { to: '/m/dashboard', label: 'Dashboard', icon: 'dashboard' as const },
  { to: '/m/trader',    label: 'Trader',    icon: 'chart' as const },
  { to: '/m/backtest',  label: 'Backtest',  icon: 'timeline-line-chart' as const },
  { to: '/autotrader',  label: 'Auto',      icon: 'automatic-updates' as const },
  { to: '/datalab',     label: 'Data',      icon: 'database' as const },
]

export const MobileNav: React.FC = () => {
  return (
    <nav className="mobile-bottom-nav">
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `mobile-nav-tab${isActive ? ' active' : ''}`
          }
        >
          <Icon icon={tab.icon} size={20} />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
