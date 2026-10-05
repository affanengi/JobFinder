import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Upload, 
  CheckCircle2, 
  Briefcase, 
  GraduationCap, 
  Wrench, 
  FolderGit2, 
  Loader2, 
  Mail, 
  Phone, 
  MapPin, 
  ExternalLink,
  Edit3,
  Trash2,
  Plus,
  Pencil,
  Award,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchWithAuth } from '../lib/api';
import { EditProfileModal, UserProfileDTO } from '../components/profile/EditProfileModal';
import { EditEducationModal, EducationFact } from '../components/profile/EditEducationModal';
import { EditExperienceModal, ExperienceFact } from '../components/profile/EditExperienceModal';
import { EditProjectModal, ProjectFact } from '../components/profile/EditProjectModal';
import { EditSkillModal, SkillFact } from '../components/profile/EditSkillModal';
import { EditCourseModal, CourseCertificationFact } from '../components/profile/EditCourseModal';
import { Search } from 'lucide-react';
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal';

interface PersonalLinks {
  github?: string;
  linkedin?: string;
  portfolio?: string;
}

interface PersonalContact {
  fullName: string;
  email: string;
  phone?: string;
  city?: string;
  country?: string;
  links?: PersonalLinks;
}





interface ProfileDTO {
  userId: string;
  personal: PersonalContact;
  skills: SkillFact[];
  projects: ProjectFact[];
  experience: ExperienceFact[];
  education: EducationFact[];
  courseCertifications?: CourseCertificationFact[];
  summary?: string;
  profileVersion: number;
}

interface DeleteTarget {
  type: 'education' | 'experience' | 'project' | 'skill' | 'course';
  id: string;
  name: string;
}

