import React from 'react';
import '../styles/badge.css';
import type { RequestStatus } from '../types/workflow';

type StatusBadgeProps = {
  status: RequestStatus | 'UNKNOWN';
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const getStatusClass = (value: StatusBadgeProps['status']) => {
    switch (value) {
      case 'PARALLEL_REVIEW':
        return 'badge-amber';
      case 'VENDOR_COORDINATION':
        return 'badge-purple';
      case 'COMPLETED':
        return 'badge-green';
      case 'HALTED':
        return 'badge-red';
      case 'CANCELLED':
        return 'badge-gray';
      default:
        return 'badge-gray';
    }
  };

  const labels: Record<string, string> = {
    PARALLEL_REVIEW: 'Parallel Review',
    VENDOR_COORDINATION: 'Vendor Coordination',
    COMPLETED: 'Completed',
    HALTED: 'Halted',
    CANCELLED: 'Cancelled',
    UNKNOWN: 'Unknown',
  };

  return <span className={`badge ${getStatusClass(status)}`}>{labels[status]}</span>;
};
