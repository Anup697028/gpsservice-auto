import React from 'react';
import '../styles/auditLog.css';
import type { HistoryEntry } from '../types/workflow';

type LegacyAuditLogEntry = {
  action: string;
  performedBy?: string;
  timestamp?: string;
};

type AuditLogProps = {
  logs?: HistoryEntry[];
  history?: HistoryEntry[];
  legacyLogs?: LegacyAuditLogEntry[];
};

const formatTime = (value: unknown) => {
  if (!value) {
    return 'N/A';
  }
  const date = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return date.toLocaleString();
};

export const AuditLog = ({ logs, history, legacyLogs }: AuditLogProps) => {
  const entries = logs ?? history ?? legacyLogs ?? [];

  if (!entries || entries.length === 0) {
    return <p className="text-muted">No audit logs</p>;
  }

  return (
    <div className="audit-log">
      <h3>Audit Log</h3>
      <div className="audit-log-list">
        {entries.map((log, index) => {
          const legacy = log as LegacyAuditLogEntry;
          const historyEntry = log as HistoryEntry;
          const userName = historyEntry.userName ?? legacy.performedBy ?? 'Unknown';
          const action = historyEntry.action ?? legacy.action;

          return (
            <div key={index} className="audit-log-entry">
              <div className="audit-log-action">{action}</div>
              <div className="audit-log-details">
                <span className="audit-log-user">By: {userName}</span>
                <span className="audit-log-time">
                  {formatTime(historyEntry.timestamp ?? legacy.timestamp)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
