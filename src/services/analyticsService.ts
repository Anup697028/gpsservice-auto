import { requestService } from './requestService';
import type { RequestRecord } from '../types/workflow';

type AnalyticsCallback = (requests: RequestRecord[]) => void;

export const analyticsService = {
  subscribeToAllRequests: (callback: AnalyticsCallback) => requestService.subscribeToAllRequests(callback),
};
