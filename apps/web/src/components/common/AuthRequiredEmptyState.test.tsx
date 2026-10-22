import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuthRequiredEmptyState } from './AuthRequiredEmptyState';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider } from '../../context/AuthContext';

describe('AuthRequiredEmptyState component', () => {
  it('renders badge, title, description, and benefits list', () => {
    render(
      <AuthProvider initialUser={null}>
        <AuthRequiredEmptyState
          icon={ShieldCheck}
          badge="Verified Facts"
          title="Sign In to Access Your Truth Lock"
          description="Your profile holds grounded truths used for deterministic ATS resume tailoring."
          benefits={[
            'Single source of truth for resume tailoring',
            'Zero hallucinations verified fact extraction',
            'Cross-device secure cloud sync',
          ]}
          primaryActionText="Sign In Now"
        />
      </AuthProvider>
    );

    expect(screen.getByText('Verified Facts')).toBeInTheDocument();
    expect(screen.getByText('Sign In to Access Your Truth Lock')).toBeInTheDocument();
    expect(screen.getByText(/Your profile holds grounded truths/i)).toBeInTheDocument();
    expect(screen.getByText('Single source of truth for resume tailoring')).toBeInTheDocument();
    expect(screen.getByText('Zero hallucinations verified fact extraction')).toBeInTheDocument();
    expect(screen.getByText('Cross-device secure cloud sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In Now/i })).toBeInTheDocument();
  });

  it('triggers secondary action callback when secondary button is clicked', () => {
    const handleSecondary = vi.fn();

    render(
      <AuthProvider initialUser={null}>
        <AuthRequiredEmptyState
          title="Sign In Required"
          description="Please sign in to proceed."
          primaryActionText="Sign In"
          secondaryAction={{
            label: 'Explore Opportunities',
            onClick: handleSecondary,
          }}
        />
      </AuthProvider>
    );

    const secondaryBtn = screen.getByRole('button', { name: /Explore Opportunities/i });
    expect(secondaryBtn).toBeInTheDocument();
    fireEvent.click(secondaryBtn);
    expect(handleSecondary).toHaveBeenCalledTimes(1);
  });

  it('opens AuthModal on primary action click when no custom onPrimaryAction is passed', () => {
    render(
      <AuthProvider initialUser={null}>
        <AuthRequiredEmptyState
          title="Sign In Required"
          description="Please sign in to proceed."
          primaryActionText="Sign In to Continue"
          authModalTitle="Welcome to JobFinder"
          authModalSubtitle="Sign in to sync your verified profile."
        />
      </AuthProvider>
    );

    const primaryBtn = screen.getByRole('button', { name: /Sign In to Continue/i });
    fireEvent.click(primaryBtn);

    // Verify AuthModal opened with contextual title
    expect(screen.getByText('Welcome to JobFinder')).toBeInTheDocument();
    expect(screen.getByText('Sign in to sync your verified profile.')).toBeInTheDocument();
  });

  it('calls custom onPrimaryAction when provided instead of default modal toggle', () => {
    const customPrimary = vi.fn();

    render(
      <AuthProvider initialUser={null}>
        <AuthRequiredEmptyState
          title="Sign In Required"
          description="Please sign in to proceed."
          primaryActionText="Custom Action"
          onPrimaryAction={customPrimary}
        />
      </AuthProvider>
    );

    const primaryBtn = screen.getByRole('button', { name: /Custom Action/i });
    fireEvent.click(primaryBtn);
    expect(customPrimary).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sign in to JobFinder')).not.toBeInTheDocument();
  });
});
