import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Layers,
  FileText,
  Sparkles,
  Zap,
  Bot,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  X,
  Info,
  Plus,
  Minus,
} from 'lucide-react'
import { Modal } from '../ui/Modal'

export interface CredentialItem {
  id?: string
  credentialId?: string
  provider: 'gemini' | 'openrouter' | 'groq' | string
  friendlyName: string
  maskedKey?: string
  maskedApiKey?: string
  costTier?: 'FREE_TIER' | 'PAID_TIER'
  isActive?: boolean
  enabled?: boolean
  healthStatus?: string
}

const getCredId = (c: CredentialItem): string => c.credentialId || c.id || ''
const getMaskedKey = (c: CredentialItem): string => c.maskedApiKey || c.maskedKey || ''

const getFriendlyCredentialName = (cred: CredentialItem, index: number): string => {
  if (cred.friendlyName && cred.friendlyName.trim()) {
    return cred.friendlyName.trim()
  }
  const prov = (cred.provider || '').toLowerCase()
  if (prov === 'gemini') return `Gemini API Key ${index + 1}`
  if (prov === 'openrouter') return `OpenRouter Key ${index + 1}`
  if (prov === 'groq') return `Groq Key ${index + 1}`
  return `Key ${index + 1}`
}

export interface TaskDefinition {
  key: string
  name: string
  badge: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const TASK_DEFINITIONS: TaskDefinition[] = [
  {
    key: 'resume_generation',
    name: 'Resume Tailoring',
    badge: 'Truth-Lock',
    description: 'Generates tailored resume content grounded in verified profile facts.',
    icon: FileText,
  },
  {
    key: 'cover_letter_generation',
    name: 'Cover Letter Generation',
    badge: 'Pydantic Schema',
    description: 'Generates personalized cover-letter content from job requirements.',
    icon: Sparkles,
  },
  {
    key: 'ats_bulk_rewrite',
    name: 'ATS Scanner & Rewriter',
    badge: 'Fast Inference',
    description: 'Rewrites resume content and improves alignment with target requirements.',
    icon: Zap,
  },
  {
    key: 'qa_copilot',
    name: 'Q&A Co-pilot Answerer',
    badge: 'Deterministic',
    description: 'Generates grounded answers for application questions.',
    icon: Bot,
  },
  {
    key: 'resume_parsing',
    name: 'Resume PDF Parser',
    badge: 'Long Context',
    description: 'Extracts structured experience, skills, and project information.',
    icon: FileText,
  },
  {
    key: 'job_ingestion',
    name: 'Job Discovery & Ingestion',
    badge: 'Fast Extraction',
    description: 'Extracts standardized job information from captured job sources.',
    icon: Sliders,
  },
]

const PROVIDERS_INFO: Array<{
  id: 'gemini' | 'openrouter' | 'groq'
  name: string
  shortName: string
  description: string
}> = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    description: 'Deep reasoning, 1M+ context window, native JSON schema enforcement.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    description: 'Multi-model hub with open weights, Llama 3.3, and free inference endpoints.',
  },
  {
    id: 'groq',
    name: 'Groq',
    shortName: 'Groq',
    description: 'Ultra-low latency LPU inference for real-time ATS scoring and rapid rewriting.',
  },
]

interface TaskRoutingMapEditorProps {
  taskRouting: Record<string, string>
  credentials: CredentialItem[]
  costPolicy: 'FREE_ONLY' | 'FREE_PREFERRED' | 'ANY_CONFIGURED'
  onSaveRoute: (taskKey: string, targetId: string) => Promise<void>
  onRemoveRoute: (taskKey: string) => Promise<void>
  onAddCredentialClick?: (provider: 'gemini' | 'openrouter' | 'groq') => void
  activeCooldowns?: string[]
}

interface Coords {
  x: number
  y: number
}

