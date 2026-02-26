import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { showToast } from '../components/Toast';
import { RequestCard } from '../components/RequestCard';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';

export const RhDashboard = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [filteredRequests, setFilteredRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [actionType, setActionType] = useState(null);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const allRequests = await requestService.getAllRequests();
      const sortedRequests = allRequests.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime();
      });
      setRequests(sortedRequests);
      setFilteredRequests(sortedRequests);
    } catch (error) {
      showToast('Failed to fetch requests', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (term) => {
    setSearchTerm(term);
    const filtered = requests.filter((r) =>
      r.id.includes(term) ||
      r.clientName?.toLowerCase().includes(term.toLowerCase()) ||
      r.city?.toLowerCase().includes(term.toLowerCase())
    );
    setFilteredRequests(filtered);
  };

  const handleApprove = async () => {
    try {
      await requestService.approveRequest(selectedRequest.id, user.uid, 'RH');
      showToast('Request approved!', 'success');
      setShowModal(false);
      fetchRequests();
    } catch (error) {
      showToast('Failed to approve request', 'error');
      console.error(error);
    }
  };

  const handleReject = async () => {
    try {
      await requestService.rejectRequest(selectedRequest.id, user.uid, 'RH');
      showToast('Request rejected!', 'success');
      setShowModal(false);
      fetchRequests();
    } catch (error) {
      showToast('Failed to reject request', 'error');
      console.error(error);
    }
  };

  const handleEditAndApprove = async () => {
    try {
      await requestService.editAndApprove(
        selectedRequest.id,
        editData,
        user.uid
      );
      showToast('Request updated and approved!', 'success');
      setShowEditModal(false);
      setShowModal(false);
      fetchRequests();
    } catch (error) {
      showToast('Failed to update request', 'error');
      console.error(error);
    }
  };

  const handleBulkApprove = async () => {
    const pendingIds = filteredRequests
      .filter((r) => r.status === 'REQUEST_CREATED' && !r.rhApproval)
      .map((r) => r.id);

    if (pendingIds.length === 0) {
      showToast('No pending requests to approve', 'info');
      return;
    }

    try {
      await requestService.bulkApprove(pendingIds, user.uid);
      showToast(`${pendingIds.length} request(s) approved!`, 'success');
      fetchRequests();
    } catch (error) {
      showToast('Failed to bulk approve', 'error');
      console.error(error);
    }
  };

  if (loading) return <Loader />;

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
          onChange={(e) => handleSearch(e.target.value)}
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
                  setSelectedRequest(req);
                  setActionType(null);
                  setShowModal(true);
                }}
                onAction={(req) => {
                  setSelectedRequest(req);
                  setActionType('action');
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
            <p><strong>Vehicles:</strong> {selectedRequest.vehicles?.length || 0}</p>
            <p><strong>RH Approval:</strong> {selectedRequest.rhApproval ? '✓' : '✗'}</p>
            <p><strong>Payment Approval:</strong> {selectedRequest.paymentApproval ? '✓' : '✗'}</p>

            <h4>Drivers</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p>{driver.vehicleNumber}: {driver.driverName} ({driver.driverNumber})</p>
              </div>
            ))}

            <AuditLog logs={selectedRequest.auditLog} />

            {!selectedRequest.rhApproval && selectedRequest.status === 'REQUEST_CREATED' && (
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
                <button className="btn btn-danger" onClick={handleReject}>
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
                value={editData.clientName || selectedRequest.clientName}
                onChange={(e) =>
                  setEditData({ ...editData, clientName: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>City</label>
              <input
                type="text"
                value={editData.city || selectedRequest.city}
                onChange={(e) =>
                  setEditData({ ...editData, city: e.target.value })
                }
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
