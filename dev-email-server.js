import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// SMTP Configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'anupgogeri4@gmail.com',
    pass: 'ckzjksyurzozkirj', // New App Password
  },
});

// Send OTP endpoint
app.post('/sendOTP', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    console.log(`📧 Sending OTP ${otp} to ${email}...`);

    await transporter.sendMail({
      from: 'anupgogeri4@gmail.com',
      to: email,
      subject: 'Your GPS System OTP Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">GPS System Verification</h2>
          <p>Your OTP verification code is:</p>
          <h1 style="background: #f0f0f0; padding: 20px; text-align: center; letter-spacing: 5px; color: #4CAF50;">
            ${otp}
          </h1>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `,
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    });

    console.log('✅ OTP email sent successfully!');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP', details: error.message });
  }
});

// Send Vendor Notification endpoint
app.post('/sendVendorNotification', async (req, res) => {
  try {
    const { requestId, vendorName, clientName, city, destination, vehicles, driverDetails, serviceType, serviceCost, tripFromDate, tripFromTime, tripToDate, tripToTime } = req.body;

    console.log(`📧 Vendor notification request received:`, {
      requestId,
      vendorName,
      clientName,
      city,
      vehicleCount: vehicles?.length,
      driverCount: driverDetails?.length
    });

    // IMPORTANT: Configure real vendor email addresses here
    // Replace with actual vendor email addresses where notifications will be sent
    const vendorEmails = {
      FleetX: 'anupgogeri4@gmail.com', // Change to real FleetX email
      WheelsEye: 'anupgogeri3@gmail.com', // Change to real WheelsEye email
    };

    const vendorEmail = vendorEmails[vendorName];
    if (!vendorEmail) {
      console.error(`❌ Invalid vendor name: "${vendorName}". Available vendors: ${Object.keys(vendorEmails).join(', ')}`);
      return res.status(400).json({ error: `Invalid vendor name: "${vendorName}". Available: ${Object.keys(vendorEmails).join(', ')}` });
    }

    const vehicleRows = (vehicles || [])
      .map((v) => `<tr><td style="padding: 8px; border: 1px solid #ddd;">${v.vehicleNumber}</td><td style="padding: 8px; border: 1px solid #ddd;">${v.isNewTrip ? 'New Trip' : 'Registered'}</td></tr>`)
      .join('');

    const driverRows = (driverDetails || [])
      .map((d) => `<tr><td style="padding: 8px; border: 1px solid #ddd;">${d.vehicleNumber}</td><td style="padding: 8px; border: 1px solid #ddd;">${d.driverName}</td><td style="padding: 8px; border: 1px solid #ddd;">${d.driverNumber}</td></tr>`)
      .join('');

    console.log(`📧 Sending vendor notification to ${vendorName} (${vendorEmail}) for request ${requestId}...`);

    await transporter.sendMail({
      from: 'anupgogeri4@gmail.com',
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
                <td style="padding: 12px; border: 1px solid #dee2e6;"><span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 12px; border-radius: 15px; font-weight: 600;">${serviceType || 'N/A'}</span> <span style="color: #666; margin-left: 10px;">₹${serviceCost || 'N/A'}</span></td>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Location</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${city || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Destination</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${destination || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Client Name</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${clientName || 'N/A'}</td>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Trip Start</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${tripFromDate || 'N/A'}</strong> at <strong>${tripFromTime || 'N/A'}</strong></td>
              </tr>
              <tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Trip End</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${tripToDate || 'N/A'}</strong> at <strong>${tripToTime || 'N/A'}</strong></td>
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
        `Service Type: ${serviceType || 'N/A'} - ₹${serviceCost || 'N/A'}`,
        `Location: ${city || 'N/A'}`,
        `Destination: ${destination || 'N/A'}`,
        `Client: ${clientName || 'N/A'}`,
        `Trip Start: ${tripFromDate || 'N/A'} at ${tripFromTime || 'N/A'}`,
        `Trip End: ${tripToDate || 'N/A'} at ${tripToTime || 'N/A'}`,
        ``,
        'DRIVER DETAILS:',
        (driverDetails || []).map(d => `${d.vehicleNumber} - ${d.driverName} - ${d.driverNumber}`).join('\n'),
      ].join('\n'),
    });

    console.log('✅ Vendor notification email sent successfully!');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending vendor notification:', error);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Development Email Server running on http://localhost:${PORT}`);
  console.log(`📧 Ready to send real OTP emails from: anupgogeri4@gmail.com\n`);
});
