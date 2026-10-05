import { CheckClipStatusResult, ClipJobPayload, ClipJobResult } from '../types';
import { getSettings } from './storage';

const DEFAULT_CHECK_TIMEOUT_MS = 3000;
const DEFAULT_CLIP_TIMEOUT_MS = 10000;

async function fetchWithTimeout(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkJobClipStatus(url: string): Promise<CheckClipStatusResult> {
  const settings = await getSettings();
  const endpoint = `${settings.apiBaseUrl.replace(/\/+$/, '')}/api/v1/jobs/clip/status?url=${encodeURIComponent(url)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.clipToken) {
    headers['X-User-Id'] = settings.clipToken;
    headers['Authorization'] = `Bearer ${settings.clipToken}`;
  }

  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'GET',
        headers,
      },
      DEFAULT_CHECK_TIMEOUT_MS
    );

    if (!res.ok) {
      return { isSaved: false };
    }

    return await res.json();
  } catch (e) {
    console.warn('Failed to check clip status from JobFinder API:', e);
    return { isSaved: false };
  }
}

export async function clipJobToBackend(payload: ClipJobPayload): Promise<ClipJobResult> {
  const settings = await getSettings();
  const endpoint = `${settings.apiBaseUrl.replace(/\/+$/, '')}/api/v1/jobs/clip`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.clipToken) {
    headers['X-User-Id'] = settings.clipToken;
    headers['Authorization'] = `Bearer ${settings.clipToken}`;
  }

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    DEFAULT_CLIP_TIMEOUT_MS
  );

  if (!res.ok) {
    const errorText = await res.text();
    let message = `Server error (${res.status})`;
    try {
      const errJson = JSON.parse(errorText);
      if (typeof errJson.detail === "string") {
        message = errJson.detail;
      } else if (Array.isArray(errJson.detail)) {
        message = errJson.detail
          .map((d: any) => `${d.loc ? d.loc.slice(1).join(".") + ": " : ""}${d.msg || JSON.stringify(d)}`)
          .join("; ");
      } else if (errJson.message) {
        message = typeof errJson.message === "string" ? errJson.message : JSON.stringify(errJson.message);
      }
    } catch {}
    throw new Error(message);
  }

  return await res.json();
}

