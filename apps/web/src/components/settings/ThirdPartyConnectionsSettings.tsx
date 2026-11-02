import React, { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  Calendar,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Zap,
  Trash2,
  Loader2,
  Info,
  Sparkles,
} from 'lucide-react'
import { fetchWithAuth } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { Modal } from '../ui/Modal'

export interface ConnectionStatusDetails {
  calendarSummary?: string
  timeZone?: string
  storageUsage?: number
  storageLimit?: number
  [key: string]: unknown
}

export interface ConnectionStatus {
  service: 'gmail' | 'calendar' | 'drive'
  isConnected: boolean
  healthStatus: 'OPERATIONAL' | 'NEEDS_REAUTHORIZATION' | 'DISCONNECTED'
  accountEmail: string | null
  scope: string | null
  connectedAt: string | null
  details: ConnectionStatusDetails
  hasSendPermission: boolean
  hasReadPermission: boolean
}

interface TestProbeResult {
  service: string
  status: string
  latencyMs: number
  details?: Record<string, unknown>
}

interface DisconnectResult {
  service: string
  status: 'DISCONNECTED_AND_REVOKED' | 'DISCONNECTED_ALREADY_INACTIVE' | 'DISCONNECTED_LOCAL_ONLY_WARNING'
  message: string
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={`${className} shrink-0`} viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
)

