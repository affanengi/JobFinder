import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LogoutConfirmModal } from './LogoutConfirmModal';
import { abortAllRequests, fetchWithAuth } from '../../lib/api';

describe('LogoutConfirmModal & Account Isolation', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });
  it('does not render when isOpen is false', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <LogoutConfirmModal
        isOpen={false}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders title, explanatory text, and buttons when isOpen is true', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <LogoutConfirmModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Log out of JobFinder?')).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to log out\? Outstanding requests will be cancelled/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('cancels logout without calling onConfirm when Cancel is clicked', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <LogoutConfirmModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <LogoutConfirmModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('executes onConfirm and closes modal upon confirmed logout', async () => {
    const handleClose = vi.fn();
    let resolveLogout: () => void = () => {};
    const handleConfirm = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveLogout = resolve;
      })
    );

    render(
      <LogoutConfirmModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    fireEvent.click(logoutBtn);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText(/logging out/i)).toBeInTheDocument();
    });

    // Resolve the promise
    resolveLogout();

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  it('displays error message honestly if sign-out fails and does not close modal', async () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn().mockRejectedValue(new Error('Network error during sign-out'));

    render(
      <LogoutConfirmModal
        isOpen={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error during sign-out')).toBeInTheDocument();
    });

    expect(handleClose).not.toHaveBeenCalled();
  });

  it('abortAllRequests triggers abort signal on in-flight requests', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = (init?.signal as AbortSignal) || null;
      return new Promise(() => {}); // never resolves to simulate pending in-flight
    });

    // Fire fetchWithAuth without awaiting
    fetchWithAuth('/api/v1/applications');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(capturedSignal).not.toBeNull();
    expect((capturedSignal as unknown as AbortSignal)?.aborted).toBe(false);

    // Call abortAllRequests
    abortAllRequests();

    expect((capturedSignal as unknown as AbortSignal)?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });
});
