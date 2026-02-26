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
    const { requestId, vendorName, foEmail, clientName, city, vehicles, driverDetails, serviceType, vehicleAvailabilityLocation, vehicleAvailableTime } = req.body;

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
              ${serviceType ? `<tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Service Type</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><span style="background: linear-gradient(135deg, #1f6f78 0%, #15545a 100%); color: white; padding: 6px 16px; border-radius: 20px; font-weight: 700; font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em;">${serviceType}</span></td>
              </tr>` : ''}
              ${city ? `<tr style="background: #f8f9fa;">
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">City</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${city}</td>
              </tr>` : ''}
              ${clientName ? `<tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Client</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${clientName}</td>
              </tr>` : ''}
              ${vehicleAvailabilityLocation ? `<tr style="background: #f8f9fa;">
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Vehicle Availability Location</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${vehicleAvailabilityLocation}</strong></td>
              </tr>` : ''}
              ${vehicleAvailableTime ? `<tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Vehicle Available Time</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${vehicleAvailableTime}</strong></td>
              </tr>` : ''}
            </table>
            
            ${vehicles && vehicles.length > 0 ? `
            <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 25px;">
              <tr style="background: #17a2b8; color: white;">
                <th colspan="2" style="padding: 14px; text-align: left; font-size: 16px; border-bottom: 2px solid #138496;">Vehicle Details</th>
              </tr>
              <tr style="background: #d1ecf1;">
                <th style="padding: 10px; text-align: left; border: 1px solid #bee5eb; font-weight: 600;">Vehicle Number</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #bee5eb; font-weight: 600;">Status</th>
              </tr>
              ${vehicleRows}
            </table>
            ` : ''}
            
            <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 25px;">
              <tr style="background: #28a745; color: white;">
                <th colspan="3" style="padding: 14px; text-align: left; font-size: 16px; border-bottom: 2px solid #218838;">LTPOC Details</th>
              </tr>
              <tr style="background: #e8f5e9;">
                <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">Vehicle Number</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">LTPOC Name</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #c8e6c9; font-weight: 600;">LTPOC Phone</th>
              </tr>
              ${driverRows || '<tr><td colspan="3" style="padding: 12px; border: 1px solid #dee2e6; text-align: center; color: #999;">No LTPOC details available</td></tr>'}
            </table>
            
            <div style="margin-top: 25px; padding: 18px; background: #fff3cd; border-left: 5px solid #ffc107; border-radius: 4px;">
              <p style="margin: 0; color: #856404; font-size: 14px;"><strong>⚠️ Action Required:</strong> Please acknowledge receipt and confirm service availability.</p>
            </div>

            ${foEmail ? `
            <div style="margin-top: 25px; text-align: center;">
              <a href="http://localhost:3001/notifyFO?requestId=${requestId}&vendorName=${vendorName}&foEmail=${foEmail}" 
                 style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #28a745 0%, #20873a 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);">
                ✓ Notify FO - GPS Service Initiated
              </a>
              <p style="margin: 10px 0 0; font-size: 12px; color: #6c757d;">Click this button after GPS service is initiated</p>
            </div>
            ` : ''}
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
        serviceType ? `Service Type: ${serviceType}` : '',
        city ? `City: ${city}` : '',
        clientName ? `Client: ${clientName}` : '',
        vehicleAvailabilityLocation ? `Vehicle Availability Location: ${vehicleAvailabilityLocation}` : '',
        vehicleAvailableTime ? `Vehicle Available Time: ${vehicleAvailableTime}` : '',
        ``,
        vehicles && vehicles.length > 0 ? 'VEHICLES:' : '',
        vehicles && vehicles.length > 0 ? (vehicles.map((v) => `${v.vehicleNumber} - ${v.isNewTrip ? 'New Trip' : 'Registered'}`).join('\n')) : '',
        ``,
        'LTPOC DETAILS:',
        (driverDetails || []).map(d => `${d.vehicleNumber} - ${d.driverName} - ${d.driverNumber}`).join('\n'),
      ].filter(line => line !== '').join('\n'),
    });

    console.log('✅ Vendor notification email sent successfully!');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending vendor notification:', error);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
});

// Notify FO endpoint
app.get('/notifyFO', async (req, res) => {
  try {
    const requestId = req.query.requestId;
    const vendorName = req.query.vendorName;
    const foEmail = req.query.foEmail;

    if (!requestId || !vendorName || !foEmail) {
      return res.status(400).send('<html><body><h2>❌ Invalid Request</h2><p>Missing required parameters.</p></body></html>');
    }

    console.log(`📧 Sending FO notification for request ${requestId} from ${vendorName}...`);

    await transporter.sendMail({
      from: 'anupgogeri4@gmail.com',
      to: foEmail,
      subject: `GPS Service Initiated - ${requestId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #28a745 0%, #20873a 100%); padding: 25px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 24px;">✓ GPS Service Initiated</h2>
          </div>
          
          <div style="padding: 30px;">
            <p style="font-size: 16px; color: #333; margin-bottom: 25px;">Dear Field Operator,</p>
            
            <div style="padding: 18px; background: #d4edda; border-left: 5px solid #28a745; border-radius: 4px; margin-bottom: 25px;">
              <p style="margin: 0; color: #155724; font-size: 15px;"><strong>✓ GPS Service Initiated</strong></p>
              <p style="margin: 8px 0 0; color: #155724; font-size: 14px;">${vendorName} has confirmed the GPS installation is complete.</p>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 25px;">
              <tr style="background: #667eea; color: white;">
                <th colspan="2" style="padding: 14px; text-align: left; font-size: 16px; border-bottom: 2px solid #5568d3;">Installation Details</th>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600; width: 35%;">Request ID</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;"><strong>${requestId}</strong></td>
              </tr>
              <tr>
                <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 600;">Vendor</td>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${vendorName}</td>
              </tr>
            </table>
            
            <div style="margin-top: 25px; padding: 18px; background: #d1ecf1; border-left: 5px solid #17a2b8; border-radius: 4px;">
              <p style="margin: 0; color: #0c5460; font-size: 14px;"><strong>ℹ️ Next Steps:</strong> Please verify the installation and update the request status in the system.</p>
            </div>
          </div>
          
          <div style="padding: 15px; background: #f8f9fa; color: #6c757d; font-size: 12px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="margin: 0;">GPS Installation Automation System</p>
          </div>
        </div>
      `,
      text: `GPS Service Initiated - ${requestId}\n\nDear Field Operator,\n\n${vendorName} has confirmed the GPS installation is complete.\n\nRequest ID: ${requestId}\nVendor: ${vendorName}\n\nPlease verify the installation and update the request status in the system.\n\nGPS Installation Automation System`,
    });

    console.log('✅ FO notification email sent successfully!');
    res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>Notification Sent</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            .success { color: #28a745; font-size: 48px; margin-bottom: 20px; }
            h2 { color: #333; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="success">✓</div>
          <h2>Field Operator Notified Successfully!</h2>
          <p>An email has been sent to <strong>${foEmail}</strong> confirming the GPS installation completion.</p>
          <p style="color: #999; font-size: 14px; margin-top: 30px;">You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Error sending FO notification:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ Failed to Send Notification</h2>
          <p style="color: #666;">An error occurred while sending the notification. Please try again or contact support.</p>
        </body>
      </html>
    `);
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Development Email Server running on http://localhost:${PORT}`);
  console.log(`📧 Ready to send real OTP emails from: anupgogeri4@gmail.com\n`);
});
