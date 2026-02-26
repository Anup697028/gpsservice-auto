import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { RequestRecord } from '../types/workflow';

type AnalyticsCallback = (requests: RequestRecord[]) => void;

export const analyticsService = {
  subscribeToAllRequests: (callback: AnalyticsCallback) => {
    const ref = collection(db, 'requests');
    return onSnapshot(ref, (snapshot) => {
      const requests = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      })) as RequestRecord[];
      callback(requests);
    });
  },
};
