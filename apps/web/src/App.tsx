import React, { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { DashboardPage } from './pages/DashboardPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ResumesPage } from './pages/ResumesPage';
import { ScannerPage } from './pages/ScannerPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RecentActivitiesPage } from './pages/RecentActivitiesPage';
import { CompanyDirectoryPage } from './pages/CompanyDirectoryPage';
import { CompanyProfilePage } from './pages/CompanyProfilePage';
import { ContactOutreachPage } from './pages/ContactOutreachPage';
import { ResumeStudioModal, TailoredResumeDTO } from './components/resume/ResumeStudioModal';
import { fetchWithAuth } from './lib/api';

const VALID_TABS = [
  'dashboard',
  'opportunities',
  'companies',
  'profile',
  'resumes',
  'scanner',
  'applications',
  'ai-activity',
  'settings',
] as const;

type ValidTab = typeof VALID_TABS[number];
const DEFAULT_TAB: ValidTab = 'opportunities';

function parseCompaniesHash(hash: string): { companyKey: string | null; contactId: string | null; oppId: string | null } {
  const clean = hash.replace(/^#/, '');
  const [path, query] = clean.split('?');
  const parts = path.split('/');
  let companyKey: string | null = null;
  let contactId: string | null = null;
  let oppId: string | null = null;

  if (parts[0] === 'companies' && parts[1]) {
    companyKey = parts[1];
    if (parts[2] === 'contacts' && parts[3]) {
      contactId = parts[3];
    }
  }

  if (query) {
    const params = new URLSearchParams(query);
    oppId = params.get('oppId');
  }

  return { companyKey, contactId, oppId };
}

function getInitialTab(): ValidTab {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace(/^#/, '').toLowerCase();
    const primary = hash.split('?')[0].split('/')[0];
    if (VALID_TABS.includes(primary as ValidTab)) {
      return primary as ValidTab;
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

  // Companies & Contacts Sub-Navigation State
  const initialCompanyNav = typeof window !== 'undefined' ? parseCompaniesHash(window.location.hash) : { companyKey: null, contactId: null, oppId: null };
  const [selectedCompanyKey, setSelectedCompanyKey] = useState<string | null>(initialCompanyNav.companyKey);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(initialCompanyNav.contactId);
  const [selectedContactOppId, setSelectedContactOppId] = useState<string | null>(initialCompanyNav.oppId);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    if (tab !== 'companies') {
      setSelectedCompanyKey(null);
      setSelectedContactId(null);
      setSelectedContactOppId(null);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('jobfinder_active_tab', tab);
      } catch {}
      if (window.location.hash !== `#${tab}`) {
        window.location.hash = tab;
      }
    }
  };

  const handleSelectCompany = (key: string) => {
    setSelectedCompanyKey(key);
    setSelectedContactId(null);
    setSelectedContactOppId(null);
    setActiveTabState('companies');
    if (typeof window !== 'undefined') {
      window.location.hash = `companies/${key}`;
    }
  };

  const handleSelectContact = (contactId: string, oppId: string) => {
    setSelectedContactId(contactId);
    setSelectedContactOppId(oppId);
    setActiveTabState('companies');
    if (typeof window !== 'undefined' && selectedCompanyKey) {
      window.location.hash = `companies/${selectedCompanyKey}/contacts/${contactId}?oppId=${oppId}`;
    }
  };

  const handleBackToCompany = () => {
    setSelectedContactId(null);
    setSelectedContactOppId(null);
    if (typeof window !== 'undefined' && selectedCompanyKey) {
      window.location.hash = `companies/${selectedCompanyKey}`;
    }
  };

  const handleBackToDirectory = () => {
    setSelectedCompanyKey(null);
    setSelectedContactId(null);
    setSelectedContactOppId(null);
    if (typeof window !== 'undefined') {
      window.location.hash = 'companies';
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const primary = hash.split('?')[0].split('/')[0].toLowerCase();

      if (VALID_TABS.includes(primary as ValidTab)) {
        setActiveTabState((current) => {
          if (current !== primary) {
            try {
              localStorage.setItem('jobfinder_active_tab', primary);
            } catch {}
            return primary;
          }
          return current;
        });

        if (primary === 'companies') {
          const nav = parseCompaniesHash(window.location.hash);
          setSelectedCompanyKey(nav.companyKey);
          setSelectedContactId(nav.contactId);
          if (nav.oppId) setSelectedContactOppId(nav.oppId);
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
      case 'companies':
        if (selectedContactId) {
          return { title: 'Contact Outreach', subtitle: 'Personalized Truth-Lock email composition & response tracking' };
        }
        if (selectedCompanyKey) {
          return { title: 'Company Profile', subtitle: 'Attributable overview, Scam Shield legitimacy assessment, and professional contacts' };
        }
        return { title: 'Companies & Contacts', subtitle: 'Browse hiring organizations, verify legitimacy, and connect with stakeholders' };
      case 'profile':
        return { title: 'Master Profile', subtitle: 'Sole canonical source of career facts, verified skills, and academic history' };
      case 'resumes':
        return { title: 'Tailored Resumes', subtitle: 'ATS-optimized resumes with zero hallucination' };
      case 'scanner':
        return { title: 'ATS Scanner', subtitle: '100-Point ATS parseability & technical keyword match engine' };
      case 'applications':
        return { title: 'Applications', subtitle: 'Track submitted & in-flight applications' };
      case 'ai-activity':
        return { title: 'Recent AI Activities', subtitle: 'Audit log of model invocations, routing decisions, and fallback traces' };
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
      case 'companies':
        if (selectedCompanyKey && selectedContactId) {
          return (
            <ContactOutreachPage
              companyKey={selectedCompanyKey}
              contactId={selectedContactId}
              opportunityId={selectedContactOppId || 'primary'}
              onBackToCompany={handleBackToCompany}
              onBackToDirectory={handleBackToDirectory}
            />
          );
        }
        if (selectedCompanyKey) {
          return (
            <CompanyProfilePage
              companyKey={selectedCompanyKey}
              onBackToDirectory={handleBackToDirectory}
              onSelectContact={(cId, oppId) => handleSelectContact(cId, oppId)}
            />
          );
        }
        return (
          <CompanyDirectoryPage
            onSelectCompany={handleSelectCompany}
            onNavigateToOpportunities={() => setActiveTab('opportunities')}
          />
        );
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
        return (
          <ApplicationsPage 
            onNavigateToOpportunities={() => setActiveTab('opportunities')} 
          />
        );
      case 'ai-activity':
        return <RecentActivitiesPage />;
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
      <SyncProvider>
        <AppContent />
      </SyncProvider>
    </AuthProvider>
  );
};

export default App;
