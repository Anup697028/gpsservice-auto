import React, { useEffect, useMemo, useState } from 'react';
import { foApiService, type VehicleValidationResult } from '../services/foApiService';
import { requestService } from '../services/requestService';
import { isStrictPhoneNumber, normalizePhoneNumber, validateBulkVehicles, validateDriverDetails } from '../utils/validation';
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
  const [manualClient, setManualClient] = useState('');
  const [serviceType, setServiceType] = useState<'FleetX' | 'WheelsEye' | ''>('');
  const [vehicleAvailabilityLocation, setVehicleAvailabilityLocation] = useState('');
  const [vehicleAvailableTime, setVehicleAvailableTime] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [validatingVehicle, setValidatingVehicle] = useState(false);
  const [selectedVehicleNumbers, setSelectedVehicleNumbers] = useState<string[]>([]);
  const [ltpocDetails, setLtpocDetails] = useState<
    Array<{ vehicleNumber: string; ltpocName: string; ltpocPhone: string }>
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [allCities, setAllCities] = useState<string[]>(COMMON_CITIES);
  const [allClients, setAllClients] = useState<string[]>(COMMON_CLIENTS);
  
  // Per-vehicle details for BULK requests
  const [bulkVehicleDetails, setBulkVehicleDetails] = useState<
    Record<string, {
      serviceType: 'FleetX' | 'WheelsEye' | '';
      vehicleAvailabilityLocation: string;
      vehicleAvailableTime: string;
      ltpocName: string;
      ltpocPhone: string;
    }>
  >({});

  const handleAddVehicle = async () => {
    if (!manualCity || !manualClient) {
      showToast('Please enter city and client name before adding vehicles', 'error');
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

  // Validate bulk selection - all vehicles must have same location
  const validateBulkLocation = () => {
    if (selectedVehicles.length <= 1) {
      return { valid: true, message: '' };
    }

    // Check if all vehicles have the same location (city)
    const locations = selectedVehicles.map(v => v.city).filter(Boolean);
    const uniqueLocations = Array.from(new Set(locations));

    if (uniqueLocations.length > 1) {
      return {
        valid: false,
        message: `Bulk request allowed only for vehicles with same location. Found: ${uniqueLocations.join(', ')}`
      };
    }

    return { valid: true, message: '' };
  };

  const resetSelections = () => {
    setVehicles([]);
    setSelectedVehicleNumbers([]);
    setLtpocDetails([]);
    
    // Add current values to history before clearing
    if (manualCity && !allCities.includes(manualCity)) {
      setAllCities(prev => [...prev, manualCity]);
    }
    
    setManualCity('');
    setManualClient('');
    setServiceType('');
    setVehicleAvailabilityLocation('');
    setVehicleAvailableTime('');
    setVehicleInput('');
  };

  const handleAddDriver = () => {
    setLtpocDetails([
      ...ltpocDetails,
      { vehicleNumber: '', ltpocName: '', ltpocPhone: '' },
    ]);
  };

  const handleUpdateDriver = (index: number, field: string, value: string) => {
    const updated = [...ltpocDetails];
    const normalizedValue = field === 'ltpocPhone' ? normalizePhoneNumber(value) : value;
    updated[index] = { ...updated[index], [field]: normalizedValue };
    setLtpocDetails(updated);
  };

  const handleRemoveDriver = (index: number) => {
    setLtpocDetails(ltpocDetails.filter((_, i) => i !== index));
  };

  const handleSubmitRequest = async () => {
    if (!manualCity || !manualClient) {
      showToast('Please enter city and client name', 'error');
      return;
    }

    if (selectedVehicles.length === 0) {
      showToast('Please add at least one vehicle', 'error');
      return;
    }

    // Determine if this is bulk request (2+ vehicles)
    const isBulkRequest = selectedVehicles.length > 1;
    const vehicleCount = selectedVehicles.length;

    // ========== VALIDATION ==========
    if (isBulkRequest) {
      // ===== BULK REQUEST VALIDATION =====
      // For bulk: all vehicles must be from the same city
      const locationValidation = validateBulkLocation();
      if (!locationValidation.valid) {
        showToast(locationValidation.message, 'error');
        return;
      }

      // For bulk: each vehicle should have its own details
      // Check that all vehicles have their fields filled
      const missingDetails = selectedVehicleNumbers.filter(vNum => {
        const details = bulkVehicleDetails[vNum];
        if (!details) return true;
        return !details.serviceType || !details.vehicleAvailabilityLocation || 
               !details.vehicleAvailableTime || !details.ltpocName || !details.ltpocPhone;
      });

      if (missingDetails.length > 0) {
        showToast(`Please fill all details for vehicles: ${missingDetails.join(', ')}`, 'error');
        return;
      }

      // Fix #3: strict 10-digit phone validation for each bulk vehicle.
      const invalidPhoneVehicles = selectedVehicleNumbers.filter((vehicleNumber) => {
        const phone = normalizePhoneNumber(bulkVehicleDetails[vehicleNumber]?.ltpocPhone || '');
        return !isStrictPhoneNumber(phone);
      });

      if (invalidPhoneVehicles.length > 0) {
        showToast(`LTPOC phone must be exactly 10 digits for: ${invalidPhoneVehicles.join(', ')}`, 'error');
        return;
      }
    } else {
      // ===== SINGLE REQUEST VALIDATION =====
      // For single: require serviceType, location, time (legacy fields)
      if (!serviceType) {
        showToast('Please select a service type (FleetX or WheelsEye)', 'error');
        return;
      }

      if (!vehicleAvailabilityLocation || !vehicleAvailableTime) {
        showToast('Please enter vehicle availability location and time', 'error');
        return;
      }

      // Validate LTPOC details for single request
      const driverValidation = validateDriverDetails(ltpocDetails);
      if (!driverValidation.valid) {
        showToast(driverValidation.message, 'error');
        return;
      }
    }

    setSubmitting(true);

    try {
      const requestId = requestService.generateRequestId();

      // Build vehicles array with per-vehicle details for bulk
      let vehiclesData;
      if (isBulkRequest) {
        // Bulk: include per-vehicle details in vehicles array
        vehiclesData = selectedVehicles.map((v) => {
          const details = bulkVehicleDetails[v.vehicleNumber];
          return {
            vehicleNumber: v.vehicleNumber,
            isNewTrip: v.isNewTrip,
            serviceType: details?.serviceType || ('FleetX' as const),
            vehicleAvailabilityLocation: details?.vehicleAvailabilityLocation || '',
            vehicleAvailableTime: details?.vehicleAvailableTime || '',
            ltpocName: details?.ltpocName || '',
            ltpocPhone: normalizePhoneNumber(details?.ltpocPhone || ''),
          };
        });
      } else {
        // Single: use legacy structure
        vehiclesData = selectedVehicles.map((item) => ({
          vehicleNumber: item.vehicleNumber,
          isNewTrip: item.isNewTrip,
        }));
      }

      const serviceCost = serviceType === 'FleetX' ? 3000 : 2000;
      const isRefundable = serviceType === 'FleetX';
      const vendorType = serviceType === 'FleetX' ? 'fleetx' : 'wheelseye';

      // Log bulk operation for audit trail
      if (isBulkRequest) {
        console.log(`Creating PARALLEL BULK request: ${vehicleCount} vehicles`);
      }

      const baseRequestData: RequestRecord = {
        // Vehicle data
        vehicles: vehiclesData,
        city: manualCity,
        clientName: manualClient,

        // Bulk tracking
        isBulkRequest,
        vehicleCount,
      };

      const singleRequestData: Partial<RequestRecord> = isBulkRequest
        ? {}
        : {
            serviceType: serviceType as 'FleetX' | 'WheelsEye',
            vendorType,
            serviceCost,
            isRefundable,
            vehicleAvailabilityLocation,
            vehicleAvailableTime,
            // Fix #3: persist only normalized 10-digit phones.
            ltpocDetails: ltpocDetails.map((ltpoc) => ({
              ...ltpoc,
              ltpocPhone: normalizePhoneNumber(ltpoc.ltpocPhone),
            })),
          };

      const requestData: RequestRecord = {
        ...baseRequestData,
        ...singleRequestData,
      };

      console.log('Submitting request:', { requestId, requestData, userId: user.id });
      await requestService.createRequest(requestData, user, requestId);

      const requestType = isBulkRequest ? 'Bulk request' : 'Single request';
      showToast(`${requestType} submitted successfully!`, 'success');
      resetSelections();
      setBulkVehicleDetails({});
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

      <div className="form-group">
        <label>From City *</label>
        <input
          type="text"
          value={manualCity}
          onChange={(e) => setManualCity(e.target.value)}
          placeholder="Enter city name..."
        />
      </div>

      <div className="form-group">
        <label>Client Name *</label>
        <input
          type="text"
          value={manualClient}
          onChange={(e) => setManualClient(e.target.value)}
          placeholder="Enter client name..."
        />
      </div>

      {/* SERVICE & LOCATION UI - CONDITIONAL BASED ON REQUEST TYPE */}
      {selectedVehicles.length <= 1 ? (
        // ===== SINGLE REQUEST UI =====
        <>
          <div className="form-group">
            <label>Service Type *</label>
            <div className="service-selector">
              <button
                type="button"
                className={`service-button ${serviceType === 'FleetX' ? 'active' : ''}`}
                onClick={() => setServiceType('FleetX')}
              >
                <div className="service-name">FleetX</div>
                <div className="service-price">₹3,000</div>
                <div className="service-badge">Refundable</div>
              </button>
              <button
                type="button"
                className={`service-button ${serviceType === 'WheelsEye' ? 'active' : ''}`}
                onClick={() => setServiceType('WheelsEye')}
              >
                <div className="service-name">WheelsEye</div>
                <div className="service-price">₹2,000</div>
                <div className="service-badge">Non-refundable</div>
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Vehicle Availability Location *</label>
              <input
                type="text"
                value={vehicleAvailabilityLocation}
                onChange={(e) => setVehicleAvailabilityLocation(e.target.value)}
                placeholder="Enter location where vehicle is available"
              />
            </div>
            <div className="form-group">
              <label>Vehicle Available Time *</label>
              <input
                type="time"
                value={vehicleAvailableTime}
                onChange={(e) => setVehicleAvailableTime(e.target.value)}
              />
            </div>
          </div>
        </>
      ) : (
        // ===== BULK REQUEST PER-VEHICLE UI =====
        <div style={{ 
          backgroundColor: '#f5f5f5', 
          border: '2px solid #1976d2',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <h3 style={{ marginTop: 0, color: '#1565c0' }}>
            Per-Vehicle Details ({selectedVehicles.length} Vehicles)
          </h3>
          <p style={{ color: '#666', fontSize: '0.95rem', marginBottom: '16px' }}>
            Customize service type, location, time, and LTPOC for each vehicle
          </p>

          {selectedVehicles.map((vehicle) => {
            const details = bulkVehicleDetails[vehicle.vehicleNumber] || {
              serviceType: '',
              vehicleAvailabilityLocation: '',
              vehicleAvailableTime: '',
              ltpocName: '',
              ltpocPhone: '',
            };

            return (
              <div
                key={vehicle.vehicleNumber}
                style={{
                  backgroundColor: '#fff',
                  border: '1px solid #ddd',
                  padding: '14px',
                  borderRadius: '6px',
                  marginBottom: '12px',
                }}
              >
                {/* Vehicle Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  paddingBottom: '10px',
                  borderBottom: '1px solid #eee',
                }}>
                  <strong style={{ fontSize: '1rem', color: '#333' }}>
                    {vehicle.vehicleNumber}
                    {vehicle.isNewTrip && <span style={{ color: '#d32f2f', marginLeft: '8px' }}>● NEW</span>}
                  </strong>
                </div>

                {/* Service Type */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '500', color: '#333' }}>
                    Service Type *
                  </label>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkVehicleDetails({
                          ...bulkVehicleDetails,
                          [vehicle.vehicleNumber]: {
                            ...details,
                            serviceType: 'FleetX',
                          },
                        })
                      }
                      style={{
                        flex: 1,
                        padding: '10px',
                        border: `2px solid ${details.serviceType === 'FleetX' ? '#1976d2' : '#ddd'}`,
                        backgroundColor: details.serviceType === 'FleetX' ? '#e3f2fd' : '#fff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: details.serviceType === 'FleetX' ? '600' : '400',
                        color: details.serviceType === 'FleetX' ? '#1565c0' : '#333',
                      }}
                    >
                      FleetX (₹3k)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkVehicleDetails({
                          ...bulkVehicleDetails,
                          [vehicle.vehicleNumber]: {
                            ...details,
                            serviceType: 'WheelsEye',
                          },
                        })
                      }
                      style={{
                        flex: 1,
                        padding: '10px',
                        border: `2px solid ${details.serviceType === 'WheelsEye' ? '#1976d2' : '#ddd'}`,
                        backgroundColor: details.serviceType === 'WheelsEye' ? '#e3f2fd' : '#fff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: details.serviceType === 'WheelsEye' ? '600' : '400',
                        color: details.serviceType === 'WheelsEye' ? '#1565c0' : '#333',
                      }}
                    >
                      WheelsEye (₹2k)
                    </button>
                  </div>
                </div>

                {/* Location */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '500', color: '#333', display: 'block' }}>
                    Availability Location *
                  </label>
                  <input
                    type="text"
                    value={details.vehicleAvailabilityLocation}
                    onChange={(e) =>
                      setBulkVehicleDetails({
                        ...bulkVehicleDetails,
                        [vehicle.vehicleNumber]: {
                          ...details,
                          vehicleAvailabilityLocation: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g., Pune Main Depot"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '6px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                    }}
                  />
                </div>

                {/* Time */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '500', color: '#333', display: 'block' }}>
                    Available Time *
                  </label>
                  <input
                    type="time"
                    value={details.vehicleAvailableTime}
                    onChange={(e) =>
                      setBulkVehicleDetails({
                        ...bulkVehicleDetails,
                        [vehicle.vehicleNumber]: {
                          ...details,
                          vehicleAvailableTime: e.target.value,
                        },
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '6px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                    }}
                  />
                </div>

                {/* LTPOC Name */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '500', color: '#333', display: 'block' }}>
                    LTPOC Name *
                  </label>
                  <input
                    type="text"
                    value={details.ltpocName}
                    onChange={(e) =>
                      setBulkVehicleDetails({
                        ...bulkVehicleDetails,
                        [vehicle.vehicleNumber]: {
                          ...details,
                          ltpocName: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g., Raj Kumar"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '6px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                    }}
                  />
                </div>

                {/* LTPOC Phone */}
                <div>
                  <label style={{ fontSize: '0.9rem', fontWeight: '500', color: '#333', display: 'block' }}>
                    LTPOC Phone *
                  </label>
                  <input
                    type="tel"
                    value={details.ltpocPhone}
                    onChange={(e) =>
                      setBulkVehicleDetails({
                        ...bulkVehicleDetails,
                        [vehicle.vehicleNumber]: {
                          ...details,
                          ltpocPhone: normalizePhoneNumber(e.target.value),
                        },
                      })
                    }
                    placeholder="10-digit phone number"
                    maxLength={10}
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '6px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'inherit',
                      fontSize: '0.95rem',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
              !manualClient
            }
          >
            {validatingVehicle ? 'Validating...' : 'Add Vehicle'}
          </button>
        </div>
        <p className="text-muted">
          Vehicle will be validated against company registry. If not found, a new trip will be created.
        </p>
        {!manualCity || !manualClient ? (
          <p className="text-muted">
            Please fill From City and Client Name to add vehicles.
          </p>
        ) : null}
      </div>

      {selectedVehicles.length > 0 && (
        <div className="info-box">
          <h3>Request Summary</h3>
          <p><strong>Client:</strong> {manualClient}</p>
          <p><strong>City:</strong> {manualCity}</p>
          <p><strong>Service:</strong> {serviceType} - ₹{serviceType === 'FleetX' ? '3,000' : '2,000'}</p>
          
          {/* Bulk Request Indicator */}
          {selectedVehicles.length > 1 && (
            <div style={{ 
              backgroundColor: '#e3f2fd', 
              border: '2px solid #1976d2',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '10px'
            }}>
              <strong style={{ color: '#1565c0' }}>
                🚗 Bulk Request ({selectedVehicles.length} Vehicles)
              </strong>
            </div>
          )}
          
          <p><strong>Selected Vehicles ({selectedVehicles.length}):</strong></p>
          <ul>
            {selectedVehicles.map((vehicle) => (
              <li key={vehicle.vehicleNumber} style={{ marginBottom: '6px' }}>
                <strong>{vehicle.vehicleNumber}</strong>
                {vehicle.isNewTrip ? ' (NEW TRIP)' : ' (Registered)'} 
                <span style={{ color: '#999', marginLeft: '8px' }}>
                  Location: {vehicle.city}
                </span>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ fontSize: '0.8rem', padding: '2px 8px', marginLeft: '8px' }}
                  onClick={() => handleRemoveVehicle(vehicle.vehicleNumber)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LTPOC DETAILS - ONLY FOR SINGLE REQUESTS */}
      {selectedVehicles.length <= 1 && (
        <div className="form-group">
          <label>LTPOC Details</label>
          {ltpocDetails.map((ltpoc, index) => (
            <div key={index} className="driver-entry">
              <div style={{ minWidth: '180px' }}>
                <SearchableDropdown
                  options={selectedVehicles.map(v => v.vehicleNumber)}
                  value={ltpoc.vehicleNumber}
                  onChange={(value) => handleUpdateDriver(index, 'vehicleNumber', value)}
                  placeholder="Select vehicle..."
                  allowCustom={false}
                />
              </div>
              <input
                type="text"
                placeholder="LTPOC Name"
                value={ltpoc.ltpocName}
                onChange={(event) => handleUpdateDriver(index, 'ltpocName', event.target.value)}
              />
              <input
                type="tel"
                placeholder="LTPOC Phone"
                value={ltpoc.ltpocPhone}
                maxLength={10}
                inputMode="numeric"
                pattern="[0-9]{10}"
                onChange={(event) =>
                  handleUpdateDriver(index, 'ltpocPhone', event.target.value)
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
            + Add LTPOC
          </button>
        </div>
      )}

      <button
        className="btn btn-primary btn-block"
        onClick={handleSubmitRequest}
        disabled={submitting || selectedVehicles.length === 0}
      >
        {submitting ? 'Submitting...' : selectedVehicles.length > 1 ? `Create Bulk Request (${selectedVehicles.length} Vehicles)` : 'Submit Request'}
      </button>
    </div>
  );
};
