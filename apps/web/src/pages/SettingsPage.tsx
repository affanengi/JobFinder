import React, { useState, useEffect } from 'react'
import {
  Settings,
  Save,
  Chrome,
  Key,
  Copy,
  CheckCircle2,
  Globe,
  Sparkles,
  Bot,
  UserCheck,
  AlertCircle,
  Sliders,
  User,
  Mail,
  Phone,
  MapPin,
  Building,
  Linkedin,
  Github,
  Globe2,
  RefreshCw,
  Info,
  ChevronDown,
  GraduationCap,
  Briefcase,
  Plus,
  Trash2,
  Cpu
} from 'lucide-react'
import { MOCK_VERIFIED_PROFILE } from '../data/mockUserFacts'
import { fetchWithAuth } from '../lib/api'
import { AutofillProfile, EducationEntry } from '../types/autofill'
import { auth, onAuthStateChanged } from '../lib/firebase'
import { AiApiHubSettings } from '../components/settings/AiApiHubSettings'

interface AutofillFormData {
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone: string
  streetAddress: string
  city: string
  state: string
  postalCode: string
  country: string
  gender: string
  pronouns: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  school: string
  degree: string
  discipline: string
  startYear: string
  endYear: string
  educations: EducationEntry[]
  experienceLevel: string
  yearsOfExperience: string
}

const INITIAL_FORM_DATA: AutofillFormData = {
  firstName: '',
  lastName: '',
  fullName: '',
  email: '',
  phone: '',
  streetAddress: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  gender: '',
  pronouns: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  school: '',
  degree: '',
  discipline: '',
  startYear: '',
  endYear: '',
  educations: [
    {
      id: 'edu-1',
      school: '',
      degree: '',
      discipline: '',
      startYear: '',
      endYear: '',
    },
  ],
  experienceLevel: '',
  yearsOfExperience: '',
}

const EXPERIENCE_LEVEL_OPTIONS = [
  { label: 'Select experience level...', value: '', years: '' },
  { label: 'Fresher / Entry Level (0 years)', value: 'fresher', years: '0' },
  { label: '3 months of internship experience', value: '3_months', years: '0.25' },
  { label: '6 months of internship experience', value: '6_months', years: '0.5' },
  { label: '1 year of experience', value: '1_year', years: '1' },
  { label: '2 years of experience', value: '2_years', years: '2' },
  { label: '3 years of experience', value: '3_years', years: '3' },
  { label: '4 years of experience', value: '4_years', years: '4' },
  { label: '5 years of experience', value: '5_years', years: '5' },
  { label: '6+ years of experience', value: '6_plus_years', years: '6' },
]

const GENDER_OPTIONS = [
  { label: 'Select gender...', value: '' },
  { label: 'Male', value: 'Male' },
  { label: 'Female', value: 'Female' },
  { label: 'Non-Binary', value: 'Non-Binary' },
  { label: 'Prefer not to say / Decline to self-identify', value: 'Prefer not to say' },
  { label: 'Other / Custom', value: 'Other' },
]

