import React, { useEffect, useMemo, useRef, useState } from 'react';
import { foApiService } from '../services/foApiService';
import { functionsService } from '../services/functionsService';
import { requestService } from '../services/requestService';
import { isStrictPhoneNumber, normalizePhoneNumber } from '../utils/validation';
import { showToast } from './Toast';
import type { RequestRecord, UserRef } from '../types/workflow';

type Vehicle = {
  vehicleNumber: string;
  city: string;
  clientName: string;
  isRegistered: boolean;
  isNewTrip?: boolean;
};

type VehicleFormDetails = {
  serviceType: 'FleetX' | 'WheelsEye' | '';
  vehicleAvailabilityLocation: string;
  vehicleAvailableTime: string;
  ltpocName: string;
  ltpocPhone: string;
};

type RequestFormProps = {
  user: UserRef;
  onSubmitted?: (requestId: string) => void;
};

type RhOption = {
  id: string;
  email: string;
  label: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const buildRhLabelFromEmail = (email: string) => {
  const normalized = normalizeRhEmail(email);
  if (!normalized) {
    return '';
  }

  return `RH • ${normalized}`;
};

const normalizeRhEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const mergeRhOptions = (existing: RhOption[], incoming: RhOption[]) => {
  const merged = new Map<string, RhOption>();

  [...existing, ...incoming].forEach((option) => {
    const email = String(option?.email || '').trim().toLowerCase();
    if (!email) {
      return;
    }

    merged.set(email, {
      id: option.id || email,
      email,
      label: option.label || buildRhLabelFromEmail(email),
    });
  });

  return Array.from(merged.values()).sort((left, right) => left.label.localeCompare(right.label));
};

const readRhMembersCache = (): RhOption[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem('gps.rhMembers.v1');
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry: unknown) => {
        const source = asRecord(entry);
        const email = String(source?.email || '').trim().toLowerCase();
        if (!email) {
          return null;
        }

        return {
          id: String(source?.id || email),
          email,
          label: buildRhLabelFromEmail(email),
        } as RhOption;
      })
      .filter((item): item is RhOption => item !== null);
  } catch {
    return [];
  }
};

const COMMON_CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata',
  'Pune', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Thane',
  'Bhopal', 'Visakhapatnam', 'Pimpri-Chinchwad', 'Patna', 'Vadodara', 'Ghaziabad',
  'Ludhiana', 'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot', 'Kalyan-Dombivali',
  'Vasai-Virar', 'Varanasi', 'Srinagar', 'Aurangabad', 'Dhanbad', 'Amritsar',
  'Navi Mumbai', 'Allahabad', 'Ranchi', 'Howrah', 'Coimbatore', 'Jabalpur',
  'Gwalior', 'Vijayawada', 'Jodhpur', 'Madurai', 'Raipur', 'Kota',
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
  'Fleet Partners',
];

const EMPTY_VEHICLE_DETAILS: VehicleFormDetails = {
  serviceType: '',
  vehicleAvailabilityLocation: '',
  vehicleAvailableTime: '',
  ltpocName: '',
  ltpocPhone: '',
};

const serviceMeta = {
  FleetX: { cost: 3000, refundable: 'YES', refundableClass: 'text-green-600' },
  WheelsEye: { cost: 2000, refundable: 'NO', refundableClass: 'text-red-500' },
};

