import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  runTransaction,
  startAfter,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  WORKFLOW_ACTIONS,
  REQUEST_STATUSES,
  type RequestRecord,
  type UserRef,
  type WorkflowAction,
  type WorkflowOptionalData,
} from '../types/workflow';
import { updateRequestState } from './workflowService';

const REQUESTS_COLLECTION = 'requests';

const mapSnapshot = (snapshot: { docs: Array<{ id: string; data: () => unknown }> }) =>
  snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Record<string, unknown>) }));

const normalizePhoneForStorage = (value: unknown) => String(value || '').replace(/\D/g, '').slice(0, 10);

const ensureStrictPhoneIfPresent = (value: unknown, fieldName: string) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return raw;
  }

  const normalized = normalizePhoneForStorage(raw);
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error(`${fieldName} must be exactly 10 digits.`);
  }

  return normalized;
};

// Fix #3: centralize phone cleanup/validation so all write paths (including import/CSV flows) store only strict 10-digit numbers.
const sanitizeRequestPhoneFields = (requestData: RequestRecord): RequestRecord => {
  const sanitizedVehicles = (requestData.vehicles ?? []).map((vehicle) => ({
    ...vehicle,
    ltpocPhone: ensureStrictPhoneIfPresent(vehicle?.ltpocPhone, `LTPOC phone for vehicle ${vehicle?.vehicleNumber || ''}`),
  }));

  const sanitizedLtpocDetails = (requestData.ltpocDetails ?? []).map((ltpoc) => ({
    ...ltpoc,
    ltpocPhone: ensureStrictPhoneIfPresent(ltpoc?.ltpocPhone, `LTPOC phone for vehicle ${ltpoc?.vehicleNumber || ''}`),
  }));

  return {
    ...requestData,
    vehicles: sanitizedVehicles,
    ltpocDetails: sanitizedLtpocDetails,
  };
};

const updateRequestWithWorkflow = async (
  requestId: string,
  action: WorkflowAction,
  user: UserRef,
  optionalData?: WorkflowOptionalData
) => {
  const docRef = doc(db, REQUESTS_COLLECTION, requestId);
  const currentDoc = await getDoc(docRef);

  if (!currentDoc.exists()) {
    throw new Error('Request not found.');
  }

  const currentData = currentDoc.data() as RequestRecord;
  const { updates, historyEntry } = updateRequestState(currentData, action, user, optionalData);

  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
    history: arrayUnion(historyEntry),
  });
};

