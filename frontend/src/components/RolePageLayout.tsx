import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useResponsiveTableLabels } from '../hooks/useResponsiveTableLabels';

type RoleKey = 'FO' | 'RH' | 'PAYMENT' | 'VENDOR';
type ActivePage = 'dashboard' | 'history' | 'cancelled' | 'profile';

type RolePageLayoutProps = {
  role: RoleKey;
  activePage: ActivePage;
  title: string;
  subtitle?: string;
  userEmail?: string | null;
  onLogout?: () => void | Promise<void>;
  headerActions?: React.ReactNode;
  showHeaderIdentity?: boolean;
  showTopRightLogout?: boolean;
  children: React.ReactNode;
};

type NavItem = {
  key: ActivePage;
  label: string;
  icon: string;
  path: string;
};

type RoleMeta = {
  label: string;
  navItems: NavItem[];
};

const ROLE_META: Record<RoleKey, RoleMeta> = {
  FO: {
    label: 'Field Operator',
    navItems: [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/fo-dashboard' },
      { key: 'history', label: 'History', icon: 'history', path: '/fo-history' },
      { key: 'cancelled', label: 'Cancelled', icon: 'cancel', path: '/fo-cancelled' },
      { key: 'profile', label: 'Profile', icon: 'account_circle', path: '/fo-profile' },
    ],
  },
  RH: {
    label: 'Regional Head',
    navItems: [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/rh-dashboard' },
      { key: 'history', label: 'History', icon: 'history', path: '/rh-history' },
      { key: 'profile', label: 'Profile', icon: 'account_circle', path: '/rh-profile' },
    ],
  },
  PAYMENT: {
    label: 'Payment Team',
    navItems: [
      { key: 'dashboard', label: 'Dashboard', icon: 'payments', path: '/payment-dashboard' },
      { key: 'history', label: 'History', icon: 'history', path: '/payment-history' },
      { key: 'profile', label: 'Profile', icon: 'account_circle', path: '/payment-profile' },
    ],
  },
  VENDOR: {
    label: 'Vendor Coordinator',
    navItems: [
      { key: 'dashboard', label: 'Dashboard', icon: 'satellite_alt', path: '/vendor-dashboard' },
      { key: 'history', label: 'History', icon: 'history', path: '/vendor-history' },
      { key: 'profile', label: 'Profile', icon: 'account_circle', path: '/vendor-profile' },
    ],
  },
};

export const RolePageLayout: React.FC<RolePageLayoutProps> = ({
  role,
  activePage,
  title,
  userEmail,
  onLogout,
  headerActions,
  showHeaderIdentity = true,
  showTopRightLogout = true,
  children,
}) => {
  const roleMeta = ROLE_META[role];
  const contentRef = useRef<HTMLDivElement>(null);
  useResponsiveTableLabels(contentRef);

  return (
    /* Stitch exact: flex h-screen overflow-hidden prevents document scroll */
    <div className="flex h-screen overflow-hidden bg-[#f8f6f5] text-slate-900">

      {/* Sidebar — hidden on mobile, visible md+ */}
      <aside className="hidden md:flex w-64 flex-shrink-0 border-r border-slate-200 bg-white flex-col justify-between py-6 px-4 shadow-xl">
        <div className="space-y-8">
          <div className="flex items-center gap-3 px-2">
            <div>
              <h1 className="text-sm font-bold leading-tight text-slate-900">GPS Automation</h1>
              <p className="text-xs text-primary font-semibold uppercase tracking-wider">{roleMeta.label}</p>
            </div>
          </div>
          <nav className="space-y-1">
            {roleMeta.navItems.map((item) => {
              const isActive = item.key === activePage;
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={
                    isActive
                      ? 'flex items-center px-3 py-2.5 rounded-lg bg-primary text-white font-medium'
                      : 'flex items-center px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-medium'
                  }
                >
                  <span className="text-sm">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-slate-100 pt-4">
          {onLogout ? (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="flex items-center px-3 py-2.5 w-full rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors font-medium text-sm"
            >
              Logout
            </button>
          ) : null}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile top bar — visible only on mobile */}
        <div className="md:hidden border-b border-slate-200 bg-white px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{roleMeta.label}</p>
              <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            </div>
            {onLogout ? (
              <button
                type="button"
                onClick={() => void onLogout()}
                className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg"
              >
                Logout
              </button>
            ) : null}
          </div>
          <nav className="mt-2 flex gap-1.5 pb-1" style={{ overflowX: 'auto' }}>
            {roleMeta.navItems.map((item) => {
              const isActive = item.key === activePage;
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${isActive ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Desktop Top Command Bar */}
        <header className="hidden md:flex h-16 border-b border-slate-200 bg-white items-center justify-between px-8 z-10 shadow-sm flex-shrink-0">
          <h2 className="text-lg font-bold tracking-tight text-primary">{title}</h2>
          <div className="flex items-center gap-6">
            {headerActions ? headerActions : null}
            {showHeaderIdentity && userEmail ? (
              <>
                <div className="h-8 w-px bg-slate-200" />
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-900">{userEmail}</p>
                  <p className="text-[10px] text-slate-500 uppercase">{roleMeta.label}</p>
                </div>
              </>
            ) : null}
            {onLogout && showTopRightLogout ? (
              <button
                type="button"
                onClick={() => void onLogout()}
                className="flex items-center px-4 py-2 bg-slate-100 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors uppercase"
              >
                LOGOUT
              </button>
            ) : null}
          </div>
        </header>

        {/* Scrollable Body — ONLY this div scrolls */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#f8f6f5]" ref={contentRef}>
          {children}
        </div>
      </main>
    </div>
  );
};
