import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { showToast } from '../components/Toast';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';
import { REQUEST_STATUSES, WORKFLOW_ACTIONS } from '../types/workflow';
import type { RequestRecord, UserRef } from '../types/workflow';
import { getUnifiedStatusLabel } from '../utils/statusMapping';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

type FilterState = {
  city: string;
  client: string;
  date: string;
};

type SelectedRequests = Set<string>;

const RH_SINGLE_APPROVAL_STATUSES = [
  REQUEST_STATUSES.PARALLEL_REVIEW,
  REQUEST_STATUSES.VENDOR_COORDINATION,
  REQUEST_STATUSES.COMPLETED,
];

const RH_BULK_APPROVAL_STATUSES = [
  REQUEST_STATUSES.FO_CREATED,
  REQUEST_STATUSES.PAYMENT_PENDING,
  REQUEST_STATUSES.PAYMENT_APPROVED,
  REQUEST_STATUSES.SERVICE_INITIATED,
  REQUEST_STATUSES.COMPLETED,
];

const toDateString = (value: unknown) => {
  if (!value) {
    return '';
  }
  const date = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return date.toISOString().slice(0, 10);
};

const normalizeVehicles = (vehicles: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(vehicles)) {
    return vehicles as Array<Record<string, unknown>>;
  }

  if (vehicles && typeof vehicles === 'object') {
    return Object.keys(vehicles as Record<string, unknown>)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ((vehicles as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>);
  }

  return [];
};

const isPaymentRejectedVehicle = (vehicle: Record<string, unknown>) => {
  return vehicle?.paymentRejected === true || String(vehicle?.paymentStatus || '').toUpperCase() === 'REJECTED';
};

const getBulkVehicleStats = (request: RequestWithId) => {
  const vehicles = normalizeVehicles(request.vehicles);
  const rejectedCount = vehicles.filter((vehicle) => isPaymentRejectedVehicle(vehicle)).length;
  const activeCount = Math.max(vehicles.length - rejectedCount, 0);

  return {
    totalCount: vehicles.length,
    rejectedCount,
    activeCount,
  };
};

const getVehiclePaymentRejectionReason = (vehicle: Record<string, unknown>, request: RequestWithId) => {
  const fromVehicle = String(vehicle?.paymentRejectionReason || '').trim();
  if (fromVehicle) {
    return fromVehicle;
  }

  const fromRequest = String((request as Record<string, unknown>)?.rejectionReason || '').trim();
  if (fromRequest) {
    return fromRequest;
  }

  if (Array.isArray(request.history)) {
    for (let index = request.history.length - 1; index >= 0; index -= 1) {
      const entry = request.history[index] as Record<string, unknown>;
      const action = String(entry?.action || '').toUpperCase();
      if (action !== WORKFLOW_ACTIONS.PAYMENT_BULK_REJECT && action !== WORKFLOW_ACTIONS.PAYMENT_REJECT) {
        continue;
      }

      const notes = String(entry?.notes || '').trim();
      if (!notes) {
        continue;
      }

      const reasonMatch = notes.match(/Reason:\s*(.+)$/i);
      if (reasonMatch?.[1]) {
        return reasonMatch[1].trim();
      }

      return notes;
    }
  }

  return '';
};

const normalizeServiceType = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'fleetx') {
    return 'FleetX';
  }
  if (raw === 'wheelseye') {
    return 'WheelsEye';
  }
  return String(value || '');
};

const hasRhApprovalSignal = (request: RequestWithId) => {
  const hasHistorySignal = Array.isArray(request.history)
    ? request.history.some((entry) => {
        const action = String((entry as Record<string, unknown>)?.action || '');
        return (
          action === WORKFLOW_ACTIONS.RH_APPROVE ||
          action === WORKFLOW_ACTIONS.RH_EDIT_APPROVE ||
          action === WORKFLOW_ACTIONS.RH_BULK_APPROVE
        );
      })
    : false;

  return (
    request.rhApproval === true ||
    request.rhActionTaken === true ||
    request.rhStatus === 'APPROVED' ||
    Boolean(request.rhApprovedAt) ||
    hasHistorySignal
  );
};

