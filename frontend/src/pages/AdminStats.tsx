import React from 'react';
import { StitchHtmlFrame } from '../components/StitchHtmlFrame';
import adminHtml from '../../../stitch_fo_dashboard/rh_dashboard_new_requests_refined/code.html?raw';

export const AdminStats: React.FC = () => {
  return <StitchHtmlFrame html={adminHtml} title="Admin Stats" />;
};