export const ThirdPartyConnectionsSettings: React.FC = () => {
  const { user } = useAuth()
  const [statuses, setStatuses] = useState<Record<'gmail' | 'calendar' | 'drive', ConnectionStatus | null>>({
    gmail: null,
    calendar: null,
    drive: null,
  })
  const [connecting, setConnecting] = useState<'gmail' | 'calendar' | 'drive' | null>(null)
  const [loading, setLoading] = useState<Record<'gmail' | 'calendar' | 'drive', boolean>>({
    gmail: true,
    calendar: true,
    drive: true,
  })
  const [testing, setTesting] = useState<'gmail' | 'calendar' | 'drive' | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestProbeResult | null>>({})
  const [disconnectModal, setDisconnectModal] = useState<'gmail' | 'calendar' | 'drive' | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
  } | null>(null)

  const fetchServiceStatus = useCallback(async (service: 'gmail' | 'calendar' | 'drive') => {
    if (!user) {
      setLoading(prev => ({ ...prev, [service]: false }))
      return
    }
    setLoading(prev => ({ ...prev, [service]: true }))
    try {
      const res = await fetchWithAuth(`/api/v1/connections/google/${service}/status`)
      if (res.ok) {
        const data = await res.json()
        setStatuses(prev => ({ ...prev, [service]: data }))
      }
    } catch (err) {
      console.error(`Failed to fetch status for ${service}:`, err)
    } finally {
      setLoading(prev => ({ ...prev, [service]: false }))
    }
  }, [user])

  useEffect(() => {
    fetchServiceStatus('gmail')
    fetchServiceStatus('calendar')
    fetchServiceStatus('drive')
  }, [fetchServiceStatus])

  const handleConnect = async (service: 'gmail' | 'calendar' | 'drive', includeRead = false) => {
    setConnecting(service)
    try {
      const query = includeRead ? '?include_read=true' : ''
      const res = await fetchWithAuth(`/api/v1/connections/google/${service}/authorize${query}`)
      if (res.ok) {
        const data = await res.json()
        if (data.authorizationUrl) {
          window.location.href = data.authorizationUrl
          return
        }
      } else {
        const err = await res.json()
        setBanner({
          type: 'error',
          message: err.detail || `Failed to initiate ${service} authorization.`,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Connection error for ${service}.`
      setBanner({
        type: 'error',
        message: msg,
      })
    } finally {
      setConnecting(null)
    }
  }

  const handleTestConnection = async (service: 'gmail' | 'calendar' | 'drive') => {
    setTesting(service)
    try {
      const res = await fetchWithAuth(`/api/v1/connections/google/${service}/test`, {
        method: 'POST',
      })
      if (res.ok) {
        const data: TestProbeResult = await res.json()
        setTestResults(prev => ({ ...prev, [service]: data }))
        setBanner({
          type: 'success',
          message: `Google ${service.toUpperCase()} connection verified in ${data.latencyMs}ms!`,
        })
      } else {
        const err = await res.json()
        setBanner({
          type: 'error',
          message: err.detail || `Probe test failed for ${service}.`,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Error probing ${service}.`
      setBanner({
        type: 'error',
        message: msg,
      })
    } finally {
      setTesting(null)
    }
  }

  const handleConfirmDisconnect = async () => {
    if (!disconnectModal) return
    const service = disconnectModal
    setDisconnecting(true)
    try {
      const res = await fetchWithAuth(`/api/v1/connections/google/${service}/disconnect`, {
        method: 'POST',
      })
      if (res.ok) {
        const data: DisconnectResult = await res.json()
        if (data.status === 'DISCONNECTED_AND_REVOKED') {
          setBanner({
            type: 'success',
            message: data.message,
          })
        } else if (data.status === 'DISCONNECTED_ALREADY_INACTIVE') {
          setBanner({
            type: 'info',
            message: data.message,
          })
        } else {
          setBanner({
            type: 'warning',
            message: data.message,
          })
        }
        await fetchServiceStatus(service)
      } else {
        const err = await res.json()
        setBanner({
          type: 'error',
          message: err.detail || `Disconnect failed for ${service}.`,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Error disconnecting ${service}.`
      setBanner({
        type: 'error',
        message: msg,
      })
    } finally {
      setDisconnecting(false)
      setDisconnectModal(null)
    }
  }

  const formatQuota = (usageBytes?: unknown, limitBytes?: unknown) => {
    const numUsage = typeof usageBytes === 'number' ? usageBytes : undefined
    const numLimit = typeof limitBytes === 'number' ? limitBytes : undefined
    if (numUsage === undefined && numLimit === undefined) return null
    const formatGb = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(1)
    if (numLimit !== undefined) {
      return `${formatGb(numUsage || 0)} GB of ${formatGb(numLimit)} GB used`
    }
    return `${formatGb(numUsage || 0)} GB used`
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-150" data-testid="third-party-connections-tab">
      {/* Informational Header Strip */}
      <div className="bg-surface p-4 rounded-xl border border-border flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Verified Google Workspace Integrations
          </h2>
          <p className="text-xs text-primary-secondary mt-0.5">
            Connect your personal Google accounts for cold outreach, interview scheduling, and resume archiving.
            All credentials are encrypted at rest with AES-256-GCM.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-primary-secondary bg-surface-subtle px-3 py-1.5 rounded-lg border border-border">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Independent OAuth Isolation Active</span>
        </div>
      </div>

      {/* Contextual Feedback Banner */}
      {banner && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
            banner.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : banner.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : banner.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {banner.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
            {banner.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0" />}
            {banner.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span>{banner.message}</span>
          </div>
          <button
            onClick={() => setBanner(null)}
            className="text-xs hover:underline opacity-80 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Grid of 3 Independent Integration Cards */}
      <div className="grid grid-cols-1 gap-6">
        {/* =================================================================== */}
        {/* CARD 1: Google Gmail */}
        {/* =================================================================== */}
        <div
          data-testid="connection-card-gmail"
          className="bg-surface p-6 rounded-xl border border-border hover:border-border/80 transition-all duration-200 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Google Gmail</h3>
                  {loading.gmail ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking...
                    </span>
                  ) : statuses.gmail?.isConnected ? (
                    statuses.gmail.healthStatus === 'OPERATIONAL' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Operational
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Needs Reauthorization
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      Disconnected
                    </span>
                  )}
                </div>
                <p className="text-xs text-primary-secondary mt-1">
                  Send personalized cold outreach to recruiters directly from your Gmail account with approved draft safety gates.
                </p>
              </div>
            </div>

            {/* Actions Header */}
            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
              {statuses.gmail?.isConnected ? (
                <>
                  <button
                    onClick={() => handleTestConnection('gmail')}
                    disabled={testing === 'gmail'}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface-subtle/80 text-white text-xs font-medium border border-border flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testing === 'gmail' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                  <button
                    onClick={() => setDisconnectModal('gmail')}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnect('gmail')}
                  disabled={connecting !== null}
                  className="w-52 h-9 rounded-lg bg-surface-subtle hover:bg-surface-hover active:bg-surface text-white text-xs font-medium border border-border-strong hover:border-neutral-500 flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50 shrink-0"
                >
                  {connecting === 'gmail' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-secondary" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Connect Gmail</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Connected Details Strip */}
          {statuses.gmail?.isConnected && (
            <div className="bg-surface-subtle p-4 rounded-lg border border-border space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-primary-secondary text-[11px] block">Authorized Gmail Address</span>
                  <span className="text-white font-mono font-medium">{statuses.gmail.accountEmail || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-primary-secondary text-[11px] block">Connected Since</span>
                  <span className="text-primary-secondary">
                    {statuses.gmail.connectedAt
                      ? new Date(statuses.gmail.connectedAt).toLocaleDateString()
                      : 'Active'}
                  </span>
                </div>
              </div>

              {/* Incremental Reply Tracking Capability */}
              <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    Automatic Reply Tracking:
                  </span>
                  {statuses.gmail.hasReadPermission ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-medium">
                      Enabled (gmail.readonly authorized)
                    </span>
                  ) : (
                    <span className="text-[10px] text-primary-secondary bg-surface px-2 py-0.5 rounded border border-border">
                      Not Enabled (Send-Only Mode)
                    </span>
                  )}
                </div>
                {!statuses.gmail.hasReadPermission && (
                  <button
                    onClick={() => handleConnect('gmail', true)}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    Enable Reply Tracking &rarr;
                  </button>
                )}
              </div>

              {/* Probe Latency display */}
              {testResults['gmail'] && (
                <div className="text-[11px] text-emerald-400 bg-emerald-500/5 p-2 rounded border border-emerald-500/20 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Probe latency: <strong>{testResults['gmail'].latencyMs}ms</strong>. Operational readiness confirmed.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* CARD 2: Google Calendar */}
        {/* =================================================================== */}
        <div
          data-testid="connection-card-calendar"
          className="bg-surface p-6 rounded-xl border border-border hover:border-border/80 transition-all duration-200 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Google Calendar</h3>
                  {loading.calendar ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking...
                    </span>
                  ) : statuses.calendar?.isConnected ? (
                    statuses.calendar.healthStatus === 'OPERATIONAL' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Operational
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Needs Reauthorization
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      Disconnected
                    </span>
                  )}
                </div>
                <p className="text-xs text-primary-secondary mt-1">
                  Synchronize recruiter interview invitations, phone screens, and follow-up deadlines with your primary calendar.
                </p>
              </div>
            </div>

            {/* Actions Header */}
            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
              {statuses.calendar?.isConnected ? (
                <>
                  <button
                    onClick={() => handleTestConnection('calendar')}
                    disabled={testing === 'calendar'}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface-subtle/80 text-white text-xs font-medium border border-border flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testing === 'calendar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                  <button
                    onClick={() => setDisconnectModal('calendar')}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnect('calendar')}
                  disabled={connecting !== null}
                  className="w-52 h-9 rounded-lg bg-surface-subtle hover:bg-surface-hover active:bg-surface text-white text-xs font-medium border border-border-strong hover:border-neutral-500 flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50 shrink-0"
                >
                  {connecting === 'calendar' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-secondary" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Connect Google Calendar</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Connected Details Strip */}
          {statuses.calendar?.isConnected && (
            <div className="bg-surface-subtle p-4 rounded-lg border border-border space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-primary-secondary text-[11px] block">Google Account</span>
                  <span className="text-white font-mono font-medium">{statuses.calendar.accountEmail || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-primary-secondary text-[11px] block">Primary Calendar</span>
                  <span className="text-white font-medium">
                    {String(statuses.calendar.details?.calendarSummary || 'Primary')}
                  </span>
                </div>
                <div>
                  <span className="text-primary-secondary text-[11px] block">Time Zone</span>
                  <span className="text-primary-secondary">
                    {String(statuses.calendar.details?.timeZone || 'System Default')}
                  </span>
                </div>
              </div>

              {testResults['calendar'] && (
                <div className="text-[11px] text-emerald-400 bg-emerald-500/5 p-2 rounded border border-emerald-500/20 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Probe latency: <strong>{testResults['calendar'].latencyMs}ms</strong>. Primary calendar reachable.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* CARD 3: Google Drive */}
        {/* =================================================================== */}
        <div
          data-testid="connection-card-drive"
          className="bg-surface p-6 rounded-xl border border-border hover:border-border/80 transition-all duration-200 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Google Drive</h3>
                  {loading.drive ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking...
                    </span>
                  ) : statuses.drive?.isConnected ? (
                    statuses.drive.healthStatus === 'OPERATIONAL' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Operational
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Needs Reauthorization
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-subtle text-primary-secondary border border-border">
                      Disconnected
                    </span>
                  )}
                </div>
                <p className="text-xs text-primary-secondary mt-1">
                  Export and automatically archive tailored ATS resumes (PDF), cover letters, and company research briefs into your Google Drive.
                </p>
              </div>
            </div>

            {/* Actions Header */}
            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
              {statuses.drive?.isConnected ? (
                <>
                  <button
                    onClick={() => handleTestConnection('drive')}
                    disabled={testing === 'drive'}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface-subtle/80 text-white text-xs font-medium border border-border flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testing === 'drive' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                  <button
                    onClick={() => setDisconnectModal('drive')}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnect('drive')}
                  disabled={connecting !== null}
                  className="w-52 h-9 rounded-lg bg-surface-subtle hover:bg-surface-hover active:bg-surface text-white text-xs font-medium border border-border-strong hover:border-neutral-500 flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50 shrink-0"
                >
                  {connecting === 'drive' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-secondary" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Connect Google Drive</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Connected Details Strip */}
          {statuses.drive?.isConnected && (
            <div className="bg-surface-subtle p-4 rounded-lg border border-border space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-primary-secondary text-[11px] block">Google Account</span>
                  <span className="text-white font-mono font-medium">{statuses.drive.accountEmail || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-primary-secondary text-[11px] block">Storage Quota</span>
                  <span className="text-primary-secondary">
                    {formatQuota(
                      statuses.drive.details?.storageUsage,
                      statuses.drive.details?.storageLimit
                    ) || 'Available'}
                  </span>
                </div>
              </div>

              {testResults['drive'] && (
                <div className="text-[11px] text-emerald-400 bg-emerald-500/5 p-2 rounded border border-emerald-500/20 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Probe latency: <strong>{testResults['drive'].latencyMs}ms</strong>. Storage quota verified.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Disconnect Confirmation Modal */}
      {disconnectModal && (
        <Modal
          isOpen={true}
          onClose={() => setDisconnectModal(null)}
          title={`Disconnect Google ${disconnectModal.toUpperCase()}?`}
        >
          <div className="space-y-4">
            <p className="text-xs text-primary-secondary">
              Disconnecting will purge your encrypted credentials from JobFinder and revoke the authorization grant with Google.
              Because separate OAuth clients are used, your other Google services (if connected) will remain unaffected.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDisconnectModal(null)}
                className="px-3.5 py-1.5 rounded-lg border border-border text-xs text-primary-secondary hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDisconnect}
                disabled={disconnecting}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Confirm Disconnect
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
