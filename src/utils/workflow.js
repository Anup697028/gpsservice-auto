export const WORKFLOW_STATES = {
  PARALLEL_REVIEW: 'PARALLEL_REVIEW',
  VENDOR_COORDINATION: 'VENDOR_COORDINATION',
  COMPLETED: 'COMPLETED',
  HALTED: 'HALTED',
};

export const getStatusColor = (status) => {
  switch (status) {
    case 'PARALLEL_REVIEW':
      return '#f59e0b'; // amber
    case 'VENDOR_COORDINATION':
      return '#8b5cf6'; // purple
    case 'COMPLETED':
      return '#10b981'; // green
    case 'HALTED':
      return '#ef4444'; // red
    default:
      return '#6b7280'; // gray
  }
};

export const getStatusLabel = (status) => {
  const labels = {
    PARALLEL_REVIEW: 'Parallel Review',
    VENDOR_COORDINATION: 'Vendor Coordination',
    COMPLETED: 'Completed',
    HALTED: 'Halted',
  };
  return labels[status] || status;
};

export const canApproveRequest = (userRole, status) => {
  if (userRole === 'RH' && status === 'PARALLEL_REVIEW') return true;
  if (userRole === 'PAYMENT' && status === 'PARALLEL_REVIEW') return true;
  return false;
};

export const canVendorNotify = (userRole, status) => {
  return userRole === 'VENDOR' && status === 'VENDOR_COORDINATION';
};
