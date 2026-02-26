import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { foApiService } from '../services/foApiService';
import { requestService } from '../services/requestService';
import { validateBulkVehicles, validateDriverDetails } from '../utils/validation';
import { showToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import { RequestCard } from '../components/RequestCard';
import '../styles/dashboard.css';

export const FoDashboard = () => {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicles, setSelectedVehicles] = useState([]);
  const [driverDetails, setDriverDetails] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const vehicleList = await foApiService.getVehicles();
        const registeredVehicles = vehicleList.filter((v) => v.isRegistered);
        setVehicles(registeredVehicles);
      } catch (error) {
        showToast('Failed to fetch vehicles', 'error');
      } finally {
        setLoading(false);
      }
    };

    const fetchRequests = async () => {
      try {
        const allRequests = await requestService.getUserRequests(user?.uid);
        setRequests(allRequests);
      } catch (error) {
        console.error('Error fetching requests:', error);
      }
    };

    fetchVehicles();
    fetchRequests();
  }, [user?.uid]);

  const handleVehicleSelect = (vehicle) => {
    const isSelected = selectedVehicles.some((v) => v.vehicleNumber === vehicle.vehicleNumber);
    if (isSelected) {
      setSelectedVehicles(
        selectedVehicles.filter((v) => v.vehicleNumber !== vehicle.vehicleNumber)
      );
    } else {
      setSelectedVehicles([...selectedVehicles, vehicle]);
    }
  };

  const handleAddDriver = () => {
    setDriverDetails([
      ...driverDetails,
      { vehicleNumber: '', driverName: '', driverNumber: '' },
    ]);
  };

  const handleUpdateDriver = (index, field, value) => {
    const updated = [...driverDetails];
    updated[index][field] = value;
    setDriverDetails(updated);
  };

  const handleRemoveDriver = (index) => {
    setDriverDetails(driverDetails.filter((_, i) => i !== index));
  };

  const handleSubmitRequest = async () => {
    const vehicleValidation = validateBulkVehicles(selectedVehicles);
    if (!vehicleValidation.valid) {
      showToast(vehicleValidation.message, 'error');
      return;
    }

    const driverValidation = validateDriverDetails(driverDetails);
    if (!driverValidation.valid) {
      showToast(driverValidation.message, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const requestData = {
        vehicles: selectedVehicles.map((v) => ({ vehicleNumber: v.vehicleNumber })),
        city: selectedVehicles[0].city,
        clientName: selectedVehicles[0].clientName,
        driverDetails,
      };

      console.log('Submitting request:', requestData);
      const requestId = await requestService.createRequest(requestData, user.uid);
      console.log('Request created successfully with ID:', requestId);
      showToast('Request submitted successfully!', 'success');
      
      setSelectedVehicles([]);
      setDriverDetails([]);
      
      const allRequests = await requestService.getAllRequests();
      const myRequests = allRequests.filter((r) => r.createdBy === user?.uid);
      setRequests(myRequests);
    } catch (error) {
      console.error('Detailed error:', error.code, error.message);
      showToast('Failed to submit request: ' + error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRequests = requests.filter((r) =>
    r.id.includes(searchTerm) || (r.clientName?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) return <Loader />;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Field Operator Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="dashboard-content">
        <div className="form-section">
          <h2>Create New Request</h2>

          <div className="form-group">
            <label>Select Vehicle(s)</label>
            <div className="vehicle-list">
              {vehicles.map((vehicle) => (
                <label key={vehicle.vehicleNumber} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedVehicles.some((v) => v.vehicleNumber === vehicle.vehicleNumber)}
                    onChange={() => handleVehicleSelect(vehicle)}
                  />
                  <span>
                    {vehicle.vehicleNumber} - {vehicle.clientName} ({vehicle.city})
                  </span>
                </label>
              ))}
            </div>
          </div>

          {selectedVehicles.length > 0 && (
            <div className="info-box">
              <p>
                <strong>Client:</strong> {selectedVehicles[0].clientName}
              </p>
              <p>
                <strong>City:</strong> {selectedVehicles[0].city}
              </p>
              <p>
                <strong>Selected Vehicles:</strong> {selectedVehicles.length}
              </p>
            </div>
          )}

          <div className="form-group">
            <label>LTPOC Details</label>
            {driverDetails.map((driver, index) => (
              <div key={index} className="driver-entry">
                <select
                  value={driver.vehicleNumber}
                  onChange={(e) => handleUpdateDriver(index, 'vehicleNumber', e.target.value)}
                >
                  <option value="">Select Vehicle</option>
                  {selectedVehicles.map((v) => (
                    <option key={v.vehicleNumber} value={v.vehicleNumber}>
                      {v.vehicleNumber}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="LTPOC Name"
                  value={driver.driverName}
                  onChange={(e) => handleUpdateDriver(index, 'driverName', e.target.value)}
                />
                <input
                  type="tel"
                  placeholder="LTPOC Phone"
                  value={driver.driverNumber}
                  onChange={(e) => handleUpdateDriver(index, 'driverNumber', e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleRemoveDriver(index)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleAddDriver}
            >
              + Add LTPOC
            </button>
          </div>

          <button
            className="btn btn-primary btn-block"
            onClick={handleSubmitRequest}
            disabled={submitting || selectedVehicles.length === 0}
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>

        <div className="requests-section">
          <h2>My Requests</h2>
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by request ID or client name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
                    setSelectedRequest(req);
                    setShowModal(true);
                  }}
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
            <p><strong>Vehicles:</strong> {selectedRequest.vehicles?.length || 0}</p>
            <h4>Drivers</h4>
            {selectedRequest.driverDetails?.map((driver, idx) => (
              <div key={idx} className="driver-info">
                <p>{driver.vehicleNumber}: {driver.driverName} ({driver.driverNumber})</p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
};
