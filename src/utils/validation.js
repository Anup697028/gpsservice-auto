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

// Fix #3: normalize to digits only and keep max length 10 for strict storage/validation.
export const normalizePhoneNumber = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

export const isStrictPhoneNumber = (value) => /^\d{10}$/.test(String(value || ''));

export const validateDriverDetails = (ltpocDetails) => {
  if (!ltpocDetails || ltpocDetails.length === 0) {
    return { valid: false, message: 'Please add at least one LTPOC' };
  }

  for (const ltpoc of ltpocDetails) {
    const normalizedPhone = normalizePhoneNumber(ltpoc.ltpocPhone);

    if (!ltpoc.vehicleNumber || !ltpoc.ltpocName || !normalizedPhone) {
      return {
        valid: false,
        message: 'All LTPOC fields (Vehicle, Name, Phone) are required',
      };
    }
    if (!isStrictPhoneNumber(normalizedPhone)) {
      return {
        valid: false,
        message: 'LTPOC phone must be exactly 10 digits',
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
