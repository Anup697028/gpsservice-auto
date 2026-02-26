import React, { useEffect, useMemo, useState } from 'react';
import { foApiService, type VehicleValidationResult } from '../services/foApiService';
import { requestService } from '../services/requestService';
import { validateBulkVehicles, validateDriverDetails } from '../utils/validation';
import { showToast } from './Toast';
import { SearchableDropdown } from './SearchableDropdown';
import type { RequestRecord, UserRef } from '../types/workflow';

type Vehicle = {
  vehicleNumber: string;
  city: string;
  clientName: string;
  isRegistered: boolean;
  isNewTrip?: boolean;
};

type RequestFormProps = {
  user: UserRef;
  onSubmitted?: (requestId: string) => void;
};

// Common Indian cities for the dropdown
const COMMON_CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata',
  'Pune', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Thane',
  'Bhopal', 'Visakhapatnam', 'Pimpri-Chinchwad', 'Patna', 'Vadodara', 'Ghaziabad',
  'Ludhiana', 'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot', 'Kalyan-Dombivali',
  'Vasai-Virar', 'Varanasi', 'Srinagar', 'Aurangabad', 'Dhanbad', 'Amritsar',
  'Navi Mumbai', 'Allahabad', 'Ranchi', 'Howrah', 'Coimbatore', 'Jabalpur',
  'Gwalior', 'Vijayawada', 'Jodhpur', 'Madurai', 'Raipur', 'Kota'
];

const COMMON_CLIENTS = [
  'Tech Corp',
  'Auto Fleet',
  'Logistics Hub',
  'BlueLine Transport',
  'City Cabs',
  'Metro Mobility',
  'Prime Logistics',
  'RoadStar Services',
  'Urban Transit',
  'Fleet Partners'
];

