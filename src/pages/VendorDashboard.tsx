import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { functionsService } from '../services/functionsService';
import { showToast } from '../components/Toast';
import { RequestCard } from '../components/RequestCard';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';
import type { RequestRecord, UserRef } from '../types/workflow';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

export const VendorDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [notifying, setNotifying] = useState(false);
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
    const unsubscribe = requestService.subscribeToRequests('VENDOR_COORDINATION', (data) => {
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

  const handleNotifyVendor = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }

    const serviceVendor = selectedRequest.serviceType ?? null;
    if (!serviceVendor) {
      showToast('Service type is missing for this request', 'error');
      return;
    }

    setNotifying(true);
    try {
      await functionsService.sendVendorNotification({
        requestId: selectedRequest.id as string,
        vendorName: serviceVendor,
        clientName: selectedRequest.clientName ?? null,
        city: selectedRequest.city ?? null,
        destination: selectedRequest.destination ?? null,
        serviceType: selectedRequest.serviceType ?? null,
        serviceCost: selectedRequest.serviceCost ?? null,
        tripFromDate: selectedRequest.tripFromDate ?? null,
        tripFromTime: selectedRequest.tripFromTime ?? null,
        tripToDate: selectedRequest.tripToDate ?? null,
        tripToTime: selectedRequest.tripToTime ?? null,
        vehicles: selectedRequest.vehicles,
        driverDetails: selectedRequest.driverDetails,
      });
      await requestService.notifyVendor(selectedRequest.id as string, serviceVendor, userRef);
      showToast(`${serviceVendor} notified successfully!`, 'success');
      setShowModal(false);
    } catch (error) {
      showToast('Failed to notify vendor', 'error');
    } finally {
      setNotifying(false);
    }
  };

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Vendor Coordinator Dashboard</h1>
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
          <p className="text-muted">No requests pending vendor coordination</p>
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
          title="Request Details - Vendor Coordination"
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

            {selectedRequest.vendorName && (
              <div className="info-box">
                <p><strong>Assigned Vendor:</strong> {selectedRequest.vendorName}</p>
                <p>
                  <strong>Notified:</strong>{' '}
                  {new Date(
                    (selectedRequest.notificationTimestamp as { toDate?: () => Date })?.toDate?.() ||
                      (selectedRequest.notificationTimestamp as string)
                  ).toLocaleString()}
                </p>
              </div>
            )}

            <h4>Driver Details</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p><strong>Vehicle:</strong> {driver.vehicleNumber}</p>
                <p><strong>Driver:</strong> {driver.driverName}</p>
                <p><strong>Phone:</strong> {driver.driverNumber}</p>
              </div>
            ))}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {!selectedRequest.vendorName && selectedRequest.status === 'VENDOR_COORDINATION' && (
              <div className="action-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleNotifyVendor}
                  disabled={notifying}
                >
                  {notifying ? 'Notifying...' : 'Notify Vendor'}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