export const TaskRoutingMapEditor: React.FC<TaskRoutingMapEditorProps> = ({
  taskRouting,
  credentials,
  costPolicy,
  onSaveRoute,
  onRemoveRoute,
  onAddCredentialClick,
  activeCooldowns = [],
}) => {
  const canvasRef = useRef<HTMLDivElement>(null)

  // Drag state
  const [dragSourceTask, setDragSourceTask] = useState<string | null>(null)
  const [dragCurrentCoords, setDragCurrentCoords] = useState<Coords | null>(null)
  const [hoveredDropTarget, setHoveredDropTarget] = useState<string | null>(null)

  // Connecting mode (click-to-connect for accessibility / touch)
  const [activeConnectingTask, setActiveConnectingTask] = useState<string | null>(null)

  // Modals state
  // 1. Task details modal (clicking task node body)
  const [viewingTaskKey, setViewingTaskKey] = useState<string | null>(null)
  // 2. Preferred route modal (clicking connection line)
  const [selectedRouteTask, setSelectedRouteTask] = useState<string | null>(null)
  const [hoveredRouteTask, setHoveredRouteTask] = useState<string | null>(null)

  // Expandable credentials per provider state (default all expanded)
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({
    gemini: true,
    openrouter: true,
    groq: true,
  })

  // Cost warning banner or toast state
  const [costWarningMessage, setCostWarningMessage] = useState<string | null>(null)

  // Handle coordinates cache: handleId -> relative {x, y}
  const [handlePositions, setHandlePositions] = useState<Record<string, Coords>>({})

  // Measure handle positions within canvas
  const updateHandlePositions = useCallback(() => {
    if (!canvasRef.current) return
    const canvasRect = canvasRef.current.getBoundingClientRect()
    const newPositions: Record<string, Coords> = {}
    const scrollLeft = canvasRef.current.scrollLeft || 0
    const scrollTop = canvasRef.current.scrollTop || 0

    // Find all elements with data-handle-id
    const handleElements = canvasRef.current.querySelectorAll<HTMLElement>('[data-handle-id]')
    handleElements.forEach((el) => {
      const handleId = el.getAttribute('data-handle-id')
      if (!handleId) return
      const rect = el.getBoundingClientRect()
      // If rect is 0 (e.g. in jsdom), provide deterministic fallback
      if (rect.width === 0 && rect.height === 0) {
        if (handleId.startsWith('task-')) {
          const idx = TASK_DEFINITIONS.findIndex((t) => `task-${t.key}` === handleId)
          newPositions[handleId] = { x: 350, y: 70 + (idx >= 0 ? idx : 0) * 125 }
        } else if (handleId.startsWith('provider-')) {
          const pIdx = PROVIDERS_INFO.findIndex((p) => `provider-${p.id}` === handleId)
          newPositions[handleId] = { x: 560, y: 140 + (pIdx >= 0 ? pIdx : 0) * 180 }
        } else if (handleId.startsWith('cred-')) {
          newPositions[handleId] = { x: 580, y: 180 }
        }
      } else {
        newPositions[handleId] = {
          x: rect.left - canvasRect.left + scrollLeft + rect.width / 2,
          y: rect.top - canvasRect.top + scrollTop + rect.height / 2,
        }
      }
    })

    setHandlePositions(newPositions)
  }, [])

  // Recalculate on render, resize, scroll, data change, or provider expansion toggle
  useEffect(() => {
    updateHandlePositions()
    const handleResize = () => updateHandlePositions()
    window.addEventListener('resize', handleResize)

    const canvasEl = canvasRef.current
    if (canvasEl) {
      canvasEl.addEventListener('scroll', handleResize)
    }

    // ResizeObserver if available
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && canvasEl) {
      ro = new ResizeObserver(() => updateHandlePositions())
      ro.observe(canvasEl)
    }

    const timer = setTimeout(() => updateHandlePositions(), 60)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (canvasEl) {
        canvasEl.removeEventListener('scroll', handleResize)
      }
      if (ro) ro.disconnect()
      clearTimeout(timer)
    }
  }, [updateHandlePositions, credentials, taskRouting, expandedProviders])

  // Map credentials by provider with friendly name defaults guaranteed
  const credentialsByProvider = useMemo(() => {
    const map: Record<string, CredentialItem[]> = {
      gemini: [],
      openrouter: [],
      groq: [],
    }
    credentials.forEach((c) => {
      const p = (c.provider || '').toLowerCase()
      if (map[p]) {
        map[p].push(c)
      }
    })
    return map
  }, [credentials])

  // Active routes mapping: taskKey -> targetId
  const activeRoutes = useMemo(() => {
    const routes: Array<{
      taskKey: string
      taskName: string
      targetId: string
      targetType: 'provider' | 'credential'
      targetName: string
      providerId: string
      isPaid: boolean
      isCooldown: boolean
    }> = []

    TASK_DEFINITIONS.forEach((task) => {
      const targetId = taskRouting[task.key]
      if (!targetId || targetId.toLowerCase() === 'auto' || targetId.trim() === '') return

      // Check if target is a provider
      const provider = PROVIDERS_INFO.find((p) => p.id === targetId.toLowerCase())
      if (provider) {
        routes.push({
          taskKey: task.key,
          taskName: task.name,
          targetId: provider.id,
          targetType: 'provider',
          targetName: provider.name,
          providerId: provider.id,
          isPaid: false,
          isCooldown: false,
        })
        return
      }

      // Check if target is a specific credential
      const cred = credentials.find((c) => getCredId(c) === targetId)
      if (cred) {
        const prov = PROVIDERS_INFO.find((p) => p.id === cred.provider.toLowerCase())
        const credId = getCredId(cred)
        const provCreds = credentialsByProvider[cred.provider.toLowerCase()] || []
        const credIdx = provCreds.findIndex((c) => getCredId(c) === credId)
        const friendlyName = getFriendlyCredentialName(cred, credIdx >= 0 ? credIdx : 0)

        routes.push({
          taskKey: task.key,
          taskName: task.name,
          targetId: credId,
          targetType: 'credential',
          targetName: `${prov ? prov.shortName : cred.provider} / ${friendlyName}`,
          providerId: cred.provider.toLowerCase(),
          isPaid: cred.costTier === 'PAID_TIER',
          isCooldown: activeCooldowns.includes(credId),
        })
      }
    })

    return routes
  }, [taskRouting, credentials, credentialsByProvider, activeCooldowns])

  // Count configured routes
  const routesCount = activeRoutes.length

  // Start dragging from task handle
  const handlePointerDownTask = (taskKey: string, e: React.PointerEvent) => {
    e.stopPropagation()
    setDragSourceTask(taskKey)
    setActiveConnectingTask(null)
    setCostWarningMessage(null)

    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect()
      const scrollLeft = canvasRef.current.scrollLeft || 0
      const scrollTop = canvasRef.current.scrollTop || 0
      setDragCurrentCoords({
        x: e.clientX - canvasRect.left + scrollLeft,
        y: e.clientY - canvasRect.top + scrollTop,
      })
    }
  }

  // Pointer move across canvas during drag
  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!dragSourceTask || !canvasRef.current) return
    const canvasRect = canvasRef.current.getBoundingClientRect()
    const scrollLeft = canvasRef.current.scrollLeft || 0
    const scrollTop = canvasRef.current.scrollTop || 0
    setDragCurrentCoords({
      x: e.clientX - canvasRect.left + scrollLeft,
      y: e.clientY - canvasRect.top + scrollTop,
    })

    // Detect hovered drop target handle under pointer
    const elemUnderPoint = document.elementFromPoint(e.clientX, e.clientY)
    const handleElem = elemUnderPoint?.closest<HTMLElement>('[data-target-id]')
    if (handleElem) {
      const targetId = handleElem.getAttribute('data-target-id')
      setHoveredDropTarget(targetId)
    } else {
      setHoveredDropTarget(null)
    }
  }

  // Check cost policy eligibility before routing
  const validateAndSaveRoute = async (taskKey: string, targetId: string) => {
    // Check if target is a paid credential under FREE_ONLY
    const cred = credentials.find((c) => getCredId(c) === targetId)
    if (cred && cred.costTier === 'PAID_TIER' && costPolicy === 'FREE_ONLY') {
      const provCreds = credentialsByProvider[cred.provider.toLowerCase()] || []
      const credIdx = provCreds.findIndex((c) => getCredId(c) === getCredId(cred))
      const fName = getFriendlyCredentialName(cred, credIdx >= 0 ? credIdx : 0)
      setCostWarningMessage(
        `"${fName}" is classified as Paid and cannot be routed under the Free Only cost policy. Change your Cost Policy to Free Preferred or Any Configured to route this task.`
      )
      return
    }

    setCostWarningMessage(null)
    await onSaveRoute(taskKey, targetId)
  }

  // Release pointer to complete drag
  const handleCanvasPointerUp = async (e: React.PointerEvent) => {
    if (!dragSourceTask) return

    const elemUnderPoint = document.elementFromPoint(e.clientX, e.clientY)
    const targetElem = elemUnderPoint?.closest<HTMLElement>('[data-target-id]')

    if (targetElem) {
      const targetId = targetElem.getAttribute('data-target-id')
      if (targetId) {
        await validateAndSaveRoute(dragSourceTask, targetId)
      }
    }

    setDragSourceTask(null)
    setDragCurrentCoords(null)
    setHoveredDropTarget(null)
  }

  // Click task handle for click-to-connect mode
  const handleTaskHandleClick = (taskKey: string) => {
    if (activeConnectingTask === taskKey) {
      setActiveConnectingTask(null)
    } else {
      setActiveConnectingTask(taskKey)
      setCostWarningMessage(null)
    }
  }

  // Click target handle to complete click-to-connect mode
  const handleTargetHandleClick = async (targetId: string) => {
    if (!activeConnectingTask) return
    await validateAndSaveRoute(activeConnectingTask, targetId)
    setActiveConnectingTask(null)
  }

  // Toggle credential list expansion for provider
  const toggleProviderExpansion = (providerId: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }))
  }

  // Cancel connecting/dragging/modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDragSourceTask(null)
        setDragCurrentCoords(null)
        setHoveredDropTarget(null)
        setActiveConnectingTask(null)
        setSelectedRouteTask(null)
        setViewingTaskKey(null)
        setCostWarningMessage(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4 shadow-sm w-full">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>Task Routing Map</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              2.0
            </span>
          </h3>
          <p className="text-xs text-primary-secondary mt-0.5">
            Interactive routing editor. Connect JobFinder AI tasks to preferred providers or individual credentials.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-[11px] font-mono text-primary-secondary">
            {routesCount === 0 ? '0 preferred routes' : `${routesCount} preferred route${routesCount > 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {/* COST WARNING ALERT */}
      {costWarningMessage && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 flex items-start justify-between gap-2 animate-in fade-in duration-150">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{costWarningMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setCostWarningMessage(null)}
            className="text-amber-400 hover:text-white cursor-pointer"
            aria-label="Dismiss warning"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HINT BAR */}
      <div className="bg-surface-subtle border border-border/80 rounded-lg px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-primary-secondary">
          <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {dragSourceTask || activeConnectingTask ? (
            <span className="text-emerald-300 font-medium">
              Connecting{' '}
              <strong className="text-white font-semibold">
                {TASK_DEFINITIONS.find((t) => t.key === (dragSourceTask || activeConnectingTask))?.name}
              </strong>{' '}
              → Click or release onto a provider or credential handle on the right (Esc to cancel).
            </span>
          ) : routesCount === 0 ? (
            <span>
              <strong>No preferred routes configured yet.</strong> Drag a connection from a task handle to a provider or credential to set its preferred route, or leave as Auto. Click any task node to view details.
            </span>
          ) : (
            <span>
              <strong>Tip:</strong> Drag from any task handle to route it. Click any task node for task details or Reset to Auto. Click any connection line to inspect or remove it.
            </span>
          )}
        </div>
        {(dragSourceTask || activeConnectingTask) && (
          <button
            type="button"
            onClick={() => {
              setDragSourceTask(null)
              setActiveConnectingTask(null)
            }}
            className="text-primary-secondary hover:text-white text-[11px] underline cursor-pointer ml-2 shrink-0"
          >
            Cancel
          </button>
        )}
      </div>

      {/* ROUTING CANVAS — FULL WIDTH, CONTENT-DRIVEN DYNAMIC HEIGHT */}
      <div
        ref={canvasRef}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        className="relative bg-[#0d0d0d] rounded-xl border border-border p-4 sm:p-6 overflow-x-auto select-none"
      >
        {/* SVG CONNECTION OVERLAY */}
        <svg
          className="absolute top-0 left-0 w-full h-full min-w-full min-h-full pointer-events-none z-10 overflow-visible"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Emerald Arrowhead Marker */}
            <marker
              id="routing-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
            </marker>

            {/* Active Glowing Arrowhead Marker */}
            <marker
              id="routing-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#34d399" />
            </marker>

            {/* Subtle Emerald Glow Filter */}
            <filter id="emerald-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#10b981" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* RENDER SAVED ROUTES (CLICKABLE SVG EDGES) */}
          {activeRoutes.map((route) => {
            const sourceHandleId = `task-${route.taskKey}`
            // Dynamic anchor-resolution: when parent provider is collapsed, route visually anchors to provider handle
            const isProviderCollapsed =
              route.targetType === 'credential' && expandedProviders[route.providerId] === false
            const targetHandleId = isProviderCollapsed
              ? `provider-${route.providerId}`
              : route.targetType === 'provider'
                ? `provider-${route.targetId}`
                : `cred-${route.targetId}`

            const sourceCoords = handlePositions[sourceHandleId]
            const targetCoords = handlePositions[targetHandleId]

            if (!sourceCoords || !targetCoords) return null

            const isHovered = hoveredRouteTask === route.taskKey
            const isSelected = selectedRouteTask === route.taskKey
            const dx = Math.max(60, Math.abs(targetCoords.x - sourceCoords.x) * 0.48)

            const pathD = `M ${sourceCoords.x} ${sourceCoords.y} C ${sourceCoords.x + dx} ${sourceCoords.y}, ${targetCoords.x - dx} ${targetCoords.y}, ${targetCoords.x} ${targetCoords.y}`

            return (
              <g
                key={route.taskKey}
                data-testid={`route-edge-${route.taskKey}`}
                data-target-handle={targetHandleId}
                data-is-collapsed={isProviderCollapsed ? 'true' : 'false'}
                role="button"
                tabIndex={0}
                aria-label={`Inspect route for ${route.taskName}`}
                className="cursor-pointer pointer-events-auto focus:outline-none"
                onClick={() => setSelectedRouteTask(route.taskKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setSelectedRouteTask(route.taskKey)
                  }
                }}
                onMouseEnter={() => setHoveredRouteTask(route.taskKey)}
                onMouseLeave={() => setHoveredRouteTask(null)}
              >
                {/* Wide invisible path for effortless clicking / hit detection */}
                <path
                  d={pathD}
                  stroke="transparent"
                  strokeWidth="24"
                  fill="none"
                />

                {/* Base connection track */}
                <path
                  d={pathD}
                  stroke={isHovered || isSelected ? '#10b981' : '#059669'}
                  strokeWidth={isHovered || isSelected ? 2.5 : 1.75}
                  strokeOpacity={isHovered || isSelected ? 0.9 : 0.45}
                  strokeLinecap="round"
                  fill="none"
                  className="transition-all duration-200 motion-reduce:transition-none"
                />

                {/* Subtle animated emerald dashed flow for ALL saved routes */}
                <path
                  d={pathD}
                  stroke={isHovered || isSelected ? '#a7f3d0' : '#34d399'}
                  strokeWidth={isHovered || isSelected ? 2.5 : 1.75}
                  strokeLinecap="round"
                  fill="none"
                  markerEnd={isHovered || isSelected ? 'url(#routing-arrow-active)' : 'url(#routing-arrow)'}
                  filter={isHovered || isSelected ? 'url(#emerald-glow)' : undefined}
                  className="routing-flow-animated transition-all duration-200 motion-reduce:transition-none"
                />
              </g>
            )
          })}

          {/* RENDER ACTIVE DRAGGING LINE */}
          {dragSourceTask && dragCurrentCoords && handlePositions[`task-${dragSourceTask}`] && (
            <g>
              {(() => {
                const sCoords = handlePositions[`task-${dragSourceTask}`]
                const dx = Math.max(40, Math.abs(dragCurrentCoords.x - sCoords.x) * 0.48)
                const dragPathD = `M ${sCoords.x} ${sCoords.y} C ${sCoords.x + dx} ${sCoords.y}, ${dragCurrentCoords.x - dx} ${dragCurrentCoords.y}, ${dragCurrentCoords.x} ${dragCurrentCoords.y}`

                return (
                  <>
                    <path
                      d={dragPathD}
                      stroke="#10b981"
                      strokeWidth="2"
                      strokeOpacity="0.4"
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={dragPathD}
                      stroke="#34d399"
                      strokeWidth="2.5"
                      fill="none"
                      strokeLinecap="round"
                      markerEnd="url(#routing-arrow-active)"
                      className="routing-flow-animated"
                      filter="url(#emerald-glow)"
                    />
                  </>
                )
              })()}
            </g>
          )}
        </svg>

        {/* 2-COLUMN NODE CANVAS WITH SPACIOUS GAP */}
        <div className="flex flex-row items-stretch justify-between gap-6 sm:gap-10 lg:gap-16 relative z-20 min-w-[650px]">
          {/* COLUMN 1: JOBFINDER AI TASKS (LEFT) — INCREASED VERTICAL RHYTHM & NODE SIZE */}
          <div className="w-[300px] sm:w-[325px] lg:w-[350px] shrink-0 space-y-5 sm:space-y-6">
            <div className="flex items-center justify-between pb-1 px-1">
              <span className="text-[11px] uppercase font-bold text-primary-secondary tracking-wider">
                JobFinder AI Tasks
              </span>
              <span className="text-[10px] text-primary-secondary font-mono">6 tasks</span>
            </div>

            {TASK_DEFINITIONS.map((task) => {
              const currentPref = taskRouting[task.key]
              const isConnecting = activeConnectingTask === task.key || dragSourceTask === task.key
              const isRouteActive = currentPref && currentPref !== 'auto' && currentPref.trim() !== ''
              const Icon = task.icon

              // Find target info
              let targetLabel = 'Auto'
              if (isRouteActive) {
                const prov = PROVIDERS_INFO.find((p) => p.id === currentPref.toLowerCase())
                if (prov) {
                  targetLabel = prov.shortName
                } else {
                  const cred = credentials.find((c) => getCredId(c) === currentPref)
                  if (cred) {
                    const provCreds = credentialsByProvider[cred.provider.toLowerCase()] || []
                    const credIdx = provCreds.findIndex((c) => getCredId(c) === getCredId(cred))
                    targetLabel = getFriendlyCredentialName(cred, credIdx >= 0 ? credIdx : 0)
                  }
                }
              }

              return (
                <div
                  key={task.key}
                  data-testid={`task-node-${task.key}`}
                  onClick={() => setViewingTaskKey(task.key)}
                  className={`relative p-3.5 sm:p-4 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between ${
                    isConnecting
                      ? 'bg-surface border-emerald-400 ring-2 ring-emerald-500/20 shadow-lg'
                      : isRouteActive
                      ? 'bg-surface border-border hover:border-emerald-500/50 shadow-sm'
                      : 'bg-surface-subtle border-border/70 hover:border-border hover:bg-surface/80'
                  }`}
                >
                  {/* 1. Header: Icon + Task Name + Capability Badge */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#141414] border border-border flex items-center justify-center text-emerald-400 shrink-0 group-hover:scale-105 transition-transform">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h4 className="text-xs sm:text-sm font-semibold text-white truncate leading-tight">
                        {task.name}
                      </h4>
                    </div>
                    <span className="text-[9px] font-medium px-2 py-0.5 rounded bg-surface border border-border text-primary-secondary shrink-0 tracking-wide">
                      {task.badge}
                    </span>
                  </div>

                  {/* 2. Short description explaining the task (1-2 concise lines) */}
                  <p className="text-[11px] text-primary-secondary leading-relaxed mt-2.5 line-clamp-2">
                    {task.description}
                  </p>

                  {/* 3. Current routing status */}
                  <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-[10px] font-mono">
                    {isRouteActive ? (
                      <div
                        className="text-emerald-400 flex items-center gap-1.5 min-w-0"
                        title="Preferred route active. Click task for details or connection line to inspect."
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_#10b981]" />
                        <span className="truncate">{targetLabel}</span>
                      </div>
                    ) : (
                      <div className="text-primary-secondary/70 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-secondary/40 shrink-0" />
                        <span>Auto (Priority Chain)</span>
                      </div>
                    )}
                  </div>

                  {/* Visually hidden accessible selector fallback for keyboard / screen-reader accessibility */}
                  <select
                    aria-label={`Preferred provider for ${task.name}`}
                    value={currentPref || 'auto'}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (e.target.value === 'auto') {
                        onRemoveRoute(task.key)
                      } else {
                        validateAndSaveRoute(task.key, e.target.value)
                      }
                    }}
                    className="sr-only"
                    tabIndex={-1}
                  >
                    <option value="auto">Auto (Priority Chain)</option>
                    <optgroup label="Providers">
                      {PROVIDERS_INFO.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                    {credentials.length > 0 && (
                      <optgroup label="Specific Credentials">
                        {credentials.map((c, idx) => {
                          const credId = getCredId(c)
                          const mKey = getMaskedKey(c)
                          const fName = getFriendlyCredentialName(c, idx)
                          return (
                            <option key={credId} value={credId}>
                              {fName} {mKey ? `(${mKey})` : ''}
                            </option>
                          )
                        })}
                      </optgroup>
                    )}
                  </select>

                  {/* OUTPUT CONNECTION HANDLE (DRAG OR CLICK TO ROUTE) */}
                  <div
                    data-handle-id={`task-${task.key}`}
                    onPointerDown={(e) => handlePointerDownTask(task.key, e)}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleTaskHandleClick(task.key)
                    }}
                    title={`Drag or click to route ${task.name}`}
                    className={`absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#181818] border-2 flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-125 transition-transform z-20 ${
                      isConnecting
                        ? 'border-emerald-400 ring-2 ring-emerald-400/50 scale-125 bg-emerald-500/20'
                        : isRouteActive
                        ? 'border-emerald-400 shadow-sm shadow-emerald-500/30'
                        : 'border-border hover:border-emerald-400'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isRouteActive || isConnecting ? 'bg-emerald-400' : 'bg-primary-secondary group-hover:bg-emerald-400'
                      }`}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* COLUMN 2: AI PROVIDERS & CREDENTIALS (RIGHT - VERTICALLY CENTERED AS A GROUP) */}
          <div className="w-[300px] sm:w-[325px] lg:w-[360px] shrink-0 flex flex-col justify-center my-auto space-y-5 sm:space-y-6 pt-1">
            <div className="flex items-center justify-between pb-1 px-1">
              <span className="text-[11px] uppercase font-bold text-primary-secondary tracking-wider">
                AI Providers & Credentials
              </span>
              <span className="text-[10px] text-primary-secondary">
                Connect to provider or specific key
              </span>
            </div>

            {PROVIDERS_INFO.map((provider) => {
              const providerCreds = credentialsByProvider[provider.id] || []
              const hasCreds = providerCreds.length > 0
              const isExpanded = expandedProviders[provider.id] !== false
              const isProviderHovered = hoveredDropTarget === provider.id

              return (
                <div
                  key={provider.id}
                  className={`relative rounded-xl border transition-all ${
                    isProviderHovered
                      ? 'bg-surface border-emerald-400 ring-2 ring-emerald-500/20 shadow-md'
                      : 'bg-surface-subtle border-border'
                  }`}
                >
                  {/* PROVIDER NODE HEADER */}
                  <div
                    data-target-id={provider.id}
                    className="p-3 border-b border-border/80 flex items-center justify-between gap-3 relative"
                  >
                    {/* PROVIDER-LEVEL INPUT HANDLE (TARGET) */}
                    <div
                      data-handle-id={`provider-${provider.id}`}
                      data-target-id={provider.id}
                      onClick={() => handleTargetHandleClick(provider.id)}
                      title={`Route to ${provider.name} (Provider-level preference)`}
                      className={`absolute -left-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#181818] border-2 flex items-center justify-center cursor-pointer hover:scale-125 transition-transform z-20 ${
                        isProviderHovered || activeConnectingTask
                          ? 'border-emerald-400 ring-2 ring-emerald-400/40 bg-emerald-500/20'
                          : 'border-border hover:border-emerald-400'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    </div>

                    {/* PROVIDER NAME & COUNT — NO DECORATIVE STATUS DOT, NO HEADER '+ ADD KEY' */}
                    <div className="flex items-center justify-between w-full pl-3">
                      <div>
                        <h4 className="text-xs font-bold text-white tracking-wide">{provider.name}</h4>
                        <span className="text-[10px] text-primary-secondary font-mono">
                          {providerCreds.length} credential{providerCreds.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      {/* COMPACT EXPAND/COLLAPSE TOGGLE FOR MULTIPLE CREDENTIALS */}
                      {hasCreds && (
                        <button
                          type="button"
                          data-testid={`toggle-credentials-${provider.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleProviderExpansion(provider.id)
                          }}
                          aria-label={isExpanded ? 'Collapse credentials' : 'Expand credentials'}
                          title={`${isExpanded ? 'Collapse' : 'Expand'} ${provider.name} credentials`}
                          className="w-6 h-6 rounded flex items-center justify-center text-primary-secondary hover:text-white hover:bg-surface border border-border/70 text-xs transition-colors cursor-pointer"
                        >
                          {isExpanded ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* CREDENTIALS CHILD NODES */}
                  <div className="p-2 space-y-2">
                    {hasCreds ? (
                      isExpanded ? (
                        providerCreds.map((cred, idx) => {
                          const credId = getCredId(cred)
                          const mKey = getMaskedKey(cred)
                          const fName = getFriendlyCredentialName(cred, idx)
                          const isCredHovered = hoveredDropTarget === credId
                          const isPaid = cred.costTier === 'PAID_TIER'
                          const isBlockedByFreeOnly = isPaid && costPolicy === 'FREE_ONLY'
                          const isCooldown = activeCooldowns.includes(credId)

                          return (
                            <div
                              key={credId}
                              data-target-id={credId}
                              className={`relative ml-3 pl-3 pr-3 py-2 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                                isCredHovered
                                  ? 'bg-surface border-emerald-400 ring-2 ring-emerald-500/20 shadow'
                                  : 'bg-[#141414] border-border/70 hover:border-border'
                              } ${isBlockedByFreeOnly ? 'opacity-70' : ''}`}
                            >
                              {/* CREDENTIAL-LEVEL INPUT HANDLE */}
                              <div
                                data-handle-id={`cred-${credId}`}
                                data-target-id={credId}
                                onClick={() => handleTargetHandleClick(credId)}
                                title={
                                  isBlockedByFreeOnly
                                    ? `${fName} (Paid tier blocked under Free Only)`
                                    : `Route specifically to ${fName}`
                                }
                                className={`absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#181818] border-2 flex items-center justify-center cursor-pointer hover:scale-125 transition-transform z-20 ${
                                  isBlockedByFreeOnly
                                    ? 'border-amber-500/60 cursor-not-allowed'
                                    : isCredHovered || activeConnectingTask
                                    ? 'border-emerald-400 ring-2 ring-emerald-400/40 bg-emerald-500/20'
                                    : 'border-border hover:border-emerald-400'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isBlockedByFreeOnly ? 'bg-amber-400' : 'bg-emerald-400'
                                  }`}
                                />
                              </div>

                              <div className="flex-1 min-w-0 pl-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-white truncate">
                                    {fName}
                                  </span>
                                  {mKey && (
                                    <span className="text-[10px] font-mono text-primary-secondary">
                                      {mKey}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span
                                    className={`text-[9px] font-medium px-1.5 py-0.2 rounded border ${
                                      isPaid
                                        ? isBlockedByFreeOnly
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                          : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    }`}
                                  >
                                    {isPaid
                                      ? isBlockedByFreeOnly
                                        ? 'Paid (Blocked by Free Only)'
                                        : 'Paid Tier'
                                      : 'Free Tier'}
                                  </span>

                                  {isCooldown ? (
                                    <span className="text-[9px] text-amber-400 flex items-center gap-1 font-mono">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                      Cooldown
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-emerald-400/80 flex items-center gap-1 font-mono">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                      Active
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div
                          data-target-id={provider.id}
                          onClick={() => toggleProviderExpansion(provider.id)}
                          className="py-1.5 px-3 text-center bg-[#141414] rounded-lg border border-border/60 text-xs text-primary-secondary hover:text-white cursor-pointer transition-colors"
                        >
                          {providerCreds.length} credential{providerCreds.length === 1 ? '' : 's'} hidden (click to expand)
                        </div>
                      )
                    ) : (
                      /* EMPTY STATE: PRESERVE '+ Add [Provider] Credential' */
                      <div
                        data-target-id={provider.id}
                        className="py-4 px-3 text-center bg-[#141414] rounded-lg border border-dashed border-border/80"
                      >
                        <p className="text-xs text-primary-secondary">
                          No {provider.shortName} credentials configured
                        </p>
                        {onAddCredentialClick && (
                          <button
                            type="button"
                            onClick={() => onAddCredentialClick(provider.id)}
                            className="mt-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                          >
                            + Add {provider.shortName} Credential
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 1. TASK DETAILS MODAL (CLICKING TASK NODE BODY) */}
      {viewingTaskKey && (() => {
        const task = TASK_DEFINITIONS.find((t) => t.key === viewingTaskKey)
        if (!task) return null
        const currentPref = taskRouting[task.key]
        const isRouteConfigured = Boolean(currentPref && currentPref !== 'auto' && currentPref.trim() !== '')
        const Icon = task.icon

        let prefTargetName = 'Auto (Priority Chain)'
        let prefTargetType = 'Automated Smart Selection'
        let prefProviderName = 'All Configured Providers'

        if (isRouteConfigured) {
          const prov = PROVIDERS_INFO.find((p) => p.id === currentPref.toLowerCase())
          if (prov) {
            prefTargetName = prov.name
            prefTargetType = 'Provider-level preference'
            prefProviderName = prov.name
          } else {
            const cred = credentials.find((c) => getCredId(c) === currentPref)
            if (cred) {
              const provCreds = credentialsByProvider[cred.provider.toLowerCase()] || []
              const credIdx = provCreds.findIndex((c) => getCredId(c) === getCredId(cred))
              prefTargetName = getFriendlyCredentialName(cred, credIdx >= 0 ? credIdx : 0)
              prefTargetType = 'Specific Credential Preference'
              const p = PROVIDERS_INFO.find((item) => item.id === cred.provider.toLowerCase())
              prefProviderName = p ? p.name : cred.provider
            }
          }
        }

        return (
          <Modal
            isOpen={Boolean(viewingTaskKey)}
            onClose={() => setViewingTaskKey(null)}
            title={
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5 text-emerald-400" />
                <span>{task.name}</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-surface-subtle border border-border text-primary-secondary">
                  {task.badge}
                </span>
              </div>
            }
            description="Task capabilities, preferred routing configuration, and fallback behavior."
            maxWidth="md"
            footer={
              <div className="flex items-center justify-end gap-2 w-full">
                {isRouteConfigured && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onRemoveRoute(task.key)
                      setViewingTaskKey(null)
                    }}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 cursor-pointer transition-colors"
                  >
                    Reset to Auto
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingTaskKey(null)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:text-white bg-surface-subtle border border-border hover:bg-surface cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            }
          >
            <div className="space-y-4 text-xs">
              {/* Task Description / Purpose */}
              <div className="bg-surface-subtle p-3 rounded-lg border border-border space-y-1">
                <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                  Task Purpose
                </span>
                <p className="text-xs text-white leading-relaxed">{task.description}</p>
              </div>

              {/* Preferred Route Section */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                  <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                    Preferred Target
                  </span>
                  <p className="text-sm font-bold text-emerald-400 mt-1">{prefTargetName}</p>
                  <span className="text-[10px] text-primary-secondary">{prefTargetType}</span>
                </div>
                <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                  <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                    Target Provider
                  </span>
                  <p className="text-sm font-semibold text-white mt-1">{prefProviderName}</p>
                  <span className="text-[10px] text-primary-secondary">Execution engine</span>
                </div>
              </div>

              {/* Routing Behavior Explanation */}
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-primary-secondary leading-relaxed space-y-1">
                <div className="text-emerald-300 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Routing Behavior Guarantee
                </div>
                <p>
                  This route is a <strong className="text-white">preference</strong>, not an exclusive hard lock.
                  JobFinder&apos;s existing 3-tier fallback architecture (Model → Credential → Provider) remains
                  fully active if this target encounters rate limits, errors, or quota exhaustion.
                </p>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* 2. PREFERRED ROUTE MODAL (CLICKING CONNECTION LINE) */}
      {selectedRouteTask && (() => {
        const task = TASK_DEFINITIONS.find((t) => t.key === selectedRouteTask)
        const targetId = taskRouting[selectedRouteTask]
        let targetTitle = 'Auto (Priority Chain)'
        let targetType = 'Auto Fallback'
        let providerName = 'All Configured'

        const prov = PROVIDERS_INFO.find((p) => p.id === targetId?.toLowerCase())
        if (prov) {
          targetTitle = prov.name
          targetType = 'Provider-level preference'
          providerName = prov.name
        } else {
          const cred = credentials.find((c) => getCredId(c) === targetId)
          if (cred) {
            const provCreds = credentialsByProvider[cred.provider.toLowerCase()] || []
            const credIdx = provCreds.findIndex((c) => getCredId(c) === getCredId(cred))
            targetTitle = getFriendlyCredentialName(cred, credIdx >= 0 ? credIdx : 0)
            targetType = 'Specific Credential Preference'
            const p = PROVIDERS_INFO.find((item) => item.id === cred.provider.toLowerCase())
            providerName = p ? p.name : cred.provider
          }
        }

        return (
          <Modal
            isOpen={Boolean(selectedRouteTask)}
            onClose={() => setSelectedRouteTask(null)}
            title={
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Preferred Route: {task?.name}</span>
              </div>
            }
            description="Routing preference configuration. If preferred target fails, JobFinder fallback executes automatically."
            maxWidth="md"
            footer={
              <div className="flex items-center justify-end gap-2 w-full">
                <button
                  type="button"
                  onClick={async () => {
                    await onRemoveRoute(selectedRouteTask)
                    setSelectedRouteTask(null)
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 cursor-pointer transition-colors"
                >
                  Remove Route
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRouteTask(null)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:text-white bg-surface-subtle border border-border hover:bg-surface cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            }
          >
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                  <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                    Preferred Target
                  </span>
                  <p className="text-sm font-bold text-emerald-400 mt-1">{targetTitle}</p>
                  <span className="text-[10px] text-primary-secondary">{targetType}</span>
                </div>
                <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                  <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                    AI Provider
                  </span>
                  <p className="text-sm font-semibold text-white mt-1">{providerName}</p>
                  <span className="text-[10px] text-primary-secondary">Execution engine</span>
                </div>
              </div>

              <div className="bg-surface-subtle p-3 rounded-lg border border-border space-y-1.5">
                <span className="text-[10px] text-primary-secondary uppercase font-semibold">
                  Routing Mode
                </span>
                <p className="text-xs text-white font-medium">
                  {targetType === 'Specific Credential Preference'
                    ? 'Credential-level preference (routes to specific key)'
                    : 'Provider-level preference (routes across available keys for provider)'}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-primary-secondary leading-relaxed">
                <strong className="text-emerald-300 font-semibold">3-Tier Fallback Guarantee:</strong>{' '}
                JobFinder prioritizes <span className="text-white font-medium">{targetTitle}</span> for{' '}
                <span className="text-white font-medium">{task?.name}</span>. If this target experiences
                rate limits, network errors, or quota exhaustion, JobFinder&apos;s existing fallback architecture
                (Model → Credential → Provider) remains active and automatically handles execution.
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
