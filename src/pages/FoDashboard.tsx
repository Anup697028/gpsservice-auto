import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { RequestCard } from '../components/RequestCard';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import { AuditLog } from '../components/AuditLog';
import { RequestForm } from '../components/RequestForm';
import { showToast } from '../components/Toast';
import '../styles/dashboard.css';
import type { RequestRecord, UserRef } from '../types/workflow';
import { REQUEST_STATUSES } from '../types/workflow';
import { getUnifiedStatusClass, getUnifiedStatusLabel } from '../utils/statusMapping';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

const sanitizeLtpocName = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized.replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ').replace(/\s+/g, ' ').trim();
};

const normalizeServiceType = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (raw === 'fleetx') {
    return 'FleetX';
  }
  if (raw === 'wheelseye') {
    return 'WheelsEye';
  }
  return '';
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

const getFoTableStatusLabel = (request: RequestWithId) => {
  if (request.status === REQUEST_STATUSES.CANCELLED) {
    return 'Cancelled';
  }

  if (request.status === REQUEST_STATUSES.HALTED || request.rhStatus === 'REJECTED' || request.paymentStatus === 'REJECTED') {
    return 'Rejected';
  }

  if (request.foNotified === true) {
    return 'FO Notified';
  }

  if (request.vendorNotified === true) {
    return 'Pending FO Notification';
  }

  if (request.paymentStatus === 'APPROVED' || request.status === REQUEST_STATUSES.PAYMENT_APPROVED) {
    return 'Pending Vendor Action';
  }

  if (String(request.rhStatus || '').toUpperCase() === 'APPROVED') {
    return 'Pending Payment Approval';
  }

  return getUnifiedStatusLabel(request.status);
};

const getFoTableStatusClass = (request: RequestWithId) => {
  const label = getFoTableStatusLabel(request).toLowerCase();

  if (label.includes('cancel')) {
    return 'status-cancelled';
  }

  if (label.includes('reject')) {
    return 'status-rejected';
  }

  if (label.includes('fo notified') || label.includes('completed')) {
    return 'status-completed';
  }

  if (label.includes('pending') || label.includes('vendor')) {
    return 'status-pending';
  }

  return getUnifiedStatusClass(request.status);
};

