import React, { useState, useEffect } from 'react'
import { fetchWithAuth } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal'
import { TaskRoutingMapEditor } from './TaskRoutingMapEditor'
import {
  Cpu,
  Key,
  Layers,
  ShieldCheck,
  AlertCircle,
  Plus,
  Trash2,
  Coins,
  Lock,
  Eye,
  EyeOff,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Info,
  Pencil,
} from 'lucide-react'

export interface CredentialItem {
  id: string
  provider: 'gemini' | 'openrouter' | 'groq'
  friendlyName: string
  maskedKey: string
  projectScope: string
  scopeType: 'VERIFIED_PROJECT' | 'USER_DECLARED_PROJECT' | 'UNVERIFIED_UNIQUE'
  costTier: 'FREE_TIER' | 'PAID_TIER'
  healthStatus: 'HEALTHY' | 'COOLDOWN' | 'QUOTA_EXHAUSTED' | 'INVALID_KEY' | 'DEGRADED'
  isActive: boolean
  createdAt: string
}

export interface ProbeResult {
  credentialId: string
  provider: string
  model: string
  success: boolean
  latencyMs: number
  message: string
  healthStatus: string
  timestamp: string
}

export interface ProviderHealth {
  provider: 'gemini' | 'openrouter' | 'groq'
  operational: boolean
  registeredModelsCount: number
}

export interface ActiveCooldown {
  credentialId: string
  modelId: string
  expiresInSeconds: number
}

export interface HealthData {
  providers: ProviderHealth[]
  credentialStatuses: Record<string, string>
  activeCooldowns: ActiveCooldown[]
  healthyCredentialsCount: number
  totalCredentialsCount: number
  timestamp: string
}

export interface ModelItem {
  modelId: string
  provider: string
  displayName: string
  capabilities: string[]
  contextWindow: number
  costTier: string
  defaultPriority: number
  isAvailable: boolean
}

export interface TelemetrySummary {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  successRate: number
  averageLatencyMs: number
  fallbackCount: number
  providerDistribution: Record<string, number>
  taskDistribution: Record<string, number>
}

export interface ExecutionItem {
  executionId: string
  userId: string
  task: string
  providerUsed: string
  modelUsed: string
  credentialIdUsed: string
  success: boolean
  latencyMs: number
  fallbackLevel: number
  hopsCount: number
  failureCategory: string | null
  costTier: string
  timestamp: string
}

interface CredentialApiResponse {
  credentialId: string
  provider: 'gemini' | 'openrouter' | 'groq'
  friendlyName: string
  maskedApiKey: string
  projectScope?: {
    scope_id?: string
    scope_type?: 'VERIFIED_PROJECT' | 'USER_DECLARED_PROJECT' | 'UNVERIFIED_UNIQUE'
    verified?: boolean
  }
  costTier?: 'FREE_TIER' | 'PAID_TIER'
  enabled: boolean
  createdAt: string
}

const PROVIDERS_META = [
  {
    id: 'gemini' as const,
    name: 'Google Gemini',
    shortName: 'Gemini',
    description: 'Configure your Gemini credentials for JobFinder AI tasks.',
    quotaGuidance:
      'Gemini quota is associated with the Google Cloud project. Multiple API keys from the same project do not create independent quota pools.',
  },
  {
    id: 'openrouter' as const,
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    description: 'Configure OpenRouter credentials to access diverse open-source and proprietary models.',
    quotaGuidance:
      'OpenRouter free endpoints (:free) have global rate limits. Adding credits unlocks high-throughput paid endpoints if permitted by your cost policy.',
  },
  {
    id: 'groq' as const,
    name: 'Groq',
    shortName: 'Groq',
    description: 'Configure your Groq credentials for ultra-low latency inference.',
    quotaGuidance:
      'Groq provides ultra-fast inference with strict per-minute rate limits on free developer tier.',
  },
]

