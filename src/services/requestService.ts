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
      console.log('createRequest called with:', { user, requestId });
      const { updates, historyEntry } = updateRequestState(null, WORKFLOW_ACTIONS.CREATE, user);

      if (requestId) {
        console.log('Using provided requestId:', requestId);
        const docRef = doc(db, REQUESTS_COLLECTION, requestId);
        const docData = {
          id: docRef.id,
          ...requestData,
          ...updates,
          createdBy: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          history: [historyEntry] as any, // Type assertion to allow Date in history
        };
        console.log('Writing document:', docData);
        await setDoc(docRef, docData);
        return docRef.id;
      }

      const docData = {
        id: requestId ?? undefined,
        ...requestData,
        ...updates,
        createdBy: user.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        history: [historyEntry] as any, // Type assertion to allow Date in history
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
    // RH can approve at any time (PARALLEL_REVIEW or VENDOR_COORDINATION) for compliance
    const q = query(
      collection(db, REQUESTS_COLLECTION),
      where('rhApproval', '==', false)
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
    const batch = writeBatch(db);

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
      const { updates, historyEntry } = updateRequestState(
        currentData,
        WORKFLOW_ACTIONS.RH_APPROVE,
        user
      );

      batch.update(docRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEntry),
      });
    });

    await batch.commit();
  },

  notifyVendor: async (requestId: string, vendorName: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.VENDOR_NOTIFY, user, {
      vendorName,
    });
  },

  cancelRequest: async (requestId: string, user: UserRef) => {
    await updateRequestWithWorkflow(requestId, WORKFLOW_ACTIONS.CANCEL, user);
  },
};
