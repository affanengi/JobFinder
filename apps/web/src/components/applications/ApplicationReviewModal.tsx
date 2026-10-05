import { useState } from 'react'
import { ShieldAlert, CheckCircle2, Lock } from 'lucide-react'
import { JobOpportunity } from '../../types/job'
import { MOCK_VERIFIED_PROFILE } from '../../data/mockUserFacts'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface ApplicationReviewModalProps {
  job: JobOpportunity | null
  isOpen: boolean
  onClose: () => void
  onSubmitFinal: (job: JobOpportunity) => void
}

export function ApplicationReviewModal({
  job,
  isOpen,
  onClose,
  onSubmitFinal
}: ApplicationReviewModalProps) {
  const [sponsorshipAnswer, setSponsorshipAnswer] = useState('No')
  const [availabilityAnswer, setAvailabilityAnswer] = useState('Immediately')
  const [interestAnswer, setInterestAnswer] = useState(
    'I am passionate about building practical AI workflow automation and agentic systems using Python and Playwright, and I am excited to contribute to the innovative engineering work at ' +
      (job?.company || 'your company') +
      '.'
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasConfirmedHumanSubmit, setHasConfirmedHumanSubmit] = useState(false)

  if (!job) return null

  const handleSubmit = () => {
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitting(false)
      onSubmitFinal(job)
      onClose()
    }, 800)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="3xl"
      title={`Application Review — ${job.title}`}
      description={`Portal: ${job.company} · Human Approval Required before Final Submission`}
    >
      <div className="space-y-6">
        {/* Human-in-the-Loop Core Safety Notice */}
        <div className="p-4 bg-surface-subtle rounded-xl border border-warning-border flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-semibold text-warning">Strict Human-in-the-Loop Gate</h4>
            <p className="text-primary-secondary leading-relaxed">
              Playwright has prepared and pre-filled standard profile information. As per system rules, the AI
              agent <strong>never auto-submits</strong>. Please verify all answers and click the submit button below to finalize.
            </p>
          </div>
        </div>

        {/* Pre-Filled Safe Fields Summary */}
        <div className="p-4 bg-surface-subtle rounded-xl border border-border space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-primary">Pre-Filled Contact & Profile Data</span>
            <Badge variant="success" size="sm">
              <CheckCircle2 className="w-3 h-3 text-success" /> Verified
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-[11px] text-primary-muted">Full Name</div>
              <div className="font-medium text-white">{MOCK_VERIFIED_PROFILE.name}</div>
            </div>
            <div>
              <div className="text-[11px] text-primary-muted">Email Address</div>
              <div className="font-medium text-white">{MOCK_VERIFIED_PROFILE.email}</div>
            </div>
            <div>
              <div className="text-[11px] text-primary-muted">Phone</div>
              <div className="font-medium text-white">{MOCK_VERIFIED_PROFILE.phone}</div>
            </div>
            <div>
              <div className="text-[11px] text-primary-muted">Resume Version</div>
              <div className="font-medium text-success">ATS-Tailored v1 (Approved)</div>
            </div>
          </div>
        </div>

        {/* Custom Application Questions Form */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary">
            Application Questions Requiring User Confirmation
          </h4>

          {/* Sponsorship question */}
          <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
            <label className="text-xs font-medium text-primary block">
              Will you now or in the future require employment visa sponsorship?
            </label>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-primary">
                <input
                  type="radio"
                  name="sponsorship"
                  value="No"
                  checked={sponsorshipAnswer === 'No'}
                  onChange={(e) => setSponsorshipAnswer(e.target.value)}
                  className="accent-white"
                />
                <span>No, authorized to work</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-primary">
                <input
                  type="radio"
                  name="sponsorship"
                  value="Yes"
                  checked={sponsorshipAnswer === 'Yes'}
                  onChange={(e) => setSponsorshipAnswer(e.target.value)}
                  className="accent-white"
                />
                <span>Yes, require sponsorship</span>
              </label>
            </div>
          </div>

          {/* Availability question */}
          <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
            <label className="text-xs font-medium text-primary block">
              Earliest available start date:
            </label>
            <input
              type="text"
              value={availabilityAnswer}
              onChange={(e) => setAvailabilityAnswer(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#121212] border border-border rounded-md text-xs text-primary focus:outline-none focus:border-white"
            />
          </div>

          {/* Interest question */}
          <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
            <label className="text-xs font-medium text-primary block">
              Why are you interested in this role at {job.company}? (AI Drafted from your profile)
            </label>
            <textarea
              rows={3}
              value={interestAnswer}
              onChange={(e) => setInterestAnswer(e.target.value)}
              className="w-full p-3 bg-[#121212] border border-border rounded-md text-xs text-primary focus:outline-none focus:border-white resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* Final Submission Gate */}
        <div className="pt-4 border-t border-border space-y-4">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-primary select-none">
            <input
              type="checkbox"
              checked={hasConfirmedHumanSubmit}
              onChange={(e) => setHasConfirmedHumanSubmit(e.target.checked)}
              className="w-4 h-4 rounded accent-white"
            />
            <span>I have reviewed all pre-filled fields and explicitly authorize submission of this application.</span>
          </label>

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="md" onClick={onClose}>
              Cancel & Edit Later
            </Button>

            <Button
              variant="primary"
              size="lg"
              disabled={!hasConfirmedHumanSubmit || isSubmitting}
              onClick={handleSubmit}
            >
              <Lock className="w-4 h-4" />
              <span>{isSubmitting ? 'Submitting Application...' : 'Submit Application (Explicit Action)'}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
