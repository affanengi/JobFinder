import React, { useEffect, useState, useCallback } from 'react';
import {
  Briefcase,
  Building2,
  MapPin,
  DollarSign,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Settings,
  RefreshCw,
  FileText,
  Clock,
  Laptop,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlignLeft,
  HelpCircle,
} from 'lucide-react';
import {
  CheckClipStatusResult,
  ClipJobPayload,
  ClipJobResult,
  ExtractedJobData,
  WorkMode,
  EmploymentType,
  FieldQualityMap,
} from '../types';
import { getSettings, getActiveDraft, saveActiveDraft, clearActiveDraft } from '../services/storage';
import { isSupportedJobUrl } from '../services/url-guard';

export default function Popup() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [extracted, setExtracted] = useState<ExtractedJobData | null>(null);
  const [clipStatus, setClipStatus] = useState<CheckClipStatusResult | null>(null);
  const [isDormant, setIsDormant] = useState<boolean>(false);
  const [customExtracting, setCustomExtracting] = useState<boolean>(false);
  const [activeTabId, setActiveTabId] = useState<number | undefined>(undefined);

  // Form state
  const [title, setTitle] = useState<string>('');
  const [company, setCompany] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [workMode, setWorkMode] = useState<WorkMode>(null);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(null);
  const [salaryRaw, setSalaryRaw] = useState<string>('');
  const [descriptionText, setDescriptionText] = useState<string>('');
  const [candidateNotes, setCandidateNotes] = useState<string>('');
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());

  // UI state
  const [showDescription, setShowDescription] = useState<boolean>(false);

  // Action state
  const [saving, setSaving] = useState<boolean>(false);
  const [saveResult, setSaveResult] = useState<ClipJobResult | null>(null);
  const [, setBackendConfigured] = useState<boolean>(true);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('http://localhost:8000');

  // Mark field as edited
  const handleFieldChange = (fieldName: string, value: any, setter: (val: any) => void) => {
    setter(value);
    setEditedFields((prev) => new Set(prev).add(fieldName));
  };

  // Extract from active tab and check clip status
  const initialize = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveResult(null);

    try {
      const settings = await getSettings();
      setApiBaseUrl(settings.apiBaseUrl);

      // 1. Get active tab
      let tabUrl = window.location.href;
      let tabId: number | undefined;

      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          tabUrl = tabs[0].url;
          tabId = tabs[0].id;
        }
      }
      setCurrentUrl(tabUrl);
      setActiveTabId(tabId);

      // Check if URL is valid web page
      if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
        setError('Open a job posting webpage (LinkedIn, Indeed, Greenhouse, etc.) to clip.');
        setLoading(false);
        return;
      }

      // Performance Isolation: If URL is unsupported (e.g. YouTube, Gmail, GitHub), go dormant immediately.
      // Do NOT send CHECK_CLIP_STATUS, do NOT send EXTRACT_JOB, do NOT execute scripts.
      if (!isSupportedJobUrl(tabUrl)) {
        setIsDormant(true);
        setLoading(false);
        return;
      }

      setIsDormant(false);

      // 2. Check if already saved in JobFinder via background script
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          { type: 'CHECK_CLIP_STATUS', url: tabUrl },
          (response) => {
            if (response?.success && response.data) {
              setClipStatus(response.data);
            }
          }
        );
      }

      // 3. Check for saved draft in session storage
      const draft = await getActiveDraft(tabUrl);

      // 4. Request DOM extraction from content script
      if (typeof chrome !== 'undefined' && chrome.tabs && tabId) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_JOB' });
          if (response?.success && response.data) {
            const data: ExtractedJobData = response.data;
            setExtracted(data);

            // Candidate-Edit Authority: draft edits permanently override extracted values
            setTitle(draft?.userEdits?.title ?? data.title ?? '');
            setCompany(draft?.userEdits?.company ?? data.company ?? '');
            setLocation(draft?.userEdits?.location ?? data.location ?? '');
            setWorkMode((draft?.userEdits?.workMode as WorkMode) ?? data.workMode ?? null);
            setEmploymentType(
              (draft?.userEdits?.employmentType as EmploymentType) ?? data.employmentType ?? null
            );
            setSalaryRaw(draft?.userEdits?.salaryRaw ?? data.salaryRaw ?? '');
            setDescriptionText(draft?.userEdits?.descriptionText ?? data.descriptionText ?? '');
            setCandidateNotes(draft?.candidateNotes ?? '');

            if (draft?.userEdits) {
              setEditedFields(new Set(Object.keys(draft.userEdits)));
            }
            setLoading(false);
            return;
          } else if (response && !response.success) {
            setError(response.error || 'Job detail content not ready. Try refreshing the page.');
            setLoading(false);
            return;
          }
        } catch (err: any) {
          console.warn('[JobFinder Popup] Message failed, attempting programmatic injection:', err);
          // Only attempt programmatic injection on verified supported job platforms (e.g. newly refreshed tab)
          if (isSupportedJobUrl(tabUrl)) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content-script.js'],
              });
              const retryRes = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_JOB' });
              if (retryRes?.success && retryRes.data) {
                const data: ExtractedJobData = retryRes.data;
                setExtracted(data);

                // Respect Candidate-Edit Authority on retry
                setTitle(draft?.userEdits?.title ?? data.title ?? '');
                setCompany(draft?.userEdits?.company ?? data.company ?? '');
                setLocation(draft?.userEdits?.location ?? data.location ?? '');
                setWorkMode((draft?.userEdits?.workMode as WorkMode) ?? data.workMode ?? null);
                setEmploymentType(
                  (draft?.userEdits?.employmentType as EmploymentType) ?? data.employmentType ?? null
                );
                setSalaryRaw(draft?.userEdits?.salaryRaw ?? data.salaryRaw ?? '');
                setDescriptionText(draft?.userEdits?.descriptionText ?? data.descriptionText ?? '');
                setCandidateNotes(draft?.candidateNotes ?? '');

                if (draft?.userEdits) {
                  setEditedFields(new Set(Object.keys(draft.userEdits)));
                }
                setLoading(false);
                return;
              } else if (retryRes && !retryRes.success) {
                setError(retryRes.error || 'Job detail content not ready.');
                setLoading(false);
                return;
              }
            } catch (injectErr: any) {
              console.error('[JobFinder Popup] Injection failed:', injectErr);
              setError('Please refresh this tab (press F5 or reload) so JobFinder can connect to this page.');
              setLoading(false);
              return;
            }
          }
        }
      }

      // Fallback if content script unavailable (e.g. localhost testing)
      if (draft?.extracted) {
        setExtracted(draft.extracted);
        setTitle(draft.userEdits.title ?? draft.extracted.title ?? '');
        setCompany(draft.userEdits.company ?? draft.extracted.company ?? '');
        setLocation(draft.userEdits.location ?? draft.extracted.location ?? '');
        setWorkMode((draft.userEdits.workMode as WorkMode) ?? draft.extracted.workMode ?? null);
        setEmploymentType(
          (draft.userEdits.employmentType as EmploymentType) ?? draft.extracted.employmentType ?? null
        );
        setSalaryRaw(draft.userEdits.salaryRaw ?? draft.extracted.salaryRaw ?? '');
        setDescriptionText(draft.userEdits.descriptionText ?? draft.extracted.descriptionText ?? '');
        setCandidateNotes(draft.candidateNotes ?? '');
        if (draft.userEdits) {
          setEditedFields(new Set(Object.keys(draft.userEdits)));
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize clipper');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Explicit user action: One-shot extraction on custom company career site
  const handleCustomSiteClip = async () => {
    if (!activeTabId || !currentUrl) {
      setError('Unable to access current tab.');
      return;
    }

    setCustomExtracting(true);
    setError(null);

    try {
      let data: ExtractedJobData | null = null;
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, {
          type: 'EXTRACT_JOB',
          isCustomSite: true,
        });
        if (response?.success && response.data) {
          data = response.data;
        } else if (response && !response.success) {
          setError(response.error || 'No job posting detected on this page.');
        }
      } catch {
        // One-shot injection onto custom site
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content-script.js'],
        });
        const retryRes = await chrome.tabs.sendMessage(activeTabId, {
          type: 'EXTRACT_JOB',
          isCustomSite: true,
        });
        if (retryRes?.success && retryRes.data) {
          data = retryRes.data;
        } else if (retryRes && !retryRes.success) {
          setError(retryRes.error || 'No job posting detected on this page.');
        }
      }

      if (data) {
        setExtracted(data);
        setIsDormant(false);
        setTitle(data.title ?? '');
        setCompany(data.company ?? '');
        setLocation(data.location ?? '');
        setWorkMode(data.workMode ?? null);
        setEmploymentType(data.employmentType ?? null);
        setSalaryRaw(data.salaryRaw ?? '');
        setDescriptionText(data.descriptionText ?? '');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to extract custom career page.');
    } finally {
      setCustomExtracting(false);
    }
  };

  // Debounced auto-save draft to session storage (preserving Candidate-Edit Authority)
  useEffect(() => {
    if (!currentUrl || loading || !extracted) return;

    const timer = setTimeout(() => {
      const userEdits: Partial<ClipJobPayload> = {};
      if (editedFields.has('title')) userEdits.title = title;
      if (editedFields.has('company')) userEdits.company = company;
      if (editedFields.has('location')) userEdits.location = location;
      if (editedFields.has('workMode')) userEdits.workMode = workMode || undefined;
      if (editedFields.has('employmentType')) userEdits.employmentType = employmentType || undefined;
      if (editedFields.has('salaryRaw')) userEdits.salaryRaw = salaryRaw;
      if (editedFields.has('descriptionText')) userEdits.descriptionText = descriptionText;

      saveActiveDraft(currentUrl, {
        extracted,
        userEdits,
        candidateNotes,
        savedAt: new Date().toISOString(),
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [
    currentUrl,
    extracted,
    title,
    company,
    location,
    workMode,
    employmentType,
    salaryRaw,
    descriptionText,
    candidateNotes,
    editedFields,
    loading,
  ]);

  // Primary action: Clip to JobFinder
  const handleClip = async () => {
    if (!title.trim() || !company.trim()) {
      setError('Job title and Company name are required.');
      return;
    }

    setSaving(true);
    setError(null);

    const formatError = (err: any): string => {
      if (!err) return 'Failed to save job to JobFinder.';
      if (typeof err === 'string') return err;
      if (err.message && typeof err.message === 'string') return err.message;
      return JSON.stringify(err);
    };

    const payload: ClipJobPayload = {
      title: title.trim(),
      company: company.trim(),
      location: location.trim() || 'Remote',
      workMode: workMode || 'remote',
      employmentType: employmentType || 'full_time',
      salaryRaw: salaryRaw.trim() || null,
      sourceUrl: currentUrl,
      sourcePlatform: extracted?.sourcePlatform || 'web_clipper',
      descriptionText: descriptionText.trim() || extracted?.descriptionText || '',
      descriptionHtml: extracted?.descriptionHtml || null,
      candidateNotes: candidateNotes.trim() || null,
      userEditedFields: Array.from(editedFields),
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CLIP_JOB', payload }, async (res) => {
          setSaving(false);
          if (res?.success && res.data) {
            setSaveResult(res.data);
            await clearActiveDraft(currentUrl);
            setClipStatus({
              isSaved: true,
              jobId: res.data.jobId,
              applicationId: res.data.applicationId,
              status: 'saved',
              kanbanDeepLink: res.data.kanbanDeepLink,
            });
          } else {
            setError(formatError(res?.error));
          }
        });
      } else {
        // Direct fallback
        const { clipJobToBackend } = await import('../services/api');
        const res = await clipJobToBackend(payload);
        setSaveResult(res);
        await clearActiveDraft(currentUrl);
        setClipStatus({
          isSaved: true,
          jobId: res.jobId,
          applicationId: res.applicationId,
          status: 'saved',
          kanbanDeepLink: res.kanbanDeepLink,
        });
        setSaving(false);
      }
    } catch (err: any) {
      setSaving(false);
      setError(formatError(err));
    }
  };

  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('/options.html', '_blank');
    }
  };

  const openKanban = (deepLink?: string) => {
    const target = deepLink
      ? `${apiBaseUrl.replace(/\/+$/, '')}${deepLink}`
      : `${apiBaseUrl.replace(/\/+$/, '')}/applications`;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: target });
    } else {
      window.open(target, '_blank');
    }
  };

  // Helper status badge for form fields
  const renderFieldBadge = (
    fieldName: string,
    isPresent: boolean,
    qualityKey?: keyof FieldQualityMap
  ) => {
    if (editedFields.has(fieldName)) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-medium text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded border border-blue-400/20">
          <Edit3 className="w-2.5 h-2.5" /> Edited
        </span>
      );
    }

    const q = qualityKey && extracted?.fieldQuality ? extracted.fieldQuality[qualityKey] : null;
    const status = q?.status ?? (isPresent ? 'detected' : 'missing');

    if (status === 'detected') {
      return (
        <span
          className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20"
          title={q?.source ? `Source: ${q.source}` : undefined}
        >
          <CheckCircle2 className="w-2.5 h-2.5" /> Detected
        </span>
      );
    }
    if (status === 'partial') {
      return (
        <span
          className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20"
          title={q?.reason || 'Partial content extracted'}
        >
          <AlertCircle className="w-2.5 h-2.5" /> Partial
        </span>
      );
    }
    if (status === 'uncertain') {
      return (
        <span
          className="flex items-center gap-1 text-[10px] font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20"
          title={q?.reason || 'Uncertain extraction'}
        >
          <HelpCircle className="w-2.5 h-2.5" /> Uncertain
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-700">
        Missing
      </span>
    );
  };

  const confidencePercent = Math.round((extracted?.confidenceScore || 0) * 100);
  const isHighConfidence = confidencePercent >= 80;
  const isPartialConfidence = confidencePercent >= 50 && confidencePercent < 80;

  return (
    <div className="flex flex-col h-full bg-[#0D0D0D] text-white">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-[#161616]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            JF
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white leading-tight">
              Clip to JobFinder
            </h1>
            <p className="text-[11px] text-primary-secondary capitalize">
              {extracted?.sourcePlatform || (isDormant ? 'Dormant' : 'Web Opportunity')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={initialize}
            title="Re-extract active job"
            className="p-1.5 rounded hover:bg-[#262626] text-primary-secondary hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openOptions}
            title="Settings & Token"
            className="p-1.5 rounded hover:bg-[#262626] text-primary-secondary hover:text-white transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Saved Opportunity Banner if already clipped */}
        {clipStatus?.isSaved && (
          <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-200">Already in JobFinder</p>
                <p className="text-[11px] text-emerald-300/80">
                  Tracked in your pipeline under{' '}
                  <span className="font-semibold uppercase text-emerald-100">
                    {clipStatus.status || 'Saved'}
                  </span>
                  .
                </p>
              </div>
            </div>
            <button
              onClick={() => openKanban(clipStatus.kanbanDeepLink || undefined)}
              className="text-[11px] font-medium text-emerald-200 underline hover:text-white flex items-center gap-0.5 shrink-0"
            >
              Open <ExternalLink className="w-3 h-3 ml-0.5" />
            </button>
          </div>
        )}

        {/* Success Confirmation Banner */}
        {saveResult && (
          <div className="p-3 rounded-lg bg-emerald-900/30 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{saveResult.message}</span>
            </div>
            <button
              onClick={() => openKanban(saveResult.kanbanDeepLink)}
              className="font-medium underline hover:text-white flex items-center gap-1"
            >
              View <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Extraction Quality Card */}
        {extracted && !loading && (
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[#161616] border border-border">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isHighConfidence
                    ? 'bg-emerald-400'
                    : isPartialConfidence
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
                }`}
              />
              <span className="text-xs text-primary-secondary">
                Extraction Quality: <strong className="text-white">{confidencePercent}%</strong>
              </span>
            </div>
            <span className="text-[11px] text-primary-muted font-mono">
              {extracted.detectedFields.length}/7 fields detected
            </span>
          </div>
        )}

        {/* Dormant state view when opened on an unsupported website */}
        {isDormant && !extracted && !loading && (
          <div className="flex flex-col items-center justify-center py-8 px-2 text-center space-y-4 my-auto">
            <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400">
              <Briefcase className="w-6 h-6 text-neutral-400" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-white">JobFinder is dormant on this page</h2>
              <p className="text-xs text-neutral-400 max-w-[280px] leading-relaxed">
                Open a supported job board (LinkedIn Jobs, Indeed, Greenhouse, Lever, Ashby, Workday) to clip opportunities.
              </p>
            </div>
            <div className="pt-2 w-full space-y-2">
              <button
                type="button"
                onClick={handleCustomSiteClip}
                disabled={customExtracting}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 rounded-md transition-colors"
              >
                {customExtracting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scanning custom page...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Clip from custom career site
                  </>
                )}
              </button>
              <p className="text-[11px] text-neutral-400">
                Extracts one-shot from this page without background tracking.
              </p>
            </div>
          </div>
        )}

        {/* Form Fields */}
        {(!isDormant || extracted) && (
          <div className="space-y-3">
          {/* Job Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5 text-neutral-400" /> Job Title *
              </label>
              {renderFieldBadge('title', Boolean(extracted?.title), 'title')}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => handleFieldChange('title', e.target.value, setTitle)}
              placeholder="e.g. Senior Machine Learning Engineer"
              className="w-full px-3 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Company */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-neutral-400" /> Company *
              </label>
              {renderFieldBadge('company', Boolean(extracted?.company), 'company')}
            </div>
            <input
              type="text"
              value={company}
              onChange={(e) => handleFieldChange('company', e.target.value, setCompany)}
              placeholder="e.g. Scale AI"
              className="w-full px-3 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Location & Work Mode Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-neutral-400" /> Job Location
                </label>
                {renderFieldBadge('location', Boolean(extracted?.location), 'location')}
              </div>
              <input
                type="text"
                value={location}
                onChange={(e) => handleFieldChange('location', e.target.value, setLocation)}
                placeholder="e.g. San Francisco, CA"
                className="w-full px-2.5 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                  <Laptop className="w-3.5 h-3.5 text-neutral-400" /> Work Mode
                </label>
                {renderFieldBadge('workMode', Boolean(extracted?.workMode), 'workMode')}
              </div>
              <select
                value={workMode || ''}
                onChange={(e) =>
                  handleFieldChange(
                    'workMode',
                    e.target.value ? (e.target.value as WorkMode) : null,
                    setWorkMode
                  )
                }
                className="w-full px-2 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="">Unspecified</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </div>
          </div>

          {/* Employment Type & Salary Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-neutral-400" /> Commitment
                </label>
                {renderFieldBadge('employmentType', Boolean(extracted?.employmentType), 'employmentType')}
              </div>
              <select
                value={employmentType || ''}
                onChange={(e) =>
                  handleFieldChange(
                    'employmentType',
                    e.target.value ? (e.target.value as EmploymentType) : null,
                    setEmploymentType
                  )
                }
                className="w-full px-2 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="">Unspecified</option>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-neutral-400" /> Compensation
                </label>
                {renderFieldBadge('salaryRaw', Boolean(extracted?.salaryRaw), 'salary')}
              </div>
              <input
                type="text"
                value={salaryRaw}
                onChange={(e) => handleFieldChange('salaryRaw', e.target.value, setSalaryRaw)}
                placeholder="e.g. $180k - $220k"
                className="w-full px-2.5 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* Expandable Structured Description Section */}
          <div className="border border-border rounded-md bg-[#161616] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDescription(!showDescription)}
              className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-[#1f1f1f] transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <AlignLeft className="w-3.5 h-3.5 text-neutral-400" />
                <span className="text-xs font-medium text-primary-secondary">Job Description</span>
                {descriptionText && (
                  <span className="text-[10px] text-neutral-400">
                    ({descriptionText.length} chars)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {renderFieldBadge('descriptionText', Boolean(descriptionText), 'description')}
                {showDescription ? (
                  <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                )}
              </div>
            </button>

            {showDescription && (
              <div className="p-2 border-t border-border bg-[#111]">
                <textarea
                  value={descriptionText}
                  onChange={(e) =>
                    handleFieldChange('descriptionText', e.target.value, setDescriptionText)
                  }
                  placeholder="Structured job description in Markdown..."
                  rows={8}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0D0D0D] border border-border rounded text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-emerald-500 transition-colors resize-y leading-relaxed"
                />
              </div>
            )}
          </div>

          {/* Candidate Notes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-primary-secondary flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-neutral-400" /> Personal Notes (Private)
              </label>
              {candidateNotes && (
                <span className="text-[10px] text-emerald-400 font-medium">Added</span>
              )}
            </div>
            <textarea
              value={candidateNotes}
              onChange={(e) => setCandidateNotes(e.target.value)}
              placeholder="Questions for recruiter, referral contact, team notes..."
              rows={2}
              className="w-full px-3 py-1.5 text-xs bg-[#161616] border border-border rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            />
          </div>
        </div>
        )}
      </div>

      {/* Bottom Sticky Action Footer */}
      <div className="p-3 border-t border-border bg-[#161616] flex items-center justify-between gap-2">
        <button
          onClick={() => openKanban()}
          className="px-3 py-2 text-xs font-medium text-primary-secondary hover:text-white rounded-md hover:bg-[#262626] transition-colors"
        >
          Open Kanban
        </button>

        {(!isDormant || extracted) && (
          <button
            onClick={handleClip}
            disabled={saving || loading || !title.trim() || !company.trim()}
            title={!title.trim() || !company.trim() ? 'Job Title and Company are required' : 'Save to JobFinder'}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-all"
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" /> Clip to JobFinder
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
