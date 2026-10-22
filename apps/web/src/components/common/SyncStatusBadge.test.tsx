import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncStatusBadge } from './SyncStatusBadge'
import { SyncProvider, useSync } from '../../context/SyncContext'
import { AuthProvider, mockTestUser } from '../../context/AuthContext'

const TestHarness: React.FC<{
  user?: any
  variant?: 'pill' | 'dashboard'
  onMount?: (sync: ReturnType<typeof useSync>) => void
}> = ({ user = mockTestUser, variant = 'pill', onMount }) => {
  return (
    <AuthProvider initialUser={user}>
      <SyncProvider>
        <Consumer onMount={onMount} variant={variant} />
      </SyncProvider>
    </AuthProvider>
  )
}

const Consumer: React.FC<{
  variant: 'pill' | 'dashboard'
  onMount?: (sync: ReturnType<typeof useSync>) => void
}> = ({ variant, onMount }) => {
  const sync = useSync()
  React.useEffect(() => {
    if (onMount) onMount(sync)
  }, [sync, onMount])

  return (
    <div>
      <SyncStatusBadge variant={variant} />
      <button
        type="button"
        data-testid="btn-success"
        onClick={() => sync.recordPersistenceSuccess('Test Resource')}
      >
        Record Success
      </button>
      <button
        type="button"
        data-testid="btn-failure"
        onClick={() => sync.recordPersistenceFailure('Failed Operation')}
      >
        Record Failure
      </button>
      <button
        type="button"
        data-testid="btn-clear"
        onClick={() => sync.resetSyncEvidence()}
      >
        Clear Evidence
      </button>
    </div>
  )
}

describe('SyncStatusBadge & SyncContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders SIGNED_OUT state with Guest Mode label and gray styling when user is null', () => {
    render(<TestHarness user={null} />)

    const badge = screen.getByTestId('sync-status-badge')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('Guest Mode · Local Only')).toBeInTheDocument()
    expect(badge.className).toContain('text-neutral-400')
  })

  it('renders CONNECTING_CLOUD state for authenticated user before persistence evidence is recorded', () => {
    render(<TestHarness user={mockTestUser} />)

    const badge = screen.getByTestId('sync-status-badge')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('Connecting to Cloud...')).toBeInTheDocument()
    expect(badge.className).toContain('text-amber-400')
  })

  it('transitions to SYNCED state only when genuine persistence success is recorded', () => {
    render(<TestHarness user={mockTestUser} />)

    expect(screen.getByText('Connecting to Cloud...')).toBeInTheDocument()

    // Trigger genuine persistence success
    fireEvent.click(screen.getByTestId('btn-success'))

    expect(screen.getByText('Cloud Synced')).toBeInTheDocument()
    const badge = screen.getByTestId('sync-status-badge')
    expect(badge.className).toContain('text-emerald-400')
  })

  it('transitions to DEGRADED state when persistence failure is recorded', () => {
    render(<TestHarness user={mockTestUser} />)

    // First record success
    fireEvent.click(screen.getByTestId('btn-success'))
    expect(screen.getByText('Cloud Synced')).toBeInTheDocument()

    // Now record failure
    fireEvent.click(screen.getByTestId('btn-failure'))
    expect(screen.getByText('Sync Degraded')).toBeInTheDocument()
    const badge = screen.getByTestId('sync-status-badge')
    expect(badge.className).toContain('text-rose-400')
  })

  it('handles offline events by marking connection degraded without falsely asserting synchronization', () => {
    render(<TestHarness user={mockTestUser} />)

    // First record success
    fireEvent.click(screen.getByTestId('btn-success'))
    expect(screen.getByText('Cloud Synced')).toBeInTheDocument()

    // Simulate browser going offline
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByText('Sync Degraded')).toBeInTheDocument()

    // Simulate browser coming back online
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    // Returns to connecting or synced state
    expect(screen.getByTestId('sync-status-badge')).toBeInTheDocument()
  })

  it('renders dashboard variant correctly with appropriate layout', () => {
    render(<TestHarness user={null} variant="dashboard" />)

    const badge = screen.getByTestId('sync-status-badge')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('Guest Mode · Local Only')).toBeInTheDocument()
  })

  it('invalidates sync evidence when switching from User A to User B or signing out', () => {
    const userA = { uid: 'user_A', email: 'a@example.com', displayName: 'User A' } as any
    const userB = { uid: 'user_B', email: 'b@example.com', displayName: 'User B' } as any

    const { rerender } = render(
      <AuthProvider initialUser={userA}>
        <SyncProvider>
          <Consumer variant="pill" />
        </SyncProvider>
      </AuthProvider>
    )

    // User A records persistence
    fireEvent.click(screen.getByTestId('btn-success'))
    expect(screen.getByText('Cloud Synced')).toBeInTheDocument()

    // Now switch to User B
    rerender(
      <AuthProvider initialUser={userB}>
        <SyncProvider>
          <Consumer variant="pill" />
        </SyncProvider>
      </AuthProvider>
    )

    // User B must NOT inherit User A's persistence evidence!
    expect(screen.queryByText('Cloud Synced')).not.toBeInTheDocument()
    expect(screen.getByText('Connecting to Cloud...')).toBeInTheDocument()
  })
})
