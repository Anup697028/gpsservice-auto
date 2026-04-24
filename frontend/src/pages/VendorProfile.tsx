import React from 'react';
import { UnifiedRoleProfile } from '../components/UnifiedRoleProfile';

const VendorProfile: React.FC = () => {
  return <UnifiedRoleProfile role="VENDOR" pageTitle="Profile" subtitle="Manage your account details and operational metrics." />;
};

export default VendorProfile;
