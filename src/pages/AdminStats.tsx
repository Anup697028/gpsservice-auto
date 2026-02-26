import React, { useEffect, useMemo, useState } from 'react';
import { analyticsService } from '../services/analyticsService';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';
import type { RequestRecord } from '../types/workflow';

type SummaryCard = {
  label: string;
  value: number;
};

export const AdminStats = () => {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = analyticsService.subscribeToAllRequests((data) => {
      setRequests(data);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const summary = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((req) => req.status === 'PARALLEL_REVIEW').length;
    const completed = requests.filter((req) => req.status === 'COMPLETED').length;
    const halted = requests.filter((req) => req.status === 'HALTED').length;

    return [
      { label: 'Total Requests', value: total },
      { label: 'Pending', value: pending },
      { label: 'Completed', value: completed },
      { label: 'Halted', value: halted },
    ] satisfies SummaryCard[];
  }, [requests]);

  const requestsByCity = useMemo(() => {
    const map = new Map<string, number>();
    requests.forEach((req) => {
      if (!req.city) return;
      map.set(req.city, (map.get(req.city) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [requests]);

  const requestsByClient = useMemo(() => {
    const map = new Map<string, number>();
    requests.forEach((req) => {
      if (!req.clientName) return;
      map.set(req.clientName, (map.get(req.clientName) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [requests]);

  if (loading) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Admin Analytics</h1>
        <p>Live request insights across cities and clients.</p>
      </div>

      <div className="analytics-grid">
        {summary.map((card) => (
          <div key={card.label} className="analytics-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="analytics-panels">
        <div className="analytics-panel">
          <h2>Requests per City</h2>
          {requestsByCity.length === 0 ? (
            <p className="text-muted">No data available</p>
          ) : (
            <ul>
              {requestsByCity.map(([city, count]) => (
                <li key={city}>
                  <span>{city}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="analytics-panel">
          <h2>Requests per Client</h2>
          {requestsByClient.length === 0 ? (
            <p className="text-muted">No data available</p>
          ) : (
            <ul>
              {requestsByClient.map(([client, count]) => (
                <li key={client}>
                  <span>{client}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