export const requestService = {
  generateRequestId: () => {
    const docRef = doc(collection(db, REQUESTS_COLLECTION));
    return docRef.id;
  },
  createRequest: async (
    requestData: RequestRecord,
    user: UserRef,
    requestId?: string
  ) => {
    try {
      const sanitizedRequestData = sanitizeRequestPhoneFields(requestData);
      console.log('createRequest called with:', { user, requestId, isBulkRequest: requestData.isBulkRequest });
      
      // Pass isBulkRequest flag so workflow service can set correct initial status
      const { updates, historyEntry } = updateRequestState(
        null, 
        WORKFLOW_ACTIONS.CREATE, 
        user,
        { isBulkRequest: sanitizedRequestData.isBulkRequest }
      );

      if (requestId) {
        console.log('Using provided requestId:', requestId);
        const docRef = doc(db, REQUESTS_COLLECTION, requestId);
        const docData = {
          id: docRef.id,
          ...sanitizedRequestData,
          ...updates,
          createdBy: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          history: [historyEntry] as any,
        };
        console.log('Writing document:', docData);
        await setDoc(docRef, docData);
        return docRef.id;
      }

      const docData = {
        id: requestId ?? undefined,
        ...sanitizedRequestData,
        ...updates,
        createdBy: user.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        history: [historyEntry] as any,
      };
      console.log('Adding document:', docData);
      const docRef = await addDoc(collection(db, REQUESTS_COLLECTION), docData);

      if (!requestId) {
        await updateDoc(docRef, { id: docRef.id });
      }

      return docRef.id;
    } catch (error) {
      console.error('Error in createRequest:', {
        error,
        errorCode: (error as any)?.code,
        errorMessage: (error as any)?.message,
        user,
      });
      throw error;
    }
  },

  getRequestById: async (requestId: string) => {
    const docRef = doc(db, REQUESTS_COLLECTION, requestId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) };
    }
    return null;
  },

  getAllRequests: async () => {
    const q = query(collection(db, REQUESTS_COLLECTION));
    const querySnapshot = await getDocs(q);
    return mapSnapshot(querySnapshot);
  },

  getRequestsByStatus: async (status: string) => {
    const q = query(collection(db, REQUESTS_COLLECTION), where('status', '==', status));
    const querySnapshot = await getDocs(q);
    return mapSnapshot(querySnapshot);
  },

  subscribeToRequests: (status: string, callback: (requests: RequestRecord[]) => void) => {
    const q = query(collection(db, REQUESTS_COLLECTION), where('status', '==', status));
    return onSnapshot(q, (snapshot) => {
      callback(mapSnapshot(snapshot) as RequestRecord[]);
    });
  },

  subscribeToUserRequests: (userId: string, callback: (requests: RequestRecord[]) => void) => {
    const q = query(collection(db, REQUESTS_COLLECTION), where('createdBy', '==', userId));
    return onSnapshot(q, (snapshot) => {
      callback(mapSnapshot(snapshot) as RequestRecord[]);
    });
  },

  subscribeToAllRequests: (callback: (requests: RequestRecord[]) => void) => {
    const q = query(collection(db, REQUESTS_COLLECTION), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      callback(mapSnapshot(snapshot) as RequestRecord[]);
    });
  },

  getPaginatedRequests: async (
    status: string,
    pageSize: number,
    lastCreatedAt?: unknown
  ) => {
    const baseQuery = query(
      collection(db, REQUESTS_COLLECTION),
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );

    const pagedQuery = lastCreatedAt
      ? query(
          collection(db, REQUESTS_COLLECTION),
          where('status', '==', status),
          orderBy('createdAt', 'desc'),
          startAfter(lastCreatedAt),
          limit(pageSize)
        )
      : baseQuery;

    const snapshot = await getDocs(pagedQuery);
    const requests = mapSnapshot(snapshot) as RequestRecord[];
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    return { requests, lastCreatedAt: lastDoc?.data()?.createdAt ?? null };
  },

  getRhPendingRequests: async () => {
    // RH can review all FO requests regardless of approval state
    const q = query(
      collection(db, REQUESTS_COLLECTION),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return mapSnapshot(querySnapshot);
  },

  getVendorApprovedRequests: async (
    vendorApprovedBy: string,
    fromDate: Date,
    toDate: Date
  ) => {
    const q = query(
      collection(db, REQUESTS_COLLECTION),
      where('vendorApprovedBy', '==', vendorApprovedBy)
    );
    const querySnapshot = await getDocs(q);
    return mapSnapshot(querySnapshot);
  },

  getPaymentPendingRequests: async () => {
    const q = query(
      collection(db, REQUESTS_COLLECTION),
      where('status', '==', REQUEST_STATUSES.PARALLEL_REVIEW),
      where('paymentApproval', '==', false)
    );
    const querySnapshot = await getDocs(q);
    return mapSnapshot(querySnapshot);
  },

  approveRequest: async (requestId: string, user: UserRef, role: 'RH' | 'PAYMENT') => {
    const action = role === 'RH' ? WORKFLOW_ACTIONS.RH_APPROVE : WORKFLOW_ACTIONS.PAYMENT_APPROVE;
    await updateRequestWithWorkflow(requestId, action, user);
  },

  rejectRequest: async (
    requestId: string,
    user: UserRef,
    role: 'RH' | 'PAYMENT',
    rejectionReason: string
  ) => {
    const action = role === 'RH' ? WORKFLOW_ACTIONS.RH_REJECT : WORKFLOW_ACTIONS.PAYMENT_REJECT;
    await updateRequestWithWorkflow(requestId, action, user, { rejectionReason });
  },

  editAndApprove: async (
    requestId: string,
    updatedData: Record<string, unknown>,
    user: UserRef,
    role: 'RH' | 'PAYMENT'
  ) => {
    const action =
      role === 'RH'
        ? WORKFLOW_ACTIONS.RH_EDIT_APPROVE
        : WORKFLOW_ACTIONS.PAYMENT_EDIT_APPROVE;
    await updateRequestWithWorkflow(requestId, action, user, { updates: updatedData });
  },

  bulkApprove: async (requestIds: string[], user: UserRef) => {
    let updatedCount = 0;

    for (const requestId of requestIds) {
      const docRef = doc(db, REQUESTS_COLLECTION, requestId);
      const snapshot = await getDoc(docRef);

      if (!snapshot.exists()) {
        continue;
      }

      const currentData = snapshot.data() as RequestRecord;
      
      // Skip if already approved or action already taken
      if (currentData.rhApproval || currentData.rhActionTaken) {
        continue;
      }

      const status = currentData.status ?? null;
      
      // RH compliance approval can be applied before/after payment/vendor progression.
      if (
        status !== REQUEST_STATUSES.PARALLEL_REVIEW &&
        status !== REQUEST_STATUSES.VENDOR_COORDINATION &&
        status !== REQUEST_STATUSES.COMPLETED
      ) {
        console.warn(
          `Skipping request ${docRef.id}: status is ${status}, must be PARALLEL_REVIEW, VENDOR_COORDINATION, or COMPLETED`
        );
        continue;
      }

      try {
        await updateRequestWithWorkflow(docRef.id, WORKFLOW_ACTIONS.RH_APPROVE, user);
        updatedCount += 1;
      } catch (error) {
        console.warn(`Skipping request ${docRef.id}: unable to approve in bulk`, error);
      }
    }

    return updatedCount;
  },

  notifyVendor: async (requestId: string, vendorName: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.VENDOR_NOTIFY, user, {
      vendorName,
      notes: `Vendor ${vendorName} notified`,
    });

    const docRef = doc(db, REQUESTS_COLLECTION, requestId);
    await updateDoc(docRef, {
      vendorName,
      vendorNotified: true,
      vendorActionTaken: true,
      approvedByVendor: true,
      notifiedAt: serverTimestamp(),
      notificationTimestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  bulkVendorApprove: async (requestIds: string[], user: UserRef) => {
    const batch = writeBatch(db);
    let updatedCount = 0;

    const docs = await Promise.all(
      requestIds.map(async (requestId) => {
        const docRef = doc(db, REQUESTS_COLLECTION, requestId);
        const snapshot = await getDoc(docRef);
        return { docRef, snapshot };
      })
    );

    docs.forEach(({ docRef, snapshot }) => {
      if (!snapshot.exists()) {
        return;
      }

      const currentData = snapshot.data() as RequestRecord;
      
      // Skip if already approved by vendor or action already taken
      if (currentData.approvedByVendor || currentData.vendorActionTaken) {
        return;
      }

      // Create history entry for vendor approval
      const historyEntry = {
        userId: user.id,
        userName: user.email || user.name || 'Vendor',
        role: user.role,
        action: 'VENDOR_APPROVE' as const,
        statusFrom: currentData.status || null,
        statusTo: currentData.status || null,
        timestamp: new Date(),
        notes: 'Vendor bulk approval',
      };

      batch.update(docRef, {
        approvedByVendor: true,
        vendorActionTaken: true,
        vendorApprovedAt: serverTimestamp(),
        vendorApprovedBy: user.id,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEntry),
      });
      updatedCount += 1;
    });

    if (updatedCount > 0) {
      await batch.commit();
    }
    return updatedCount;
  },

  // ========== BULK REQUEST WORKFLOW FUNCTIONS ==========

  /**
   * RH approves a BULK request (FO_CREATED → PAYMENT_PENDING)
   * - Validates request is bulk and at FO_CREATED status
   * - Updates rhStatus and transitions to PAYMENT_PENDING
   */
  approveBulkRequest: async (requestId: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.RH_BULK_APPROVE, user);
  },

  /**
   * RH rejects a BULK request
   * - Validates request is bulk and at FO_CREATED status
   * - Sets rejection reason and status to HALTED
   */
  rejectBulkRequest: async (
    requestId: string,
    rejectionReason: string,
    user: UserRef
  ) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.RH_BULK_REJECT, user, {
      rejectionReason,
    });
  },

  /**
   * Payment approves a BULK request (PAYMENT_PENDING → PAYMENT_APPROVED)
   * - Validates request is bulk and at PAYMENT_PENDING status
   * - Updates paymentStatus and transitions to PAYMENT_APPROVED
   */
  approveBulkPayment: async (requestId: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE, user);
  },

  /**
   * Payment rejects a BULK request
   * - Validates request is bulk and at PAYMENT_PENDING status
   * - Sets rejection reason and status to HALTED
   */
  rejectBulkPayment: async (
    requestId: string,
    rejectionReason: string,
    user: UserRef
  ) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.PAYMENT_BULK_REJECT, user, {
      rejectionReason,
    });
  },

  updateBulkPaymentVehicles: async (
    requestId: string,
    vehicleIndexes: number[],
    action: 'APPROVE' | 'REJECT',
    user: UserRef,
    rejectionReason?: string
  ) => {
    if (!user?.id || user.role !== 'PAYMENT') {
      throw new Error('Only PAYMENT role can perform this action.');
    }

    const uniqueIndexes = Array.from(new Set(vehicleIndexes)).filter(
      (index) => Number.isInteger(index) && index >= 0
    );

    if (uniqueIndexes.length === 0) {
      throw new Error('Select at least one eligible vehicle.');
    }

    const normalizedRejectionReason = String(rejectionReason || '').trim();
    if (action === 'REJECT' && !normalizedRejectionReason) {
      throw new Error('Rejection reason is required.');
    }

    const docRef = doc(db, REQUESTS_COLLECTION, requestId);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists()) {
        throw new Error('Request not found.');
      }

      const currentData = snapshot.data() as RequestRecord;
      if (!currentData.isBulkRequest) {
        throw new Error('This action is only available for bulk requests.');
      }

      if (currentData.status !== REQUEST_STATUSES.FO_CREATED) {
        throw new Error('Bulk payment action is only allowed when request status is FO_CREATED.');
      }

      const rawVehicles = currentData.vehicles as unknown;
      const vehicles = Array.isArray(rawVehicles)
        ? (rawVehicles as Array<Record<string, unknown>>)
        : rawVehicles && typeof rawVehicles === 'object'
          ? Object.keys(rawVehicles as Record<string, unknown>)
              .sort((a, b) => Number(a) - Number(b))
              .map((key) => (((rawVehicles as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>))
          : [];

      if (vehicles.length === 0) {
        throw new Error('No vehicles found in this bulk request.');
      }

      const selectedIndexes = uniqueIndexes.filter((index) => index < vehicles.length);
      if (selectedIndexes.length === 0) {
        throw new Error('Selected vehicles are invalid.');
      }

      for (const index of selectedIndexes) {
        const vehicle = (vehicles[index] ?? {}) as Record<string, unknown>;
        if (vehicle.paymentActionTaken === true) {
          throw new Error(`Vehicle at position ${index + 1} is already processed.`);
        }
      }

      const isIndexSelected = (index: number) => selectedIndexes.includes(index);
      const updatedVehicles = vehicles.map((vehicle, index) => {
        if (!isIndexSelected(index)) {
          return vehicle;
        }

        if (action === 'APPROVE') {
          return {
            ...vehicle,
            paymentActionTaken: true,
            paymentApproved: true,
            paymentRejected: false,
            paymentApprovedAt: new Date(),
            paymentRejectedAt: null,
          };
        }

        return {
          ...vehicle,
          paymentActionTaken: true,
          paymentApproved: false,
          paymentRejected: true,
          paymentRejectionReason: normalizedRejectionReason,
          paymentRejectedAt: new Date(),
          paymentApprovedAt: null,
        };
      });

      const allVehiclesProcessed =
        updatedVehicles.length > 0 &&
        updatedVehicles.every((vehicle) => Boolean((vehicle as Record<string, unknown>)?.paymentActionTaken));

      const approvedVehicleCount = updatedVehicles.filter(
        (vehicle) => Boolean((vehicle as Record<string, unknown>)?.paymentApproved)
      ).length;

      const rejectedVehicleCount = updatedVehicles.filter(
        (vehicle) => Boolean((vehicle as Record<string, unknown>)?.paymentRejected)
      ).length;

      let nextStatus: string = REQUEST_STATUSES.FO_CREATED;
      if (allVehiclesProcessed && approvedVehicleCount > 0) {
        nextStatus = REQUEST_STATUSES.PAYMENT_APPROVED;
      } else if (allVehiclesProcessed && rejectedVehicleCount === updatedVehicles.length) {
        nextStatus = REQUEST_STATUSES.HALTED;
      }

      const selectedVehicleNumbers = selectedIndexes
        .map((index) => (vehicles[index] as Record<string, unknown>)?.vehicleNumber)
        .filter(Boolean)
        .join(', ');

      const historyEntry = {
        userId: user.id,
        userName: user.name ?? user.email ?? null,
        role: user.role,
        action:
          action === 'APPROVE'
            ? WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE
            : WORKFLOW_ACTIONS.PAYMENT_BULK_REJECT,
        statusFrom: currentData.status ?? null,
        statusTo: nextStatus,
        timestamp: new Date(),
        notes:
          action === 'REJECT'
            ? `Payment rejected ${selectedIndexes.length} vehicle(s): ${selectedVehicleNumbers || 'N/A'} | Reason: ${normalizedRejectionReason}`
            : `Payment approved ${selectedIndexes.length} vehicle(s): ${selectedVehicleNumbers || 'N/A'}`,
      };

      const updates: Record<string, unknown> = {
        status: nextStatus,
        paymentStatus:
          nextStatus === REQUEST_STATUSES.PAYMENT_APPROVED
            ? 'APPROVED'
            : nextStatus === REQUEST_STATUSES.HALTED
              ? 'REJECTED'
              : 'PENDING',
        bothApproved:
          nextStatus === REQUEST_STATUSES.PAYMENT_APPROVED && currentData.rhStatus === 'APPROVED',
        vehicles: updatedVehicles,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEntry),
      };

      transaction.update(docRef, updates);
    });
  },

  /**
   * Vendor notifies on a BULK request (PAYMENT_APPROVED → SERVICE_INITIATED)
   * - Validates request is bulk and at PAYMENT_APPROVED status
   * - Vendor provides vendor name and request moves to SERVICE_INITIATED
   */
  notifyBulkVendor: async (requestId: string, vendorName: string, user: UserRef) => {
    const docRef = doc(db, REQUESTS_COLLECTION, requestId);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists()) {
        throw new Error('Request not found.');
      }

      const currentData = snapshot.data() as RequestRecord;
      if (!currentData.isBulkRequest) {
        throw new Error('This action is only available for bulk requests.');
      }

      // Normalize vehicles array
      const rawVehicles = currentData.vehicles as unknown;
      const vehicles = Array.isArray(rawVehicles)
        ? (rawVehicles as Array<Record<string, unknown>>)
        : rawVehicles && typeof rawVehicles === 'object'
          ? Object.keys(rawVehicles as Record<string, unknown>)
              .sort((a, b) => Number(a) - Number(b))
              .map((key) => (((rawVehicles as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>))
          : [];

      // Set vendorNotified on each vehicle that has been payment-approved
      const updatedVehicles = vehicles.map((vehicle) => {
        // Only mark as vendorNotified if payment approved
        if (vehicle.paymentApproved === true) {
          return {
            ...vehicle,
            vendorNotified: true,
            vendorName: vendorName,
          };
        }
        return vehicle;
      });

      // Prepare workflow update
      const { updates, historyEntry } = updateRequestState(
        currentData,
        WORKFLOW_ACTIONS.VENDOR_BULK_NOTIFY,
        user,
        { vendorName }
      );

      transaction.update(docRef, {
        ...updates,
        vehicles: updatedVehicles,
        vendorNotified: true,
        vendorName: vendorName,
        notifiedAt: serverTimestamp(),
        notificationTimestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEntry),
      });
    });
  },

  markFoNotified: async (requestIds: string[]) => {
    if (requestIds.length === 0) {
      return;
    }

    const batch = writeBatch(db);
    requestIds.forEach((requestId) => {
      const requestRef = doc(db, REQUESTS_COLLECTION, requestId);
      batch.update(requestRef, {
        foNotified: true,
        notifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  },

  removeBulkVehicle: async (requestId: string, vehicleNumber: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.FO_REMOVE_VEHICLE, user, {
      updates: { vehicleNumber },
      notes: `FO removed vehicle ${vehicleNumber} from bulk request`,
    });
  },

  /**
   * Bulk approve multiple BULK requests by RH
    * - Filters to RH-actionable bulk requests
   * - Applies RH_BULK_APPROVE to each
   */
  bulkApproveBulkRequests: async (requestIds: string[], user: UserRef) => {
    let updatedCount = 0;

    for (const requestId of requestIds) {
      const docRef = doc(db, REQUESTS_COLLECTION, requestId);
      const snapshot = await getDoc(docRef);

      if (!snapshot.exists()) {
        continue;
      }

      const currentData = snapshot.data() as RequestRecord;
      
      // Only approve BULK requests where RH has not actioned yet
      if (!currentData.isBulkRequest) {
        console.warn(`Skipping non-bulk request ${docRef.id}`);
        continue;
      }

      const rhAlreadyActioned = currentData.rhStatus === 'APPROVED' || currentData.rhStatus === 'REJECTED';
      const isRhActionableStatus =
        currentData.status === REQUEST_STATUSES.FO_CREATED ||
        currentData.status === REQUEST_STATUSES.PAYMENT_PENDING ||
        currentData.status === REQUEST_STATUSES.PAYMENT_APPROVED ||
        currentData.status === REQUEST_STATUSES.SERVICE_INITIATED ||
        currentData.status === REQUEST_STATUSES.COMPLETED;

      if (!isRhActionableStatus || rhAlreadyActioned) {
        console.warn(
          `Skipping request ${docRef.id}: status is ${currentData.status}, rhStatus is ${currentData.rhStatus}`
        );
        continue;
      }

      try {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(docRef);

          if (!snapshot.exists()) {
            return;
          }

          const currentData = snapshot.data() as RequestRecord;

          // Update vehicle-level RH approval for bulk requests
          const rawVehicles = currentData.vehicles as unknown;
          const vehicles = Array.isArray(rawVehicles)
            ? (rawVehicles as Array<Record<string, unknown>>)
            : rawVehicles && typeof rawVehicles === 'object'
              ? Object.keys(rawVehicles as Record<string, unknown>)
                  .sort((a, b) => Number(a) - Number(b))
                  .map((key) => (((rawVehicles as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>))
              : [];

          const updatedVehicles = vehicles.map((vehicle) => ({
            ...vehicle,
            rhApproved: true,
            rhApprovedAt: new Date(),
          }));

          const { updates, historyEntry } = updateRequestState(
            currentData,
            WORKFLOW_ACTIONS.RH_BULK_APPROVE,
            user
          );

          transaction.update(docRef, {
            ...updates,
            vehicles: updatedVehicles,
            updatedAt: serverTimestamp(),
            history: arrayUnion(historyEntry),
          });
        });

        updatedCount += 1;
      } catch (error) {
        console.warn(`Skipping bulk request ${docRef.id}: unable to approve in bulk`, error);
      }
    }

    return updatedCount;
  },

  /**
   * Bulk approve multiple BULK requests by Payment
   * - Filters to only PAYMENT_PENDING bulk requests
   * - Applies PAYMENT_BULK_APPROVE to each
   */
  bulkApproveBulkPayment: async (requestIds: string[], user: UserRef) => {
    const batch = writeBatch(db);
    let updatedCount = 0;

    const docs = await Promise.all(
      requestIds.map(async (requestId) => {
        const docRef = doc(db, REQUESTS_COLLECTION, requestId);
        const snapshot = await getDoc(docRef);
        return { docRef, snapshot };
      })
    );

    docs.forEach(({ docRef, snapshot }) => {
      if (!snapshot.exists()) {
        return;
      }

      const currentData = snapshot.data() as RequestRecord;
      
      // Only approve BULK requests at PAYMENT_PENDING
      if (!currentData.isBulkRequest) {
        console.warn(`Skipping non-bulk request ${docRef.id}`);
        return;
      }

      if (currentData.status !== REQUEST_STATUSES.PAYMENT_PENDING) {
        console.warn(
          `Skipping request ${docRef.id}: status is ${currentData.status}, must be PAYMENT_PENDING`
        );
        return;
      }

      const { updates, historyEntry } = updateRequestState(
        currentData,
        WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE,
        user
      );

      batch.update(docRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEntry),
      });
      updatedCount += 1;
    });

    if (updatedCount > 0) {
      await batch.commit();
    }
    return updatedCount;
  },

  cancelRequest: async (requestId: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.CANCEL, user);
  },
};
