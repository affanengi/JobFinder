import { ClipperSettings, DraftJobData } from '../types';

const DEFAULT_SETTINGS: ClipperSettings = {
  apiBaseUrl: 'http://localhost:8000',
  clipToken: '',
};

export async function getSettings(): Promise<ClipperSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get(['apiBaseUrl', 'clipToken']);
      return {
        apiBaseUrl: res.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
        clipToken: res.clipToken || DEFAULT_SETTINGS.clipToken,
      };
    } catch (e) {
      console.warn('chrome.storage.local failed, using defaults', e);
    }
  }

  // Fallback for dev / non-extension test environments
  try {
    const saved = localStorage.getItem('jobfinder_clipper_settings');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: ClipperSettings): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set(settings);
    return;
  }
  try {
    localStorage.setItem('jobfinder_clipper_settings', JSON.stringify(settings));
  } catch {}
}

export async function getActiveDraft(url: string): Promise<DraftJobData | null> {
  const key = `draft_${encodeURIComponent(url)}`;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    try {
      const res = await chrome.storage.session.get([key]);
      return (res[key] as DraftJobData) || null;
    } catch {}
  }
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export async function saveActiveDraft(url: string, draft: DraftJobData): Promise<void> {
  const key = `draft_${encodeURIComponent(url)}`;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    try {
      await chrome.storage.session.set({ [key]: draft });
      return;
    } catch {}
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {}
}

export async function clearActiveDraft(url: string): Promise<void> {
  const key = `draft_${encodeURIComponent(url)}`;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    try {
      await chrome.storage.session.remove(key);
      return;
    } catch {}
  }
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