export const FoDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTargetRequest, setCancelTargetRequest] = useState<RequestWithId | null>(null);
  const [selectedVehicleToRemove, setSelectedVehicleToRemove] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

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
    if (!user) {
      return;
    }
    const unsubscribe = requestService.subscribeToUserRequests(user.uid, (data) => {
      setRequests(data as RequestWithId[]);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  const filteredRequests = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const filtered = requests.filter((item) =>
      item.id?.toLowerCase().includes(term) ||
      item.clientName?.toLowerCase().includes(term)
    );
    // Sort by createdAt, newest first
    return filtered.sort((a, b) => {
      const dateA = (a.createdAt as any)?.toDate?.() || new Date(0);
      const dateB = (b.createdAt as any)?.toDate?.() || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [requests, searchTerm]);

  const handleCancelRequest = async (request: RequestWithId) => {
    if (!userRef || !request.id) {
      return;
    }
    
    if (!confirm(`Are you sure you want to cancel request #${request.id.substring(0, 8)}?`)) {
      return;
    }
    
    try {
      await requestService.cancelRequest(request.id, userRef);
      showToast('Request cancelled successfully', 'success');
    } catch (error) {
      showToast('Failed to cancel request: ' + (error as Error).message, 'error');
    }
  };

  const openCancelOptions = (request: RequestWithId) => {
    setCancelTargetRequest(request);
    setSelectedVehicleToRemove('');
    setShowCancelModal(true);
  };

  const handleCancelEntireRequest = async () => {
    if (!cancelTargetRequest || !cancelTargetRequest.id || !userRef) {
      return;
    }
    await handleCancelRequest(cancelTargetRequest);
    setShowCancelModal(false);
    setCancelTargetRequest(null);
    setSelectedVehicleToRemove('');
  };

  const handleRemoveVehicleFromBulk = async () => {
    if (!cancelTargetRequest?.id || !selectedVehicleToRemove || !userRef) {
      showToast('Please select a vehicle to remove', 'error');
      return;
    }

    try {
      await requestService.removeBulkVehicle(cancelTargetRequest.id, selectedVehicleToRemove, userRef);
      showToast(`Vehicle ${selectedVehicleToRemove} removed from bulk request`, 'success');
      setShowCancelModal(false);
      setCancelTargetRequest(null);
      setSelectedVehicleToRemove('');
    } catch (error) {
      showToast('Failed to remove vehicle: ' + (error as Error).message, 'error');
    }
  };

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Field Operator Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="dashboard-content">
        <RequestForm user={userRef} />

        <div className="requests-section">
          <h2>My Requests</h2>
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by request ID or client name..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong>Total Requests in History: {requests.length}</strong>
            <span style={{ margin: '0 8px' }}>•</span>
            <strong>Filtered Requests: {filteredRequests.length}</strong>
          </div>

          {filteredRequests.length === 0 ? (
            <p className="text-muted">No requests found</p>
          ) : (
            <div className="requests-table-wrapper">
              <table className="requests-table">
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Status</th>
                    <th>Client</th>
                    <th>City</th>
                    <th>Service</th>
                    <th>Vehicles</th>
                    <th>Created</th>
                    <th style={{ minWidth: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="request-id-cell">{request.id?.substring(0, 8)}...</td>
                      <td>
                          <span className={`status-badge ${getFoTableStatusClass(request)}`}>
                          {getFoTableStatusLabel(request)}
                        </span>
                      </td>
                      <td>{request.clientName || 'N/A'}</td>
                      <td>{request.city || 'N/A'}</td>
                      <td>
                        <span className="service-badge">
                          {request.isBulkRequest
                            ? 'Per-vehicle'
                            : normalizeServiceType(request.serviceType || (request as any).service_type || request.vendorType) || 'N/A'}
                        </span>
                      </td>
                      <td>{normalizeVehicles(request.vehicles).length || 0}</td>
                      <td className="date-cell">
                        {request.createdAt ? new Date(
                          (request.createdAt as any)?.toDate?.() || request.createdAt
                        ).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="actions-cell">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setSelectedRequest(request);
                            setShowModal(true);
                          }}
                        >
                          View
                        </button>
                        {(request.status === REQUEST_STATUSES.PARALLEL_REVIEW || request.status === REQUEST_STATUSES.FO_CREATED) && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => openCancelOptions(request)}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
            <p><strong>Status:</strong> {getUnifiedStatusLabel(selectedRequest.status)}</p>
            {selectedRequest.isBulkRequest && (
              <div style={{ background: '#e7f3ff', padding: '12px', borderRadius: '4px', margin: '12px 0' }}>
                <strong>Bulk Request:</strong> {selectedRequest.vehicleCount || selectedRequest.vehicles?.length || 0} vehicles
                <div style={{ marginTop: '10px', fontSize: '0.95rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
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
                        {selectedRequest.rhStatus === 'APPROVED' ? 'APPROVED' : 'PENDING'}
                      </span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      <strong>Payment Team:</strong>
                      <span style={{
                        marginLeft: '8px',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        backgroundColor: selectedRequest.paymentStatus === 'APPROVED' ? '#c8e6c9' : '#fff3cd',
                        color: selectedRequest.paymentStatus === 'APPROVED' ? '#2e7d32' : '#856404',
                        fontWeight: '600'
                      }}>
                        {selectedRequest.paymentStatus === 'APPROVED' ? 'APPROVED' : 'PENDING'}
                      </span>
                    </span>
                  </div>
                </div>
                {selectedRequest.bothApproved && (
                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#c8e6c9', borderRadius: '3px', textAlign: 'center', color: '#2e7d32', fontWeight: '600' }}>
                    Both teams approved - Ready for vendor
                  </div>
                )}
              </div>
            )}
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}</p>
            <p><strong>Service Type:</strong> {selectedRequest.isBulkRequest ? 'Per-vehicle' : selectedRequest.serviceType}</p>
            {!selectedRequest.isBulkRequest && (
              <p><strong>Service Cost:</strong> ₹{selectedRequest.serviceCost}</p>
            )}
            {selectedRequest.vehicleAvailabilityLocation && (
              <p><strong>Vehicle Availability Location:</strong> {selectedRequest.vehicleAvailabilityLocation}</p>
            )}
            {selectedRequest.vehicleAvailableTime && (
              <p><strong>Vehicle Available Time:</strong> {selectedRequest.vehicleAvailableTime}</p>
            )}
            <p><strong>Vehicles:</strong> {selectedRequest.vehicles?.length || 0}</p>

            {selectedRequest.isBulkRequest && selectedRequest.vehicles && selectedRequest.vehicles.length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h4 style={{ marginTop: 0 }}>Per-Vehicle Details</h4>
                {selectedRequest.vehicles.map((vehicle: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < selectedRequest.vehicles.length - 1 ? '1px solid #ddd' : 'none' }}>
                    <p><strong>Vehicle Number:</strong> {vehicle.vehicleNumber}</p>
                    {vehicle.serviceType && <p><strong>Service Type:</strong> {vehicle.serviceType}</p>}
                    {vehicle.vehicleAvailabilityLocation && <p><strong>Location:</strong> {vehicle.vehicleAvailabilityLocation}</p>}
                    {vehicle.vehicleAvailableTime && <p><strong>Available Time:</strong> {vehicle.vehicleAvailableTime}</p>}
                    {vehicle.ltpocName && <p><strong>LTPOC Name:</strong> {sanitizeLtpocName(vehicle.ltpocName)}</p>}
                    {vehicle.ltpocPhone && <p><strong>LTPOC Phone:</strong> {vehicle.ltpocPhone}</p>}
                  </div>
                ))}
              </div>
            )}

            {!selectedRequest.isBulkRequest && (
              <>
                <h4>LTPOC Details</h4>
                {selectedRequest.ltpocDetails?.map((ltpoc, idx) => (
                  <div key={idx} className="driver-info">
                    <p><strong>Vehicle:</strong> {ltpoc.vehicleNumber}</p>
                    <p><strong>LTPOC Name:</strong> {sanitizeLtpocName(ltpoc.ltpocName)}</p>
                    <p><strong>Phone:</strong> {ltpoc.ltpocPhone}</p>
                  </div>
                ))}
              </>
            )}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />
          </div>
        </Modal>
      )}

      {cancelTargetRequest && (
        <Modal
          isOpen={showCancelModal}
          title="Cancel Request"
          onClose={() => {
            setShowCancelModal(false);
            setCancelTargetRequest(null);
            setSelectedVehicleToRemove('');
          }}
          onSubmit={() => {
            // Intentionally no-op; use explicit action buttons below
          }}
          submitText="Close"
        >
          <div className="modal-details">
            <p><strong>Request ID:</strong> {cancelTargetRequest.id}</p>
            <p><strong>Status:</strong> {getUnifiedStatusLabel(cancelTargetRequest.status)}</p>
            <p><strong>Vehicles:</strong> {cancelTargetRequest.vehicles?.length || 0}</p>

            {cancelTargetRequest.isBulkRequest && cancelTargetRequest.status === REQUEST_STATUSES.FO_CREATED ? (
              <>
                <p style={{ marginTop: '12px' }}>
                  Choose one option:
                </p>

                <div style={{ marginBottom: '12px' }}>
                  <label>Remove one vehicle from this bulk request</label>
                  <select
                    value={selectedVehicleToRemove}
                    onChange={(event) => setSelectedVehicleToRemove(event.target.value)}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    <option value="">Select vehicle</option>
                    {(cancelTargetRequest.vehicles || []).map((vehicle: any) => (
                      <option key={vehicle.vehicleNumber} value={vehicle.vehicleNumber}>
                        {vehicle.vehicleNumber}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: '10px' }}
                    onClick={handleRemoveVehicleFromBulk}
                    disabled={!selectedVehicleToRemove}
                  >
                    Remove Selected Vehicle
                  </button>
                </div>

                <div style={{ borderTop: '1px solid #ddd', paddingTop: '12px' }}>
                  <button className="btn btn-danger" onClick={handleCancelEntireRequest}>
                    Cancel Entire Bulk Request
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-danger" onClick={handleCancelEntireRequest}>
                Cancel Entire Request
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
