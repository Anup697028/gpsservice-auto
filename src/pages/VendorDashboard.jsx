import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { functionsService } from '../services/functionsService';
import { showToast } from '../components/Toast';
import { RequestCard } from '../components/RequestCard';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';

export const VendorDashboard = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [notifying, setNotifying] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const VENDORS = ['Fleetx', 'Wheelseye'];

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const vendorRequests = await requestService.getRequestsByStatus('VENDOR_COORDINATION');
      setRequests(vendorRequests);
    } catch (error) {
      showToast('Failed to fetch requests', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = requests.filter((r) =>
    r.id.includes(searchTerm) ||
    r.clientName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleNotifyVendor = async () => {
    if (!selectedVendor) {
      showToast('Please select a vendor', 'error');
      return;
    }

    setNotifying(true);
    try {
      // Send email notification to vendor
      await functionsService.sendVendorNotification({
        requestId: selectedRequest.id,
        vendorName: selectedVendor,
        clientName: selectedRequest.clientName,
        city: selectedRequest.city,
        vehicles: selectedRequest.vehicles,
        driverDetails: selectedRequest.driverDetails,
      });

      // Update request in Firestore
      await requestService.notifyVendor(
        selectedRequest.id,
        selectedVendor,
        user.uid
      );

      showToast(`${selectedVendor} notified successfully via email!`, 'success');
      setShowNotifyModal(false);
      setShowModal(false);
      setSelectedVendor('');
      fetchRequests();
    } catch (error) {
      showToast('Failed to notify vendor: ' + error.message, 'error');
      console.error(error);
    } finally {
      setNotifying(false);
    }
  };

  if (loading) return <Loader />;

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
          onChange={(e) => setSearchTerm(e.target.value)}
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
                  setSelectedRequest(req);
                  setShowModal(true);
                }}
                onAction={(req) => {
                  setSelectedRequest(req);
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
            <p><strong>Vehicles:</strong> {selectedRequest.vehicles?.length || 0}</p>

            {selectedRequest.vendorName && (
              <div className="info-box">
                <p><strong>Assigned Vendor:</strong> {selectedRequest.vendorName}</p>
                <p>
                  <strong>Notified:</strong>{' '}
                  {new Date(selectedRequest.notificationTimestamp?.toDate?.() || selectedRequest.notificationTimestamp).toLocaleString()}
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

            <AuditLog logs={selectedRequest.auditLog} />

            {!selectedRequest.vendorName && selectedRequest.status === 'VENDOR_COORDINATION' && (
              <div className="action-buttons">
                <button
                  className="btn btn-primary"
                  onClick={() => setShowNotifyModal(true)}
                >
                  Notify Vendor
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal
          isOpen={showNotifyModal}
          title="Select Vendor to Notify"
          onClose={() => setShowNotifyModal(false)}
          onSubmit={handleNotifyVendor}
          submitText="Notify"
        >
          <div className="form-group">
            <label>Select Vendor</label>
            <select
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.target.value)}
            >
              <option value="">Choose a vendor...</option>
              {VENDORS.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
};
