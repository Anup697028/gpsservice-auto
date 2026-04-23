import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useResponsiveTableLabels } from '../hooks/useResponsiveTableLabels';

type ActivePage = 'dashboard' | 'history' | 'profile';

type PaymentConsoleLayoutProps = {
  activePage: ActivePage;
  userName: string;
  userTitle: string;
  onLogout?: () => void | Promise<void>;
  topTitle?: string;
  topRight?: React.ReactNode;
  showTopBar?: boolean;
  showTopRightLogout?: boolean;
  showSidebarIdentity?: boolean;
  contentClassName?: string;
  children: React.ReactNode;
};

const NAV_ITEMS: Array<{ key: ActivePage; label: string; icon: string; path: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/payment-dashboard' },
  { key: 'history', label: 'History', icon: 'history', path: '/payment-history' },
  { key: 'profile', label: 'Profile', icon: 'person', path: '/payment-profile' },
];

export const PaymentConsoleLayout: React.FC<PaymentConsoleLayoutProps> = ({
  activePage,
  userName,
  userTitle,
  onLogout,
  topTitle = 'Payment Team Console',
  topRight,
  showTopBar = true,
  showTopRightLogout = true,
  showSidebarIdentity = true,
  contentClassName = '',
  children,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  useResponsiveTableLabels(contentRef);

  return (
    /* Stitch exact: flex h-screen overflow-hidden */
    <div className="flex h-screen overflow-hidden bg-[#f8f6f5] text-slate-900" style={{ fontFamily: "'IBM Plex Sans', 'Inter', sans-serif" }}>

      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-shrink-0 border-r border-slate-200 bg-white flex-col">
        <div className="p-6 border-b border-slate-200 flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-xl">G</div>
          <span className="font-bold text-lg tracking-tight">GPS Admin</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === activePage;
            return (
              <Link
                key={item.key}
                to={item.path}
                className={
                  isActive
                    ? 'flex items-center gap-3 px-4 py-3 bg-primary/10 text-primary rounded-lg font-semibold'
                    : 'flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors'
                }
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 mt-auto border-t border-slate-200">
          {showSidebarIdentity ? (
            <div className="flex items-center gap-3 p-2 mb-3">
              <div className="flex flex-col">
                <p className="text-sm font-bold">{userName}</p>
                <p className="text-xs text-slate-500">{userTitle}</p>
              </div>
            </div>
          ) : null}
          {onLogout ? (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="w-full py-2 text-sm font-bold text-slate-600 hover:text-primary border border-slate-200 rounded-lg transition-colors"
            >
              Logout
            </button>
          ) : null}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile top bar */}
        <div className="md:hidden border-b border-slate-200 bg-white px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Payment Console</p>
              <h2 className="text-sm font-bold text-slate-900">{topTitle}</h2>
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
            {NAV_ITEMS.map((item) => {
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

        {showTopBar ? (
          <header className="hidden md:flex h-16 bg-white border-b border-slate-200 items-center justify-between px-8 flex-shrink-0 z-10">
            <h1 className="text-xl font-bold text-primary uppercase tracking-wider">{topTitle}</h1>
            <div className="flex items-center gap-6">
              {topRight ? topRight : null}
              {onLogout && showTopRightLogout ? (
                <button
                  type="button"
                  onClick={() => void onLogout()}
                  className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Logout
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        {/* Scrollable Body — ONLY this div scrolls */}
        <div className={`flex-1 overflow-y-auto p-6 md:p-8 space-y-8 bg-[#f8f6f5] ${contentClassName}`} ref={contentRef}>
          {children}
        </div>
      </main>
    </div>
  );
};