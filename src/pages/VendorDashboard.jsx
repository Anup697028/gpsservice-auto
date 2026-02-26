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

const normalizeVehicles = (vehicles) => {
  if (Array.isArray(vehicles)) {
    return vehicles;
  }

  if (vehicles && typeof vehicles === 'object') {
    return Object.keys(vehicles)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => vehicles[key] || {});
  }

  return [];
};

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
  const userRef = user
    ? { id: user.uid, email: user.email, role: 'VENDOR' }
    : null;

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      // Fetch requests with PAYMENT_APPROVED status
      const vendorRequests = await requestService.getRequestsByStatus('PAYMENT_APPROVED');
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
  const selectedVehicles = selectedRequest ? normalizeVehicles(selectedRequest.vehicles) : [];

  const handleNotifyVendor = async () => {
    if (!selectedVendor) {
      showToast('Please select a vendor', 'error');
      return;
    }

    if (!userRef || !selectedRequest) {
      showToast('User info missing. Please re-login.', 'error');
      return;
    }

    setNotifying(true);
    try {
      const isBulk = Boolean(selectedRequest.isBulkRequest);
      const fallbackLtpocDetails = selectedRequest.driverDetails
        ? selectedRequest.driverDetails.map((driver) => ({
            vehicleNumber: driver.vehicleNumber,
            ltpocName: driver.driverName,
            ltpocPhone: driver.driverNumber,
          }))
        : undefined;

      // Send email notification to vendor
      await functionsService.sendVendorNotification({
        requestId: selectedRequest.id,
        vendorName: selectedVendor,
        clientName: selectedRequest.clientName,
        city: selectedRequest.city,
        vehicles: normalizeVehicles(selectedRequest.vehicles),
        ltpocDetails: selectedRequest.ltpocDetails || fallbackLtpocDetails,
        serviceType: selectedRequest.serviceType,
        vehicleAvailabilityLocation: selectedRequest.vehicleAvailabilityLocation,
        vehicleAvailableTime: selectedRequest.vehicleAvailableTime,
      });

      // Update request in Firestore
      if (isBulk) {
        await requestService.notifyBulkVendor(
          selectedRequest.id,
          selectedVendor,
          userRef
        );
      } else {
        await requestService.notifyVendor(
          selectedRequest.id,
          selectedVendor,
          userRef
        );
      }

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
            {selectedRequest.isBulkRequest && (
              <p style={{ background: '#e7f3ff', padding: '12px', borderRadius: '4px', margin: '12px 0' }}>
                <strong>🚗 Bulk Request:</strong> {selectedRequest.vehicleCount || selectedVehicles.length || 0} vehicles
                {selectedRequest.bothApproved && (
                  <div style={{ marginTop: '8px', color: '#2e7d32', fontWeight: '600' }}>
                    ✓ Both RH & Payment approved
                  </div>
                )}
              </p>
            )}
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}</p>
            <p><strong>Service Type:</strong> {selectedRequest.serviceType}</p>
            <p><strong>Vehicles:</strong> {selectedVehicles.length || 0}</p>

            {/* Per-Vehicle Details for Bulk Requests */}
            {selectedRequest.isBulkRequest && selectedVehicles.length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h4 style={{ marginTop: '0' }}>Per-Vehicle Details</h4>
                {selectedVehicles.map((vehicle, idx) => (
                  <div key={idx} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < selectedVehicles.length - 1 ? '1px solid #ddd' : 'none' }}>
                    <p><strong>Vehicle Number:</strong> {vehicle.vehicleNumber}</p>
                    {vehicle.serviceType && <p><strong>Service Type:</strong> {vehicle.serviceType}</p>}
                    {vehicle.vehicleAvailabilityLocation && <p><strong>Location:</strong> {vehicle.vehicleAvailabilityLocation}</p>}
                    {vehicle.vehicleAvailableTime && <p><strong>Available Time:</strong> {vehicle.vehicleAvailableTime}</p>}
                    {vehicle.ltpocName && <p><strong>LTPOC Name:</strong> {vehicle.ltpocName}</p>}
                    {vehicle.ltpocPhone && <p><strong>LTPOC Phone:</strong> {vehicle.ltpocPhone}</p>}
                  </div>
                ))}
              </div>
            )}

            {selectedRequest.vendorName && (
              <div className="info-box">
                <p><strong>Assigned Vendor:</strong> {selectedRequest.vendorName}</p>
                <p>
                  <strong>Notified:</strong>{' '}
                  {new Date(selectedRequest.notificationTimestamp?.toDate?.() || selectedRequest.notificationTimestamp).toLocaleString()}
                </p>
              </div>
            )}

            <h4>LTPOC Details</h4>
            {(selectedRequest.ltpocDetails || selectedRequest.driverDetails || []).map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p><strong>Vehicle:</strong> {driver.vehicleNumber}</p>
                <p><strong>LTPOC:</strong> {driver.ltpocName || driver.driverName}</p>
                <p><strong>Phone:</strong> {driver.ltpocPhone || driver.driverNumber}</p>
              </div>
            ))}

            <AuditLog logs={selectedRequest.auditLog} />

            {!selectedRequest.vendorName && (
              (!selectedRequest.isBulkRequest && selectedRequest.status === 'VENDOR_COORDINATION') ||
              (selectedRequest.isBulkRequest && selectedRequest.status === 'PAYMENT_APPROVED')
            ) && (
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
