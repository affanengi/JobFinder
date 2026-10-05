import { CheckClipStatusResult, ClipJobPayload, ClipJobResult } from '../types';
import { checkJobClipStatus, clipJobToBackend } from '../services/api';
import { isSupportedJobUrl } from '../services/url-guard';

// Handle messages from Popup or Content Script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_CLIP_STATUS') {
    if (!isSupportedJobUrl(message.url)) {
      sendResponse({ success: true, data: { isSaved: false } });
      return false;
    }

    checkJobClipStatus(message.url)
      .then((status: CheckClipStatusResult) => {
        sendResponse({ success: true, data: status });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'CLIP_JOB') {
    clipJobToBackend(message.payload as ClipJobPayload)
      .then((res: ClipJobResult) => {
        sendResponse({ success: true, data: res });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  return false;
});

// Update icon badge when switching tabs - strictly gated to supported job platforms
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || !isSupportedJobUrl(tab.url)) {
      // Immediately reset badge on unsupported sites (YouTube, Gmail, GitHub, etc.)
      chrome.action.setBadgeText({ tabId: activeInfo.tabId, text: '' });
      return;
    }

    const status = await checkJobClipStatus(tab.url);
    if (status.isSaved) {
      chrome.action.setBadgeText({ tabId: tab.id, text: 'SAVED' });
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#10B981' });
    } else {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    }
  } catch {}
});

