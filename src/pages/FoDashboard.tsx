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

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

export const FoDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
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
    return requests.filter((item) =>
      item.id?.toLowerCase().includes(term) ||
      item.clientName?.toLowerCase().includes(term)
    );
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
                  onCancel={handleCancelRequest}
                  showCancel={true}
                />
              ))}
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
            <h4>Drivers</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p>{driver.vehicleNumber}: {driver.driverName} ({driver.driverNumber})</p>
              </div>
            ))}
            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />
          </div>
        </Modal>
      )}
    </div>
  );
};
