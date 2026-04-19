import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Navbar,
  NavbarGroup,
  NavbarHeading,
  NavbarDivider,
  Alignment,
  Tag,
  Spinner,
  Intent,
} from '@blueprintjs/core'
import { useHealth } from '../api/client'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/trader',    label: 'Trader' },
  { to: '/autotrader',label: 'AutoTrader' },
  { to: '/backtest',  label: 'Backtest' },
  { to: '/datalab',   label: 'Data Lab' },
]

export const TopNavBar: React.FC = () => {
  const location = useLocation()
  const { data: health, isLoading, isError } = useHealth()

  return (
    <Navbar style={{ flexShrink: 0 }}>
      <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading>
          <span
            style={{
              fontWeight: 900,
              fontSize: 18,
              color: '#FFB74D',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
            }}
          >
            MRT
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#8f99a8',
              marginLeft: 6,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Algo Trading
          </span>
        </NavbarHeading>
        <NavbarDivider />
        {NAV_LINKS.map(link => {
          const isActive = location.pathname.startsWith(link.to)
          return (
            <NavLink
              key={link.to}
              to={link.to}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 50,
                padding: '0 12px',
                fontSize: 13,
                fontWeight: isActive ? 700 : 400,
                color: isActive ? '#FFB74D' : '#8f99a8',
                textDecoration: 'none',
                borderBottom: isActive ? '2px solid #FFB74D' : '2px solid transparent',
                transition: 'color 0.15s',
              }}
            >
              {link.label}
            </NavLink>
          )
        })}
      </NavbarGroup>

      <NavbarGroup align={Alignment.RIGHT}>
        {/* API status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isLoading ? (
            <Spinner size={14} />
          ) : isError ? (
            <Tag intent={Intent.DANGER} minimal round style={{ fontSize: 10 }}>
              OFFLINE
            </Tag>
          ) : (
            <Tag intent={Intent.SUCCESS} minimal round style={{ fontSize: 10 }}>
              {health?.status ?? 'LIVE'}
            </Tag>
          )}
          <span style={{ fontSize: 11, color: '#8f99a8' }}>API</span>
        </div>
        <NavbarDivider />
        {/* Clock */}
        <LiveClock />
      </NavbarGroup>
    </Navbar>
  )
}

const LiveClock: React.FC = () => {
  const [time, setTime] = React.useState(() => new Date().toISOString().slice(11, 19))

  React.useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toISOString().slice(11, 19))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#8f99a8',
        letterSpacing: '0.05em',
      }}
    >
      {time} UTC
    </span>
  )
}
