export type VehicleRecord = {
  vehicleNumber: string;
  city: string;
  clientName: string;
  isRegistered: boolean;
};

export type VehicleValidationResult = {
  vehicleNumber: string;
  isRegistered: boolean;
  city?: string;
  clientName?: string;
};

export const foApiService = {
  // Mock API to fetch vehicles
  // In production, replace with actual API endpoint

  validateVehicle: async (vehicleNumber: string): Promise<VehicleValidationResult> => {
    // Simulate API call to validate vehicle
    return new Promise((resolve) => {
      setTimeout(() => {
        // Mock validation - in production, check against company vehicle registry
        const mockVehicles = [
          { vehicleNumber: 'KA-01-AB-1234', isRegistered: true, city: 'Bangalore', clientName: 'Tech Corp' },
          { vehicleNumber: 'KA-01-AB-1235', isRegistered: true, city: 'Bangalore', clientName: 'Tech Corp' },
          { vehicleNumber: 'MH-02-CD-5678', isRegistered: true, city: 'Mumbai', clientName: 'Auto Fleet' },
          { vehicleNumber: 'DL-01-EF-9012', isRegistered: true, city: 'Delhi', clientName: 'Capital Motors' },
        ];
        
        const found = mockVehicles.find(v => v.vehicleNumber.toUpperCase() === vehicleNumber.toUpperCase());
        if (found) {
          resolve(found);
        } else {
          resolve({ vehicleNumber, isRegistered: false });
        }
      }, 300);
    });
  },

  getVehicles: async (): Promise<VehicleRecord[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([
          {
            vehicleNumber: 'KA-01-AB-1234',
            city: 'Bangalore',
            clientName: 'Tech Corp',
            isRegistered: true,
          },
          {
            vehicleNumber: 'KA-01-AB-1235',
            city: 'Bangalore',
            clientName: 'Tech Corp',
            isRegistered: true,
          },
          {
            vehicleNumber: 'KA-01-AB-1236',
            city: 'Bangalore',
            clientName: 'Tech Corp',
            isRegistered: false,
          },
          {
            vehicleNumber: 'MH-02-CD-5678',
            city: 'Mumbai',
            clientName: 'Auto Fleet',
            isRegistered: true,
          },
          {
            vehicleNumber: 'MH-02-CD-5679',
            city: 'Mumbai',
            clientName: 'Auto Fleet',
            isRegistered: true,
          },
          {
            vehicleNumber: 'DL-01-EF-9012',
            city: 'Delhi',
            clientName: 'Capital Motors',
            isRegistered: true,
          },
        ]);
      }, 500);
    });
  },
};
