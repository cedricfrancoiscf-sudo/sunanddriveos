import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  carekeeperHidden?: boolean;
}

function Icon({ d }: { d: string }): React.JSX.Element {
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Tableau de bord', icon: <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /> },
  { to: '/vehicles', label: 'Flotte', icon: <Icon d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /> },
  { to: '/rentals', label: 'Locations', icon: <Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
  { to: '/messages', label: 'Messages', icon: <Icon d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /> },
  { to: '/sequences', label: 'Séquences', icon: <Icon d="M4 6h16M4 10h16M4 14h16M4 18h16" /> },
  { to: '/planning', label: 'Planning', icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /> },
  { to: '/accessories', label: 'Accessoires', icon: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /> },
  { to: '/export', label: 'Exports', icon: <Icon d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />, carekeeperHidden: true },
  { to: '/scoring', label: 'Scoring', icon: <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />, carekeeperHidden: true },
  { to: '/third-party-owners', label: 'Propriétaires', icon: <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />, adminOnly: true },
  { to: '/users', label: 'Utilisateurs', icon: <Icon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />, adminOnly: true },
  { to: '/settings', label: 'Paramètres', icon: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />, adminOnly: true },
];

const VIE_VEHICULE_ITEMS: NavItem[] = [
  { to: '/maintenance', label: 'Entretiens', icon: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" /> },
  { to: '/technical-controls', label: 'Contrôle technique', icon: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /> },
  { to: '/vehicle-checks', label: 'Fiches contrôle', icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /> },
  { to: '/documents', label: 'Documents', icon: <Icon d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /> },
];

const PRIMARY = '#01696e';

interface SidebarProps {
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function LockedItem({ label, icon, requiredPlan, collapsed }: {
  label: string;
  icon: React.ReactNode;
  requiredPlan: 'pro' | 'enterprise';
  collapsed?: boolean;
}): React.JSX.Element {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShowModal(true)} title={collapsed ? label : undefined}
        className={`flex w-full items-center rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-50 transition-colors ${
          collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
        }`}>
        {icon}
        {!collapsed && <><span className="flex-1 text-left">{label}</span><span className="text-xs">🔒</span></>}
      </button>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="rounded-2xl bg-white p-6 shadow-xl max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">
              Disponible dans le plan {requiredPlan === 'pro' ? 'Pro' : 'Enterprise'}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Passez au plan {requiredPlan === 'pro' ? 'Pro (59€/mois)' : 'Enterprise'} pour accéder à cette fonctionnalité.
            </p>
            <button type="button" onClick={() => { window.location.href = '/upgrade'; }}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: PRIMARY }}>
              Voir les plans →
            </button>
            <button type="button" onClick={() => setShowModal(false)}
              className="mt-2 w-full text-sm text-gray-400 hover:text-gray-600">
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Sidebar({ onClose, collapsed = false, onToggleCollapse }: SidebarProps): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [vieVehiculeOpen, setVieVehiculeOpen] = useState(
    localStorage.getItem('sidebar_vie_vehicule_open') === 'true'
  );

  function toggleVieVehicule(): void {
    const next = !vieVehiculeOpen;
    setVieVehiculeOpen(next);
    localStorage.setItem('sidebar_vie_vehicule_open', String(next));
  }

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: () => api.get<{ progressPercent: number; allDone: boolean; dismissed: boolean; completedCount: number; totalCount: number }>('/onboarding/progress').then(r => r.data),
    staleTime: 60_000,
    enabled: !!user,
  });
  const showOnboarding = onboarding && !onboarding.dismissed && !onboarding.allDone;

  const { data: syncData } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<{ state: { isRunning: boolean; error: string | null; progress: number }; plan: string }>('/sync/status').then(r => r.data),
    refetchInterval: 5_000,
    staleTime: 4_000,
    enabled: !!user && user.role !== 'carkeeper',
  });
  const syncStatus = syncData?.state;
  const isStarterPlan = !syncData || syncData.plan === 'starter';

  const isCarkeeper = user?.role === 'carkeeper';
  const isPro = user?.plan === 'pro' || user?.plan === 'enterprise' || user?.isSuperAdmin;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && user?.role !== 'admin' && !user?.isSuperAdmin) return false;
    if (item.carekeeperHidden && isCarkeeper) return false;
    return true;
  });

  // Items Pro gated (remplacés par LockedItem si starter)
  const PRO_LOCKED_ITEMS: Array<{ to: string; label: string; icon: React.ReactNode }> = [
    { to: '/sequences', label: 'Séquences', icon: <Icon d="M4 6h16M4 10h16M4 14h16M4 18h16" /> },
    { to: '/scoring', label: 'Scoring', icon: <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /> },
    { to: '/export', label: 'Exports', icon: <Icon d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /> },
  ];

  function handleLogout(): void {
    logout();
    navigate('/login');
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center rounded-lg text-sm font-medium transition-colors ${
      collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
    } ${isActive ? 'text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`;

  const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties | undefined =>
    isActive ? { backgroundColor: PRIMARY } : undefined;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Logo */}
      <div className={`flex h-16 shrink-0 items-center border-b border-gray-100 ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'}`}>
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: PRIMARY }}
        >
          <span className="text-sm font-bold text-white">S</span>
        </div>
        {!collapsed && <span className="font-semibold text-gray-900 truncate flex-1">SunanddriveOS</span>}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Agrandir la sidebar' : 'Réduire la sidebar'}
            className={`rounded-md p-1 text-gray-400 hover:text-gray-600 hidden lg:block ${collapsed ? '' : 'ml-auto'}`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-gray-400 hover:text-gray-600 lg:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {visibleItems
            .filter(item => !PRO_LOCKED_ITEMS.some(p => p.to === item.to))
            .map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={onClose}
                className={navLinkClass}
                style={navLinkStyle}
                title={collapsed ? item.label : undefined}
              >
                {item.icon}
                {!collapsed && item.label}
              </NavLink>
            </li>
          ))}

          {/* Items Pro — cadenas si plan starter */}
          {PRO_LOCKED_ITEMS
            .filter(item => {
              if (item.to === '/export' && isCarkeeper) return false; // carekeeperHidden
              return true;
            })
            .map(item => (
              <li key={item.to}>
                {isPro
                  ? <NavLink to={item.to} onClick={onClose} className={navLinkClass} style={navLinkStyle} title={collapsed ? item.label : undefined}>
                      {item.icon}{!collapsed && item.label}
                    </NavLink>
                  : <LockedItem label={item.label} icon={item.icon} requiredPlan="pro" collapsed={collapsed} />
                }
              </li>
            ))
          }

          {/* Section "Vie du véhicule" collapsible */}
          <li>
            <button
              type="button"
              onClick={collapsed ? undefined : toggleVieVehicule}
              title={collapsed ? 'Vie du véhicule' : undefined}
              className={`flex w-full items-center rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors ${
                collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
              }`}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Vie du véhicule</span>
                  <svg className={`h-4 w-4 shrink-0 transition-transform ${vieVehiculeOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </button>

            {vieVehiculeOpen && !collapsed && (
              <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3">
                {VIE_VEHICULE_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} onClick={onClose} className={navLinkClass} style={navLinkStyle}>
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
          {/* Section "INTELLIGENCE ✨" */}
          <li className="pt-3">
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Intelligence ✨
              </p>
            )}
            <ul className="space-y-0.5">
              <li>
                {isStarterPlan ? (
                  <div title={collapsed ? 'Vue unifiée' : undefined}
                    className={`flex items-center rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed select-none ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}>
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {!collapsed && <><span className="flex-1">Vue unifiée</span><svg className="h-3.5 w-3.5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg></>}
                  </div>
                ) : (
                  <NavLink to="/intelligence" onClick={onClose} className={navLinkClass} style={navLinkStyle} title={collapsed ? 'Vue unifiée' : undefined}>
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {!collapsed && 'Vue unifiée'}
                  </NavLink>
                )}
              </li>
              <li>
                {isStarterPlan ? (
                  <div title={collapsed ? 'Rapport CEO' : undefined}
                    className={`flex items-center rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed select-none ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}>
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {!collapsed && <><span className="flex-1">Rapport CEO</span><svg className="h-3.5 w-3.5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg></>}
                  </div>
                ) : (
                  <NavLink to="/intelligence/report" onClick={onClose} className={navLinkClass} style={navLinkStyle} title={collapsed ? 'Rapport CEO' : undefined}>
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {!collapsed && 'Rapport CEO'}
                  </NavLink>
                )}
              </li>
            </ul>
          </li>
        </ul>
      </nav>

      {/* Onboarding */}
      {showOnboarding && (
        <div className="shrink-0 px-2 pb-2">
          <NavLink
            to="/onboarding"
            onClick={onClose}
            className={navLinkClass}
            style={navLinkStyle}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
            <span className="flex-1">Mise en route</span>
            <span
              className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: '#e07b39' }}
            >
              {onboarding.totalCount - onboarding.completedCount}
            </span>
          </NavLink>
        </div>
      )}

      {/* Sync indicator */}
      {user?.role !== 'carkeeper' && syncStatus && (syncStatus.isRunning || syncStatus.error != null) && (
        <div className="shrink-0 px-4 pb-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className={`h-2 w-2 rounded-full ${
              syncStatus.isRunning ? 'animate-pulse bg-orange-400' : 'bg-red-500'
            }`} />
            {syncStatus.isRunning ? `Sync ${syncStatus.progress}%` : 'Erreur sync'}
          </div>
        </div>
      )}

      {/* User footer */}
      <div className="shrink-0 border-t border-gray-100 p-3">
        <div className={`flex items-center rounded-lg px-2 py-2 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: PRIMARY }}
            title={collapsed ? (user?.name ?? undefined) : undefined}
          >
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="truncate text-xs text-gray-400 capitalize">{user?.role ?? 'admin'}</p>
            </div>
          )}
          {!collapsed && <button
            type="button"
            onClick={handleLogout}
            title="Déconnexion"
            className="shrink-0 rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>}
        </div>
      </div>
    </div>
  );
}
