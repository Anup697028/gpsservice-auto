"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVendorNotification = exports.sendOTP = void 0;
const https_1 = require("firebase-functions/v2/https");
const nodemailer_1 = __importDefault(require("nodemailer"));
const cors_1 = __importDefault(require("cors"));
const corsHandler = (0, cors_1.default)({ origin: true });
const getTransporter = () => {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
        throw new Error('SMTP credentials are not configured.');
    }
    return nodemailer_1.default.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
};
const vendorEmailMap = {
    FleetX: process.env.VENDOR_FLEETX || 'your-fleetx-email@company.com',
    WheelsEye: process.env.VENDOR_WHEELSEYE || 'your-wheelseye-email@company.com',
};
exports.sendOTP = (0, https_1.onRequest)((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { email, otp } = req.body;
            if (!email || !otp) {
                res.status(400).json({ error: 'Email and OTP are required.' });
                return;
            }
            const transporter = getTransporter();
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
                to: email,
                subject: 'Your verification code',
                text: `Your OTP is ${otp}. It expires in 10 minutes.`,
            });
            res.status(200).json({ success: true });
        }
        catch (error) {
            console.error('sendOTP error', error);
            res.status(500).json({ error: 'Failed to send OTP.' });
        }
    });
});
exports.sendVendorNotification = (0, https_1.onRequest)((req, res) => {
    return corsHandler(req, res, async () => {
        try {
            const { requestId, vendorName, clientName, city, destination, vehicles, driverDetails, serviceType, serviceCost, tripFromDate, tripFromTime, tripToDate, tripToTime } = req.body;
            if (!requestId || !vendorName) {
                res.status(400).json({ error: 'Request ID and vendor name are required.' });
                return;
            }
            const vendorEmail = vendorEmailMap[vendorName];
            if (!vendorEmail) {
                res.status(400).json({ error: 'Vendor email not configured.' });
                return;
            }
            const vehicleRows = (vehicles ?? [])
                .map((vehicle) => `<tr><td style="padding: 8px; border: 1px solid #ddd;">${vehicle.vehicleNumber}</td><td style="padding: 8px; border: 1px solid #ddd;">${vehicle.isNewTrip ? 'New Trip' : 'Registered'}</td></tr>`)
                .join('');
            const driverRows = (driverDetails ?? [])
                .map((driver) => `<tr><td style="padding: 8px; border: 1px solid #ddd;">${driver.vehicleNumber}</td><td style="padding: 8px; border: 1px solid #ddd;">${driver.driverName}</td><td style="padding: 8px; border: 1px solid #ddd;">${driver.driverNumber}</td></tr>`)
                .join('');
            const transporter = getTransporter();
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
                to: vendorEmail,
                subject: `GPS Installation Service Request - ${requestId}`,
                html: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 24px;">GPS Installation Service Request</h2>
            </div>
            
            <div style="padding: 30px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 25px;">Dear ${vendorName} Team,</p>
              
              <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 25px;">
                <tr style="background: #667eea; color: white;">
                  <th colspan="2" style="padding: 14px; text-align: left; font-size: 16px; border-bottom: 2px solid #5568d3;">Service Request Details</th>
                </tr>
                <tr style="background: #f8f9fa;">
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600; width: 35%;">Request ID</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${requestId}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Service Type</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;"><span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 12px; border-radius: 15px; font-weight: 600;">${serviceType ?? 'N/A'}</span> <span style="color: #666; margin-left: 10px;">₹${serviceCost ?? 'N/A'}</span></td>
                </tr>
                <tr style="background: #f8f9fa;">
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Location</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;">${city ?? 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Destination</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;">${destination ?? 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Client Name</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;">${clientName ?? 'N/A'}</td>
                </tr>
                <tr style="background: #f8f9fa;">
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Trip Start</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${tripFromDate ?? 'N/A'}</strong> at <strong>${tripFromTime ?? 'N/A'}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Trip End</td>
                  <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${tripToDate ?? 'N/A'}</strong> at <strong>${tripToTime ?? 'N/A'}</strong></td>
                </tr>
              </table>
              
              <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 25px;">
                <tr style="background: #28a745; color: white;">
                  <th colspan="3" style="padding: 14px; text-align: left; font-size: 16px; border-bottom: 2px solid #218838;">Driver Details</th>
                </tr>
                <tr style="background: #e8f5e9;">
                  <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">Vehicle Number</th>
                  <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">Driver Name</th>
                  <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">Driver Phone</th>
                </tr>
                ${driverRows || '<tr><td colspan="3" style="padding: 12px; border: 1px solid #dee2e6; text-align: center; color: #999;">No driver details available</td></tr>'}
              </table>
              
              <div style="margin-top: 25px; padding: 18px; background: #fff3cd; border-left: 5px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px;"><strong>⚠️ Action Required:</strong> Please acknowledge receipt and confirm service availability.</p>
              </div>
            </div>
            
            <div style="padding: 15px; background: #f8f9fa; color: #6c757d; font-size: 12px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="margin: 0;">GPS Installation Automation System</p>
            </div>
          </div>
        `,
                text: [
                    `GPS Installation Service Request - ${requestId}`,
                    `Dear ${vendorName} Team,`,
                    ``,
                    `REQUEST DETAILS:`,
                    `Request ID: ${requestId}`,
                    `Service Type: ${serviceType ?? 'N/A'} - ₹${serviceCost ?? 'N/A'}`,
                    `Location: ${city ?? 'N/A'}`,
                    `Destination: ${destination ?? 'N/A'}`,
                    `Client: ${clientName ?? 'N/A'}`,
                    `Trip Start: ${tripFromDate ?? 'N/A'} at ${tripFromTime ?? 'N/A'}`,
                    `Trip End: ${tripToDate ?? 'N/A'} at ${tripToTime ?? 'N/A'}`,
                    ``,
                    'DRIVER DETAILS:',
                    (driverDetails ?? []).map((d) => `${d.vehicleNumber} - ${d.driverName} - ${d.driverNumber}`).join('\n'),
                ].join('\n'),
            });
            res.status(200).json({ success: true });
        }
        catch (error) {
            console.error('sendVendorNotification error', error);
            res.status(500).json({ error: 'Failed to send vendor notification.' });
        }
    });
});
