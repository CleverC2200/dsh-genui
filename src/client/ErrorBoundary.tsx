import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from './i18n/index.ts'

interface ErrorBoundaryProps {

  label?: string
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

const fallbackStyle: Record<string, string | number> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '8px 12px',
  margin: '4px 0',
  borderRadius: '8px',
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'rgba(127,127,127,0.08)',
  color: 'inherit',
  fontSize: '12px',
  lineHeight: 1.5,
  fontFamily: 'inherit',
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dsh-genui] render failed:', error, info.componentStack ?? '')
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div style={fallbackStyle} role="alert" data-genui-error>
        <span style={{ fontWeight: 600 }}>
          {t('err.boundary.body', { label: this.props.label ?? t('err.boundary.generic') })}
        </span>
        <span style={{ opacity: 0.75, overflowWrap: 'anywhere' }}>{error.message}</span>
      </div>
    )
  }
}
