import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopHeader } from './TopHeader';
import { AuthProvider, mockTestUser } from '../../context/AuthContext';
import { SyncProvider } from '../../context/SyncContext';

describe('TopHeader Cloud Sync Status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders a green indicator dot with "Connected to Cloud" title when user is logged in, without displaying "Connecting to Cloud..."', () => {
    render(
      <AuthProvider initialUser={mockTestUser}>
        <SyncProvider>
          <TopHeader pageTitle="ATS Scanner" pageSubtitle="100-Point ATS parseability" />
        </SyncProvider>
      </AuthProvider>
    );

    // Profile & Logout should be present
    expect(screen.getByText(mockTestUser.displayName!)).toBeInTheDocument();
    expect(screen.getByTitle('Sign Out')).toBeInTheDocument();

    // Must NOT have the distracting amber "Connecting to Cloud..." text
    expect(screen.queryByText('Connecting to Cloud...')).not.toBeInTheDocument();

    // Must have the green indicator dot indicating connected to cloud
    const cloudIndicator = screen.getByTitle('Connected to Cloud');
    expect(cloudIndicator).toBeInTheDocument();
    expect(cloudIndicator.getAttribute('aria-label')).toBe('Connected to Cloud');
  });

  it('renders guest mode and Sign In button when user is logged out', () => {
    render(
      <AuthProvider initialUser={null}>
        <SyncProvider>
          <TopHeader pageTitle="ATS Scanner" />
        </SyncProvider>
      </AuthProvider>
    );

    expect(screen.getByText('Sign In / Sync')).toBeInTheDocument();
    expect(screen.getByText('Guest Mode · Local Only')).toBeInTheDocument();
    expect(screen.queryByTitle('Sign Out')).not.toBeInTheDocument();
  });
});