const hasRhRejectionSignal = (request: RequestWithId) => {
  const hasHistorySignal = Array.isArray(request.history)
    ? request.history.some((entry) => {
        const action = String((entry as Record<string, unknown>)?.action || '');
        return action === WORKFLOW_ACTIONS.RH_REJECT || action === WORKFLOW_ACTIONS.RH_BULK_REJECT;
      })
    : false;

  return request.rhStatus === 'REJECTED' || request.status === REQUEST_STATUSES.HALTED || hasHistorySignal;
};

export const RhDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterState>({ city: '', client: '', date: '' });
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedRequests, setSelectedRequests] = useState<SelectedRequests>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  const userRef = useMemo<UserRef | null>(() => {
    if (!user || !userRole) {
      return null;
    }
    return {
      id: user.uid,
      email: user.email,
      role: userRole,
    };
  }, [user, userRole]);

  useEffect(() => {
    // RH sees ALL FO requests for tracking and bulk approval
    const unsubscribe = requestService.subscribeToAllRequests((data) => {
      setRequests(data as RequestWithId[]);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // RH sees ALL requests (no restrictive filtering)
  const eligibleRequests = useMemo(() => {
    return requests;
  }, [requests]);

  const cityOptions = useMemo(() => {
    return Array.from(new Set(eligibleRequests.map((item) => item.city).filter(Boolean))) as string[];
  }, [eligibleRequests]);

  const clientOptions = useMemo(() => {
    return Array.from(new Set(eligibleRequests.map((item) => item.clientName).filter(Boolean))) as string[];
  }, [eligibleRequests]);

  const filteredRequests = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return eligibleRequests.filter((item) => {
      const matchesSearch =
        item.id?.toLowerCase().includes(term) ||
        item.clientName?.toLowerCase().includes(term) ||
        item.city?.toLowerCase().includes(term);

      const matchesCity = filters.city ? item.city === filters.city : true;
      const matchesClient = filters.client ? item.clientName === filters.client : true;
      const matchesDate = filters.date
        ? toDateString(item.createdAt) === filters.date
        : true;

      return matchesSearch && matchesCity && matchesClient && matchesDate;
    });
  }, [eligibleRequests, searchTerm, filters]);

  const handleApprove = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }

    const isBulk = selectedRequest.isBulkRequest;

    // ===== BULK REQUEST WORKFLOW (PARALLEL APPROVAL) =====
    if (isBulk) {
      const isRhBulkActionable =
        RH_BULK_APPROVAL_STATUSES.includes(
          selectedRequest.status as typeof RH_BULK_APPROVAL_STATUSES[number]
        ) &&
        selectedRequest.rhStatus !== 'APPROVED' &&
        selectedRequest.rhStatus !== 'REJECTED';

      if (!isRhBulkActionable) {
        showToast(
          `Cannot approve: Bulk request is in ${selectedRequest.status} status or RH already actioned.`,
          'error'
        );
        return;
      }

      try {
        // RH approval is compliance-only and should not block/rollback business progression.
        await requestService.approveBulkRequest(selectedRequest.id as string, userRef);
        
        // Determine message based on current Payment status
        if (selectedRequest.paymentStatus === 'APPROVED') {
          const { activeCount } = getBulkVehicleStats(selectedRequest);
          showToast(
            `✓ RH compliance approved for bulk request (${activeCount} vehicles).`,
            'success'
          );
        } else {
          showToast(
            `✓ RH compliance approved. Workflow still proceeds independently through Payment/Vendor.`,
            'success'
          );
        }
        setShowModal(false);
      } catch (error) {
        const errorMsg = (error as Error).message;
        showToast('Failed to approve bulk request: ' + errorMsg, 'error');
      }
      return;
    }

    // ===== SINGLE REQUEST WORKFLOW =====
    if (selectedRequest.rhActionTaken) {
      showToast('RH action already completed for this request', 'info');
      return;
    }

    // Validate workflow state before approval
    if (!RH_SINGLE_APPROVAL_STATUSES.includes(selectedRequest.status as typeof RH_SINGLE_APPROVAL_STATUSES[number])) {
      showToast(
        `Cannot approve: Request is in ${selectedRequest.status} status. RH approval is only allowed while RH is still pending.`,
        'error'
      );
      return;
    }

    try {
      await requestService.approveRequest(selectedRequest.id as string, userRef, 'RH');
      showToast('RH compliance approved for request.', 'success');
      setShowModal(false);
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('Illegal workflow transition')) {
        showToast('Cannot approve at current request stage.', 'error');
      } else {
        showToast('Failed to approve request: ' + errorMsg, 'error');
      }
    }
  };

  const handleReject = async () => {
    if (!selectedRequest || !userRef || !rejectionReason.trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }

    const isBulk = selectedRequest.isBulkRequest;

    try {
      if (isBulk) {
        // Bulk request rejection
        await requestService.rejectBulkRequest(
          selectedRequest.id as string,
          rejectionReason,
          userRef
        );
      } else {
        // Single request rejection
        await requestService.rejectRequest(
          selectedRequest.id as string,
          userRef,
          'RH',
          rejectionReason
        );
      }
      showToast('Request rejected!', 'success');
      setShowRejectModal(false);
      setShowModal(false);
      setRejectionReason('');
    } catch (error) {
      showToast('Failed to reject request: ' + (error as Error).message, 'error');
    }
  };

  const handleEditAndApprove = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }
    try {
      await requestService.editAndApprove(
        selectedRequest.id as string,
        editData,
        userRef,
        'RH'
      );
      showToast('Request updated and approved!', 'success');
      setShowEditModal(false);
      setShowModal(false);
      setEditData({});
    } catch (error) {
      showToast('Failed to update request', 'error');
    }
  };

  const handleBulkApprove = async () => {
    if (!userRef) {
      return;
    }

    // Separate single and bulk requests
    const singleRequests = filteredRequests.filter(
      (item) => !item.isBulkRequest && canSelectForRhAction(item)
    );

    const bulkRequests = filteredRequests.filter(
      (item) => item.isBulkRequest && canSelectForRhAction(item)
    );

    // If using selection, filter by selected requests
    if (selectedRequests.size > 0) {
      const selectedIds = Array.from(selectedRequests);
      singleRequests.length = 0;
      bulkRequests.length = 0;
      
      filteredRequests.forEach((item) => {
        if (selectedIds.includes(item.id as string)) {
          if (item.isBulkRequest && canSelectForRhAction(item)) {
            bulkRequests.push(item);
          } else if (
            !item.isBulkRequest &&
            canSelectForRhAction(item)
          ) {
            singleRequests.push(item);
          }
        }
      });
    }

    if (singleRequests.length === 0 && bulkRequests.length === 0) {
      showToast(
        'No pending RH compliance approvals found.',
        'info'
      );
      return;
    }

    setBulkApproving(true);
    try {
      let singleCount = 0;
      let bulkCount = 0;

      // Approve single requests
      if (singleRequests.length > 0) {
        const singleIds = singleRequests.map((item) => item.id).filter(Boolean) as string[];
        singleCount = await requestService.bulkApprove(singleIds, userRef);
      }

      // Approve bulk requests
      if (bulkRequests.length > 0) {
        const bulkIds = bulkRequests.map((item) => item.id).filter(Boolean) as string[];
        bulkCount = await requestService.bulkApproveBulkRequests(bulkIds, userRef);
      }

      const message =
        singleCount > 0 && bulkCount > 0
          ? `${singleCount} single request(s) and ${bulkCount} bulk request(s) RH-approved for compliance.`
          : singleCount > 0
            ? `${singleCount} single request(s) RH-approved for compliance.`
            : `${bulkCount} bulk request(s) RH-approved for compliance.`;

      if (singleCount + bulkCount > 0) {
        showToast(message, 'success');
        setSelectedRequests(new Set());
      } else {
        showToast('No eligible requests to approve', 'info');
      }
    } catch (error) {
      console.error('Bulk approve error:', error);
      showToast('Failed to bulk approve: ' + (error as Error).message, 'error');
    } finally {
      setBulkApproving(false);
    }
  };

  const toggleRequestSelection = (requestId: string) => {
    setSelectedRequests((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(requestId)) {
        newSet.delete(requestId);
      } else {
        newSet.add(requestId);
      }
      return newSet;
    });
  };

  const canSelectForRhAction = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      return (
        RH_BULK_APPROVAL_STATUSES.includes(request.status as typeof RH_BULK_APPROVAL_STATUSES[number]) &&
        request.rhStatus !== 'APPROVED' &&
        request.rhStatus !== 'REJECTED'
      );
    }

    const alreadyApproved = hasRhApprovalSignal(request);
    const alreadyRejected = hasRhRejectionSignal(request);

    return (
      RH_SINGLE_APPROVAL_STATUSES.includes(request.status as typeof RH_SINGLE_APPROVAL_STATUSES[number]) &&
      !alreadyApproved &&
      !alreadyRejected
    );
  };

  const isRhPendingApproval = (request: RequestWithId) => {
    return canSelectForRhAction(request);
  };

  const pendingRhApprovalsCount = useMemo(
    () => filteredRequests.filter((request) => isRhPendingApproval(request)).length,
    [filteredRequests]
  );

  const getRhStatusLabel = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      if (request.status === REQUEST_STATUSES.CANCELLED) {
        return 'Cancelled';
      }

      if (request.status === REQUEST_STATUSES.HALTED || request.rhStatus === 'REJECTED') {
        return 'RH Rejected';
      }

      if (request.rhStatus === 'APPROVED') {
        return 'RH Approved';
      }

      if (canSelectForRhAction(request)) {
        return 'Pending RH Approval';
      }

      return getUnifiedStatusLabel(request.status);
    }

    if (request.status === REQUEST_STATUSES.CANCELLED) {
      return 'Cancelled';
    }

    if (request.status === REQUEST_STATUSES.HALTED) {
      return 'RH Rejected';
    }

    if (hasRhApprovalSignal(request)) {
      return 'RH Approved';
    }

    if (canSelectForRhAction(request)) {
      return 'Pending RH Approval';
    }

    return getUnifiedStatusLabel(request.status);
  };

  const getRhStatusClass = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      if (request.status === REQUEST_STATUSES.CANCELLED) {
        return 'status-cancelled';
      }

      if (request.status === REQUEST_STATUSES.HALTED || request.rhStatus === 'REJECTED') {
        return 'status-rejected';
      }

      if (request.rhStatus === 'APPROVED') {
        return 'status-completed';
      }

      return 'status-pending';
    }

    if (request.status === REQUEST_STATUSES.CANCELLED) {
      return 'status-cancelled';
    }

    if (request.status === REQUEST_STATUSES.HALTED) {
      return 'status-rejected';
    }

    if (hasRhApprovalSignal(request)) {
      return 'status-completed';
    }

    if (canSelectForRhAction(request)) {
      return 'status-pending';
    }

    return `status-${request.status?.toLowerCase().replace(/_/g, '-')}`;
  };

  const toggleSelectAll = () => {
    const selectableRequests = filteredRequests
      .filter((item) => canSelectForRhAction(item))
      .map((item) => item.id)
      .filter(Boolean) as string[];

    if (selectedRequests.size === selectableRequests.length && selectableRequests.length > 0) {
      setSelectedRequests(new Set());
    } else {
      setSelectedRequests(new Set(selectableRequests));
    }
  };

  useEffect(() => {
    setSelectedRequests((prev) => {
      const next = new Set(
        Array.from(prev).filter((id) => {
          const request = filteredRequests.find((item) => item.id === id);
          return request ? canSelectForRhAction(request) : false;
        })
      );

      if (next.size === prev.size) {
        return prev;
      }

      return next;
    });
  }, [filteredRequests]);

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Regional Head Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="dashboard-controls">
        <button 
          className="btn btn-success" 
          onClick={handleBulkApprove}
          disabled={bulkApproving}
        >
          {bulkApproving 
            ? 'Approving...' 
            : selectedRequests.size > 0 
              ? `Bulk Approve (${selectedRequests.size} Selected)` 
              : 'Approve All Pending'}
        </button>
        {selectedRequests.size > 0 && (
          <button 
            className="btn btn-secondary" 
            onClick={() => setSelectedRequests(new Set())}
          >
            Clear Selection
          </button>
        )}
      </div>

      <div className="search-box">
        <input
          type="text"
          placeholder="Search by ID, client, or city..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="dashboard-controls">
        <select
          value={filters.city}
          onChange={(event) => setFilters({ ...filters, city: event.target.value })}
        >
          <option value="">All Cities</option>
          {cityOptions.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
        <select
          value={filters.client}
          onChange={(event) => setFilters({ ...filters, client: event.target.value })}
        >
          <option value="">All Clients</option>
          {clientOptions.map((client) => (
            <option key={client} value={client}>
              {client}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.date}
          onChange={(event) => setFilters({ ...filters, date: event.target.value })}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <strong>Total Requests in History: {requests.length}</strong>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>Filtered Requests: {filteredRequests.length}</strong>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>Pending RH Approvals: {pendingRhApprovalsCount}</strong>
      </div>

      <div className="dashboard-content">
        {filteredRequests.length === 0 ? (
          <p className="text-muted">No requests found</p>
        ) : (
          <div className="requests-table-wrapper">
            <table className="requests-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={
                        filteredRequests.filter((item) => canSelectForRhAction(item)).length > 0 &&
                        selectedRequests.size === filteredRequests.filter((item) => canSelectForRhAction(item)).length
                      }
                    />
                  </th>
                  <th>Request ID</th>
                  <th>Status</th>
                  <th>Client</th>
                  <th>City</th>
                  <th>Service</th>
                  <th>Vehicles</th>
                  <th>Created At</th>
                  <th style={{ minWidth: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  (() => {
                    const normalizedVehicles = normalizeVehicles(request.vehicles);
                    const bulkVehicleStats = getBulkVehicleStats(request as RequestWithId);
                    const firstVehicleWithServiceType = normalizedVehicles.find((vehicle) => Boolean(vehicle?.serviceType));
                    const resolvedServiceType =
                      normalizeServiceType(firstVehicleWithServiceType?.serviceType || (firstVehicleWithServiceType as any)?.service_type || firstVehicleWithServiceType?.vendorType) ||
                      normalizeServiceType(request.serviceType || (request as any).service_type || request.vendorType) ||
                      'N/A';

                    return (
                  <tr key={request.id} style={{
                    backgroundColor: request.isBulkRequest ? '#e3f2fd' : 'transparent'
                  }}>
                    <td>
                      {canSelectForRhAction(request as RequestWithId) && (
                        <input
                          type="checkbox"
                          checked={selectedRequests.has(request.id as string)}
                          onChange={() => toggleRequestSelection(request.id as string)}
                        />
                      )}
                    </td>
                    <td className="request-id-cell">{request.id?.substring(0, 8)}...</td>
                    <td>
                      <span className={`status-badge ${getRhStatusClass(request as RequestWithId)}`}>
                        {getRhStatusLabel(request as RequestWithId)}
                      </span>
                    </td>
                    <td>
                      <div>
                        {request.clientName || 'N/A'}
                        {request.isBulkRequest && (
                          <div style={{ fontSize: '0.85rem', color: '#1976d2', fontWeight: 'bold' }}>
                            🚗 Bulk ({bulkVehicleStats.activeCount} vehicles)
                          </div>
                        )}
                      </div>
                    </td>
                    <td>{request.city || 'N/A'}</td>
                    <td>
                      <span className="service-badge">{request.isBulkRequest ? 'Per-vehicle' : resolvedServiceType}</span>
                    </td>
                    <td>{request.isBulkRequest ? bulkVehicleStats.activeCount : normalizedVehicles.length || 0}</td>
                    <td className="date-cell">
                      {request.createdAt
                        ? new Date(
                            (request.createdAt as any)?.toDate?.() || request.createdAt
                          ).toLocaleDateString()
                        : 'N/A'}
                    </td>
                    <td className="actions-cell">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setSelectedRequest(request as RequestWithId);
                          setShowModal(true);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRequest && (
        <Modal
          isOpen={showModal}
          title="Request Details"
          onClose={() => setShowModal(false)}
          onSubmit={() => setShowModal(false)}
          submitText="Close"
        >
          <div className="modal-details">
            <p><strong>Request ID:</strong> {selectedRequest.id}</p>
            <p><strong>Status:</strong> {getRhStatusLabel(selectedRequest)}</p>
            {selectedRequest.isBulkRequest && (
              (() => {
                const selectedVehicles = normalizeVehicles(selectedRequest.vehicles);
                const selectedVehicleStats = getBulkVehicleStats(selectedRequest);
                return (
              <div style={{ background: '#e7f3ff', padding: '12px', borderRadius: '4px', margin: '12px 0' }}>
                <strong>🚗 Bulk Request:</strong> {selectedVehicleStats.activeCount} vehicles
                {selectedVehicleStats.rejectedCount > 0 && (
                  <div style={{ marginTop: '6px', color: '#b71c1c', fontWeight: 600 }}>
                    Payment Rejected Vehicles: {selectedVehicleStats.rejectedCount}
                  </div>
                )}
                
                {/* RH Approval Status */}
                <div style={{ marginTop: '10px', fontSize: '0.95rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span>
                      <strong>RH Team:</strong>
                      <span style={{
                        marginLeft: '8px',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        backgroundColor: selectedRequest.rhStatus === 'APPROVED' ? '#c8e6c9' : '#fff3cd',
                        color: selectedRequest.rhStatus === 'APPROVED' ? '#2e7d32' : '#856404',
                        fontWeight: '600'
                      }}>
                        {selectedRequest.rhStatus === 'APPROVED' ? '✓ APPROVED' : '⏳ PENDING'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
                );
              })()
            )}
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}</p>
            <p><strong>Service Type:</strong> {normalizeServiceType(selectedRequest.serviceType) || 'N/A'}</p>
            <p><strong>Service Cost:</strong> ₹{selectedRequest.serviceCost}</p>
            {selectedRequest.vehicleAvailabilityLocation && (
              <p><strong>Vehicle Availability Location:</strong> {selectedRequest.vehicleAvailabilityLocation}</p>
            )}
            {selectedRequest.vehicleAvailableTime && (
              <p><strong>Vehicle Available Time:</strong> {selectedRequest.vehicleAvailableTime}</p>
            )}
            <p><strong>Vehicles:</strong> {normalizeVehicles(selectedRequest.vehicles).length || 0}</p>
            
            {/* Per-Vehicle Details for Bulk Requests */}
            {selectedRequest.isBulkRequest && normalizeVehicles(selectedRequest.vehicles).length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h4 style={{ marginTop: '0' }}>Per-Vehicle Details</h4>
                {(() => {
                  const selectedVehicles = normalizeVehicles(selectedRequest.vehicles);
                  const ltpocByVehicle = new Map(
                    ((selectedRequest.ltpocDetails ?? []) as Array<Record<string, unknown>>).map((item) => [
                      String(item.vehicleNumber ?? ''),
                      item,
                    ])
                  );

                  return selectedVehicles.map((vehicle: any, idx: number) => {
                    const vehicleNumber = String(vehicle?.vehicleNumber || vehicle?.vehicleNo || vehicle?.registrationNumber || 'N/A');
                    const matchedLtpoc = ltpocByVehicle.get(vehicleNumber) as Record<string, unknown> | undefined;
                    const isPaymentRejected = isPaymentRejectedVehicle(vehicle as Record<string, unknown>);
                    const paymentRejectionReason = getVehiclePaymentRejectionReason(vehicle as Record<string, unknown>, selectedRequest);

                    return (
                      <div key={idx} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < selectedVehicles.length - 1 ? '1px solid #ddd' : 'none' }}>
                        <p><strong>Vehicle Number:</strong> {vehicleNumber}</p>
                        <p>
                          <strong>Payment Status:</strong>{' '}
                          <span style={{
                            color: isPaymentRejected ? '#b71c1c' : '#2e7d32',
                            fontWeight: 600,
                          }}>
                            {isPaymentRejected ? 'Rejected' : 'Approved/Eligible'}
                          </span>
                        </p>
                        {isPaymentRejected && paymentRejectionReason && (
                          <p>
                            <strong>Rejection Reason:</strong>{' '}
                            <span className="rejection-reason-highlight">{paymentRejectionReason}</span>
                          </p>
                        )}
                        {(vehicle.serviceType || selectedRequest.serviceType) && (
                          <p><strong>Service Type:</strong> {normalizeServiceType(vehicle.serviceType || selectedRequest.serviceType)}</p>
                        )}
                        {(vehicle.vehicleAvailabilityLocation || selectedRequest.vehicleAvailabilityLocation) && (
                          <p><strong>Location:</strong> {vehicle.vehicleAvailabilityLocation || selectedRequest.vehicleAvailabilityLocation}</p>
                        )}
                        {(vehicle.vehicleAvailableTime || selectedRequest.vehicleAvailableTime) && (
                          <p><strong>Available Time:</strong> {vehicle.vehicleAvailableTime || selectedRequest.vehicleAvailableTime}</p>
                        )}
                        {(vehicle.ltpocName || matchedLtpoc?.ltpocName) && (
                          <p><strong>LTPOC Name:</strong> {String(vehicle.ltpocName || matchedLtpoc?.ltpocName || '')}</p>
                        )}
                        {(vehicle.ltpocPhone || matchedLtpoc?.ltpocPhone) && (
                          <p><strong>LTPOC Phone:</strong> {String(vehicle.ltpocPhone || matchedLtpoc?.ltpocPhone || '')}</p>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
            
            <p><strong>RH Approval:</strong> {selectedRequest.rhApproval ? '✓' : '✗'}</p>
            <h4>LTPOC Details</h4>
            {selectedRequest.ltpocDetails?.map((ltpoc, idx) => (
              <div key={idx} className="driver-info">
                <p><strong>Vehicle:</strong> {ltpoc.vehicleNumber}</p>
                <p><strong>LTPOC Name:</strong> {ltpoc.ltpocName}</p>
                <p><strong>Phone:</strong> {ltpoc.ltpocPhone}</p>
              </div>
            ))}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {/* BULK REQUEST APPROVAL BUTTONS */}
            {selectedRequest.isBulkRequest && canSelectForRhAction(selectedRequest) && (
              <>
                {selectedRequest.rhStatus !== 'APPROVED' ? (
                  <div className="action-buttons">
                    <button className="btn btn-success" onClick={handleApprove}>
                      ✓ Approve for RH
                    </button>
                    {selectedRequest.status === REQUEST_STATUSES.FO_CREATED && (
                      <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>
                        ✗ Reject
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#c8e6c9',
                    borderRadius: '4px',
                    marginTop: '12px',
                    textAlign: 'center',
                    color: '#2e7d32',
                    fontWeight: '600'
                  }}>
                    ✓ RH Has Approved
                    {selectedRequest.paymentStatus !== 'APPROVED' && (
                      <div style={{ fontSize: '0.9rem', marginTop: '8px', fontWeight: '400' }}>
                        Waiting for Payment team...
                      </div>
                    )}
                    {selectedRequest.bothApproved && (
                      <div style={{ fontSize: '0.9rem', marginTop: '8px', fontWeight: '600' }}>
                        Both teams approved! Ready for vendor
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* SINGLE REQUEST APPROVAL BUTTONS (unchanged) */}
            {!selectedRequest.rhApproval &&
              !selectedRequest.rhActionTaken &&
              !selectedRequest.isBulkRequest &&
              canSelectForRhAction(selectedRequest) && (
              <div className="action-buttons">
                <button className="btn btn-success" onClick={handleApprove}>
                  Approve
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowEditModal(true)}
                >
                  Edit & Approve
                </button>
                {selectedRequest.status === REQUEST_STATUSES.PARALLEL_REVIEW && (
                  <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>
                    Reject
                  </button>
                )}
              </div>
            )}

            {selectedRequest.rhActionTaken && (
              <div className="info-box" style={{ marginTop: '1rem', padding: '12px', background: '#e7f1ff', borderRadius: '4px' }}>
                <p style={{ margin: 0, color: '#0c5460' }}>✓ RH Action Completed</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal
          isOpen={showEditModal}
          title="Edit Request"
          onClose={() => setShowEditModal(false)}
          onSubmit={handleEditAndApprove}
          submitText="Save & Approve"
        >
          <div className="edit-form">
            <div className="form-group">
              <label>Client Name</label>
              <input
                type="text"
                value={(editData.clientName as string) || selectedRequest.clientName || ''}
                onChange={(event) =>
                  setEditData({ ...editData, clientName: event.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>City</label>
              <input
                type="text"
                value={(editData.city as string) || selectedRequest.city || ''}
                onChange={(event) => setEditData({ ...editData, city: event.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal
          isOpen={showRejectModal}
          title="Reject Request"
          onClose={() => setShowRejectModal(false)}
          onSubmit={handleReject}
          submitText="Reject"
        >
          <div className="form-group">
            <label>Rejection Reason</label>
            <textarea
              rows={4}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Provide a reason for rejection"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
