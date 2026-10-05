/**
 * API Client with automatic Firebase Auth Token & User-Id header propagation.
 */

import { auth } from './firebase';

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

  return fetch(url, {
    ...options,
    headers,
  });
}