export const RequestForm = ({ user, onSubmitted }: RequestFormProps) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [manualCity, setManualCity] = useState('');
  const [destination, setDestination] = useState('');
  const [manualClient, setManualClient] = useState('');
  const [serviceType, setServiceType] = useState<'FleetX' | 'WheelsEye' | ''>('');
  const [tripFromDate, setTripFromDate] = useState('');
  const [tripFromTime, setTripFromTime] = useState('');
  const [tripToDate, setTripToDate] = useState('');
  const [tripToTime, setTripToTime] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [validatingVehicle, setValidatingVehicle] = useState(false);
  const [selectedVehicleNumbers, setSelectedVehicleNumbers] = useState<string[]>([]);
  const [driverDetails, setDriverDetails] = useState<
    Array<{ vehicleNumber: string; driverName: string; driverNumber: string }>
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [allCities, setAllCities] = useState<string[]>(COMMON_CITIES);
  const [allClients, setAllClients] = useState<string[]>(COMMON_CLIENTS);

  const handleAddVehicle = async () => {
    if (!manualCity || !destination || !manualClient) {
      showToast('Please enter city, destination, and client name before adding vehicles', 'error');
      return;
    }
    if (!vehicleInput.trim()) {
      showToast('Please enter a vehicle number', 'error');
      return;
    }

    setValidatingVehicle(true);
    try {
      const validation = await foApiService.validateVehicle(vehicleInput.trim());
      
      if (validation.isRegistered) {
        // Vehicle exists in company registry - use existing workflow
        const newVehicle: Vehicle = {
          vehicleNumber: validation.vehicleNumber,
          city: validation.city || '',
          clientName: validation.clientName || '',
          isRegistered: true,
          isNewTrip: false,
        };
        setVehicles([...vehicles, newVehicle]);
        setSelectedVehicleNumbers([...selectedVehicleNumbers, validation.vehicleNumber]);
        showToast(`Vehicle ${validation.vehicleNumber} added (Registered)`, 'success');
      } else {
        // Vehicle NOT registered - create new trip
        const newVehicle: Vehicle = {
          vehicleNumber: validation.vehicleNumber,
          city: manualCity,
          clientName: manualClient,
          isRegistered: false,
          isNewTrip: true,
        };
        setVehicles([...vehicles, newVehicle]);
        setSelectedVehicleNumbers([...selectedVehicleNumbers, validation.vehicleNumber]);
        showToast(`Vehicle ${validation.vehicleNumber} added as NEW TRIP`, 'info');
      }
      
      setVehicleInput('');
    } catch (error) {
      showToast('Failed to validate vehicle', 'error');
    } finally {
      setValidatingVehicle(false);
    }
  };

  const handleRemoveVehicle = (vehicleNumber: string) => {
    setVehicles(vehicles.filter(v => v.vehicleNumber !== vehicleNumber));
    setSelectedVehicleNumbers(selectedVehicleNumbers.filter(vn => vn !== vehicleNumber));
  };

  useEffect(() => {
    // No longer need to fetch vehicles - manual entry only
  }, []);

  // Update city and client lists when vehicles are added
  useEffect(() => {
    const registeredCities = vehicles.filter(v => v.isRegistered && v.city).map(v => v.city);
    const registeredClients = vehicles.filter(v => v.isRegistered && v.clientName).map(v => v.clientName);
    
    setAllCities(prev => Array.from(new Set([...COMMON_CITIES, ...registeredCities, ...prev])));
    setAllClients(prev => Array.from(new Set([...registeredClients, ...prev])));
  }, [vehicles]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const unsubscribe = requestService.subscribeToUserRequests(user.id, (data) => {
      const clientNames = data
        .map((item) => item.clientName)
        .filter((name): name is string => Boolean(name));
      const cityNames = data
        .map((item) => item.city)
        .filter((city): city is string => Boolean(city));

      setAllClients((prev) => Array.from(new Set([...prev, ...clientNames])));
      setAllCities((prev) => Array.from(new Set([...prev, ...cityNames])));
    });

    return unsubscribe;
  }, [user?.id]);

  const selectedVehicles = useMemo(
    () => vehicles.filter((item) => selectedVehicleNumbers.includes(item.vehicleNumber)),
    [vehicles, selectedVehicleNumbers]
  );

  const resetSelections = () => {
    setVehicles([]);
    setSelectedVehicleNumbers([]);
    setDriverDetails([]);
    
    // Add current values to history before clearing
    if (manualCity && !allCities.includes(manualCity)) {
      setAllCities(prev => [...prev, manualCity]);
    }
    if (destination && !allCities.includes(destination)) {
      setAllCities(prev => [...prev, destination]);
    }
    if (manualClient && !allClients.includes(manualClient)) {
      setAllClients(prev => [...prev, manualClient]);
    }
    
    setManualCity('');
    setDestination('');
    setManualClient('');
    setServiceType('');
    setTripFromDate('');
    setTripFromTime('');
    setTripToDate('');
    setTripToTime('');
    setVehicleInput('');
  };

  const handleAddDriver = () => {
    setDriverDetails([
      ...driverDetails,
      { vehicleNumber: '', driverName: '', driverNumber: '' },
    ]);
  };

  const handleUpdateDriver = (index: number, field: string, value: string) => {
    const updated = [...driverDetails];
    updated[index] = { ...updated[index], [field]: value };
    setDriverDetails(updated);
  };

  const handleRemoveDriver = (index: number) => {
    setDriverDetails(driverDetails.filter((_, i) => i !== index));
  };

  const handleSubmitRequest = async () => {
    if (!manualCity || !destination || !manualClient) {
      showToast('Please enter city, destination, and client name', 'error');
      return;
    }

    if (!serviceType) {
      showToast('Please select a service type (FleetX or WheelsEye)', 'error');
      return;
    }

    if (!tripFromDate || !tripFromTime || !tripToDate || !tripToTime) {
      showToast('Please enter trip from and to date/time', 'error');
      return;
    }

    if (selectedVehicles.length === 0) {
      showToast('Please add at least one vehicle', 'error');
      return;
    }

    const driverValidation = validateDriverDetails(driverDetails);
    if (!driverValidation.valid) {
      showToast(driverValidation.message, 'error');
      return;
    }

    setSubmitting(true);

    try {
      const requestId = requestService.generateRequestId();
      
      const serviceCost = serviceType === 'FleetX' ? 3000 : 2000;
      const isRefundable = serviceType === 'FleetX';
      
      const requestData: RequestRecord = {
        vehicles: selectedVehicles.map((item) => ({ 
          vehicleNumber: item.vehicleNumber,
          isNewTrip: item.isNewTrip 
        })),
        city: manualCity,
        destination,
        clientName: manualClient,
        serviceType,
        serviceCost,
        isRefundable,
        tripFromDate,
        tripFromTime,
        tripToDate,
        tripToTime,
        driverDetails,
      };

      console.log('Submitting request:', { requestId, requestData, userId: user.id });
      await requestService.createRequest(requestData, user, requestId);
      showToast('Request submitted successfully!', 'success');
      resetSelections();
      onSubmitted?.(requestId);
    } catch (error) {
      console.error('Submit error:', error);
      console.error('Error code:', (error as any)?.code);
      console.error('Error message:', (error as any)?.message);
      const errorMsg = (error as any)?.message || 'Failed to submit request. Please try again.';
      showToast(`Error: ${errorMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-section">
      <h2>Create New Request</h2>

      <SearchableDropdown
        options={allCities}
        value={manualCity}
        onChange={setManualCity}
        placeholder="Search or enter city name..."
        label="From City *"
        allowCustom={true}
      />
      <p className="text-muted" style={{ marginTop: '-0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Start typing to search from common cities or enter a custom city name
      </p>

      <SearchableDropdown
        options={allCities}
        value={destination}
        onChange={setDestination}
        placeholder="Search or enter destination..."
        label="To Destination *"
        allowCustom={true}
      />
      <p className="text-muted" style={{ marginTop: '-0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Choose the destination city or enter a custom destination
      </p>

      <SearchableDropdown
        options={allClients}
        value={manualClient}
        onChange={setManualClient}
        placeholder="Search or enter client name..."
        label="Client Name *"
        allowCustom={true}
      />
      <p className="text-muted" style={{ marginTop: '-0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Start typing to search from previous clients or enter a new client name
      </p>

      <div className="form-group">
        <label>Service Type *</label>
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value as 'FleetX' | 'WheelsEye' | '')}
        >
          <option value="">Select service type</option>
          <option value="FleetX">FleetX - ₹3,000 (Refundable)</option>
          <option value="WheelsEye">WheelsEye - ₹2,000 (Non-refundable)</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Trip From Date *</label>
          <input
            type="date"
            value={tripFromDate}
            onChange={(e) => setTripFromDate(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Trip From Time *</label>
          <input
            type="time"
            value={tripFromTime}
            onChange={(e) => setTripFromTime(e.target.value)}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Trip To Date *</label>
          <input
            type="date"
            value={tripToDate}
            onChange={(e) => setTripToDate(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Trip To Time *</label>
          <input
            type="time"
            value={tripToTime}
            onChange={(e) => setTripToTime(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Add Vehicle Number</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={vehicleInput}
            onChange={(e) => setVehicleInput(e.target.value.toUpperCase())}
            placeholder="e.g., KA-01-AB-1234"
            onKeyDown={(e) => e.key === 'Enter' && handleAddVehicle()}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAddVehicle}
            disabled={
              validatingVehicle ||
              !vehicleInput.trim() ||
              !manualCity ||
              !destination ||
              !manualClient
            }
          >
            {validatingVehicle ? 'Validating...' : 'Add Vehicle'}
          </button>
        </div>
        <p className="text-muted">
          Vehicle will be validated against company registry. If not found, a new trip will be created.
        </p>
        {!manualCity || !destination || !manualClient ? (
          <p className="text-muted">
            Please fill From City, To Destination, and Client Name to add vehicles.
          </p>
        ) : null}
      </div>

      {selectedVehicles.length > 0 && (
        <div className="info-box">
          <p><strong>Client:</strong> {manualClient}</p>
          <p><strong>City:</strong> {manualCity}</p>
          <p><strong>Destination:</strong> {destination}</p>
          <p><strong>Service:</strong> {serviceType} - ₹{serviceType === 'FleetX' ? '3,000' : '2,000'}</p>
          <p><strong>Added Vehicles:</strong></p>
          <ul>
            {selectedVehicles.map((vehicle) => (
              <li key={vehicle.vehicleNumber}>
                {vehicle.vehicleNumber} 
                {vehicle.isNewTrip ? ' (NEW TRIP)' : ' (Registered)'}{' '}
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                  onClick={() => handleRemoveVehicle(vehicle.vehicleNumber)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label>Driver Details</label>
        {driverDetails.map((driver, index) => (
          <div key={index} className="driver-entry">
            <div style={{ minWidth: '180px' }}>
              <SearchableDropdown
                options={selectedVehicles.map(v => v.vehicleNumber)}
                value={driver.vehicleNumber}
                onChange={(value) => handleUpdateDriver(index, 'vehicleNumber', value)}
                placeholder="Select vehicle..."
                allowCustom={false}
              />
            </div>
            <input
              type="text"
              placeholder="Driver Name"
              value={driver.driverName}
              onChange={(event) => handleUpdateDriver(index, 'driverName', event.target.value)}
            />
            <input
              type="tel"
              placeholder="Driver Phone"
              value={driver.driverNumber}
              onChange={(event) =>
                handleUpdateDriver(index, 'driverNumber', event.target.value)
              }
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
        <button type="button" className="btn btn-secondary" onClick={handleAddDriver}>
          + Add Driver
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
  );
};
