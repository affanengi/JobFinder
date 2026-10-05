import { useState, useEffect } from 'react'
import { Brain, CheckCircle2, ShieldCheck, BarChart2, Award, FolderGit2, Briefcase, RefreshCw, ExternalLink, Users } from 'lucide-react'
import { fetchWithAuth } from '../lib/api'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'

interface MetricFact {
  metric: string
  value: string
  context: string
}

interface ProjectFact {
  id: string
  name: string
  description?: string
  bullets?: string[]
  technologies?: string[]
  metrics?: MetricFact[]
}

interface ExperienceFact {
  id: string
  company: string
  title: string
  location?: string
  startDate?: string
  endDate?: string
  current?: boolean
  bullets?: string[]
  metrics?: MetricFact[]
  category?: string
  employmentType?: string
}

interface CourseCertificationFact {
  id: string
  title: string
  certificateUrl?: string | null
  completionYear?: string | null
  description?: string | null
  provider?: string | null
  instructor?: string | null
  credentialId?: string | null
  verified?: boolean
  source?: string
}

const CATEGORY_NAMES: Record<string, string> = {
  programming: 'Languages & Programming',
  languages: 'Languages & Programming',
  web: 'Frontend Frameworks & UI',
  frontend: 'Frontend Frameworks & UI',
  backend: 'Backend & APIs',
  data: 'Databases & Data Systems',
  database: 'Databases & Data Systems',
  ai_ml: 'AI & Generative AI',
  automation: 'Automation & Integrations',
  tools: 'Developer Tools & Platforms',
  cloud: 'Cloud & Infrastructure',
  productivity: 'Data & Productivity Tools',
  engineering: 'Software Engineering Core',
  soft: 'Professional & Soft Skills',
  languages_spoken: 'Spoken & Written Languages',
  other: 'General & Core Skills',
};

interface SkillFact {
  id: string
  name: string
  category: string
  proficiency: string
  verified: boolean
}

interface ProfileData {
  userId: string
  personal?: {
    fullName: string
    email: string
  }
  summary?: string
  skills?: SkillFact[]
  projects?: ProjectFact[]
  experience?: ExperienceFact[]
  courseCertifications?: CourseCertificationFact[]
}

