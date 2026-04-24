import React from 'react';
import '../styles/requestCard.css';
import { StatusBadge } from './StatusBadge';
import type { RequestRecord } from '../types/workflow';
import { formatRequestIdDisplay } from '../utils/workflowView';

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

  const getBulkValue = (field: 'serviceType' | 'vehicleAvailabilityLocation' | 'vehicleAvailableTime') => {
    const values = (request.vehicles ?? [])
      .map((vehicle: any) => vehicle[field])
      .filter(Boolean) as string[];
    const uniqueValues = Array.from(new Set(values));
    return uniqueValues.length > 0 ? uniqueValues.join(', ') : 'N/A';
  };

  const displayService = request.isBulkRequest
    ? getBulkValue('serviceType')
    : request.serviceType ?? 'N/A';

  const displayAvailabilityLocation = request.isBulkRequest
    ? getBulkValue('vehicleAvailabilityLocation')
    : request.vehicleAvailabilityLocation;

  const displayAvailableTime = request.isBulkRequest
    ? getBulkValue('vehicleAvailableTime')
    : request.vehicleAvailableTime;

  return (
    <div className="request-card">
      <div className="request-card-header">
        <div>
          <h3>Request {formatRequestIdDisplay(request.id)}</h3>
          <p className="text-muted">
            {request.clientName ?? 'Unknown client'} - {request.city ?? 'Unknown city'}
          </p>
        </div>
        <StatusBadge status={request.status ?? 'UNKNOWN'} />
      </div>
      <div className="request-card-body">
        <div className="request-info-row">
          <span className="label">Service:</span>
          <span className="service-badge">{displayService}</span>
        </div>
        <div className="request-info-row">
          <span className="label">Vehicles:</span>
          <span>{request.vehicles?.length || 0}</span>
        </div>
        {displayAvailabilityLocation && displayAvailabilityLocation !== 'N/A' && (
          <div className="request-info-row">
            <span className="label">Availability Location:</span>
            <span>{displayAvailabilityLocation}</span>
          </div>
        )}
        {displayAvailableTime && displayAvailableTime !== 'N/A' && (
          <div className="request-info-row">
            <span className="label">Available Time:</span>
            <span>{displayAvailableTime}</span>
          </div>
        )}
        <div className="request-info-row">
          <span className="label">Created:</span>
          <span>{formatDate(request.createdAt)}</span>
        </div>
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
