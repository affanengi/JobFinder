import React from 'react';
import { 
  Sparkles, 
  Send, 
  FileText, 
  BrainCircuit, 
  Settings, 
  LayoutDashboard,
  ShieldCheck,
  UserCheck,
  Gauge
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  recommendationsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  recommendationsCount = 4,
}) => {
  const { user } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'opportunities', label: 'Opportunities', icon: Sparkles, badge: recommendationsCount },
    { id: 'profile', label: 'Master Profile & Truth', icon: ShieldCheck },
    { id: 'resumes', label: 'Resumes & Tailoring', icon: FileText },
    { id: 'scanner', label: 'ATS Scanner', icon: Gauge },
    { id: 'applications', label: 'Applications', icon: Send },
    { id: 'memory', label: 'Memory & Facts', icon: BrainCircuit },
    { id: 'settings', label: 'Preferences & Filters', icon: Settings },
  ];

  const displayName = user?.displayName || 'Affan Razvi';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'AR';

  return (
    <aside className="w-64 border-r border-white/40 bg-[#0D0D0D] flex flex-col h-screen select-none shrink-0">
      {/* Workspace Header - Aligned with TopHeader height h-14 */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-white/40">
        <div className="w-7 h-7 rounded bg-white text-black font-black flex items-center justify-center text-xs tracking-tighter shadow-sm">
          JF
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-xs font-semibold text-white tracking-tight leading-none">jobFinder</span>
          <span className="text-[10px] text-[#A3A3A3] font-mono leading-none mt-1">Personal AI Career OS</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <div className="text-[10px] font-semibold text-[#A3A3A3] uppercase tracking-wider px-2.5 mb-2">
          Workspace
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#1F1F1F] text-white font-semibold border border-white/20'
                  : 'text-[#A3A3A3] hover:bg-[#1F1F1F]/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon size={15} className={isActive ? 'text-white' : 'text-[#A3A3A3]'} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#161616] border border-white/20 text-[#A3A3A3]">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* User Footer with Quick Link to Profile */}
      <div 
        onClick={() => onSelectTab('profile')}
        className={`p-3 border-t border-white/40 bg-[#0D0D0D] flex items-center justify-between cursor-pointer hover:bg-[#1F1F1F]/50 transition-colors ${
          activeTab === 'profile' ? 'bg-[#1F1F1F]' : ''
        }`}
        title="Click to view Master Profile"
      >
        <div className="flex items-center gap-2.5">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-6 h-6 rounded-full border border-white/30" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[#161616] border border-white/30 flex items-center justify-center text-[10px] font-bold text-white">
              {initials}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-xs font-medium text-white truncate max-w-[120px]">
              {displayName}
            </span>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
              <UserCheck size={10} className="text-emerald-400" />
              Verified Profile
            </span>
          </div>
        </div>
        <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
          Cloud Sync
        </div>
      </div>
    </aside>
  );
};
