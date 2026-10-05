import React, { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { DashboardPage } from './pages/DashboardPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ResumesPage } from './pages/ResumesPage';
import { ScannerPage } from './pages/ScannerPage';
import { MemoryPage } from './pages/MemoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ResumeStudioModal, TailoredResumeDTO } from './components/resume/ResumeStudioModal';
import { fetchWithAuth } from './lib/api';

const VALID_TABS = [
  'dashboard',
  'opportunities',
  'profile',
  'resumes',
  'scanner',
  'applications',
  'memory',
  'settings',
] as const;

type ValidTab = typeof VALID_TABS[number];
const DEFAULT_TAB: ValidTab = 'opportunities';

function getInitialTab(): ValidTab {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (VALID_TABS.includes(hash as ValidTab)) {
      return hash as ValidTab;
    }
    try {
      const stored = localStorage.getItem('jobfinder_active_tab');
      if (stored && VALID_TABS.includes(stored as ValidTab)) {
        return stored as ValidTab;
      }
    } catch {
      // ignore storage error
    }
  }
  return DEFAULT_TAB;
}

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTabState] = useState<string>(getInitialTab);
  const [recommendationsCount, setRecommendationsCount] = useState<number>(0);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('jobfinder_active_tab', tab);
      } catch {}
      if (window.location.hash !== `#${tab}`) {
        window.location.hash = tab;
      }
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').toLowerCase();
      if (VALID_TABS.includes(hash as ValidTab)) {
        setActiveTabState((current) => {
          if (current !== hash) {
            try {
              localStorage.setItem('jobfinder_active_tab', hash);
            } catch {}
            return hash;
          }
          return current;
        });
      }
    };

    if (window.location.hash.replace(/^#/, '').toLowerCase() !== activeTab) {
      window.location.hash = activeTab;
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab]);

  useEffect(() => {
    fetchWithAuth('/api/v1/recommendations')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          const count = data.filter((j: any) => !j.status || j.status === 'recommended').length;
          setRecommendationsCount(count);
        }
      })
      .catch(() => {});
  }, []);
  const [scannerResumeId, setScannerResumeId] = useState<string | null>(null);
  const [scannerJobId, setScannerJobId] = useState<string | null>(null);

  // Direct Resume Studio Launcher State
  const [studioConfig, setStudioConfig] = useState<{
    isOpen: boolean;
    jobId: string;
    jobTitle: string;
    jobCompany: string;
    existingResume?: TailoredResumeDTO | null;
  } | null>(null);

  const handleNavigateToScanner = (resumeId: string, jobId?: string) => {
    setScannerResumeId(resumeId);
    setScannerJobId(jobId || null);
    setActiveTab('scanner');
  };

  const handleOpenStudioFromScanner = async (resumeId: string, jobId?: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/resumes`);
      if (res.ok) {
        const resumes: TailoredResumeDTO[] = await res.json();
        const matched = resumes.find((r) => r.id === resumeId);
        if (matched) {
          setStudioConfig({
            isOpen: true,
            jobId: matched.jobId || jobId || 'general',
            jobTitle: matched.jobTitle,
            jobCompany: matched.jobCompany,
            existingResume: matched,
          });
          return;
        }
      }
    } catch (e) {
      console.error('Failed to resolve resume for studio:', e);
    }
  };

  const getPageMeta = () => {
    switch (activeTab) {
      case 'dashboard':
        return { title: 'Dashboard', subtitle: 'Daily job discovery & match intelligence' };
      case 'opportunities':
        return { title: 'Opportunities', subtitle: 'Ranked & scored match recommendations' };
      case 'profile':
        return { title: 'Master Profile', subtitle: 'Verified career facts & truth knowledge base' };
      case 'resumes':
        return { title: 'Tailored Resumes', subtitle: 'ATS-optimized resumes with zero hallucination' };
      case 'scanner':
        return { title: 'ATS Scanner', subtitle: '100-Point ATS parseability & technical keyword match engine' };
      case 'applications':
        return { title: 'Applications', subtitle: 'Track submitted & in-flight applications' };
      case 'memory':
        return { title: 'Memory Layer', subtitle: 'Learned preferences & interaction history' };
      case 'settings':
        return { title: 'Settings', subtitle: 'Job discovery parameters & hard filters' };
      default:
        return { title: 'jobFinder', subtitle: 'Personal AI Career OS' };
    }
  };

  const renderActivePage = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardPage
            onNavigateToOpportunities={() => setActiveTab('opportunities')}
            onNavigateToTab={(tab: string) => setActiveTab(tab)}
          />
        );
      case 'opportunities':
        return <OpportunitiesPage onCountChange={setRecommendationsCount} />;
      case 'profile':
        return <ProfilePage />;
      case 'resumes':
        return (
          <ResumesPage 
            onNavigateToOpportunities={() => setActiveTab('opportunities')}
            onNavigateToScanner={handleNavigateToScanner}
          />
        );
      case 'scanner':
        return (
          <ScannerPage
            initialResumeId={scannerResumeId}
            initialJobId={scannerJobId}
            onOpenResumeStudio={handleOpenStudioFromScanner}
            onNavigateToResumes={() => setActiveTab('resumes')}
          />
        );
      case 'applications':
        return <ApplicationsPage />;
      case 'memory':
        return <MemoryPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <OpportunitiesPage onCountChange={setRecommendationsCount} />;
    }
  };

  const pageMeta = getPageMeta();

  return (
    <div className="flex h-screen bg-bg text-primary overflow-hidden font-sans antialiased selection:bg-white/20 selection:text-white">
      {/* Notion-Style Dark Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        recommendationsCount={recommendationsCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-bg">
        <TopHeader pageTitle={pageMeta.title} pageSubtitle={pageMeta.subtitle} />
        
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            {renderActivePage()}
          </div>
        </main>
      </div>

      {/* Studio Modal Launched from Scanner */}
      {studioConfig && (
        <ResumeStudioModal
          isOpen={studioConfig.isOpen}
          onClose={() => setStudioConfig(null)}
          jobId={studioConfig.jobId}
          jobTitle={studioConfig.jobTitle}
          jobCompany={studioConfig.jobCompany}
          initialTab="resume"
          existingResume={studioConfig.existingResume}
          onApplicationApproved={() => setStudioConfig(null)}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