export const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  // Education Modal State
  const [isEduModalOpen, setIsEduModalOpen] = useState(false);
  const [selectedEdu, setSelectedEdu] = useState<EducationFact | null>(null);

  // Skill Modal State & Category Filter
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillFact | null>(null);
  const [activeSkillCategory, setActiveSkillCategory] = useState<string>('all');
  const [skillSearchQuery, setSkillSearchQuery] = useState<string>('');

  // Project Modal State
  const [isProjModalOpen, setIsProjModalOpen] = useState(false);
  const [selectedProj, setSelectedProj] = useState<ProjectFact | null>(null);

  // Experience Modal State
  const [isExpModalOpen, setIsExpModalOpen] = useState(false);
  const [selectedExp, setSelectedExp] = useState<ExperienceFact | null>(null);

  // Course Certification Modal State
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseCertificationFact | null>(null);

  // Delete Confirmation Modal State
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchProfile = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth('/api/v1/profile');
      if (res.ok) {
        const data: ProfileDTO = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user]);

  const saveUpdatedProfile = async (updatedProfile: ProfileDTO, successMsg: string) => {
    setProfile(updatedProfile);
    try {
      const res = await fetchWithAuth('/api/v1/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProfile),
      });

      if (res.ok) {
        showToast(successMsg);
      } else {
        showToast('Error syncing updates to Firestore.');
      }
    } catch (err) {
      console.error('Failed to sync profile update:', err);
      showToast('Error syncing updates to Firestore.');
    }
  };

  const handleSaveProfileEdits = async (updated: Partial<UserProfileDTO>) => {
    if (!profile) return;

    const updatedProfile: ProfileDTO = {
      ...profile,
      personal: {
        ...profile.personal,
        fullName: updated.personal?.fullName ?? profile.personal.fullName,
        email: updated.personal?.email ?? profile.personal.email,
        phone: updated.personal?.phone ?? profile.personal.phone,
        city: updated.personal?.city ?? profile.personal.city,
        country: updated.personal?.country ?? profile.personal.country,
        links: {
          ...profile.personal.links,
          ...updated.personal?.links,
        },
      },
      summary: updated.summary ?? profile.summary,
    };

    await saveUpdatedProfile(updatedProfile, 'Master Profile details updated in Cloud Firestore!');
  };

  // Skill handlers
  const handleOpenAddSkill = () => {
    setSelectedSkill(null);
    setIsSkillModalOpen(true);
  };

  const handleOpenEditSkill = (skill: SkillFact) => {
    setSelectedSkill(skill);
    setIsSkillModalOpen(true);
  };

  const handleSaveSkill = async (savedSkill: SkillFact) => {
    if (!profile) return;
    const exists = profile.skills.some((s) => s.id === savedSkill.id);
    const updatedSkillList = exists
      ? profile.skills.map((s) => (s.id === savedSkill.id ? savedSkill : s))
      : [...profile.skills, savedSkill];

    const updated = {
      ...profile,
      skills: updatedSkillList,
    };
    await saveUpdatedProfile(
      updated,
      exists ? `Skill "${savedSkill.name}" updated in Master Profile!` : `Skill "${savedSkill.name}" added to Master Profile!`
    );
  };

  // Education handlers
  const handleOpenAddEdu = () => {
    setSelectedEdu(null);
    setIsEduModalOpen(true);
  };

  const handleOpenEditEdu = (edu: EducationFact) => {
    setSelectedEdu(edu);
    setIsEduModalOpen(true);
  };

  const handleSaveEducation = async (savedEdu: EducationFact) => {
    if (!profile) return;
    const exists = profile.education.some((e) => e.id === savedEdu.id);
    const updatedEduList = exists
      ? profile.education.map((e) => (e.id === savedEdu.id ? savedEdu : e))
      : [savedEdu, ...profile.education];

    const updated = {
      ...profile,
      education: updatedEduList,
    };
    await saveUpdatedProfile(
      updated,
      exists ? 'Education record updated in Master Profile!' : 'New education record added to Master Profile!'
    );
  };

  // Project handlers
  const handleOpenAddProj = () => {
    setSelectedProj(null);
    setIsProjModalOpen(true);
  };

  const handleOpenEditProj = (proj: ProjectFact) => {
    setSelectedProj(proj);
    setIsProjModalOpen(true);
  };

  const handleSaveProject = async (savedProj: ProjectFact) => {
    if (!profile) return;
    const exists = profile.projects.some((p) => p.id === savedProj.id);
    const updatedProjList = exists
      ? profile.projects.map((p) => (p.id === savedProj.id ? savedProj : p))
      : [savedProj, ...profile.projects];

    const updated = {
      ...profile,
      projects: updatedProjList,
    };
    await saveUpdatedProfile(
      updated,
      exists ? 'Project record updated in Master Profile!' : 'New project record added to Master Profile!'
    );
  };

  // Helper to distinguish leadership & club roles from professional work experience
  const isLeadershipExp = (e: ExperienceFact) => {
    const cat = ((e as any).category || '').toLowerCase();
    const emp = ((e as any).employmentType || '').toLowerCase();
    const co = (e.company || '').toLowerCase();
    return cat === 'leadership' || emp === 'leadership' || emp === 'club' || co.includes('club') || co.includes('techniva');
  };

  // Experience handlers
  const handleOpenAddExp = (forLeadership: boolean = false) => {
    setSelectedExp(forLeadership ? {
      id: '',
      company: '',
      title: '',
      current: false,
      bullets: [''],
      verified: true,
      category: 'leadership',
      employmentType: 'leadership',
    } as any : null);
    setIsExpModalOpen(true);
  };

  const handleOpenEditExp = (exp: ExperienceFact) => {
    setSelectedExp(exp);
    setIsExpModalOpen(true);
  };

  const handleSaveExperience = async (savedExp: ExperienceFact) => {
    if (!profile) return;
    const exists = profile.experience.some((e) => e.id === savedExp.id);
    const updatedExpList = exists
      ? profile.experience.map((e) => (e.id === savedExp.id ? savedExp : e))
      : [savedExp, ...profile.experience];

    const updated = {
      ...profile,
      experience: updatedExpList,
    };
    await saveUpdatedProfile(
      updated,
      exists ? 'Experience record updated in Master Profile!' : 'New experience record added to Master Profile!'
    );
  };

  // Course handlers
  const handleOpenAddCourse = () => {
    setSelectedCourse(null);
    setIsCourseModalOpen(true);
  };

  const handleOpenEditCourse = (course: CourseCertificationFact) => {
    setSelectedCourse(course);
    setIsCourseModalOpen(true);
  };

  const handleSaveCourse = async (savedCourse: CourseCertificationFact) => {
    if (!profile) return;
    const currentCourses = profile.courseCertifications || [];
    const exists = currentCourses.some((c) => c.id === savedCourse.id);
    const updatedCourseList = exists
      ? currentCourses.map((c) => (c.id === savedCourse.id ? savedCourse : c))
      : [savedCourse, ...currentCourses];

    const updated = {
      ...profile,
      courseCertifications: updatedCourseList,
    };
    await saveUpdatedProfile(
      updated,
      exists ? 'Course / certification updated in Master Profile!' : 'New course / certification added to Master Profile!'
    );
  };

  // Confirmed delete execution
  const handleExecuteDelete = async () => {
    if (!profile || !deleteTarget) return;

    let updated: ProfileDTO;
    let msg: string;

    switch (deleteTarget.type) {
      case 'education':
        updated = {
          ...profile,
          education: profile.education.filter((e) => e.id !== deleteTarget.id),
        };
        msg = `Education record "${deleteTarget.name}" deleted.`;
        break;
      case 'experience':
        updated = {
          ...profile,
          experience: profile.experience.filter((e) => e.id !== deleteTarget.id),
        };
        msg = `Experience record "${deleteTarget.name}" deleted.`;
        break;
      case 'project':
        updated = {
          ...profile,
          projects: profile.projects.filter((p) => p.id !== deleteTarget.id),
        };
        msg = `Project "${deleteTarget.name}" deleted.`;
        break;
      case 'skill':
        updated = {
          ...profile,
          skills: profile.skills.filter((s) => s.id !== deleteTarget.id),
        };
        msg = `Skill "${deleteTarget.name}" deleted.`;
        break;
      case 'course':
        updated = {
          ...profile,
          courseCertifications: (profile.courseCertifications || []).filter((c) => c.id !== deleteTarget.id),
        };
        msg = `Course / certification "${deleteTarget.name}" deleted.`;
        break;
      default:
        return;
    }

    await saveUpdatedProfile(updated, msg);
    setDeleteTarget(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetchWithAuth('/api/v1/profile/upload-resume', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        showToast('Resume imported! Extracted facts updated.');
        await fetchProfile();
      } else {
        showToast('Failed to parse uploaded resume.');
      }
    } catch (err) {
      console.error('Error uploading resume:', err);
      showToast('Error uploading resume.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#1A1A1A] border border-emerald-500/40 text-emerald-400 text-xs font-mono shadow-2xl flex items-center gap-2 animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Master Profile & Truth</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Grounded in Verified Profile
            </span>
          </div>
          <p className="text-xs text-[#A3A3A3] mt-1">
            Authoritative career facts, verified skills, and academic history for zero-hallucination tailoring.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-neutral-700 border border-white/20 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm">
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>{isUploading ? 'Extracting Facts...' : 'Upload General Resume'}</span>
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>

          <button
            onClick={() => setIsEditModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors cursor-pointer shadow-sm"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-7 h-7 animate-spin text-white" />
          <p className="text-xs text-[#A3A3A3] font-mono">Loading verified career facts from Cloud Firestore...</p>
        </div>
      ) : profile ? (
        <div className="space-y-6">
          
          {/* Identity & Contact Card */}
          <div className="bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-bold text-white">{profile.personal.fullName}</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#222222] text-[#A3A3A3] border border-white/10">
                    v{profile.profileVersion}.0
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#A3A3A3]">
                  {profile.personal.email && (
                    <div className="flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-[#666666]" />
                      <span>{profile.personal.email}</span>
                    </div>
                  )}
                  {profile.personal.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-[#666666]" />
                      <span>{profile.personal.phone}</span>
                    </div>
                  )}
                  {profile.personal.city && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#666666]" />
                      <span>{profile.personal.city}, {profile.personal.country || 'India'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Social URLs */}
              <div className="flex items-center gap-2">
                {profile.personal.links?.github && (
                  <a
                    href={profile.personal.links.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0D0D0D] border border-white/10 hover:border-white/30 text-neutral-300 text-xs font-mono transition-colors"
                  >
                    <span>GitHub</span>
                    <ExternalLink className="w-3 h-3 text-[#666666]" />
                  </a>
                )}
                {profile.personal.links?.linkedin && (
                  <a
                    href={profile.personal.links.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0D0D0D] border border-white/10 hover:border-white/30 text-neutral-300 text-xs font-mono transition-colors"
                  >
                    <span>LinkedIn</span>
                    <ExternalLink className="w-3 h-3 text-[#666666]" />
                  </a>
                )}
                {profile.personal.links?.portfolio && (
                  <a
                    href={profile.personal.links.portfolio}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0D0D0D] border border-white/10 hover:border-white/30 text-neutral-300 text-xs font-mono transition-colors"
                  >
                    <span>Portfolio</span>
                    <ExternalLink className="w-3 h-3 text-[#666666]" />
                  </a>
                )}
              </div>
            </div>

            {/* Career Summary */}
            {profile.summary && (
              <div className="pt-3 border-t border-white/10">
                <span className="text-[10px] font-mono uppercase text-[#666666] block mb-1">Authoritative Career Summary</span>
                <p className="text-xs text-neutral-300 leading-relaxed">{profile.summary}</p>
              </div>
            )}
          </div>

          {/* Grid Layout for Skills, Projects, Education, and Experience */}
          <div className="space-y-6">
            
            {/* Verified Skills */}
            <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                    Verified Skills ({profile.skills.length})
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    Authoritative Truth
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenAddSkill}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Skill</span>
                  </button>
                </div>
              </div>

              {/* Category Filter Pills & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  {[
                    { id: 'all', label: 'All', count: profile.skills.length },
                    { id: 'programming', label: 'Languages', count: profile.skills.filter(s => s.category === 'programming').length },
                    { id: 'web', label: 'Frontend & UI', count: profile.skills.filter(s => s.category === 'web').length },
                    { id: 'backend', label: 'Backend', count: profile.skills.filter(s => s.category === 'backend').length },
                    { id: 'data', label: 'Databases', count: profile.skills.filter(s => s.category === 'data').length },
                    { id: 'ai_ml', label: 'AI & GenAI', count: profile.skills.filter(s => s.category === 'ai_ml').length },
                    { id: 'automation', label: 'Automation', count: profile.skills.filter(s => s.category === 'automation').length },
                    { id: 'tools', label: 'Tools & Platforms', count: profile.skills.filter(s => s.category === 'tools').length },
                    { id: 'cloud', label: 'Cloud', count: profile.skills.filter(s => s.category === 'cloud').length },
                    { id: 'productivity', label: 'Productivity', count: profile.skills.filter(s => s.category === 'productivity').length },
                    { id: 'engineering', label: 'Engineering', count: profile.skills.filter(s => s.category === 'engineering').length },
                    { id: 'soft', label: 'Soft Skills', count: profile.skills.filter(s => s.category === 'soft').length },
                    { id: 'languages_spoken', label: 'Languages Spoken', count: profile.skills.filter(s => s.category === 'languages_spoken').length },
                  ].filter(cat => cat.id === 'all' || cat.count > 0).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveSkillCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                        activeSkillCategory === cat.id
                          ? 'bg-white text-black font-bold'
                          : 'bg-[#0D0D0D] border border-white/10 text-neutral-400 hover:text-white hover:border-white/20'
                      }`}
                    >
                      {cat.label} ({cat.count})
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[140px] sm:w-48">
                  <Search className="w-3 h-3 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter skills..."
                    value={skillSearchQuery}
                    onChange={(e) => setSkillSearchQuery(e.target.value)}
                    className="w-full pl-7 pr-2.5 py-1 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white placeholder:text-[#555555] focus:border-white/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Skills Chips Grid */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {profile.skills
                  .filter((skill) => {
                    const matchesCat = activeSkillCategory === 'all' || skill.category === activeSkillCategory;
                    const matchesSearch = !skillSearchQuery || skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase());
                    return matchesCat && matchesSearch;
                  })
                  .map((skill) => (
                    <span
                      key={skill.id}
                      className="group/skill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-medium hover:border-emerald-500/50 transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>{skill.name}</span>
                      {skill.proficiency && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 uppercase font-semibold font-mono">
                          {skill.proficiency === 'advanced' ? 'adv' : skill.proficiency === 'intermediate' ? 'int' : 'beg'}
                        </span>
                      )}
                      
                      {/* Action buttons */}
                      <button
                        onClick={() => handleOpenEditSkill(skill)}
                        className="opacity-0 group-hover/skill:opacity-100 text-[#888888] hover:text-white transition-opacity ml-0.5 cursor-pointer"
                        title="Edit skill details"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ type: 'skill', id: skill.id, name: skill.name })}
                        className="opacity-0 group-hover/skill:opacity-100 text-neutral-400 hover:text-rose-400 transition-opacity ml-0.5 cursor-pointer"
                        title="Remove skill from profile"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
              </div>
            </div>

            {/* Verified Projects */}
            <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                    Verified Projects ({profile.projects.length})
                  </h3>
                </div>
                <button
                  onClick={handleOpenAddProj}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Project</span>
                </button>
              </div>

              <div className="space-y-3 pt-1">
                {profile.projects.map((proj) => (
                  <div key={proj.id} className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white">{proj.name}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Verified
                        </span>
                        <button
                          onClick={() => handleOpenEditProj(proj)}
                          className="text-[#888888] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                          title="Edit project & bullets"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: 'project', id: proj.id, name: proj.name })}
                          className="text-[#666666] hover:text-rose-400 transition-colors p-1 rounded hover:bg-white/5 cursor-pointer"
                          title="Delete project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#A3A3A3]">{proj.description}</p>
                    {proj.bullets && proj.bullets.length > 0 && (
                      <ul className="list-disc list-inside text-[11px] text-neutral-300 space-y-1">
                        {proj.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {proj.technologies && proj.technologies.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {proj.technologies.map((t, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] text-[#A3A3A3] border border-white/10">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Verified Courses & Certifications */}
            <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                    Courses &amp; Certifications ({(profile.courseCertifications || []).length})
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hidden sm:inline-flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Verified Evidence
                  </span>
                </div>
                <button
                  onClick={handleOpenAddCourse}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Course</span>
                </button>
              </div>

              {(!profile.courseCertifications || profile.courseCertifications.length === 0) ? (
                <div className="p-4 rounded-xl bg-[#0D0D0D] border border-dashed border-white/10 text-center text-xs text-[#A3A3A3]">
                  No courses or certifications listed yet. Click "+ Add Course" to record your completed learning credentials.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {profile.courseCertifications.map((course) => (
                    <div
                      key={course.id}
                      className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 flex flex-col justify-between gap-3 group hover:border-white/20 transition-colors"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-white leading-snug line-clamp-2">
                            {course.title}
                          </h4>
                          {course.completionYear && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] text-[#A3A3A3] border border-white/10 shrink-0">
                              {course.completionYear}
                            </span>
                          )}
                        </div>

                        {course.provider && (
                          <div className="text-[11px] text-[#A3A3A3] font-medium flex items-center gap-1.5 flex-wrap">
                            <span>{course.provider}</span>
                            {course.instructor && (
                              <>
                                <span className="text-neutral-600">•</span>
                                <span className="text-emerald-400 font-mono text-[10px]">Instr: {course.instructor}</span>
                              </>
                            )}
                          </div>
                        )}
                        {!course.provider && course.instructor && (
                          <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                            <span>Instructor: {course.instructor}</span>
                          </div>
                        )}

                        {course.description && (
                          <p className="text-[11px] text-neutral-400 leading-relaxed line-clamp-3">
                            {course.description}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {course.certificateUrl ? (
                            <a
                              href={course.certificateUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline transition-colors truncate"
                            >
                              <span>View Certificate</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-[10px] text-neutral-500 font-mono">No Link</span>
                          )}
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                            Verified
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleOpenEditCourse(course)}
                            className="text-[#888888] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                            title="Edit course details"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              setDeleteTarget({
                                type: 'course',
                                id: course.id,
                                name: course.title,
                              })
                            }
                            className="text-[#666666] hover:text-rose-400 transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                            title="Delete course"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Verified Education & Experience */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Education Card */}
              <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                      Education ({profile.education.length})
                    </h3>
                  </div>
                  <button
                    onClick={handleOpenAddEdu}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {profile.education.map((edu) => (
                    <div key={edu.id} className="p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10 flex items-start justify-between gap-2 group hover:border-white/20 transition-colors">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white truncate">{edu.degree}</span>
                          {edu.grade && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-0.5">
                              <Award className="w-2.5 h-2.5" />
                              <span>{edu.grade}</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#A3A3A3] truncate">{edu.institution}</div>
                        <div className="flex items-center gap-2 text-[10px] font-mono text-[#666666]">
                          {edu.field && <span>{edu.field}</span>}
                          {edu.field && edu.endDate && <span>•</span>}
                          {edu.endDate && <span>Class of {edu.endDate}</span>}
                        </div>
                      </div>
                      
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleOpenEditEdu(edu)}
                          className="text-[#888888] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                          title="Edit education details & percentage/grade"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: 'education', id: edu.id, name: `${edu.degree} (${edu.institution})` })}
                          className="text-[#666666] hover:text-rose-400 transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                          title="Delete education entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Professional Experience Card */}
              {(() => {
                const workExp = profile.experience.filter((e) => !isLeadershipExp(e));
                const leadershipExp = profile.experience.filter((e) => isLeadershipExp(e));

                return (
                  <>
                    <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Briefcase className="w-4 h-4 text-emerald-400" />
                          <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                            Professional Experience ({workExp.length})
                          </h3>
                        </div>
                        <button
                          onClick={() => handleOpenAddExp(false)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Work Exp</span>
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {workExp.length === 0 ? (
                          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-dashed border-white/10 text-center text-xs text-[#A3A3A3]">
                            No professional experience records listed yet. Click "+ Add Work Exp" to record verified roles.
                          </div>
                        ) : (
                          workExp.map((exp) => (
                            <div key={exp.id} className="p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10 flex items-start justify-between gap-2 group hover:border-white/20 transition-colors">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-white truncate">{exp.title}</span>
                                  <span className="text-[10px] font-mono text-[#888888]">
                                    {exp.startDate ? `${exp.startDate} - ` : ''}{exp.current ? 'Present' : exp.endDate || ''}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#A3A3A3] truncate">
                                  {exp.company} {exp.location ? `• ${exp.location}` : ''}
                                </div>
                                {exp.bullets && exp.bullets.length > 0 && (
                                  <div className="text-[11px] text-neutral-400 space-y-0.5 pt-1">
                                    {exp.bullets.slice(0, 2).map((b, i) => (
                                      <div key={i} className="flex items-start gap-1">
                                        <span className="text-neutral-500">•</span>
                                        <span className="truncate">{b}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              
                              {/* Action buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleOpenEditExp(exp)}
                                  className="text-[#888888] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                                  title="Edit professional experience"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteTarget({ type: 'experience', id: exp.id, name: `${exp.title} (${exp.company})` })}
                                  className="text-[#666666] hover:text-rose-400 transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                                  title="Delete experience entry"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Leadership & Activities Card */}
                    <div className="bg-[#161616] border border-white/20 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-emerald-400" />
                          <h3 className="text-xs font-mono uppercase text-white tracking-wider">
                            Leadership & Activities ({leadershipExp.length})
                          </h3>
                        </div>
                        <button
                          onClick={() => handleOpenAddExp(true)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Role</span>
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {leadershipExp.length === 0 ? (
                          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-dashed border-white/10 text-center text-xs text-[#A3A3A3]">
                            No leadership or club records listed. Click "+ Add Role" to record your activities.
                          </div>
                        ) : (
                          leadershipExp.map((exp) => (
                            <div key={exp.id} className="p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10 flex items-start justify-between gap-2 group hover:border-white/20 transition-colors">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-white truncate">{exp.title}</span>
                                  <span className="text-[10px] font-mono text-[#888888]">
                                    {exp.startDate ? `${exp.startDate} - ` : ''}{exp.current ? 'Present' : exp.endDate || ''}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#A3A3A3] truncate">{exp.company}</div>
                                {exp.bullets && exp.bullets.length > 0 && (
                                  <div className="text-[11px] text-neutral-400 space-y-0.5 pt-1">
                                    {exp.bullets.slice(0, 2).map((b, i) => (
                                      <div key={i} className="flex items-start gap-1">
                                        <span className="text-neutral-500">•</span>
                                        <span className="truncate">{b}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              
                              {/* Action buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleOpenEditExp(exp)}
                                  className="text-[#888888] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                                  title="Edit leadership / club experience"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteTarget({ type: 'experience', id: exp.id, name: `${exp.title} (${exp.company})` })}
                                  className="text-[#666666] hover:text-rose-400 transition-colors p-1 rounded hover:bg-white/10 cursor-pointer"
                                  title="Delete experience entry"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}

            </div>

          </div>
        </div>
      ) : (
        <div className="py-20 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Unable to Load Verified Profile</h3>
            <p className="text-xs text-[#A3A3A3] mt-1 max-w-sm">
              Could not connect to the API server or fetch profile facts. Please ensure the backend server is running.
            </p>
          </div>
          <button
            onClick={fetchProfile}
            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Edit Profile Details Modal */}
      {profile && (
        <EditProfileModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          profile={profile}
          onSave={handleSaveProfileEdits}
        />
      )}

      {/* Edit / Add Project Modal */}
      <EditProjectModal
        isOpen={isProjModalOpen}
        onClose={() => setIsProjModalOpen(false)}
        project={selectedProj}
        onSave={handleSaveProject}
      />

      {/* Edit / Add Education Modal */}
      <EditEducationModal
        isOpen={isEduModalOpen}
        onClose={() => setIsEduModalOpen(false)}
        education={selectedEdu}
        onSave={handleSaveEducation}
      />

      {/* Edit / Add Skill Modal */}
      <EditSkillModal
        isOpen={isSkillModalOpen}
        onClose={() => setIsSkillModalOpen(false)}
        skill={selectedSkill}
        onSave={handleSaveSkill}
      />

      {/* Edit / Add Experience Modal */}
      <EditExperienceModal
        isOpen={isExpModalOpen}
        onClose={() => setIsExpModalOpen(false)}
        experience={selectedExp}
        onSave={handleSaveExperience}
      />

      {/* Edit / Add Course Modal */}
      <EditCourseModal
        isOpen={isCourseModalOpen}
        onClose={() => setIsCourseModalOpen(false)}
        course={selectedCourse}
        onSave={handleSaveCourse}
      />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          isOpen={!!deleteTarget}
          title={`Delete ${deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1)}`}
          itemName={deleteTarget.name}
          message={`Are you sure you want to delete "${deleteTarget.name}"? This action will permanently remove it from your verified Master Profile in Cloud Firestore.`}
          onConfirm={handleExecuteDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};
