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

const toEpoch = (value: unknown) => {
  if (!value) {
    return 0;
  }

  const date = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
};

export const AuditLog = ({ logs, history, legacyLogs }: AuditLogProps) => {
  const mergedEntries = [
    ...(Array.isArray(logs) ? logs : []),
    ...(Array.isArray(history) ? history : []),
    ...(Array.isArray(legacyLogs) ? legacyLogs : []),
  ];

  const dedupedEntries = Array.from(
    new Map(
      mergedEntries.map((entry) => {
        const log = entry as Record<string, unknown>;
        const dedupeKey = [
          String(log.action ?? ''),
          String(log.userName ?? log.performedBy ?? ''),
          String(log.statusFrom ?? ''),
          String(log.statusTo ?? ''),
          String(log.notes ?? ''),
          String(toEpoch(log.timestamp)),
        ].join('|');
        return [dedupeKey, entry];
      })
    ).values()
  ).sort((a, b) => {
    const aTs = toEpoch((a as Record<string, unknown>).timestamp);
    const bTs = toEpoch((b as Record<string, unknown>).timestamp);
    return bTs - aTs;
  });

  if (!dedupedEntries || dedupedEntries.length === 0) {
    return <p className="text-muted">No audit logs</p>;
  }

  return (
    <div className="audit-log">
      <h3>Audit Log</h3>
      <div className="audit-log-table-wrapper">
        <table className="audit-log-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Status From</th>
              <th>Status To</th>
              <th>Performed By</th>
              <th>Notes</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {dedupedEntries.map((log, index) => {
              const legacy = log as LegacyAuditLogEntry;
              const historyEntry = log as HistoryEntry;
              const userName = historyEntry.userName ?? legacy.performedBy ?? 'Unknown';
              const action = historyEntry.action ?? legacy.action;
              const statusFrom = historyEntry.statusFrom ?? '-';
              const statusTo = historyEntry.statusTo ?? '-';
              const notes = historyEntry.notes ?? '-';
              const notesText = String(notes || '').toLowerCase();
              const shouldHighlightReason =
                notesText.includes('reject') || notesText.includes('reason:') || notesText.includes('rejection');

              return (
                <tr key={index}>
                  <td className="action-cell">{action}</td>
                  <td className="status-cell">{statusFrom}</td>
                  <td className="status-cell">{statusTo}</td>
                  <td className="user-cell">{userName}</td>
                  <td className={`notes-cell ${shouldHighlightReason ? 'reason-highlight' : ''}`}>{notes}</td>
                  <td className="time-cell">
                    {formatTime(historyEntry.timestamp ?? legacy.timestamp)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
