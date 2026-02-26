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

export const PaymentDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [searchTerm, setSearchTerm] = useState('');
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

  const filteredRequests = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return requests.filter((item) =>
      item.id?.toLowerCase().includes(term) ||
      item.clientName?.toLowerCase().includes(term)
    );
  }, [requests, searchTerm]);

  const handleApprove = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }
    try {
      await requestService.approveRequest(selectedRequest.id as string, userRef, 'PAYMENT');
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
        'PAYMENT',
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
        'PAYMENT'
      );
      showToast('Request updated and approved!', 'success');
      setShowEditModal(false);
      setShowModal(false);
      setEditData({});
    } catch (error) {
      showToast('Failed to update request', 'error');
    }
  };

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Payment Team Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="search-box">
        <input
          type="text"
          placeholder="Search by ID or client name..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="dashboard-content">
        {filteredRequests.length === 0 ? (
          <p className="text-muted">No pending requests</p>
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
          title="Request Details - Payment Verification"
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

            <h4>Vehicle Details</h4>
            {selectedRequest.vehicles?.map((vehicle, idx) => (
              <div key={idx} className="vehicle-info">
                <p>{vehicle.vehicleNumber}</p>
              </div>
            ))}

            <h4>Driver Details</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p><strong>Vehicle:</strong> {driver.vehicleNumber}</p>
                <p><strong>Driver Name:</strong> {driver.driverName}</p>
                <p><strong>Phone:</strong> {driver.driverNumber}</p>
              </div>
            ))}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {!selectedRequest.paymentApproval && selectedRequest.status === 'PARALLEL_REVIEW' && (
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