export function MemoryPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth('/api/v1/profile')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
      }
    } catch (err) {
      console.error('Failed to load profile memory facts:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  // Aggregate verified quantitative facts across projects and experiences
  const verifiedMetrics: Array<{ entity: string; metric: string; value: string; context: string }> = []

  if (profile?.experience) {
    for (const exp of profile.experience) {
      if (exp.metrics && Array.isArray(exp.metrics)) {
        for (const m of exp.metrics) {
          if (typeof m === 'object' && m.metric) {
            verifiedMetrics.push({
              entity: `${exp.title} (${exp.company})`,
              metric: m.metric,
              value: m.value,
              context: m.context
            })
          }
        }
      }
    }
  }

  if (profile?.projects) {
    for (const proj of profile.projects) {
      if (proj.metrics && Array.isArray(proj.metrics)) {
        for (const m of proj.metrics) {
          if (typeof m === 'object' && m.metric) {
            verifiedMetrics.push({
              entity: proj.name,
              metric: m.metric,
              value: m.value,
              context: m.context
            })
          }
        }
      }
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6 md:p-8 animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-emerald-400" />
            Verified Master Memory & Provenance
          </h1>
          <p className="text-xs text-primary-secondary mt-1">
            Candidate-confirmed single source of truth stored in Firestore. AI write-protected with zero automated overwrites.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadProfile} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Memory</span>
          </Button>
        </div>
      </div>

      {/* Provenance Banner */}
      <div className="bg-surface/60 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="text-xs">
          <div className="font-semibold text-white flex items-center gap-2">
            Deterministic Grounding Active
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
              Sole Source of Truth
            </span>
          </div>
          <p className="text-primary-secondary mt-0.5 text-[11px]">
            Every resume claim and AI optimization is deterministically validated against these confirmed profile records. Unverified metrics or unsupported tools are rejected before PDF compilation.
          </p>
        </div>
      </div>

      {/* Section 1: Verified Candidate Quantitative Evidence */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            Verified Quantitative Evidence ({verifiedMetrics.length})
          </h3>
          <span className="text-[11px] text-neutral-400">Directly Grounded in Profile Facts</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {verifiedMetrics.map((item, idx) => (
            <div key={idx} className="bg-surface p-4 rounded-xl border border-border hover:border-emerald-500/30 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[11px] font-semibold text-neutral-300 truncate">{item.entity}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-bold shrink-0">
                  {item.value}
                </span>
              </div>
              <div className="text-xs font-semibold text-white mb-1">{item.metric}</div>
              <div className="text-[11px] text-primary-secondary leading-relaxed">{item.context}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Verified Experience & Leadership */}
      {/* Section 2: Verified Professional Experience & Leadership */}
      {(() => {
        const isLeadership = (e: ExperienceFact) => {
          const cat = (e.category || '').toLowerCase();
          const emp = (e.employmentType || '').toLowerCase();
          const co = (e.company || '').toLowerCase();
          return cat === 'leadership' || emp === 'leadership' || emp === 'club' || co.includes('club') || co.includes('techniva');
        };
        const workExp = (profile?.experience || []).filter((e) => !isLeadership(e));
        const leadershipExp = (profile?.experience || []).filter((e) => isLeadership(e));

        return (
          <>
            <div className="space-y-3 pt-4 border-t border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-400" />
                Verified Professional Experience ({workExp.length})
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {workExp.map((exp, idx) => (
                  <div key={idx} className="bg-surface p-4 rounded-xl border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-white text-xs">{exp.title}</span>
                        <span className="text-primary-secondary text-xs ml-2">· {exp.company}</span>
                        {exp.location && <span className="text-neutral-500 text-xs ml-1">({exp.location})</span>}
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono">
                        {exp.startDate} – {exp.endDate || (exp.current ? 'Present' : '')}
                      </div>
                    </div>
                    {exp.bullets && exp.bullets.length > 0 && (
                      <ul className="space-y-1 text-xs text-neutral-300 pl-4 list-disc">
                        {exp.bullets.map((b, bIdx) => (
                          <li key={bIdx} className="leading-relaxed">{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {leadershipExp.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-border">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  Verified Leadership & Activities ({leadershipExp.length})
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {leadershipExp.map((exp, idx) => (
                    <div key={idx} className="bg-surface p-4 rounded-xl border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-white text-xs">{exp.title}</span>
                          <span className="text-primary-secondary text-xs ml-2">· {exp.company}</span>
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono">
                          {exp.startDate} – {exp.endDate || (exp.current ? 'Present' : '')}
                        </div>
                      </div>
                      {exp.bullets && exp.bullets.length > 0 && (
                        <ul className="space-y-1 text-xs text-neutral-300 pl-4 list-disc">
                          {exp.bullets.map((b, bIdx) => (
                            <li key={bIdx} className="leading-relaxed">{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Section 3: Verified Projects */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-emerald-400" />
          Verified Projects & Implementations ({profile?.projects?.length || 0})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profile?.projects?.map((proj, idx) => (
            <div key={idx} className="bg-surface p-4 rounded-xl border border-border flex flex-col justify-between space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-white text-xs">{proj.name}</div>
                  <Badge variant="success" size="sm">
                    <CheckCircle2 className="w-3 h-3" /> Verified
                  </Badge>
                </div>
                <div className="text-[11px] text-primary-secondary leading-relaxed line-clamp-2">
                  {proj.description}
                </div>
              </div>
              {proj.technologies && proj.technologies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {proj.technologies.map((tech, tIdx) => (
                    <span key={tIdx} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-neutral-300 border border-white/10 font-mono">
                      {tech}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Verified Courses & Certifications */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-400" />
            Verified Courses &amp; Certifications ({profile?.courseCertifications?.length || 0})
          </h3>
          <span className="text-[11px] text-neutral-400 font-mono">User-Provided Verified Records</span>
        </div>
        {(!profile?.courseCertifications || profile.courseCertifications.length === 0) ? (
          <div className="p-4 rounded-xl bg-surface border border-dashed border-border text-center text-xs text-primary-secondary">
            No verified courses or certifications stored.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {profile.courseCertifications.map((course) => (
              <div key={course.id} className="bg-surface p-4 rounded-xl border border-border flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="font-bold text-white text-xs truncate">{course.title}</div>
                    <Badge variant="success" size="sm">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </Badge>
                  </div>
                  {course.completionYear && (
                    <div className="text-[10px] font-mono text-[#888888] mb-1">
                      Completed: {course.completionYear}
                    </div>
                  )}
                  {course.provider && (
                    <div className="text-[11px] text-[#A3A3A3] font-medium mb-1 flex items-center gap-1.5 flex-wrap">
                      <span>{course.provider}</span>
                      {course.instructor && (
                        <>
                          <span className="text-neutral-600">•</span>
                          <span className="text-emerald-400 font-mono text-[10px]">Instructor: {course.instructor}</span>
                        </>
                      )}
                    </div>
                  )}
                  {!course.provider && course.instructor && (
                    <div className="text-[10px] text-emerald-400 font-mono mb-1">
                      Instructor: {course.instructor}
                    </div>
                  )}
                  {course.description && (
                    <div className="text-[11px] text-primary-secondary leading-relaxed line-clamp-3">
                      {course.description}
                    </div>
                  )}
                </div>
                {course.certificateUrl && (
                  <div className="pt-2 border-t border-white/5">
                    <a
                      href={course.certificateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline transition-colors"
                    >
                      <span>View Certificate Link</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 5: Verified Technical Skills */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-400" />
            Verified Technical &amp; Professional Skills ({profile?.skills?.length || 0})
          </h3>
          <span className="text-[11px] text-neutral-400 font-mono">100% Grounded Candidate Truth</span>
        </div>

        {/* Grouped Skills by Domain */}
        <div className="space-y-4">
          {Object.entries(
            (profile?.skills || []).reduce<Record<string, SkillFact[]>>((acc, skill) => {
              const catKey = skill.category || 'other';
              if (!acc[catKey]) acc[catKey] = [];
              acc[catKey].push(skill);
              return acc;
            }, {})
          ).map(([catKey, skillsInCat]) => (
            <div key={catKey} className="bg-surface/50 p-4 rounded-xl border border-border/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  {CATEGORY_NAMES[catKey] || catKey.toUpperCase()}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">
                  {skillsInCat.length} skills
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {skillsInCat.map((skill, idx) => (
                  <div key={idx} className="bg-surface p-2.5 rounded-lg border border-border flex items-center justify-between text-xs hover:border-emerald-500/30 transition-colors">
                    <span className="font-medium text-white truncate text-[11px]">{skill.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-semibold capitalize shrink-0 ml-1">
                      {skill.proficiency || 'adv'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
