/**
 * API Client with automatic Firebase Auth Token & User-Id header propagation.
 */

import { auth } from './firebase';

const activeAbortControllers = new Set<AbortController>();

/**
 * Aborts all active in-flight fetchWithAuth requests and clears the controller registry.
 * Called immediately during user sign-out to prevent stale responses from populating state.
 */
export function abortAllRequests(): void {
  for (const controller of activeAbortControllers) {
    try {
      controller.abort();
    } catch {
      // Ignore already aborted controllers
    }
  }
  activeAbortControllers.clear();
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  // Await Firebase initial auth resolution if available
  if (typeof auth?.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // Continue if authStateReady is rejected
    }
  }

  const currentUser = auth.currentUser;
  let token: string | null = null;
  if (currentUser) {
    try {
      token = await currentUser.getIdToken();
    } catch {
      token = null;
    }
  }

  const headers = new Headers(options.headers || {});
  if (currentUser?.uid) {
    headers.set('X-User-Id', currentUser.uid);
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  activeAbortControllers.add(controller);

  // Link caller-provided signal if present
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } finally {
    activeAbortControllers.delete(controller);
  }
}
