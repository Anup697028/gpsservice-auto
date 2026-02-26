import React from 'react';
import '../styles/badge.css';
import type { RequestStatus } from '../types/workflow';
import { getUnifiedStatusLabel } from '../utils/statusMapping';

type StatusBadgeProps = {
  status: RequestStatus | 'UNKNOWN';
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const getStatusClass = (value: StatusBadgeProps['status']) => {
    switch (value) {
      case 'FO_CREATED':
      case 'PAYMENT_PENDING':
      case 'PARALLEL_REVIEW':
        return 'badge-amber';
      case 'PAYMENT_APPROVED':
      case 'SERVICE_INITIATED':
      case 'COMPLETED':
        return 'badge-green';
      case 'VENDOR_COORDINATION':
        return 'badge-purple';
      case 'HALTED':
        return 'badge-red';
      case 'CANCELLED':
        return 'badge-gray';
      default:
        return 'badge-gray';
    }
  };

  return (
    <span className={`badge ${getStatusClass(status)}`}>
      {status === 'UNKNOWN' ? 'Unknown' : getUnifiedStatusLabel(status)}
    </span>
  );
};
