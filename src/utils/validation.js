export const validateBulkVehicles = (selectedVehicles) => {
  if (selectedVehicles.length === 0) {
    return { valid: false, message: 'Please select at least one vehicle' };
  }

  if (selectedVehicles.length === 1) {
    return { valid: true };
  }

  const firstCity = selectedVehicles[0].city;
  const firstClient = selectedVehicles[0].clientName;

  const allSameCity = selectedVehicles.every((v) => v.city === firstCity);
  const allSameClient = selectedVehicles.every((v) => v.clientName === firstClient);

  if (!allSameCity || !allSameClient) {
    return {
      valid: false,
      message: 'Bulk registration allowed only for same client and same city.',
    };
  }

  return { valid: true };
};

export const validateDriverDetails = (driverDetails) => {
  if (!driverDetails || driverDetails.length === 0) {
    return { valid: false, message: 'Please add at least one driver' };
  }

  for (const driver of driverDetails) {
    if (!driver.vehicleNumber || !driver.driverName || !driver.driverNumber) {
      return {
        valid: false,
        message: 'All driver fields are required',
      };
    }
    if (driver.driverNumber.length < 10) {
      return {
        valid: false,
        message: 'Invalid driver phone number',
      };
    }
  }

  return { valid: true };
};

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password) => {
  return password.length >= 6;
};
