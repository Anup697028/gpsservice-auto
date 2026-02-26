import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { showToast } from '../components/Toast';
import { RequestCard } from '../components/RequestCard';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';
import type { RequestRecord, UserRef } from '../types/workflow';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

type FilterState = {
  city: string;
  client: string;
  date: string;
};

const toDateString = (value: unknown) => {
  if (!value) {
    return '';
  }
  const date = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return date.toISOString().slice(0, 10);
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
    const unsubscribe = requestService.subscribeToRequests('PARALLEL_REVIEW', (data) => {
      setRequests(data as RequestWithId[]);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const cityOptions = useMemo(() => {
    return Array.from(new Set(requests.map((item) => item.city).filter(Boolean))) as string[];
  }, [requests]);

  const clientOptions = useMemo(() => {
    return Array.from(new Set(requests.map((item) => item.clientName).filter(Boolean))) as string[];
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return requests.filter((item) => {
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
  }, [requests, searchTerm, filters]);

  const handleApprove = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }
    try {
      await requestService.approveRequest(selectedRequest.id as string, userRef, 'RH');
      showToast('Request approved!', 'success');
      setShowModal(false);
    } catch (error) {
      showToast('Failed to approve request', 'error');
    }
  };

  const handleReject = async () => {
    if (!selectedRequest || !userRef || !rejectionReason.trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }
    try {
      await requestService.rejectRequest(
        selectedRequest.id as string,
        userRef,
        'RH',
        rejectionReason
      );
      showToast('Request rejected!', 'success');
      setShowRejectModal(false);
      setShowModal(false);
      setRejectionReason('');
    } catch (error) {
      showToast('Failed to reject request', 'error');
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
    const pendingIds = filteredRequests
      .filter((item) => !item.rhApproval)
      .map((item) => item.id)
      .filter(Boolean) as string[];

    if (pendingIds.length === 0) {
      showToast('No pending requests to approve', 'info');
      return;
    }

    try {
      await requestService.bulkApprove(pendingIds, userRef);
      showToast(`${pendingIds.length} request(s) approved!`, 'success');
    } catch (error) {
      showToast('Failed to bulk approve', 'error');
    }
  };

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
        <button className="btn btn-success" onClick={handleBulkApprove}>
          Approve All Pending (Once per day)
        </button>
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

      <div className="dashboard-content">
        {filteredRequests.length === 0 ? (
          <p className="text-muted">No requests found</p>
        ) : (
          <div className="requests-grid">
            {filteredRequests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                onViewDetails={(req) => {
                  setSelectedRequest(req as RequestWithId);
                  setShowModal(true);
                }}
                onAction={(req) => {
                  setSelectedRequest(req as RequestWithId);
                  setShowModal(true);
                }}
              />
            ))}
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
            <p><strong>Status:</strong> {selectedRequest.status}</p>
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}</p>
            <p><strong>Destination:</strong> {selectedRequest.destination}</p>
            <p><strong>Service Type:</strong> {selectedRequest.serviceType}</p>
            <p><strong>Service Cost:</strong> ₹{selectedRequest.serviceCost}</p>
            {selectedRequest.tripFromDate && (
              <>
                <p><strong>Trip From:</strong> {selectedRequest.tripFromDate} at {selectedRequest.tripFromTime}</p>
                <p><strong>Trip To:</strong> {selectedRequest.tripToDate} at {selectedRequest.tripToTime}</p>
              </>
            )}
            <p><strong>Vehicles:</strong> {selectedRequest.vehicles?.length || 0}</p>
            <p><strong>RH Approval:</strong> {selectedRequest.rhApproval ? '✓' : '✗'}</p>
            <p><strong>Payment Approval:</strong> {selectedRequest.paymentApproval ? '✓' : '✗'}</p>

            <h4>Drivers</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p>{driver.vehicleNumber}: {driver.driverName} ({driver.driverNumber})</p>
              </div>
            ))}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {!selectedRequest.rhApproval && selectedRequest.status === 'PARALLEL_REVIEW' && (
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
                <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>
                  Reject
                </button>
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
