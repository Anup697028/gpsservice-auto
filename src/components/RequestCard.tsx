import React from 'react';
import '../styles/requestCard.css';
import { StatusBadge } from './StatusBadge';
import type { RequestRecord } from '../types/workflow';

type RequestCardProps = {
  request: RequestRecord & { id?: string };
  onViewDetails: (request: RequestRecord & { id?: string }) => void;
  onAction?: (request: RequestRecord & { id?: string }) => void;
  onCancel?: (request: RequestRecord & { id?: string }) => void;
  showCancel?: boolean;
};

const formatDate = (value: unknown) => {
  if (!value) {
    return 'N/A';
  }
  const date = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return date.toLocaleDateString();
};

export const RequestCard = ({ request, onViewDetails, onAction, onCancel, showCancel }: RequestCardProps) => {
  const canCancel = showCancel && onCancel && 
    request.status !== 'COMPLETED' && 
    request.status !== 'CANCELLED';

  return (
    <div className="request-card">
      <div className="request-card-header">
        <div>
          <h3>Request #{request.id?.substring(0, 8) ?? 'New'}</h3>
          <p className="text-muted">
            {request.clientName ?? 'Unknown client'} - {request.city ?? 'Unknown city'}
          </p>
        </div>
        <StatusBadge status={request.status ?? 'UNKNOWN'} />
      </div>
      <div className="request-card-body">
        <div className="request-info-row">
          <span className="label">Service:</span>
          <span className="service-badge">{request.serviceType ?? 'N/A'}</span>
        </div>
        <div className="request-info-row">
          <span className="label">Vehicles:</span>
          <span>{request.vehicles?.length || 0}</span>
        </div>
        <div className="request-info-row">
          <span className="label">Destination:</span>
          <span>{request.destination ?? 'N/A'}</span>
        </div>
        <div className="request-info-row">
          <span className="label">Created:</span>
          <span>{formatDate(request.createdAt)}</span>
        </div>
        {request.tripFromDate && (
          <div className="request-info-row">
            <span className="label">Trip:</span>
            <span>{request.tripFromDate} {request.tripFromTime} → {request.tripToDate} {request.tripToTime}</span>
          </div>
        )}
        {request.status === 'COMPLETED' && request.vendorName && (
          <div className="request-info-row">
            <span className="label">Vendor:</span>
            <span>{request.vendorName}</span>
          </div>
        )}
      </div>
      <div className="request-card-footer">
        <button className="btn btn-secondary" onClick={() => onViewDetails(request)}>
          View Details
        </button>
        {onAction && (
          <button className="btn btn-primary" onClick={() => onAction(request)}>
            Take Action
          </button>
        )}
        {canCancel && (
          <button className="btn btn-danger" onClick={() => onCancel(request)}>
            Cancel Request
          </button>
        )}
      </div>
    </div>
  );
};