export const RequestForm = ({ user, onSubmitted }: RequestFormProps) => {
  const [draftRequestId, setDraftRequestId] = useState(() => requestService.generateRequestId());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [manualCity, setManualCity] = useState('');
  const [manualClient, setManualClient] = useState('');
  const [rhOptions, setRhOptions] = useState<RhOption[]>([]);
  const [assignedRhEmail, setAssignedRhEmail] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [validatingVehicle, setValidatingVehicle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allCities, setAllCities] = useState<string[]>(COMMON_CITIES);
  const [allClients, setAllClients] = useState<string[]>(COMMON_CLIENTS);
  const [vehicleDetails, setVehicleDetails] = useState<Record<string, VehicleFormDetails>>({});
  const [rhLookupBlocked, setRhLookupBlocked] = useState(false);
  const rhLookupWarningShownRef = useRef(false);

  const selectedVehicles = useMemo(() => vehicles, [vehicles]);
  const isBulkRequestMode = selectedVehicles.length > 1;
  const selectedRhOption = useMemo(() => {
    const normalizedAssignedRhEmail = normalizeRhEmail(assignedRhEmail);
    return rhOptions.find((option) => option.email === normalizedAssignedRhEmail) || null;
  }, [rhOptions, assignedRhEmail]);
  const draftTaskLabel = `#${draftRequestId.slice(0, 8).toUpperCase()}`;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.add('fo-dashboard-no-slide');
    return () => {
      document.body.classList.remove('fo-dashboard-no-slide');
    };
  }, []);

  useEffect(() => {
    const cached = readRhMembersCache();
    if (cached.length > 0) {
      setRhOptions((prev) => mergeRhOptions(prev, cached));
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const syncAssignedRhEmail = (mergedOptions: RhOption[]) => {
      setAssignedRhEmail((currentEmail) => {
        const normalizedCurrentEmail = normalizeRhEmail(currentEmail);
        if (!mergedOptions.length) {
          return normalizedCurrentEmail;
        }

        const existing = mergedOptions.find((option) => option.email === normalizedCurrentEmail);
        return existing ? existing.email : normalizedCurrentEmail;
      });
    };

    const loadRhDirectoryFromFunctions = async (attempt = 0) => {
      try {
        const remoteDirectory = await functionsService.listRhDirectory();
        if (!active || !Array.isArray(remoteDirectory)) {
          return;
        }

        const remoteOptions = remoteDirectory
          .map((entry) => {
            const email = normalizeRhEmail(entry.email);
            if (!email) {
              return null;
            }

            return {
              id: String(entry.id || email),
              email,
              label: buildRhLabelFromEmail(email),
            } as RhOption;
          })
          .filter((option): option is RhOption => option !== null);

        if (remoteOptions.length === 0) {
          return;
        }

        setRhLookupBlocked(false);
        setRhOptions((previous) => {
          const merged = mergeRhOptions(previous, remoteOptions);
          syncAssignedRhEmail(merged);
          return merged;
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const message = String((error as Error)?.message || '');
        const retryableAuthIssue =
          attempt < 3
          && /session expired|unauthorized|token/i.test(message);

        if (retryableAuthIssue) {
          retryTimer = setTimeout(() => {
            if (active) {
              void loadRhDirectoryFromFunctions(attempt + 1);
            }
          }, 500);
          return;
        }

        console.error('RH directory function lookup failed:', error);
      }
    };

    void loadRhDirectoryFromFunctions();

    return () => {
      active = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [user?.id]);

  useEffect(() => {
    const registeredCities = vehicles.map((vehicle) => vehicle.city).filter(Boolean);
    const registeredClients = vehicles.map((vehicle) => vehicle.clientName).filter(Boolean);

    setAllCities((prev) => Array.from(new Set([...COMMON_CITIES, ...prev, ...registeredCities])));
    setAllClients((prev) => Array.from(new Set([...COMMON_CLIENTS, ...prev, ...registeredClients])));
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
    }, undefined, user.email);

    return unsubscribe;
  }, [user?.id]);

  const updateVehicleDetail = (vehicleNumber: string, field: keyof VehicleFormDetails, value: string) => {
    setVehicleDetails((prev) => ({
      ...prev,
      [vehicleNumber]: {
        ...(prev[vehicleNumber] ?? EMPTY_VEHICLE_DETAILS),
        [field]: field === 'ltpocPhone' ? normalizePhoneNumber(value) : value,
      },
    }));
  };

  const getDetails = (vehicleNumber: string) => vehicleDetails[vehicleNumber] ?? EMPTY_VEHICLE_DETAILS;

  const validateBulkLocation = () => {
    if (selectedVehicles.length <= 1) {
      return { valid: true, message: '' };
    }

    const locations = selectedVehicles.map((vehicle) => vehicle.city).filter(Boolean);
    const uniqueLocations = Array.from(new Set(locations));

    if (uniqueLocations.length > 1) {
      return {
        valid: false,
        message: `Bulk request allowed only for vehicles with same location. Found: ${uniqueLocations.join(', ')}`,
      };
    }

    return { valid: true, message: '' };
  };

  const resetForm = () => {
    if (manualCity && !allCities.includes(manualCity)) {
      setAllCities((prev) => [...prev, manualCity]);
    }

    if (manualClient && !allClients.includes(manualClient)) {
      setAllClients((prev) => [...prev, manualClient]);
    }

    setVehicles([]);
    setManualCity('');
    setManualClient('');
    setAssignedRhEmail('');
    setVehicleInput('');
    setVehicleDetails({});
    setDraftRequestId(requestService.generateRequestId());
  };

  const handleAddVehicle = async () => {
    if (!manualCity || !manualClient) {
      showToast('Please enter city and client name before adding vehicles', 'error');
      return;
    }

    const normalizedVehicle = vehicleInput.trim().toUpperCase();
    if (!normalizedVehicle) {
      showToast('Please enter a vehicle number', 'error');
      return;
    }

    if (vehicles.some((vehicle) => vehicle.vehicleNumber === normalizedVehicle)) {
      showToast('Vehicle already added to this request', 'info');
      return;
    }

    setValidatingVehicle(true);

    try {
      const validation = await foApiService.validateVehicle(normalizedVehicle);
      const nextVehicle: Vehicle = {
        vehicleNumber: validation.vehicleNumber,
        city: validation.city || manualCity,
        clientName: validation.clientName || manualClient,
        isRegistered: validation.isRegistered,
        isNewTrip: !validation.isRegistered,
      };

      setVehicles((prev) => [...prev, nextVehicle]);
      setVehicleDetails((prev) => ({
        ...prev,
        [validation.vehicleNumber]: prev[validation.vehicleNumber] ?? {
          ...EMPTY_VEHICLE_DETAILS,
          serviceType: 'FleetX',
        },
      }));
      setVehicleInput('');

      showToast(
        validation.isRegistered
          ? `Vehicle ${validation.vehicleNumber} added (Registered)`
          : `Vehicle ${validation.vehicleNumber} added as NEW TRIP`,
        validation.isRegistered ? 'success' : 'warning'
      );
    } catch {
      showToast('Failed to validate vehicle', 'error');
    } finally {
      setValidatingVehicle(false);
    }
  };

  const handleRemoveVehicle = (vehicleNumber: string) => {
    setVehicles((prev) => prev.filter((vehicle) => vehicle.vehicleNumber !== vehicleNumber));
    setVehicleDetails((prev) => {
      const next = { ...prev };
      delete next[vehicleNumber];
      return next;
    });
  };

  const handleSubmitRequest = async () => {
    const normalizedAssignedRhEmail = normalizeRhEmail(assignedRhEmail);

    if (!manualCity || !manualClient) {
      showToast('Please enter city and client name', 'error');
      return;
    }

    if (selectedVehicles.length === 0) {
      showToast('Please add at least one vehicle', 'error');
      return;
    }

    if (!normalizedAssignedRhEmail) {
      showToast('Please assign a Regional Head from database accounts.', 'error');
      return;
    }

    const isBulkRequest = isBulkRequestMode;
    const vehiclesForSubmission = isBulkRequest ? selectedVehicles : selectedVehicles.slice(0, 1);

    if (isBulkRequest && vehiclesForSubmission.length < 2) {
      showToast('Bulk request requires at least 2 vehicles.', 'error');
      return;
    }

    if (isBulkRequest) {
      const locationValidation = validateBulkLocation();
      if (!locationValidation.valid) {
        showToast(locationValidation.message, 'error');
        return;
      }
    }

    const missingVehicles = vehiclesForSubmission
      .filter((vehicle) => {
        const details = getDetails(vehicle.vehicleNumber);
        return (
          !details.serviceType ||
          !details.vehicleAvailabilityLocation.trim() ||
          !details.vehicleAvailableTime ||
          !details.ltpocName.trim() ||
          !details.ltpocPhone.trim()
        );
      })
      .map((vehicle) => vehicle.vehicleNumber);

    if (missingVehicles.length > 0) {
      showToast(`Please fill all details for vehicles: ${missingVehicles.join(', ')}`, 'error');
      return;
    }

    const invalidPhoneVehicles = vehiclesForSubmission
      .filter((vehicle) => !isStrictPhoneNumber(getDetails(vehicle.vehicleNumber).ltpocPhone))
      .map((vehicle) => vehicle.vehicleNumber);

    if (invalidPhoneVehicles.length > 0) {
      showToast(`LTPOC phone must be exactly 10 digits for: ${invalidPhoneVehicles.join(', ')}`, 'error');
      return;
    }

    setSubmitting(true);

    try {
      const vehiclesData = vehiclesForSubmission.map((vehicle) => {
        const details = getDetails(vehicle.vehicleNumber);
        return {
          vehicleNumber: vehicle.vehicleNumber,
          isNewTrip: vehicle.isNewTrip,
          serviceType: details.serviceType || 'FleetX',
          vehicleAvailabilityLocation: details.vehicleAvailabilityLocation.trim(),
          vehicleAvailableTime: details.vehicleAvailableTime,
          ltpocName: details.ltpocName.trim(),
          ltpocPhone: normalizePhoneNumber(details.ltpocPhone),
        };
      });

      const firstVehicle = vehiclesData[0];
      const singleServiceCost = firstVehicle?.serviceType === 'FleetX' ? 3000 : 2000;
      const singleVendorType = firstVehicle?.serviceType === 'FleetX' ? 'fleetx' : 'wheelseye';

      const requestData: RequestRecord = {
        vehicles: vehiclesData,
        ltpocDetails: vehiclesData.map((vehicle) => ({
          vehicleNumber: vehicle.vehicleNumber,
          ltpocName: vehicle.ltpocName,
          ltpocPhone: vehicle.ltpocPhone,
        })),
        city: manualCity,
        clientName: manualClient,
        assignedRhEmail: selectedRhOption?.email || normalizedAssignedRhEmail,
        assignedRhUserId: selectedRhOption?.id || null,
        isBulkRequest,
        vehicleCount: vehiclesData.length,
        ...(isBulkRequest
          ? {}
          : {
              serviceType: firstVehicle.serviceType,
              vendorType: singleVendorType,
              serviceCost: singleServiceCost,
              isRefundable: firstVehicle.serviceType === 'FleetX',
              vehicleAvailabilityLocation: firstVehicle.vehicleAvailabilityLocation,
              vehicleAvailableTime: firstVehicle.vehicleAvailableTime,
            }),
      };

      await requestService.createRequest(requestData, user, draftRequestId);
      showToast(
        isBulkRequest
          ? `Bulk request (${vehiclesData.length} vehicles) submitted successfully!`
          : 'Single request submitted successfully!',
        'success'
      );

      onSubmitted?.(draftRequestId);
      resetForm();
    } catch (error) {
      const errorMsg = (error as Error)?.message || 'Failed to submit request. Please try again.';
      showToast(`Error: ${errorMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const topFieldLabelClass = 'text-[12px] font-bold uppercase tracking-tight text-black';
  const compactInputClass =
    'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] leading-5 focus:ring-primary focus:border-primary hover:border-slate-300';
  const singleVehicle = selectedVehicles[0] ?? null;
  const singleDetails = singleVehicle ? getDetails(singleVehicle.vehicleNumber) : EMPTY_VEHICLE_DETAILS;
  const singleVehicleNumber = singleVehicle?.vehicleNumber || '';

  return (
    <div className="fo-request-form bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-bold text-primary leading-tight">Create Installation Request</h3>
        <span className="text-[11px] font-semibold px-2.5 py-1 bg-primary/10 text-primary rounded-full">New Task ID: {draftTaskLabel}</span>
      </div>

      <div className="p-3 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className={topFieldLabelClass}>City Location</label>
            <input
              className={compactInputClass}
              list="fo-city-options"
              placeholder="Search City..."
              type="text"
              value={manualCity}
              onChange={(event) => setManualCity(event.target.value)}
            />
            <datalist id="fo-city-options">
              {allCities.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1">
            <label className={topFieldLabelClass}>Client Name</label>
            <input
              className={compactInputClass}
              list="fo-client-options"
              placeholder="Enter corporate client name"
              type="text"
              value={manualClient}
              onChange={(event) => setManualClient(event.target.value)}
            />
            <datalist id="fo-client-options">
              {allClients.map((client) => (
                <option key={client} value={client} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1">
            <label className={topFieldLabelClass}>Assign Regional Head (RH)</label>
            <input
              className={compactInputClass}
              list="fo-rh-options"
              placeholder={rhOptions.length > 0 ? 'Search RH email...' : 'Enter RH email'}
              type="text"
              value={assignedRhEmail}
              onChange={(event) => setAssignedRhEmail(event.target.value)}
            />
            <datalist id="fo-rh-options">
              {rhOptions.map((option) => (
                <option key={option.id} value={option.email} />
              ))}
            </datalist>
            {rhLookupBlocked && rhOptions.length === 0 ? (
              <p className="text-[11px] leading-tight text-amber-700">Live RH directory could not load right now. Manual RH email is enabled.</p>
            ) : null}
            {!rhLookupBlocked && rhOptions.length === 0 ? (
              <p className="text-[11px] leading-tight text-amber-700">No RH accounts found in database yet. Please create RH accounts first.</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[16px] font-bold uppercase tracking-tight text-primary block">Vehicle Number</label>
          <div className="flex gap-2">
            <input
              className={compactInputClass}
              placeholder="e.g. MH-12-AB-1234"
              type="text"
              value={vehicleInput}
              onChange={(event) => setVehicleInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddVehicle();
                }
              }}
            />
            <button
              className="h-9 px-4 bg-slate-900 text-white rounded-lg font-bold text-[13px] hover:bg-black flex items-center"
              disabled={validatingVehicle || !vehicleInput.trim() || !manualCity || !manualClient}
              onClick={handleAddVehicle}
              type="button"
            >
              {validatingVehicle ? 'VALIDATING...' : 'ADD'}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-lg border border-dashed border-slate-200 min-h-9">
            {selectedVehicles.length === 0 ? (
              <span className="text-[12px] text-slate-400">Added vehicles will appear here.</span>
            ) : (
              selectedVehicles.map((vehicle) => (
                <div key={vehicle.vehicleNumber} className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 text-[11px] leading-none font-mono font-bold shadow-sm">
                  <span>{vehicle.vehicleNumber}</span>
                  {vehicle.isNewTrip ? <span className="text-primary text-[9px] font-black">NEW</span> : null}
                  <button className="text-slate-400 hover:text-red-500 leading-none" onClick={() => handleRemoveVehicle(vehicle.vehicleNumber)} type="button">
                    <span className="material-symbols-outlined text-xs">close</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {isBulkRequestMode ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {selectedVehicles.map((vehicle) => {
                const details = getDetails(vehicle.vehicleNumber);

                return (
                  <div key={vehicle.vehicleNumber} className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/30 shadow-sm">
                    <div className="bg-slate-100 px-3 py-2 border-b border-slate-200">
                      <h4 className="text-[12px] font-bold text-black uppercase tracking-tight">
                        Operational Details: <span className="text-primary">{vehicle.vehicleNumber}</span>
                        {vehicle.isNewTrip ? <span className="ml-1.5 text-[10px] text-primary">NEW TRIP</span> : null}
                      </h4>
                    </div>

                    <div className="p-3 space-y-3">
                      <div className="space-y-2">
                        <label className="text-[12px] font-bold uppercase tracking-tight text-primary">Service Type</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['FleetX', 'WheelsEye'] as const).map((service) => {
                            const meta = serviceMeta[service];
                            const isSelected = (details.serviceType || 'FleetX') === service;

                            return (
                              <label key={service} className="cursor-pointer">
                                <input
                                  checked={isSelected}
                                  className="hidden peer"
                                  name={`service-${vehicle.vehicleNumber}`}
                                  onChange={() => updateVehicleDetail(vehicle.vehicleNumber, 'serviceType', service)}
                                  type="radio"
                                />
                                <div
                                  className={`h-full rounded-lg border p-2 shadow-sm ${
                                    isSelected
                                      ? 'border-primary bg-orange-50 ring-1 ring-primary/35'
                                      : 'border-slate-200 bg-white hover:border-primary/50'
                                  }`}
                                >
                                  <p className={`mb-1 text-[12px] font-bold leading-tight ${isSelected ? 'text-primary' : 'text-black'}`}>{service}</p>
                                  <div className="space-y-0.5 text-[11px] text-slate-600 leading-tight">
                                    <div className="flex justify-between">
                                      <span>Cost:</span>
                                      <span className="font-bold text-black">₹{meta.cost}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Refundable:</span>
                                      <span className={`font-bold ${meta.refundableClass}`}>{meta.refundable}</span>
                                    </div>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[12px] font-bold uppercase tracking-tight text-primary">Availability Location</label>
                          <input
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:ring-primary"
                            placeholder="Enter Depot/Site"
                            type="text"
                            value={details.vehicleAvailabilityLocation}
                            onChange={(event) => updateVehicleDetail(vehicle.vehicleNumber, 'vehicleAvailabilityLocation', event.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[12px] font-bold uppercase tracking-tight text-primary">Available Time</label>
                          <input
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:ring-primary"
                            type="datetime-local"
                            value={details.vehicleAvailableTime}
                            onChange={(event) => updateVehicleDetail(vehicle.vehicleNumber, 'vehicleAvailableTime', event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[12px] font-bold uppercase tracking-tight text-primary">LPTOC Details</label>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold uppercase text-black">LPTOC Name</label>
                            <input
                              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px]"
                              placeholder="Name"
                              type="text"
                              value={details.ltpocName}
                              onChange={(event) => updateVehicleDetail(vehicle.vehicleNumber, 'ltpocName', event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold uppercase text-black">Phone Number</label>
                            <input
                              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px]"
                              inputMode="numeric"
                              maxLength={10}
                              pattern="[0-9]{10}"
                              placeholder="Phone"
                              type="tel"
                              value={details.ltpocPhone}
                              onChange={(event) => updateVehicleDetail(vehicle.vehicleNumber, 'ltpocPhone', event.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-6">
                <label className="block text-[17px] font-bold uppercase tracking-tight text-primary">Service Type</label>

                <div className="grid grid-cols-2 gap-2">
                  {(['FleetX', 'WheelsEye'] as const).map((service) => {
                    const meta = serviceMeta[service];
                    const isSelected = (singleDetails.serviceType || 'FleetX') === service;

                    return (
                      <label
                        key={service}
                        className={`group ${singleVehicle ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                      >
                        <input
                          checked={isSelected}
                          className="peer sr-only"
                          name="single-service-type"
                          onChange={() => {
                            if (singleVehicle) {
                              updateVehicleDetail(singleVehicle.vehicleNumber, 'serviceType', service);
                            }
                          }}
                          type="radio"
                          disabled={!singleVehicle}
                        />
                        <div
                          className={`h-full rounded-lg border p-3 text-left shadow-sm ${
                            isSelected
                              ? 'border-primary bg-orange-50 ring-1 ring-primary/35'
                              : 'border-slate-200 bg-white hover:border-primary/50'
                          }`}
                        >
                          <p className={`mb-1 text-[13px] font-bold leading-tight ${isSelected ? 'text-primary' : 'text-black'}`}>{service}</p>
                          <div className="space-y-0.5 text-[11px] font-medium text-slate-600 leading-tight">
                            <div className="flex justify-between">
                              <span>Cost:</span>
                              <span className="font-bold text-black">₹{meta.cost}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Refundable:</span>
                              <span className={`font-bold uppercase ${meta.refundableClass}`}>{meta.refundable}</span>
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1 lg:col-span-3">
                <label className="text-[12px] font-bold uppercase tracking-tight text-black">Availability Location</label>
                <input
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:border-primary focus:ring-primary disabled:text-slate-400"
                  placeholder="Enter Depot/Site"
                  type="text"
                  value={singleDetails.vehicleAvailabilityLocation}
                  onChange={(event) => {
                    if (singleVehicle) {
                      updateVehicleDetail(singleVehicle.vehicleNumber, 'vehicleAvailabilityLocation', event.target.value);
                    }
                  }}
                  disabled={!singleVehicle}
                />
              </div>

              <div className="space-y-1 lg:col-span-3">
                <label className="text-[12px] font-bold uppercase tracking-tight text-black">Available Time</label>
                <input
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:border-primary focus:ring-primary disabled:text-slate-400"
                  type="datetime-local"
                  value={singleDetails.vehicleAvailableTime}
                  onChange={(event) => {
                    if (singleVehicle) {
                      updateVehicleDetail(singleVehicle.vehicleNumber, 'vehicleAvailableTime', event.target.value);
                    }
                  }}
                  disabled={!singleVehicle}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[16px] font-bold uppercase tracking-tight text-primary">LPTOC Details</label>
                <button
                  className="text-[11px] font-bold uppercase tracking-tight text-primary hover:underline disabled:text-slate-400"
                  disabled={!singleVehicle}
                  type="button"
                >
                  ADD ROW
                </button>
              </div>

              <div>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-[12px] font-bold uppercase tracking-tight text-slate-900">Vehicle Number</th>
                      <th className="px-3 py-2 text-[12px] font-bold uppercase tracking-tight text-slate-900">LPTOC Name</th>
                      <th className="px-3 py-2 text-[12px] font-bold uppercase tracking-tight text-slate-900">Phone Number</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-3 py-2">
                        <select
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 disabled:text-slate-400"
                          value={singleVehicleNumber}
                          disabled={!singleVehicle}
                          onChange={() => {}}
                        >
                          {selectedVehicles.map((vehicle) => (
                            <option key={vehicle.vehicleNumber} value={vehicle.vehicleNumber}>
                              {vehicle.vehicleNumber}
                            </option>
                          ))}
                          {!singleVehicle ? <option value="">Vehicle Number</option> : null}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:border-primary focus:ring-primary disabled:text-slate-400"
                          type="text"
                          placeholder="Name"
                          value={singleDetails.ltpocName}
                          onChange={(event) => {
                            if (singleVehicle) {
                              updateVehicleDetail(singleVehicle.vehicleNumber, 'ltpocName', event.target.value);
                            }
                          }}
                          disabled={!singleVehicle}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:border-primary focus:ring-primary disabled:text-slate-400"
                          inputMode="numeric"
                          maxLength={10}
                          pattern="[0-9]{10}"
                          type="tel"
                          placeholder="Phone"
                          value={singleDetails.ltpocPhone}
                          onChange={(event) => {
                            if (singleVehicle) {
                              updateVehicleDetail(singleVehicle.vehicleNumber, 'ltpocPhone', event.target.value);
                            }
                          }}
                          disabled={!singleVehicle}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {!singleVehicle ? (
                <p className="text-[12px] text-slate-600">Add at least one vehicle number above to enable service type, availability, and LPTOC details.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-50 px-3 py-2.5 flex items-center justify-end gap-2">
        <button className="h-9 px-5 text-slate-600 font-bold text-[13px] hover:bg-slate-100 rounded-lg" onClick={resetForm} type="button">
          CANCEL
        </button>
        <button
          className="h-9 px-6 bg-primary text-white font-bold text-[13px] rounded-lg hover:brightness-110 shadow-md shadow-primary/20 flex items-center disabled:opacity-60"
          disabled={submitting || selectedVehicles.length === 0}
          onClick={handleSubmitRequest}
          type="button"
        >
          {submitting ? 'SUBMITTING...' : 'GENERATE INSTALLATION REQUEST'}
        </button>
      </div>
    </div>
  );
};