const PRONOUN_OPTIONS = [
  { label: 'Select pronouns...', value: '' },
  { label: 'he/him/his', value: 'he/him/his' },
  { label: 'she/her/hers', value: 'she/her/hers' },
  { label: 'they/them/theirs', value: 'they/them/theirs' },
  { label: 'he/they', value: 'he/they' },
  { label: 'she/they', value: 'she/they' },
  { label: 'Prefer not to say / Decline to self-identify', value: 'Prefer not to say' },
  { label: 'Other / Custom', value: 'Other' },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'autofill' | 'integrations' | 'ai-hub'>('autofill')
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const clipToken = 'clp_live_affan_personal'
  const apiUrl = 'http://localhost:8000'

  // Autofill Profile State
  const [formData, setFormData] = useState<AutofillFormData>(INITIAL_FORM_DATA)
  const [initialData, setInitialData] = useState<AutofillFormData>(INITIAL_FORM_DATA)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPrefilling, setIsPrefilling] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [customGenderSelected, setCustomGenderSelected] = useState(false)
  const [customPronounsSelected, setCustomPronounsSelected] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info'
    text: string
  } | null>(null)

  // Fetch initial Autofill Profile on mount
  useEffect(() => {
    let isMounted = true

    async function loadAutofillProfile() {
      setIsLoading(true)
      try {
        const res = await fetchWithAuth('/api/v1/profile/autofill')
        if (res.ok) {
          const data: AutofillProfile = await res.json()
          if (isMounted) {
            let loadedEdus: EducationEntry[] = []
            if (data.educations && data.educations.length > 0) {
              loadedEdus = data.educations.map((e, idx) => ({
                id: e.id || `edu-${idx + 1}`,
                school: e.school || '',
                degree: e.degree || '',
                discipline: e.discipline || '',
                startYear: e.startYear || '',
                endYear: e.endYear || '',
              }))
            } else if (data.school || data.degree || data.discipline || data.startYear || data.endYear) {
              loadedEdus = [
                {
                  id: 'edu-1',
                  school: data.school || '',
                  degree: data.degree || '',
                  discipline: data.discipline || '',
                  startYear: data.startYear || '',
                  endYear: data.endYear || '',
                },
              ]
            } else {
              loadedEdus = [
                {
                  id: 'edu-1',
                  school: '',
                  degree: '',
                  discipline: '',
                  startYear: '',
                  endYear: '',
                },
              ]
            }

            const mapped: AutofillFormData = {
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              fullName: data.fullName || '',
              email: data.email || '',
              phone: data.phone || '',
              streetAddress: data.streetAddress || '',
              city: data.city || '',
              state: data.state || '',
              postalCode: data.postalCode || '',
              country: data.country || '',
              gender: data.gender || '',
              pronouns: data.pronouns || '',
              linkedinUrl: data.linkedinUrl || '',
              githubUrl: data.githubUrl || '',
              portfolioUrl: data.portfolioUrl || '',
              school: loadedEdus[0]?.school || data.school || '',
              degree: loadedEdus[0]?.degree || data.degree || '',
              discipline: loadedEdus[0]?.discipline || data.discipline || '',
              startYear: loadedEdus[0]?.startYear || data.startYear || '',
              endYear: loadedEdus[0]?.endYear || data.endYear || '',
              educations: loadedEdus,
              experienceLevel: data.experienceLevel || '',
              yearsOfExperience: data.yearsOfExperience !== undefined && data.yearsOfExperience !== null ? String(data.yearsOfExperience) : '',
            }
            setFormData(mapped)
            setInitialData(mapped)
            setIsDirty(false)
          }
        }
      } catch (err) {
        console.error('Failed to load autofill configuration:', err)
        if (isMounted) {
          setStatusMessage({
            type: 'error',
            text: 'Could not load autofill configuration. Please check your connection.',
          })
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadAutofillProfile()

    let unsubscribe = () => {}
    if (auth && typeof onAuthStateChanged === 'function') {
      unsubscribe = onAuthStateChanged(auth, () => {
        if (isMounted) {
          loadAutofillProfile()
        }
      })
    }

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleInputChange = (field: keyof AutofillFormData, value: string) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value }
      const dirty = Object.keys(updated).some(
        (k) => updated[k as keyof AutofillFormData] !== initialData[k as keyof AutofillFormData]
      )
      setIsDirty(dirty)
      return updated
    })
  }

  const isCustomGender =
    customGenderSelected ||
    Boolean(
      formData.gender &&
      !['Male', 'Female', 'Non-Binary', 'Prefer not to say'].includes(formData.gender)
    )

  const isCustomPronouns =
    customPronounsSelected ||
    Boolean(
      formData.pronouns &&
      !['he/him/his', 'she/her/hers', 'they/them/theirs', 'he/they', 'she/they', 'Prefer not to say'].includes(formData.pronouns)
    )

  const handleGenderChange = (val: string) => {
    if (val === 'Other') {
      setCustomGenderSelected(true)
      if (['Male', 'Female', 'Non-Binary', 'Prefer not to say'].includes(formData.gender)) {
        handleInputChange('gender', '')
      }
    } else {
      setCustomGenderSelected(false)
      handleInputChange('gender', val)
    }
  }

  const handlePronounsChange = (val: string) => {
    if (val === 'Other') {
      setCustomPronounsSelected(true)
      if (['he/him/his', 'she/her/hers', 'they/them/theirs', 'he/they', 'she/they', 'Prefer not to say'].includes(formData.pronouns)) {
        handleInputChange('pronouns', '')
      }
    } else {
      setCustomPronounsSelected(false)
      handleInputChange('pronouns', val)
    }
  }

  // Explicit user action to prefill from Master Profile
  const handlePrefillFromMasterProfile = async () => {
    setIsPrefilling(true)
    setStatusMessage(null)
    try {
      const res = await fetchWithAuth('/api/v1/profile')
      if (res.ok) {
        const masterProfile = await res.json()
        const personal = masterProfile.personal || {}
        const links = personal.links || {}

        let masterEdus: EducationEntry[] = []
        if (masterProfile.education && masterProfile.education.length > 0) {
          masterEdus = masterProfile.education.map((e: { id?: string; institution?: string; degree?: string; field?: string; startDate?: string; endDate?: string }, idx: number) => ({
            id: e.id || `edu-${idx + 1}`,
            school: e.institution || '',
            degree: e.degree || '',
            discipline: e.field || '',
            startYear: e.startDate || '',
            endYear: e.endDate || '',
          }))
        } else {
          masterEdus = [
            {
              id: 'edu-1',
              school: '',
              degree: '',
              discipline: '',
              startYear: '',
              endYear: '',
            },
          ]
        }

        setFormData((prev) => {
          const updated: AutofillFormData = {
            ...prev,
            fullName: prev.fullName || personal.fullName || '',
            firstName: prev.firstName || personal.firstName || '',
            lastName: prev.lastName || personal.lastName || '',
            email: prev.email || personal.email || '',
            phone: prev.phone || personal.phone || '',
            city: prev.city || personal.city || '',
            country: prev.country || personal.country || '',
            linkedinUrl: prev.linkedinUrl || links.linkedin || '',
            githubUrl: prev.githubUrl || links.github || '',
            portfolioUrl: prev.portfolioUrl || links.portfolio || '',
            school: masterEdus[0]?.school || prev.school || '',
            degree: masterEdus[0]?.degree || prev.degree || '',
            discipline: masterEdus[0]?.discipline || prev.discipline || '',
            startYear: masterEdus[0]?.startYear || prev.startYear || '',
            endYear: masterEdus[0]?.endYear || prev.endYear || '',
            educations: masterEdus.length > 0 ? masterEdus : prev.educations,
            experienceLevel: prev.experienceLevel || 'fresher',
            yearsOfExperience: prev.yearsOfExperience || '0',
          }
          setIsDirty(true)
          return updated
        })

        setStatusMessage({
          type: 'info',
          text: 'Prefilled details from Master Profile. Review values below and click "Save Autofill Configuration" when ready.',
        })
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Failed to retrieve Master Profile data.',
        })
      }
    } catch (err) {
      console.error('Error prefilling from master profile:', err)
      setStatusMessage({
        type: 'error',
        text: 'Failed to prefill from Master Profile.',
      })
    } finally {
      setIsPrefilling(false)
    }
  }

  const handleEducationChange = (index: number, field: keyof EducationEntry, value: string) => {
    setFormData((prev) => {
      const nextEdus = [...prev.educations]
      nextEdus[index] = { ...nextEdus[index], [field]: value }
      const updated: AutofillFormData = {
        ...prev,
        educations: nextEdus,
        school: index === 0 && field === 'school' ? value : (nextEdus[0]?.school || prev.school),
        degree: index === 0 && field === 'degree' ? value : (nextEdus[0]?.degree || prev.degree),
        discipline: index === 0 && field === 'discipline' ? value : (nextEdus[0]?.discipline || prev.discipline),
        startYear: index === 0 && field === 'startYear' ? value : (nextEdus[0]?.startYear || prev.startYear),
        endYear: index === 0 && field === 'endYear' ? value : (nextEdus[0]?.endYear || prev.endYear),
      }
      setIsDirty(true)
      return updated
    })
  }

  const handleAddEducation = () => {
    setFormData((prev) => {
      const newEntry: EducationEntry = {
        id: `edu-${Date.now()}`,
        school: '',
        degree: '',
        discipline: '',
        startYear: '',
        endYear: '',
      }
      const updated: AutofillFormData = {
        ...prev,
        educations: [...prev.educations, newEntry],
      }
      setIsDirty(true)
      return updated
    })
  }

  const handleRemoveEducation = (index: number) => {
    setFormData((prev) => {
      if (prev.educations.length <= 1) {
        const resetEdus: EducationEntry[] = [
          { id: 'edu-1', school: '', degree: '', discipline: '', startYear: '', endYear: '' }
        ]
        const updated: AutofillFormData = {
          ...prev,
          educations: resetEdus,
          school: '',
          degree: '',
          discipline: '',
          startYear: '',
          endYear: '',
        }
        setIsDirty(true)
        return updated
      }
      const nextEdus = prev.educations.filter((_, i) => i !== index)
      const updated: AutofillFormData = {
        ...prev,
        educations: nextEdus,
        school: nextEdus[0]?.school || '',
        degree: nextEdus[0]?.degree || '',
        discipline: nextEdus[0]?.discipline || '',
        startYear: nextEdus[0]?.startYear || '',
        endYear: nextEdus[0]?.endYear || '',
      }
      setIsDirty(true)
      return updated
    })
  }

  const handleSaveAutofill = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setStatusMessage(null)

    try {
      const payload: AutofillProfile = {
        firstName: formData.firstName.trim() || null,
        lastName: formData.lastName.trim() || null,
        fullName: formData.fullName.trim() || null,
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        streetAddress: formData.streetAddress.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state.trim() || null,
        postalCode: formData.postalCode.trim() || null,
        country: formData.country.trim() || null,
        gender: formData.gender.trim() || null,
        pronouns: formData.pronouns.trim() || null,
        linkedinUrl: formData.linkedinUrl.trim() || null,
        githubUrl: formData.githubUrl.trim() || null,
        portfolioUrl: formData.portfolioUrl.trim() || null,
        school: (formData.educations[0]?.school || formData.school).trim() || null,
        degree: (formData.educations[0]?.degree || formData.degree).trim() || null,
        discipline: (formData.educations[0]?.discipline || formData.discipline).trim() || null,
        startYear: (formData.educations[0]?.startYear || formData.startYear).trim() || null,
        endYear: (formData.educations[0]?.endYear || formData.endYear).trim() || null,
        educations: formData.educations.map((e) => ({
          id: e.id,
          school: e.school.trim(),
          degree: e.degree.trim(),
          discipline: e.discipline.trim(),
          startYear: e.startYear.trim(),
          endYear: e.endYear.trim(),
        })),
        experienceLevel: formData.experienceLevel.trim() || null,
        yearsOfExperience: formData.yearsOfExperience.trim() ? parseFloat(formData.yearsOfExperience.trim()) : null,
      }

      const res = await fetchWithAuth('/api/v1/profile/autofill', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setInitialData(formData)
        setIsDirty(false)
        setStatusMessage({
          type: 'success',
          text: 'Autofill Configuration saved successfully to your cloud profile.',
        })
        setTimeout(() => {
          setStatusMessage(null)
        }, 5000)
      } else {
        const errorData = await res.json().catch(() => ({}))
        setStatusMessage({
          type: 'error',
          text: errorData.detail || 'Failed to save autofill configuration.',
        })
      }
    } catch (err) {
      console.error('Error saving autofill profile:', err)
      setStatusMessage({
        type: 'error',
        text: 'Network error occurred while saving autofill configuration.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={`space-y-6 ${activeTab === 'ai-hub' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto p-6 md:p-8 animate-in fade-in duration-150`}>
      {/* Page Header */}
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-emerald-400" />
          Settings & Configuration
        </h1>
        <p className="text-xs text-primary-secondary mt-1">
          Manage your browser autofill data, job discovery filters, and browser extension integrations.
        </p>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveTab('autofill')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'autofill'
                ? 'bg-emerald-500 text-black shadow-sm shadow-emerald-500/20'
                : 'bg-surface text-primary-secondary hover:text-white hover:bg-surface-subtle border border-border'
            }`}
          >
            <Bot className="w-4 h-4" />
            Autofill Configuration
          </button>
          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'integrations'
                ? 'bg-emerald-500 text-black shadow-sm shadow-emerald-500/20'
                : 'bg-surface text-primary-secondary hover:text-white hover:bg-surface-subtle border border-border'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Discovery & Integrations
          </button>
          <button
            onClick={() => setActiveTab('ai-hub')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'ai-hub'
                ? 'bg-emerald-500 text-black shadow-sm shadow-emerald-500/20'
                : 'bg-surface text-primary-secondary hover:text-white hover:bg-surface-subtle border border-border'
            }`}
          >
            <Cpu className="w-4 h-4" />
            AI / API Hub
          </button>
        </div>
      </div>

      {/* TAB 1: Autofill Configuration */}
      {activeTab === 'autofill' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Informational Guidance Callout */}
          <div className="bg-surface p-4 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-surface via-surface to-emerald-950/20 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mt-0.5 shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    Browser Autofill Profile
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Deterministic ATS Filling
                    </span>
                  </h3>
                  <p className="text-xs text-primary-secondary mt-1 leading-relaxed">
                    This personal configuration data is used exclusively by Playwright to deterministically populate
                    application forms on Greenhouse, Lever, Ashby, and Workday. This data is strictly separated from
                    your Verified Master Profile facts and is never used as evidence by the Q&A Co-pilot.
                  </p>
                </div>
              </div>

              {/* Prefill from Master Profile explicit action */}
              <button
                type="button"
                onClick={handlePrefillFromMasterProfile}
                disabled={isPrefilling || isLoading}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                title="Copies existing contact information from your Master Profile into these fields without auto-saving."
              >
                {isPrefilling ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : (
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Prefill from Master Profile</span>
              </button>
            </div>
          </div>

          {/* Status Notifications */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
              }`}
            >
              {statusMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {statusMessage.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />}
              {statusMessage.type === 'info' && <Info className="w-4 h-4 shrink-0 text-blue-400" />}
              <span className="flex-1">{statusMessage.text}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center text-xs text-primary-secondary flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
              Loading your autofill configuration...
            </div>
          ) : (
            <form onSubmit={handleSaveAutofill} className="space-y-6">
              {/* 1. Candidate Identity */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <User className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Candidate Identity
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">First Name</label>
                    <input
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => handleInputChange('firstName', e.target.value)}
                      placeholder="e.g. Jane"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Last Name</label>
                    <input
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => handleInputChange('lastName', e.target.value)}
                      placeholder="e.g. Doe"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Full Name</label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => handleInputChange('fullName', e.target.value)}
                      placeholder="e.g. Jane Doe"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Contact Details */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Mail className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Contact Information
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-emerald-400" /> Email Address
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      placeholder="e.g. candidate@example.com"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-400" /> Phone Number (with Country Code)
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      placeholder="e.g. +1 555-123-4567 or +91 9876543210"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Address & Location */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Location & Physical Address
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Street Address</label>
                    <input
                      type="text"
                      value={formData.streetAddress}
                      onChange={(e) => handleInputChange('streetAddress', e.target.value)}
                      placeholder="e.g. 123 Innovation Drive, Apt 4B"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs text-primary-secondary font-medium">City</label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) => handleInputChange('city', e.target.value)}
                        placeholder="e.g. San Francisco"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-primary-secondary font-medium">State / Province</label>
                      <input
                        type="text"
                        value={formData.state}
                        onChange={(e) => handleInputChange('state', e.target.value)}
                        placeholder="e.g. CA"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-primary-secondary font-medium">Postal / Zip Code</label>
                      <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) => handleInputChange('postalCode', e.target.value)}
                        placeholder="e.g. 94105"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-primary-secondary font-medium">Country</label>
                      <input
                        type="text"
                        value={formData.country}
                        onChange={(e) => handleInputChange('country', e.target.value)}
                        placeholder="e.g. United States"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. Voluntary Demographic Fields */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Building className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Voluntary Demographics
                    </h3>
                    <p className="text-[11px] text-primary-secondary mt-0.5">
                      Optional self-identification fields requested by standard ATS portals (e.g. Greenhouse). Leave blank if you prefer to answer manually.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Gender</label>
                    <div className="relative">
                      <select
                        value={isCustomGender ? 'Other' : formData.gender}
                        onChange={(e) => handleGenderChange(e.target.value)}
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors cursor-pointer appearance-none pr-8"
                      >
                        {GENDER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} className="bg-[#18181b] text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-primary-secondary pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    {isCustomGender && (
                      <input
                        type="text"
                        value={formData.gender}
                        onChange={(e) => handleInputChange('gender', e.target.value)}
                        placeholder="Specify custom gender"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors mt-2"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Pronouns</label>
                    <div className="relative">
                      <select
                        value={isCustomPronouns ? 'Other' : formData.pronouns}
                        onChange={(e) => handlePronounsChange(e.target.value)}
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors cursor-pointer appearance-none pr-8"
                      >
                        {PRONOUN_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} className="bg-[#18181b] text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-primary-secondary pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    {isCustomPronouns && (
                      <input
                        type="text"
                        value={formData.pronouns}
                        onChange={(e) => handleInputChange('pronouns', e.target.value)}
                        placeholder="Specify custom pronouns (e.g. she/they)"
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors mt-2"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* 5. Online Profiles & Portfolio Links */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Globe2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Online Profiles & Portfolios
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium flex items-center gap-1.5">
                      <Linkedin className="w-3.5 h-3.5 text-emerald-400" /> LinkedIn Profile URL
                    </label>
                    <input
                      type="url"
                      value={formData.linkedinUrl}
                      onChange={(e) => handleInputChange('linkedinUrl', e.target.value)}
                      placeholder="https://www.linkedin.com/in/your-profile"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium flex items-center gap-1.5">
                      <Github className="w-3.5 h-3.5 text-emerald-400" /> GitHub Profile URL
                    </label>
                    <input
                      type="url"
                      value={formData.githubUrl}
                      onChange={(e) => handleInputChange('githubUrl', e.target.value)}
                      placeholder="https://github.com/your-username"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" /> Portfolio Website URL
                    </label>
                    <input
                      type="url"
                      value={formData.portfolioUrl}
                      onChange={(e) => handleInputChange('portfolioUrl', e.target.value)}
                      placeholder="https://yourportfolio.com"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 6. Education Information */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-emerald-400" />
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Education Credentials
                      </h3>
                      <p className="text-[11px] text-primary-secondary mt-0.5">
                        Deterministic academic information used to populate ATS Education dropdowns and date fields.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddEducation}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    title="Add another degree, junior college, or school education"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Education</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {formData.educations.map((edu, idx) => (
                    <div
                      key={edu.id || idx}
                      className="bg-surface-subtle/50 p-4 rounded-lg border border-border/80 space-y-3 relative group transition-colors hover:border-border"
                    >
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-primary">
                            Education #{idx + 1}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Primary / Highest Degree
                            </span>
                          )}
                          {idx === 1 && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                              Secondary / Junior College / High School
                            </span>
                          )}
                        </div>
                        {formData.educations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveEducation(idx)}
                            className="inline-flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-colors"
                            title="Remove this education entry"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs text-primary-secondary font-medium">
                            School / College / University
                          </label>
                          <input
                            type="text"
                            value={edu.school}
                            onChange={(e) => handleEducationChange(idx, 'school', e.target.value)}
                            placeholder={idx === 0 ? "e.g. Stanford University or City College" : "e.g. Sree Tapasiya Jr College or High School"}
                            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs text-primary-secondary font-medium">Degree</label>
                            <input
                              type="text"
                              value={edu.degree}
                              onChange={(e) => handleEducationChange(idx, 'degree', e.target.value)}
                              placeholder={idx === 0 ? "e.g. Bachelor's Degree or B.Tech" : "e.g. Intermediate, High School Diploma, or MPC"}
                              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-primary-secondary font-medium">Discipline / Major</label>
                            <input
                              type="text"
                              value={edu.discipline}
                              onChange={(e) => handleEducationChange(idx, 'discipline', e.target.value)}
                              placeholder={idx === 0 ? "e.g. Computer Science" : "e.g. MPC, Sciences, or General Studies"}
                              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs text-primary-secondary font-medium">Start Date Year</label>
                            <input
                              type="text"
                              value={edu.startYear}
                              onChange={(e) => handleEducationChange(idx, 'startYear', e.target.value)}
                              placeholder="e.g. 2020"
                              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-primary-secondary font-medium">End Date / Graduation Year</label>
                            <input
                              type="text"
                              value={edu.endYear}
                              onChange={(e) => handleEducationChange(idx, 'endYear', e.target.value)}
                              placeholder="e.g. 2024"
                              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 7. Work Experience & Seniority Level */}
              <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Briefcase className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Experience & Seniority Thresholds
                    </h3>
                    <p className="text-[11px] text-primary-secondary mt-0.5">
                      Used by the deterministic autofill engine to answer experience questions (e.g. &ldquo;Do you have more than 5 years of experience?&rdquo; &rarr; No, or &ldquo;Do you have more than 1 year?&rdquo; &rarr; Yes).
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Experience Level</label>
                    <div className="relative">
                      <select
                        value={formData.experienceLevel}
                        onChange={(e) => {
                          const val = e.target.value
                          const matchedOpt = EXPERIENCE_LEVEL_OPTIONS.find((o) => o.value === val)
                          setFormData((prev) => {
                            const updated = {
                              ...prev,
                              experienceLevel: val,
                              yearsOfExperience: matchedOpt?.years !== undefined && matchedOpt.years !== '' ? matchedOpt.years : prev.yearsOfExperience
                            }
                            const dirty = Object.keys(updated).some(
                              (k) => updated[k as keyof AutofillFormData] !== initialData[k as keyof AutofillFormData]
                            )
                            setIsDirty(dirty)
                            return updated
                          })
                        }}
                        className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors cursor-pointer appearance-none pr-8"
                      >
                        {EXPERIENCE_LEVEL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} className="bg-[#18181b] text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-primary-secondary pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-primary-secondary font-medium">Total Years of Experience (Numeric)</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max="40"
                      value={formData.yearsOfExperience}
                      onChange={(e) => handleInputChange('yearsOfExperience', e.target.value)}
                      placeholder="e.g. 0, 0.5, 1, 2, 4, 5"
                      className="w-full bg-surface-subtle border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-primary-secondary/50 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {isDirty && (
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      Unsaved changes
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isSaving || !isDirty}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-black" />
                  ) : (
                    <Save className="w-4 h-4 text-black" />
                  )}
                  <span>{isSaving ? 'Saving...' : 'Save Autofill Configuration'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 2: Discovery & Integrations */}
      {activeTab === 'integrations' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Browser Extension / Web Clipper Card */}
          <div className="bg-surface p-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-surface via-surface to-emerald-950/20 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
                  <Chrome className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    JobFinder Web Clipper (Extension)
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Ready to Install
                    </span>
                  </h3>
                  <p className="text-xs text-primary-secondary">
                    Clip opportunities from LinkedIn, Indeed, Greenhouse, Lever, Ashby, and Workday directly into your Kanban.
                  </p>
                </div>
              </div>
            </div>

            {/* Connection Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-primary-secondary flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-emerald-400" /> API Base URL
                  </span>
                  <button
                    onClick={() => copyToClipboard(apiUrl, setCopiedUrl)}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {copiedUrl ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs text-white font-mono bg-bg px-2 py-1 rounded block truncate border border-border/50">
                  {apiUrl}
                </code>
              </div>

              <div className="bg-surface-subtle p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-primary-secondary flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-emerald-400" /> Scoped Clip Token
                  </span>
                  <button
                    onClick={() => copyToClipboard(clipToken, setCopiedToken)}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {copiedToken ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedToken ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs text-white font-mono bg-bg px-2 py-1 rounded block truncate border border-border/50">
                  {clipToken}
                </code>
              </div>
            </div>

            {/* Installation Instructions */}
            <div className="bg-bg/60 p-3.5 rounded-lg border border-border/70 text-xs space-y-2">
              <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> How to install in Chrome / Brave / Edge:
              </h4>
              <ol className="list-decimal list-inside space-y-1 text-primary-secondary text-[11px] leading-relaxed">
                <li>
                  Open <code className="text-white bg-surface-subtle px-1 rounded">chrome://extensions</code> in your browser and enable <strong className="text-white">Developer mode</strong> (top-right toggle).
                </li>
                <li>
                  Click <strong className="text-white">Load unpacked</strong> and select the directory:
                  <div className="mt-1 font-mono text-[10px] text-emerald-300 bg-surface px-2 py-1 rounded border border-border select-all">
                    /home/mohdaffan/Desktop/jobFinder/apps/extension/dist
                  </div>
                </li>
                <li>
                  Pin the <strong className="text-white">JobFinder</strong> icon in your browser toolbar, open any job posting, and click to clip!
                </li>
              </ol>
            </div>
          </div>

          {/* Desired Roles */}
          <div className="bg-surface p-5 rounded-xl border border-border space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">Desired Job Roles</h3>
            <div className="flex flex-wrap gap-2">
              {MOCK_VERIFIED_PROFILE.preferences.desiredRoles.map((role, idx) => (
                <span key={idx} className="px-3 py-1 bg-surface-subtle border border-border rounded-md text-xs text-white">
                  {role}
                </span>
              ))}
            </div>
          </div>

          {/* Excluded Roles / Hard Filters */}
          <div className="bg-surface p-5 rounded-xl border border-border space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-danger">Hard Excluded Roles</h3>
            <div className="flex flex-wrap gap-2">
              {MOCK_VERIFIED_PROFILE.preferences.excludedRoles.map((role, idx) => (
                <span key={idx} className="px-3 py-1 bg-danger-soft border border-danger-border rounded-md text-xs text-danger font-medium">
                  ✕ {role}
                </span>
              ))}
            </div>
          </div>

          {/* Daily Target */}
          <div className="bg-surface p-5 rounded-xl border border-border space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">Daily Recommendation Target</h3>
            <p className="text-xs text-primary-secondary">
              Maximum number of top-fit recommendations generated per discovery schedule run (currently set to 10).
            </p>
          </div>

          <button
            type="button"
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4 text-black" />
            <span>Save Preferences</span>
          </button>
        </div>
      )}

      {/* TAB 3: AI / API Hub */}
      {activeTab === 'ai-hub' && <AiApiHubSettings />}
    </div>
  )
}
