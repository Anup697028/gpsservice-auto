import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { RequestForm } from '../components/RequestForm';
import { RolePageLayout } from '../components/RolePageLayout';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import { getRequestStatusLabel, normalizeRole, type RequestWithId } from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  userProfile: { id?: string | null; name?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

export const FoDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const profileUserId = String(userProfile?.id || '').trim();
  const stableUserId = profileUserId || String(user?.uid || '').trim();

  const userRef = useMemo<UserRef | null>(() => {
    if (!user) {
      return null;
    }
    return {
      id: stableUserId,
      email: user.email ?? null,
      name: userProfile?.name ?? null,
      role: 'FO',
    };
  }, [user, stableUserId, userProfile?.name]);

  const isFoRole = normalizeRole(userRole) === 'FO';

  useEffect(() => {
    if (!stableUserId || !isFoRole) {
      return () => {};
    }
    const unsubscribe = requestService.subscribeToFoRequests(stableUserId, user?.email, (data) => {
      setRequests(data as RequestWithId[]);
    });
    return unsubscribe;
  }, [stableUserId, user?.email, isFoRole]);

  const kpis = useMemo(() => {
    const totalRequests = requests.length;
    const pendingSync = requests.filter((request) => getRequestStatusLabel(request).toLowerCase().includes('pending')).length;
    const completedToday = requests.filter((request) => {
      const label = getRequestStatusLabel(request).toLowerCase();
      return label === 'fo notified' || label === 'completed';
    }).length;
    return { totalRequests, pendingSync, completedToday };
  }, [requests]);

  if (loading || !userRef || !isFoRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="FO"
      activePage="dashboard"
      title="Field Operations Console"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <div className="mx-auto w-full max-w-[1280px]">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Total Requests</p>
            <p className="text-[20px] leading-tight font-bold text-black">{kpis.totalRequests.toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Pending Sync</p>
            <p className="text-[20px] leading-tight font-bold text-[#f26a21]">{kpis.pendingSync.toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Completed Today</p>
            <p className="text-[20px] leading-tight font-bold text-green-600">{kpis.completedToday.toLocaleString('en-IN')}</p>
          </div>
        </div>

        <RequestForm user={userRef} />
      </div>
    </RolePageLayout>
  );
};