export const AiApiHubSettings: React.FC = () => {
  // Navigation / provider tab state
  const [selectedProviderTab, setSelectedProviderTab] = useState<'gemini' | 'openrouter' | 'groq'>('gemini')

  // Core settings state
  const [costPolicy, setCostPolicy] = useState<'FREE_ONLY' | 'FREE_PREFERRED' | 'ANY_CONFIGURED'>('FREE_ONLY')
  const [allowPaidFallback, setAllowPaidFallback] = useState<boolean>(false)
  const [taskRouting, setTaskRouting] = useState<Record<string, string>>({})
  const [credentials, setCredentials] = useState<CredentialItem[]>([])
  const [healthData, setHealthData] = useState<HealthData | null>(null)
  const [models, setModels] = useState<ModelItem[]>([])
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary | null>(null)
  const [recentExecutions, setRecentExecutions] = useState<ExecutionItem[]>([])

  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isHealthRefreshing, setIsHealthRefreshing] = useState<boolean>(false)
  const [isTelemetryRefreshing, setIsTelemetryRefreshing] = useState<boolean>(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false)
  const [isRoutingDetailsModalOpen, setIsRoutingDetailsModalOpen] = useState(false)
  const [deletingCred, setDeletingCred] = useState<CredentialItem | null>(null)
  const [probingCredId, setProbingCredId] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({})
  const [catalogFilterProvider, setCatalogFilterProvider] = useState<string>('all')
  const [catalogSearch, setCatalogSearch] = useState<string>('')

  // Add credential form state
  const [formProvider, setFormProvider] = useState<'gemini' | 'openrouter' | 'groq'>('gemini')
  const [formFriendlyName, setFormFriendlyName] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formCostTier, setFormCostTier] = useState<'FREE_TIER' | 'PAID_TIER'>('FREE_TIER')
  const [formProjectScope, setFormProjectScope] = useState('')
  const [showFormKey, setShowFormKey] = useState(false)
  const [isSavingCred, setIsSavingCred] = useState(false)

  // Edit credential form state
  const [editingCred, setEditingCred] = useState<CredentialItem | null>(null)
  const [editFriendlyName, setEditFriendlyName] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const [editCostTier, setEditCostTier] = useState<'FREE_TIER' | 'PAID_TIER'>('FREE_TIER')
  const [editProjectScope, setEditProjectScope] = useState('')
  const [showEditKey, setShowEditKey] = useState(false)
  const [isUpdatingCred, setIsUpdatingCred] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [credsRes, settingsRes, healthRes, modelsRes, teleRes] = await Promise.all([
        fetchWithAuth('/api/v1/ai/credentials'),
        fetchWithAuth('/api/v1/ai/settings'),
        fetchWithAuth('/api/v1/ai/health'),
        fetchWithAuth('/api/v1/ai/models'),
        fetchWithAuth('/api/v1/ai/telemetry'),
      ])

      if (credsRes.ok) {
        const credsData = await credsRes.json()
        if (Array.isArray(credsData)) {
          const mapped: CredentialItem[] = credsData.map((c: CredentialApiResponse) => ({
            id: c.credentialId,
            provider: c.provider,
            friendlyName: c.friendlyName,
            maskedKey: c.maskedApiKey,
            projectScope: c.projectScope?.scope_id || 'Default Scope',
            scopeType: c.projectScope?.scope_type || 'UNVERIFIED_UNIQUE',
            costTier: c.costTier || 'FREE_TIER',
            healthStatus: 'HEALTHY',
            isActive: c.enabled,
            createdAt: c.createdAt,
          }))
          setCredentials(mapped)
        }
      }

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        if (settingsData.costPolicy) {
          setCostPolicy(settingsData.costPolicy)
        }
        if (typeof settingsData.allowPaidFallback === 'boolean') {
          setAllowPaidFallback(settingsData.allowPaidFallback)
        }
        if (settingsData.taskRouting && typeof settingsData.taskRouting === 'object') {
          setTaskRouting(settingsData.taskRouting)
        }
      }

      if (healthRes.ok) {
        const hData = await healthRes.json()
        setHealthData(hData)
      }

      if (modelsRes.ok) {
        const mData = await modelsRes.json()
        if (Array.isArray(mData)) {
          setModels(mData)
        }
      }

      if (teleRes.ok) {
        const tData = await teleRes.json()
        if (tData.summary) {
          setTelemetrySummary(tData.summary)
        }
        if (Array.isArray(tData.recentExecutions)) {
          setRecentExecutions(tData.recentExecutions)
        }
      }
    } catch (err) {
      console.error('Failed to load AI Hub state from backend:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const refreshHealth = async () => {
    setIsHealthRefreshing(true)
    try {
      const res = await fetchWithAuth('/api/v1/ai/health')
      if (res.ok) {
        const hData = await res.json()
        setHealthData(hData)
      }
    } catch (err) {
      console.error('Failed to refresh health:', err)
    } finally {
      setIsHealthRefreshing(false)
    }
  }

  const refreshTelemetry = async () => {
    setIsTelemetryRefreshing(true)
    try {
      const res = await fetchWithAuth('/api/v1/ai/telemetry')
      if (res.ok) {
        const tData = await res.json()
        if (tData.summary) {
          setTelemetrySummary(tData.summary)
        }
        if (Array.isArray(tData.recentExecutions)) {
          setRecentExecutions(tData.recentExecutions)
        }
      }
    } catch (err) {
      console.error('Failed to refresh AI usage:', err)
    } finally {
      setIsTelemetryRefreshing(false)
    }
  }

  const handleTestConnection = async (credId: string) => {
    setProbingCredId(credId)
    try {
      const res = await fetchWithAuth(`/api/v1/ai/credentials/${credId}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: 'ping' }),
      })
      if (res.ok) {
        const probeData: ProbeResult = await res.json()
        setProbeResults((prev) => ({ ...prev, [credId]: probeData }))
        await refreshHealth()
      } else {
        const err = await res.json()
        setProbeResults((prev) => ({
          ...prev,
          [credId]: {
            credentialId: credId,
            provider: 'unknown',
            model: 'unknown',
            success: false,
            latencyMs: 0,
            message: err.detail || 'Probe request failed',
            healthStatus: 'DEGRADED',
            timestamp: new Date().toISOString(),
          },
        }))
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Network error during connection probe'
      setProbeResults((prev) => ({
        ...prev,
        [credId]: {
          credentialId: credId,
          provider: 'unknown',
          model: 'unknown',
          success: false,
          latencyMs: 0,
          message: errMsg,
          healthStatus: 'DEGRADED',
          timestamp: new Date().toISOString(),
        },
      }))
    } finally {
      setProbingCredId(null)
    }
  }

  const handleToggleActive = async (credId: string) => {
    const cred = credentials.find((c) => c.id === credId)
    if (!cred) return
    const newStatus = !cred.isActive

    // Optimistic update
    setCredentials((prev) =>
      prev.map((c) => (c.id === credId ? { ...c, isActive: newStatus } : c))
    )

    try {
      const res = await fetchWithAuth(`/api/v1/ai/credentials/${credId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newStatus }),
      })
      if (!res.ok) {
        throw new Error('Server returned error')
      }
      await refreshHealth()
    } catch (err) {
      console.error('Failed to toggle status on server:', err)
      // Revert if error
      setCredentials((prev) =>
        prev.map((c) => (c.id === credId ? { ...c, isActive: !newStatus } : c))
      )
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingCred) return
    const credId = deletingCred.id

    try {
      const res = await fetchWithAuth(`/api/v1/ai/credentials/${credId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setCredentials((prev) => prev.filter((c) => c.id !== credId))
        await refreshHealth()
      } else {
        const err = await res.json()
        alert(`Failed to delete credential: ${err.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error deleting credential:', err)
      alert('Network or server error while deleting credential.')
    }
  }

  const handleCostPolicyChange = async (newPolicy: 'FREE_ONLY' | 'FREE_PREFERRED' | 'ANY_CONFIGURED') => {
    setCostPolicy(newPolicy)
    try {
      await fetchWithAuth('/api/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costPolicy: newPolicy }),
      })
    } catch (err) {
      console.error('Failed to persist cost policy:', err)
    }
  }

  const handleAllowPaidFallbackChange = async (newVal: boolean) => {
    setAllowPaidFallback(newVal)
    try {
      await fetchWithAuth('/api/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowPaidFallback: newVal }),
      })
    } catch (err) {
      console.error('Failed to persist allowPaidFallback setting:', err)
    }
  }

  const handleTaskRoutingChange = async (taskKey: string, provider: string) => {
    const previous = { ...taskRouting }
    const updated = { ...taskRouting }
    if (!provider || provider === 'auto') {
      delete updated[taskKey]
    } else {
      updated[taskKey] = provider
    }
    setTaskRouting(updated)

    try {
      const res = await fetchWithAuth('/api/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskRouting: updated }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.taskRouting && typeof data.taskRouting === 'object') {
          setTaskRouting(data.taskRouting)
        }
      } else {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to save task routing preference:', err)
        setTaskRouting(previous)
      }
    } catch (err) {
      console.error('Failed to save task routing preference:', err)
      setTaskRouting(previous)
    }
  }

  const openAddModal = (provider: 'gemini' | 'openrouter' | 'groq') => {
    setFormProvider(provider)
    setFormFriendlyName('')
    setFormApiKey('')
    setFormCostTier('FREE_TIER')
    setFormProjectScope('')
    setShowFormKey(false)
    setIsAddModalOpen(true)
  }

  const handleOpenEditModal = (cred: CredentialItem) => {
    setEditingCred(cred)
    setEditFriendlyName(cred.friendlyName)
    setEditApiKey('')
    setEditCostTier(cred.costTier)
    setEditProjectScope(
      cred.projectScope && cred.projectScope !== 'Default Scope' && cred.projectScope !== 'default_scope'
        ? cred.projectScope
        : ''
    )
    setShowEditKey(false)
  }

  const handleUpdateCredential = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCred) return

    if (!editFriendlyName.trim()) {
      alert('Credential name is required.')
      return
    }

    setIsUpdatingCred(true)
    const payload: {
      friendlyName: string
      costTier: 'FREE_TIER' | 'PAID_TIER'
      projectScope?: {
        scope_id: string
        scope_type: 'USER_DECLARED_PROJECT' | 'UNVERIFIED_UNIQUE'
        verified: boolean
      }
      apiKey?: string
    } = {
      friendlyName: editFriendlyName.trim(),
      costTier: editCostTier,
    }

    if (editingCred.provider === 'gemini') {
      payload.projectScope = editProjectScope.trim()
        ? {
            scope_id: editProjectScope.trim(),
            scope_type: 'USER_DECLARED_PROJECT',
            verified: false,
          }
        : {
            scope_id: 'default_scope',
            scope_type: 'UNVERIFIED_UNIQUE',
            verified: false,
          }
    }

    if (editApiKey.trim()) {
      payload.apiKey = editApiKey.trim()
    }

    try {
      const res = await fetchWithAuth(`/api/v1/ai/credentials/${editingCred.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Failed to update credential: ${err.detail || 'Unknown error'}`)
        return
      }

      const updated = await res.json()
      const updatedCred: CredentialItem = {
        id: updated.credentialId,
        provider: updated.provider,
        friendlyName: updated.friendlyName,
        maskedKey: updated.maskedApiKey,
        projectScope: updated.projectScope?.scope_id || 'Default Scope',
        scopeType: updated.projectScope?.scope_type || 'UNVERIFIED_UNIQUE',
        costTier: updated.costTier || 'FREE_TIER',
        healthStatus: editingCred.healthStatus,
        isActive: updated.enabled,
        createdAt: updated.createdAt,
      }

      setCredentials((prev) =>
        prev.map((c) => (c.id === updatedCred.id ? updatedCred : c))
      )
      setEditingCred(null)
      await refreshHealth()
    } catch (err) {
      console.error('Error updating credential:', err)
      alert('Network or server error while updating credential.')
    } finally {
      setIsUpdatingCred(false)
    }
  }

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formApiKey.trim()) {
      alert('API Key is required.')
      return
    }

    setIsSavingCred(true)
    const payload = {
      provider: formProvider,
      friendlyName: formFriendlyName.trim() || `${formProvider.toUpperCase()} Key`,
      apiKey: formApiKey.trim(),
      costTier: formCostTier,
      projectScope:
        formProvider === 'gemini' && formProjectScope.trim()
          ? {
              scope_id: formProjectScope.trim(),
              scope_type: 'USER_DECLARED_PROJECT',
              verified: false,
            }
          : undefined,
      enabled: true,
    }

    try {
      const res = await fetchWithAuth('/api/v1/ai/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(`Failed to save credential: ${err.detail || 'Unknown error'}`)
        return
      }

      const saved = await res.json()
      const newCred: CredentialItem = {
        id: saved.credentialId,
        provider: saved.provider,
        friendlyName: saved.friendlyName,
        maskedKey: saved.maskedApiKey,
        projectScope: saved.projectScope?.scope_id || 'Default Scope',
        scopeType: saved.projectScope?.scope_type || 'UNVERIFIED_UNIQUE',
        costTier: saved.costTier || 'FREE_TIER',
        healthStatus: 'HEALTHY',
        isActive: saved.enabled,
        createdAt: saved.createdAt,
      }

      setCredentials((prev) => [...prev, newCred])
      setIsAddModalOpen(false)
      setFormFriendlyName('')
      setFormApiKey('')
      setFormProjectScope('')
      await refreshHealth()
    } catch (err) {
      console.error('Error adding credential:', err)
      alert('Network or server error while saving credential.')
    } finally {
      setIsSavingCred(false)
    }
  }

  // Filtered views and metrics
  const activeMeta = PROVIDERS_META.find((p) => p.id === selectedProviderTab)!
  const providerCreds = credentials.filter((c) => c.provider === selectedProviderTab)

  const configuredProvidersCount = ['gemini', 'openrouter', 'groq'].filter((p) =>
    credentials.some((c) => c.provider === p)
  ).length

  const getProviderStatusBadge = (providerId: 'gemini' | 'openrouter' | 'groq') => {
    const creds = credentials.filter((c) => c.provider === providerId)
    if (creds.length === 0) {
      return {
        label: 'Not configured',
        classes: 'bg-zinc-800 text-zinc-400 border-zinc-700',
        dot: 'bg-zinc-500',
      }
    }
    const hasActiveCooldown = healthData?.activeCooldowns?.some((cd) =>
      creds.some((c) => c.id === cd.credentialId)
    )
    const hasUnhealthy = creds.some((c) => {
      const st = healthData?.credentialStatuses[c.id] || c.healthStatus
      return st !== 'HEALTHY'
    })
    const adapter = healthData?.providers?.find((p) => p.provider === providerId)
    const adapterFailed = adapter && !adapter.operational

    if (hasActiveCooldown || hasUnhealthy || adapterFailed) {
      return {
        label: 'Needs attention',
        classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
        dot: 'bg-amber-400',
      }
    }
    return {
      label: 'Healthy',
      classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-400',
    }
  }

  // Filtered models for catalog modal
  const filteredCatalogModels = models.filter((m) => {
    const matchProvider = catalogFilterProvider === 'all' || m.provider === catalogFilterProvider
    const matchQuery =
      catalogSearch === '' ||
      m.modelId.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      m.displayName.toLowerCase().includes(catalogSearch.toLowerCase())
    return matchProvider && matchQuery
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* 1. Compact Page Header & Status Strip */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-400" />
              AI / API Hub
            </h2>
            <p className="text-xs text-primary-secondary mt-0.5">
              Manage your AI providers, credentials and routing.
            </p>
          </div>
          <div className="text-[11px] text-primary-secondary flex items-center gap-1.5 self-start sm:self-auto">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>AES-256-GCM Vault</span>
          </div>
        </div>

        {/* Compact Status Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div className="bg-surface-subtle p-2.5 rounded-lg border border-border flex flex-col justify-between">
            <span className="text-[10px] uppercase font-semibold text-primary-secondary tracking-wider">
              Configured Providers
            </span>
            <span className="text-sm font-bold text-white mt-1">
              {isLoading ? '...' : `${configuredProvidersCount} of 3`}
            </span>
            <span className="text-[10px] text-primary-secondary">Active in vault</span>
          </div>

          <div className="bg-surface-subtle p-2.5 rounded-lg border border-border flex flex-col justify-between">
            <span className="text-[10px] uppercase font-semibold text-primary-secondary tracking-wider">
              System Health
            </span>
            <span className="text-sm font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isLoading ? '...' : healthData?.healthyCredentialsCount ? 'Operational' : 'Ready'}
            </span>
            <span className="text-[10px] text-primary-secondary">
              {healthData?.activeCooldowns?.length || 0} active cooldowns
            </span>
          </div>

          <div className="bg-surface-subtle p-2.5 rounded-lg border border-border flex flex-col justify-between">
            <span className="text-[10px] uppercase font-semibold text-primary-secondary tracking-wider">
              AI Requests
            </span>
            <span className="text-sm font-bold text-white mt-1">
              {isLoading ? '...' : telemetrySummary ? telemetrySummary.totalRequests : 0}
            </span>
            <span className="text-[10px] text-primary-secondary">
              {telemetrySummary && telemetrySummary.totalRequests > 0
                ? `${telemetrySummary.successRate}% success rate`
                : 'No requests yet'}
            </span>
          </div>

          <div className="bg-surface-subtle p-2.5 rounded-lg border border-border flex flex-col justify-between">
            <span className="text-[10px] uppercase font-semibold text-primary-secondary tracking-wider">
              Active Cost Policy
            </span>
            <span className="text-sm font-bold text-emerald-400 mt-1 truncate">
              {costPolicy === 'FREE_ONLY'
                ? 'Free Only ($0)'
                : costPolicy === 'FREE_PREFERRED'
                ? 'Free Preferred'
                : 'Any Configured'}
            </span>
            <span className="text-[10px] text-primary-secondary">
              {costPolicy === 'FREE_PREFERRED' && allowPaidFallback
                ? 'Paid fallback enabled'
                : 'Zero-cost strictly enforced'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Layout: Graph Gets Priority & Full Width */}
      <div className="space-y-6">
        {/* AREA A: PROVIDERS & CREDENTIALS */}
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4 shadow-sm">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                AI Providers &amp; Credentials
              </h3>
              <p className="text-xs text-primary-secondary mt-0.5">
                Configure your API keys per provider. Credentials belong to your private account pool.
              </p>
            </div>

            {/* Top-Level Provider Tabs */}
            <div className="flex flex-wrap gap-2">
              {PROVIDERS_META.map((p) => {
                const count = credentials.filter((c) => c.provider === p.id).length
                const isSelected = selectedProviderTab === p.id

                return (
                  <button
                    key={p.id}
                    data-testid={`provider-tab-${p.id}`}
                    type="button"
                    onClick={() => setSelectedProviderTab(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-500 text-black shadow-sm shadow-emerald-500/20'
                        : 'bg-surface-subtle text-primary-secondary hover:text-white border border-border'
                    }`}
                  >
                    <span>{p.name}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        isSelected
                          ? 'bg-black/20 text-black'
                          : 'bg-surface text-primary-secondary border border-border'
                      }`}
                    >
                      {count} {count === 1 ? 'key' : 'keys'}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Provider Context Banner & CTA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{activeMeta.name}</h4>
                <p className="text-xs text-primary-secondary mt-0.5">{activeMeta.description}</p>
              </div>

              {providerCreds.length > 0 && (
                <button
                  type="button"
                  onClick={() => openAddModal(selectedProviderTab)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black flex items-center gap-1.5 transition-all shadow-sm shadow-emerald-500/20 cursor-pointer self-start sm:self-auto shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Add {activeMeta.shortName} Credential
                </button>
              )}
            </div>

            {/* Contextual Quota Warning (Provider-Specific, Not Global) */}
            {activeMeta.quotaGuidance && (
              <div className="bg-surface-subtle/80 border border-border rounded-lg p-3 flex items-start gap-2.5 text-xs text-primary-secondary">
                <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">Provider Guidance:</span> {activeMeta.quotaGuidance}
                </div>
              </div>
            )}

            {/* Provider Credential Table OR Intentional Empty State */}
            {providerCreds.length === 0 ? (
              <div className="bg-surface-subtle/60 border border-dashed border-border rounded-xl p-8 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-primary-secondary mx-auto">
                  <Key className="w-5 h-5 text-emerald-400/80" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">No {activeMeta.name} credentials configured</h4>
                  <p className="text-xs text-primary-secondary mt-1 max-w-md mx-auto">
                    Add a {activeMeta.shortName} API key to enable {activeMeta.shortName} models for your JobFinder AI tasks.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAddModal(selectedProviderTab)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black inline-flex items-center gap-1.5 transition-all shadow-sm shadow-emerald-500/20 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add {activeMeta.shortName} Credential
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/80">
                <table data-testid="credentials-table" className="w-full text-left text-xs text-primary-secondary">
                  <thead className="bg-surface-subtle/80 text-white font-medium border-b border-border text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">Masked Key</th>
                      <th className="py-2.5 px-3">Routing Cost Tier</th>
                      {selectedProviderTab === 'gemini' && <th className="py-2.5 px-3">Project Scope</th>}
                      <th className="py-2.5 px-3">Health</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {providerCreds.map((cred) => {
                      const probe = probeResults[cred.id]
                      const isProbing = probingCredId === cred.id
                      const statusInHealth = healthData?.credentialStatuses[cred.id] || cred.healthStatus

                      return (
                        <tr key={cred.id} className="hover:bg-surface-subtle/40 transition-colors">
                          <td className="py-3 px-3 font-medium text-white">{cred.friendlyName}</td>
                          <td className="py-3 px-3 font-mono text-[11px] text-primary-secondary">
                            {cred.maskedKey}
                          </td>
                          <td className="py-3 px-3 text-[11px]">
                            <span
                              className={`px-2 py-0.5 rounded font-mono font-medium border ${
                                cred.costTier === 'FREE_TIER'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              }`}
                            >
                              {cred.costTier === 'FREE_TIER' ? 'Free Tier' : 'Paid Tier'}
                            </span>
                          </td>
                          {selectedProviderTab === 'gemini' && (
                            <td className="py-3 px-3 text-[11px] text-primary-secondary font-mono">
                              {cred.projectScope}
                            </td>
                          )}
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border w-max ${
                                  statusInHealth === 'HEALTHY'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : statusInHealth === 'COOLDOWN'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    statusInHealth === 'HEALTHY'
                                      ? 'bg-emerald-400'
                                      : statusInHealth === 'COOLDOWN'
                                      ? 'bg-amber-400'
                                      : 'bg-red-400'
                                  }`}
                                />
                                {statusInHealth}
                              </span>
                              {probe && (
                                <span className="text-[10px] text-primary-secondary">
                                  {probe.success ? `Probe OK (${probe.latencyMs}ms)` : probe.message}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleTestConnection(cred.id)}
                              disabled={isProbing}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-surface-subtle hover:bg-surface border border-border text-primary-secondary hover:text-white transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                              title="Test connection to provider endpoint"
                            >
                              {isProbing ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  Testing...
                                </>
                              ) : (
                                'Test Connection'
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(cred.id)}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                                cred.isActive
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                              }`}
                            >
                              {cred.isActive ? 'Active' : 'Disabled'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(cred)}
                              className="p-1 rounded text-primary-secondary hover:text-white hover:bg-surface transition-colors cursor-pointer inline-flex items-center"
                              title="Edit credential"
                              aria-label={`Edit ${cred.friendlyName}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingCred(cred)}
                              className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer inline-flex items-center"
                              title="Delete credential"
                              aria-label={`Delete ${cred.friendlyName}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* AREA B: TASK ROUTING — VISUAL ROUTING MAP 2.0 (INTERACTIVE N8N-STYLE EDITOR) */}
          <TaskRoutingMapEditor
            taskRouting={taskRouting}
            credentials={credentials}
            costPolicy={costPolicy}
            onSaveRoute={async (taskKey, targetId) => {
              await handleTaskRoutingChange(taskKey, targetId)
            }}
            onRemoveRoute={async (taskKey) => {
              await handleTaskRoutingChange(taskKey, 'auto')
            }}
            onAddCredentialClick={(provider) => {
              openAddModal(provider)
            }}
            activeCooldowns={(healthData?.activeCooldowns || []).map((cd) => cd.credentialId)}
          />

          {/* AREA C: COST POLICY */}
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4 shadow-sm">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-400" />
                Cost Policy
              </h3>
              <p className="text-xs text-primary-secondary mt-0.5">
                Set cost boundaries for JobFinder. Server-side policy ensures paid endpoints are blocked unless allowed.
              </p>
            </div>

            {/* 3 Compact Radio Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  costPolicy === 'FREE_ONLY'
                    ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm shadow-emerald-500/10'
                    : 'bg-surface-subtle border-border hover:border-border'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="costPolicy"
                        value="FREE_ONLY"
                        checked={costPolicy === 'FREE_ONLY'}
                        onChange={() => handleCostPolicyChange('FREE_ONLY')}
                        className="text-emerald-500 focus:ring-emerald-500"
                      />
                      Free Only
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      $0 Guaranteed
                    </span>
                  </div>
                  <p className="text-[11px] text-primary-secondary mt-2 leading-relaxed">
                    Only eligible free resources will be used. Paid models are blocked.
                  </p>
                </div>
              </label>

              <label
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  costPolicy === 'FREE_PREFERRED'
                    ? 'bg-blue-500/10 border-blue-500/50 shadow-sm shadow-blue-500/10'
                    : 'bg-surface-subtle border-border hover:border-border'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="costPolicy"
                        value="FREE_PREFERRED"
                        checked={costPolicy === 'FREE_PREFERRED'}
                        onChange={() => handleCostPolicyChange('FREE_PREFERRED')}
                        className="text-blue-500 focus:ring-blue-500"
                      />
                      Free Preferred
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                      Guarded Fallback
                    </span>
                  </div>
                  <p className="text-[11px] text-primary-secondary mt-2 leading-relaxed">
                    Free resources are preferred. Paid models are blocked unless fallback is enabled below.
                  </p>
                </div>
              </label>

              <label
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  costPolicy === 'ANY_CONFIGURED'
                    ? 'bg-purple-500/10 border-purple-500/50 shadow-sm shadow-purple-500/10'
                    : 'bg-surface-subtle border-border hover:border-border'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="costPolicy"
                        value="ANY_CONFIGURED"
                        checked={costPolicy === 'ANY_CONFIGURED'}
                        onChange={() => handleCostPolicyChange('ANY_CONFIGURED')}
                        className="text-purple-500 focus:ring-purple-500"
                      />
                      Any Configured
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      Unrestricted
                    </span>
                  </div>
                  <p className="text-[11px] text-primary-secondary mt-2 leading-relaxed">
                    Any eligible configured resource may be used based on model capability ranking.
                  </p>
                </div>
              </label>
            </div>

            {/* Contextual Paid Fallback Control: ONLY shown when relevant (FREE_PREFERRED) */}
            {costPolicy === 'FREE_PREFERRED' && (
              <div className="bg-surface-subtle p-3.5 rounded-lg border border-border flex items-center justify-between gap-4 animate-in fade-in duration-100">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Allow Paid Fallback
                  </div>
                  <p className="text-[11px] text-primary-secondary mt-0.5">
                    When free models exhaust quota, fail over to paid credentials rather than terminating the request.
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={allowPaidFallback}
                    onChange={(e) => handleAllowPaidFallbackChange(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500" />
                </label>
              </div>
            )}
          </div>

          {/* SUPPORTING / REFERENCE SECTION: System Status, How Routing Works, Model Catalog */}
          {/* Normal page flow, NOT sticky, 3-column grid below primary controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
            {/* CARD 1 — SYSTEM STATUS */}
            <div className="bg-surface rounded-xl border border-border p-4 space-y-3.5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    System Status
                  </h3>
                  <button
                    type="button"
                    onClick={refreshHealth}
                    disabled={isHealthRefreshing}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isHealthRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {/* Provider Status Rows */}
                <div className="space-y-2 mt-3">
                  {(['gemini', 'openrouter', 'groq'] as const).map((prov) => {
                    const badge = getProviderStatusBadge(prov)
                    const count = credentials.filter((c) => c.provider === prov).length
                    const name = prov === 'gemini' ? 'Gemini' : prov === 'openrouter' ? 'OpenRouter' : 'Groq'

                    return (
                      <div key={prov} className="flex items-center justify-between text-xs py-1">
                        <span className="text-white font-medium flex items-center gap-1.5">
                          {name}
                          <span className="text-[10px] text-primary-secondary">({count})</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${badge.classes}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Compact Metrics */}
              <div className="border-t border-border pt-2.5 space-y-1.5 text-xs text-primary-secondary mt-3">
                <div className="flex items-center justify-between">
                  <span>Configured Keys</span>
                  <span className="font-semibold text-white">
                    {healthData?.totalCredentialsCount ?? credentials.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active Cooldowns</span>
                  <span className="font-semibold text-white">
                    {healthData?.activeCooldowns?.length ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last Checked</span>
                  <span className="font-mono text-[10px] text-white">
                    {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleTimeString() : 'Never'}
                  </span>
                </div>
              </div>
            </div>

            {/* CARD 2 — HOW ROUTING WORKS */}
            <div className="bg-surface rounded-xl border border-border p-4 space-y-3 shadow-sm flex flex-col justify-between">
              <div>
                <div className="border-b border-border pb-2.5">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    How Routing Works
                  </h3>
                </div>

                <div className="space-y-2 text-xs mt-3">
                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <div className="font-semibold text-white">Model</div>
                      <div className="text-[11px] text-primary-secondary">
                        Fails over to adjacent model upon 429/503 rate limits.
                      </div>
                    </div>
                  </div>

                  <div className="pl-2 text-primary-secondary text-[10px]">↓</div>

                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <div className="font-semibold text-white">Credential</div>
                      <div className="text-[11px] text-primary-secondary">
                        Switches to distinct project key if current quota is exhausted.
                      </div>
                    </div>
                  </div>

                  <div className="pl-2 text-primary-secondary text-[10px]">↓</div>

                  <div className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <div className="font-semibold text-white">Provider</div>
                      <div className="text-[11px] text-primary-secondary">
                        Fails over across providers: Gemini → OpenRouter → Groq.
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-primary-secondary border-t border-border pt-2 leading-relaxed mt-2.5">
                  Automatic fallback keeps eligible AI tasks running when a candidate fails.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsRoutingDetailsModalOpen(true)}
                className="w-full text-center text-xs font-semibold text-emerald-400 hover:text-emerald-300 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer mt-2"
              >
                View details
              </button>
            </div>

            {/* CARD 3 — MODEL CATALOG SUMMARY */}
            <div className="bg-surface rounded-xl border border-border p-4 space-y-3 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    Model Catalog
                  </h3>
                  <span className="text-[10px] font-mono text-primary-secondary">
                    {models.length} known models
                  </span>
                </div>

                <div className="text-xs text-primary-secondary space-y-1.5 mt-3">
                  <div className="flex items-center justify-between">
                    <span>Gemini</span>
                    <span className="font-mono text-white">
                      {models.filter((m) => m.provider === 'gemini').length} models
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>OpenRouter</span>
                    <span className="font-mono text-white">
                      {models.filter((m) => m.provider === 'openrouter').length} models
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Groq</span>
                    <span className="font-mono text-white">
                      {models.filter((m) => m.provider === 'groq').length} models
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-primary-secondary pt-2 leading-relaxed border-t border-border mt-2.5">
                  Known catalog models. Access requires configuring an active credential for the respective provider.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(true)}
                className="w-full text-center text-xs font-semibold text-white hover:text-emerald-400 py-1.5 rounded-lg border border-border bg-surface-subtle hover:bg-surface transition-colors cursor-pointer mt-2"
              >
                View Model Catalog
              </button>
            </div>
          </div>

          {/* AREA D: RECENT AI ACTIVITY & USAGE */}
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Recent AI Activity</span>
                  <span className="text-xs font-normal text-primary-secondary">(Latest 5)</span>
                </h3>
                <p className="text-xs text-primary-secondary mt-0.5">
                  Audit trail of recent AI requests. Prompts and outputs are strictly stripped from logs.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href="#ai-activity"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  View Full Activity History &rarr;
                </a>
                <button
                  type="button"
                  onClick={refreshTelemetry}
                  disabled={isTelemetryRefreshing}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-subtle border border-border text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTelemetryRefreshing ? 'animate-spin' : ''}`} />
                  Refresh usage
                </button>
              </div>
            </div>

            {/* Compact Usage Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-surface-subtle p-2.5 rounded-lg border border-border text-center">
                <div className="text-[10px] uppercase font-semibold text-primary-secondary">Requests</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {telemetrySummary?.totalRequests ?? 0}
                </div>
              </div>
              <div className="bg-surface-subtle p-2.5 rounded-lg border border-border text-center">
                <div className="text-[10px] uppercase font-semibold text-primary-secondary">Success Rate</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {telemetrySummary?.totalRequests ? `${telemetrySummary.successRate}%` : '—'}
                </div>
              </div>
              <div className="bg-surface-subtle p-2.5 rounded-lg border border-border text-center">
                <div className="text-[10px] uppercase font-semibold text-primary-secondary">Avg Latency</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {telemetrySummary?.averageLatencyMs ? `${telemetrySummary.averageLatencyMs}ms` : '—'}
                </div>
              </div>
              <div className="bg-surface-subtle p-2.5 rounded-lg border border-border text-center">
                <div className="text-[10px] uppercase font-semibold text-primary-secondary">Fallbacks</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {telemetrySummary?.fallbackCount ?? 0}
                </div>
              </div>
            </div>

            {/* Activity Table */}
            <div className="overflow-x-auto rounded-lg border border-border/80">
              <table className="w-full text-left text-xs text-primary-secondary">
                <thead className="bg-surface-subtle/80 text-white font-medium border-b border-border text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Task</th>
                    <th className="py-2.5 px-3">Provider</th>
                    <th className="py-2.5 px-3">Credential</th>
                    <th className="py-2.5 px-3">Model</th>
                    <th className="py-2.5 px-3">Outcome</th>
                    <th className="py-2.5 px-3">Fallback</th>
                    <th className="py-2.5 px-3 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recentExecutions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-xs text-primary-secondary">
                        {isLoading
                          ? 'Loading activity...'
                          : 'No AI activity yet. When you generate tailored resumes, cover letters, or run scans, metrics appear here.'}
                      </td>
                    </tr>
                  ) : (
                    recentExecutions.slice(0, 5).map((item) => (
                      <tr key={item.executionId} className="hover:bg-surface-subtle/40 transition-colors">
                        <td className="py-2.5 px-3 text-[11px] font-mono text-primary-secondary whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-white">{item.task}</td>
                        <td className="py-2.5 px-3 uppercase text-[11px]">{item.providerUsed}</td>
                        <td className="py-2.5 px-3 text-[11px] text-white/90">
                          {credentials.find((c) => c.id === item.credentialIdUsed)?.friendlyName || item.credentialIdUsed || 'Default'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-emerald-400">
                          {item.modelUsed}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.success ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
                              <XCircle className="w-3.5 h-3.5" />
                              {item.failureCategory || 'Failed'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          {item.fallbackLevel === 0 ? (
                            <span className="text-primary-secondary">None</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              L{item.fallbackLevel} ({item.hopsCount} hops)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[11px] text-white">
                          {item.latencyMs}ms
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-primary-secondary">
                Showing {Math.min(5, recentExecutions.length)} most recent activities.
              </span>
              <a
                href="#ai-activity"
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
              >
                Open Recent AI Activities for full history, cursor pagination & hop traces &rarr;
              </a>
            </div>
          </div>
      </div>

      {/* MODAL 1: ADD CREDENTIAL MODAL (PORTAL BASED VIA SHARED MODAL) */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        maxWidth="md"
        title={
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <span>Add {activeMeta.shortName} Credential</span>
          </div>
        }
        description="Register a new provider API key to your encrypted personal vault."
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-secondary hover:text-white border border-border cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-credential-form"
              disabled={isSavingCred}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black cursor-pointer shadow-sm shadow-emerald-500/20 disabled:opacity-50 transition-all"
            >
              {isSavingCred ? 'Saving...' : 'Save Credential'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 text-xs text-emerald-300">
            <span className="font-semibold text-emerald-200">Encrypted Storage:</span> Keys are encrypted at rest with AES-256-GCM. Raw keys are never stored in plain Firestore or browser storage.
          </div>

          <form id="add-credential-form" onSubmit={handleAddCredential} className="space-y-3.5">
            {/* Read-Only Provider Indicator (No redundant dropdown selection) */}
            <div>
              <label className="block text-xs font-semibold text-white mb-1">Adding credential for</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-surface-subtle border border-border rounded-lg text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-semibold text-white">{activeMeta.name}</span>
                <span className="text-[10px] text-primary-secondary">({activeMeta.shortName} API)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white mb-1">Credential Name</label>
              <input
                type="text"
                placeholder={`e.g. My ${activeMeta.shortName} Key`}
                value={formFriendlyName}
                onChange={(e) => setFormFriendlyName(e.target.value)}
                className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-primary-secondary focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-white mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showFormKey ? 'text' : 'password'}
                  placeholder="Enter provider API key"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  required
                  className="w-full bg-surface-subtle border border-border rounded-lg pl-3 pr-9 py-1.5 text-xs text-white placeholder-primary-secondary font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowFormKey(!showFormKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary-secondary hover:text-white cursor-pointer"
                  aria-label={showFormKey ? 'Hide key' : 'Show key'}
                >
                  {showFormKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white mb-1">
                Routing Cost Tier
              </label>
              <select
                value={formCostTier}
                onChange={(e) => setFormCostTier(e.target.value as 'FREE_TIER' | 'PAID_TIER')}
                className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="FREE_TIER">Free Tier — $0 usage</option>
                <option value="PAID_TIER">Paid Tier — requires paid fallback permission</option>
              </select>
              <p className="text-[10px] text-primary-secondary mt-1">
                Controls whether this credential can be selected under the active cost policy.
              </p>
            </div>

            {/* Gemini-specific Project Scope field (hidden for OpenRouter and Groq) */}
            {formProvider === 'gemini' && (
              <div>
                <label className="block text-xs font-semibold text-white mb-1">
                  Google Cloud Project ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-gemini-project-123"
                  value={formProjectScope}
                  onChange={(e) => setFormProjectScope(e.target.value)}
                  className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-primary-secondary focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-primary-secondary mt-1">
                  Helps JobFinder identify Gemini credentials that share the same Google Cloud quota project. Multiple API keys from the same project share quota limits.
                </p>
              </div>
            )}
          </form>
        </div>
      </Modal>

      {/* MODAL 1B: EDIT CREDENTIAL MODAL (PORTAL BASED VIA SHARED MODAL) */}
      <Modal
        isOpen={editingCred !== null}
        onClose={() => setEditingCred(null)}
        maxWidth="md"
        title={
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-emerald-400" />
            <span>Edit Credential</span>
          </div>
        }
        description="Update credential metadata or replace the API key in your encrypted personal vault."
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingCred(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-secondary hover:text-white border border-border cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-credential-form"
              disabled={isUpdatingCred}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black cursor-pointer shadow-sm shadow-emerald-500/20 disabled:opacity-50 transition-all"
            >
              {isUpdatingCred ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </>
        }
      >
        {editingCred && (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 text-xs text-emerald-300">
              <span className="font-semibold text-emerald-200">Vault Security:</span> Changes are saved to your encrypted personal vault. Leaving the API key blank keeps your existing encrypted key intact.
            </div>

            <form id="edit-credential-form" onSubmit={handleUpdateCredential} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-white mb-1">Provider</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-subtle border border-border rounded-lg text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-white capitalize">
                    {PROVIDERS_META.find((p) => p.id === editingCred.provider)?.name || editingCred.provider}
                  </span>
                  <span className="text-[10px] text-primary-secondary font-mono">({editingCred.maskedKey})</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white mb-1">Credential Name</label>
                <input
                  type="text"
                  placeholder="e.g. My Primary Key"
                  value={editFriendlyName}
                  onChange={(e) => setEditFriendlyName(e.target.value)}
                  required
                  className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-primary-secondary focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-white">API Key (Optional Replacement)</label>
                  <span className="text-[10px] text-primary-secondary font-mono">
                    Current: {editingCred.maskedKey}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type={showEditKey ? 'text' : 'password'}
                    placeholder="Leave blank to keep existing key"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    className="w-full bg-surface-subtle border border-border rounded-lg pl-3 pr-9 py-1.5 text-xs text-white placeholder-primary-secondary font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditKey(!showEditKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary-secondary hover:text-white cursor-pointer"
                    aria-label={showEditKey ? 'Hide key' : 'Show key'}
                  >
                    {showEditKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-primary-secondary mt-1">
                  Leave empty to keep your existing encrypted key. Enter a new key only if you want to rotate it.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white mb-1">
                  Routing Cost Tier
                </label>
                <select
                  value={editCostTier}
                  onChange={(e) => setEditCostTier(e.target.value as 'FREE_TIER' | 'PAID_TIER')}
                  className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="FREE_TIER">Free Tier — $0 usage</option>
                  <option value="PAID_TIER">Paid Tier — requires paid fallback permission</option>
                </select>
                <p className="text-[10px] text-primary-secondary mt-1">
                  Controls whether this credential can be selected under the active cost policy.
                </p>
              </div>

              {editingCred.provider === 'gemini' && (
                <div>
                  <label className="block text-xs font-semibold text-white mb-1">
                    Google Cloud Project ID (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. my-gemini-project-123"
                    value={editProjectScope}
                    onChange={(e) => setEditProjectScope(e.target.value)}
                    className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-primary-secondary focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-primary-secondary mt-1">
                    Helps JobFinder identify Gemini credentials that share the same Google Cloud quota project. Multiple API keys from the same project share quota limits.
                  </p>
                </div>
              )}
            </form>
          </div>
        )}
      </Modal>

      {/* MODAL 2: KNOWN MODEL CATALOG MODAL (PORTAL BASED VIA SHARED MODAL) */}
      <Modal
        isOpen={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        maxWidth="4xl"
        bodyClassName="p-0"
        title={
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Known Model Catalog</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-subtle border border-border text-primary-secondary">
              {models.length} Registered
            </span>
          </div>
        }
        description="Verified models recognized across JobFinder adapters and their capability contracts."
        headerContent={
          <div className="px-6 py-3 flex items-center justify-between gap-4 text-xs text-primary-secondary flex-wrap bg-surface-subtle border-b border-border">
            <span className="flex items-center gap-1.5 max-w-lg">
              <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong>Catalog fact vs User access:</strong> A registered model is available to you only if you have configured an active credential for its provider.
              </span>
            </span>

            {/* Filter controls */}
            <div className="flex items-center gap-2">
              <select
                aria-label="Filter models by provider"
                value={catalogFilterProvider}
                onChange={(e) => setCatalogFilterProvider(e.target.value)}
                className="bg-surface border border-border rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="all">All Providers</option>
                <option value="gemini">Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
              </select>

              <input
                type="text"
                placeholder="Filter models..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="bg-surface border border-border rounded-lg px-2.5 py-1 text-xs text-white placeholder-primary-secondary focus:outline-none focus:border-emerald-500 w-36"
              />
            </div>
          </div>
        }
        footer={
          <button
            type="button"
            onClick={() => setIsCatalogModalOpen(false)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-surface border border-border hover:bg-surface-subtle cursor-pointer transition-colors"
          >
            Close
          </button>
        }
      >
        {/* Table Container with Opaque Sticky Headers so scrolling rows never bleed through */}
        <div className="overflow-y-auto max-h-[55vh]">
          <table className="w-full text-left text-xs text-primary-secondary border-collapse">
            <thead className="sticky top-0 z-20 bg-[#161616] text-white font-medium border-b border-border shadow-sm text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 bg-[#161616]">Model ID</th>
                <th className="py-3 px-4 bg-[#161616]">Provider</th>
                <th className="py-3 px-4 bg-[#161616]">Display Name</th>
                <th className="py-3 px-4 bg-[#161616]">Context Window</th>
                <th className="py-3 px-4 bg-[#161616]">Cost Tier</th>
                <th className="py-3 px-4 bg-[#161616]">Capabilities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-surface">
              {filteredCatalogModels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-primary-secondary">
                    No matching models found.
                  </td>
                </tr>
              ) : (
                filteredCatalogModels.map((model) => (
                  <tr key={model.modelId} className="hover:bg-surface-subtle/50 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-emerald-400 font-semibold">
                      {model.modelId}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-subtle border border-border text-white uppercase">
                        {model.provider}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-white">{model.displayName}</td>
                    <td className="py-2.5 px-4 text-[11px]">
                      {model.contextWindow.toLocaleString()} tokens
                    </td>
                    <td className="py-2.5 px-4 text-[11px]">
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono font-medium border ${
                          model.costTier === 'FREE'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        }`}
                      >
                        {model.costTier}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {model.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="px-1.5 py-0.5 rounded text-[9px] bg-surface-subtle border border-border text-primary-secondary"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* MODAL 3: ROUTING DETAILS MODAL (PORTAL BASED VIA SHARED MODAL) */}
      <Modal
        isOpen={isRoutingDetailsModalOpen}
        onClose={() => setIsRoutingDetailsModalOpen(false)}
        maxWidth="lg"
        title={
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>3-Tier Unified Fallback Architecture</span>
          </div>
        }
        description="Deterministic failover hierarchy enforced during every AI execution."
        footer={
          <button
            type="button"
            onClick={() => setIsRoutingDetailsModalOpen(false)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-surface border border-border hover:bg-surface-subtle cursor-pointer transition-colors"
          >
            Close
          </button>
        }
      >
        <div className="space-y-4 text-xs text-primary-secondary leading-relaxed">
          <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 space-y-1.5">
            <div className="font-semibold text-white flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                1
              </span>
              Level 1: Intra-Credential Model Fallback
            </div>
            <p>
              When a model encounters a 429 quota exhaustion or 503 high demand, the orchestrator applies a temporary 60-second cooldown on that model and instantly switches to the next capable model on the same credential.
            </p>
          </div>

          <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 space-y-1.5">
            <div className="font-semibold text-white flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                2
              </span>
              Level 2: Distinct Project / Credential Fallback
            </div>
            <p>
              If all models on a key fail, the orchestrator inspects other credentials for the same provider, skipping keys sharing the exact same Google Cloud project scope to avoid hitting shared project rate limits.
            </p>
          </div>

          <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 space-y-1.5">
            <div className="font-semibold text-white flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                3
              </span>
              Level 3: Cross-Provider Failover
            </div>
            <p>
              If all credentials for your preferred provider are exhausted, the orchestrator transparently dispatches to secondary providers (e.g. Gemini → OpenRouter → Groq) within your cost policy limits.
            </p>
          </div>
        </div>
      </Modal>

      {/* MODAL 4: DELETE CONFIRMATION MODAL (PORTAL BASED VIA SHARED COMPONENT) */}
      <DeleteConfirmModal
        isOpen={deletingCred !== null}
        title="Delete Provider Credential"
        itemName={deletingCred?.friendlyName}
        message="Are you sure you want to permanently delete this credential? This action will remove it from your AES-256-GCM encrypted vault in Cloud Firestore."
        onConfirm={handleConfirmDelete}
        onClose={() => setDeletingCred(null)}
      />
    </div>
  )
}
