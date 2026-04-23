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
    pass: 'ckzjksyurzozkirj',
  },
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Safe value renderer - returns empty string for null, undefined, empty, or "NA"
 * Ensures no "NA" or placeholder values appear in emails
 */
function safeValue(value) {
  if (value === null || value === undefined || value === '' || value === 'NA' || value === '-') {
    return '';
  }
  return String(value).trim();
}

/**
 * Build Installation Status table HTML
 * Renders each field (Vehicle Number, Vendor Name, LTPOC Name, Phone, Installation Date) as separate rows
 * Only renders rows with values (conditional rendering)
 */
function buildInstallationStatusTable(vehicles, ltpocDetails, vendorName) {
  let allRows = '';

  for (const vehicle of vehicles) {
    const safeVehicleNumber = safeValue(vehicle.vehicleNumber);
    if (!safeVehicleNumber) continue;

    const ltpoc = ltpocDetails?.find((d) => d.vehicleNumber === vehicle.vehicleNumber);
    const safeVendorName = safeValue(vendorName);
    const safeLtpocName = safeValue(ltpoc?.ltpocName);
    const safeLtpocPhone = safeValue(ltpoc?.ltpocPhone);
    const installationDate = new Date().toLocaleDateString();

    // Build rows only for fields that have values
    if (safeVehicleNumber) {
      allRows += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Vehicle Number</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeVehicleNumber}</strong></td>
        </tr>`;
    }

    if (safeVendorName) {
      allRows += `
        <tr>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vendor Name</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeVendorName}</strong></td>
        </tr>`;
    }

    if (safeLtpocName) {
      allRows += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Name</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeLtpocName}</strong></td>
        </tr>`;
    }

    if (safeLtpocPhone) {
      allRows += `
        <tr>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Phone</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeLtpocPhone}</strong></td>
        </tr>`;
    }

    if (installationDate) {
      allRows += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Installation Date</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${installationDate}</strong></td>
        </tr>`;
    }

  }

  if (!allRows) {
    return '';
  }

  return `
    <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
      <tr style="background: #667eea; color: white;">
        <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">INSTALLATION STATUS</th>
      </tr>
      ${allRows}
    </table>
  `;
}

/**
 * Build conditional request details table
 * Only shows rows for non-empty values
 */
function buildRequestDetailsTable(data) {
  const { requestId, serviceType, city, clientName, vehicleAvailabilityLocation, vehicleAvailableTime } = data;

  let rows = '';

  if (safeValue(requestId)) {
    rows += `<tr style="background: #f8f9fa;">
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Request ID</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeValue(requestId)}</strong></td>
    </tr>`;
  }

  if (safeValue(serviceType)) {
    rows += `<tr>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Service Type</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><span style="background: linear-gradient(135deg, #1f6f78 0%, #15545a 100%); color: white; padding: 8px 16px; border-radius: 20px; font-weight: 700; text-transform: uppercase; font-size: 14px; letter-spacing: 0.05em; display: inline-block;">${safeValue(serviceType)}</span></td>
    </tr>`;
  }

  if (safeValue(city)) {
    rows += `<tr style="background: #f8f9fa;">
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">City</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${safeValue(city)}</td>
    </tr>`;
  }

  if (safeValue(clientName)) {
    rows += `<tr>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Client</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${safeValue(clientName)}</td>
    </tr>`;
  }

  if (safeValue(vehicleAvailabilityLocation)) {
    rows += `<tr style="background: #f8f9fa;">
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Availability Location</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${safeValue(vehicleAvailabilityLocation)}</td>
    </tr>`;
  }

  if (safeValue(vehicleAvailableTime)) {
    rows += `<tr>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Available Time</td>
      <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${safeValue(vehicleAvailableTime)}</td>
    </tr>`;
  }

  return `
    <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
      <tr style="background: #1f6f78; color: white;">
        <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">REQUEST DETAILS</th>
      </tr>
      ${rows}
    </table>
  `;
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsvBuffer(headers, rows) {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n');
  return Buffer.from(csv, 'utf-8');
}

// ============================================================
// EMAIL TEMPLATE BUILDERS
// ============================================================

/**
 * Build LTPOC Details section HTML
 * Explicitly displays LTPOC Name, Phone, and Email only
 * Only shows fields that have values (conditional rendering)
 */
function buildLTPOCDetailsSection(ltpocDetails) {
  if (!ltpocDetails || ltpocDetails.length === 0) {
    return '';
  }

  const ltpocRows = ltpocDetails
    .map((ltpoc) => {
      const safeName = safeValue(ltpoc.ltpocName);
      const safePhone = safeValue(ltpoc.ltpocPhone);
      const safeEmail = safeValue(ltpoc.ltpocEmail);
      
      if (!safeName && !safePhone && !safeEmail) {
        return null;
      }

      let content = '';

      if (safeName) {
        content += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">LTPOC Name</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeName}</strong></td>
        </tr>`;
      }

      if (safePhone) {
        content += `
        <tr>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Phone</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safePhone}</strong></td>
        </tr>`;
      }

      if (safeEmail) {
        content += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Email</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeEmail}</strong></td>
        </tr>`;
      }

      return content;
    })
    .filter((row) => row !== null)
    .join('');

  if (!ltpocRows) {
    return '';
  }

  return `
    <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
      <tr style="background: #c9934f; color: white;">
        <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">LTPOC (LOCAL POINT OF CONTACT) DETAILS</th>
      </tr>
      ${ltpocRows}
    </table>
  `;
}

/**
 * Build vendor notification email HTML with LTPOC details
 * Displays LTPOC information (Name, Phone) for each vehicle
 */
function buildVendorNotificationHTML(data) {
  const {
    requestId,
    vendorName,
    clientName,
    city,
    vehicles = [],
    ltpocDetails = [],
    serviceType,
    vehicleAvailabilityLocation,
    vehicleAvailableTime,
  } = data;

  const requestDetailsTable = buildRequestDetailsTable({
    requestId,
    serviceType,
    city,
    clientName,
    vehicleAvailabilityLocation,
    vehicleAvailableTime,
  });

  const ltpocDetailsSection = buildLTPOCDetailsSection(ltpocDetails);

  const installationStatusTable = buildInstallationStatusTable(vehicles, ltpocDetails, vendorName);

  return `
    <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #1f6f78 0%, #15545a 100%); padding: 30px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.02em;">GPS Installation Request</h2>
      </div>
      
      <div style="padding: 40px; background: #fafbfc;">
        <p style="font-size: 16px; color: #333; margin-bottom: 30px;">Dear <strong>${safeValue(vendorName)}</strong> Team,</p>
        
        ${requestDetailsTable}

        ${ltpocDetailsSection}

        ${installationStatusTable}
        <div style="margin: 30px 0; padding: 20px; background: #fff3cd; border-left: 5px solid #ffc107; border-radius: 4px;">
          <p style="margin: 0; color: #856404; font-size: 14px;"><strong>⚠️ Action Required:</strong> Please acknowledge receipt and confirm service availability.</p>
        </div>
      </div>
      
      <div style="padding: 20px; background: #f8f9fa; color: #6c757d; font-size: 12px; text-align: center; border-top: 1px solid #dee2e6;">
        <p style="margin: 0;">GPS Installation Automation System</p>
      </div>
    </div>
  `;
}

// ============================================================
// ENDPOINTS
// ============================================================

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

// Consolidated Vendor Notification endpoint
app.post('/sendVendorBulkNotification', async (req, res) => {
  try {
    const { vendorName, rows = [] } = req.body;

    if (!vendorName || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'vendorName and non-empty rows are required.' });
    }

    const vendorEmails = {
      FleetX: 'anupgogeri2@gmail.com',
      WheelsEye: 'anupgogeri3@gmail.com',
    };

    const vendorEmail = vendorEmails[vendorName];
    if (!vendorEmail) {
      return res.status(400).json({ error: 'Invalid vendor name.' });
    }

    const sanitizedRows = rows.map((row) => ({
      requestId: safeValue(row.requestId),
      city: safeValue(row.city),
      clientName: safeValue(row.clientName),
      date: safeValue(row.date),
      serviceType: safeValue(row.serviceType),
      vehicleNumber: safeValue(row.vehicleNumber),
      vehicleAvailabilityLocation: safeValue(row.vehicleAvailabilityLocation),
      lpoAdditional: safeValue(row.lpoAdditional),
    }));

    const headers = [
      'Request ID', 'City', 'Client', 'Date', 'Service Type', 'Vehicle Number', 'Location',
      'LPO Additional'
    ];

    const csvRows = sanitizedRows.map((row) => [
      row.requestId,
      row.city,
      row.clientName,
      row.date,
      row.serviceType,
      row.vehicleNumber,
      row.vehicleAvailabilityLocation,
      row.lpoAdditional,
    ]);

    const csvBuffer = buildCsvBuffer(headers, csvRows);

    const tableRows = sanitizedRows
      .slice(0, 100)
      .map((row) => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">${row.city}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.clientName}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.date}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.serviceType}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.vehicleNumber}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.vehicleAvailabilityLocation}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.lpoAdditional}</td>
        </tr>
      `)
      .join('');

    await transporter.sendMail({
      from: 'anupgogeri4@gmail.com',
      to: vendorEmail,
      subject: 'Consolidated GPS Service Requests',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
          <h2>Consolidated GPS Service Requests</h2>
          <p>Dear ${vendorName} Team,</p>
          <p>Attached CSV contains vehicle-level consolidated rows. Service cost is intentionally excluded.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">
            <thead>
              <tr style="background:#f3f3f3;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">City</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Client</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Date</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Service Type</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vehicle Number</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Location</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">LPO Additional</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      `,
      attachments: [{
        filename: `${vendorName.toLowerCase()}_consolidated_${new Date().toISOString().slice(0, 10)}.csv`,
        content: csvBuffer,
      }],
    });

    return res.json({ success: true, count: sanitizedRows.length });
  } catch (error) {
    console.error('❌ Error sending consolidated vendor email:', error);
    return res.status(500).json({ error: 'Failed to send consolidated vendor email', details: error.message });
  }
});

// Consolidated FO Notification endpoint (one email per FO group)
app.post('/sendFoBulkNotification', async (req, res) => {
  try {
    const { foEmail, foName, rows = [] } = req.body;

    if (!foEmail || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'foEmail and non-empty rows are required.' });
    }

    const sanitizedRows = rows.map((row) => ({
      requestId: safeValue(row.requestId),
      city: safeValue(row.city),
      clientName: safeValue(row.clientName),
      date: safeValue(row.createdAt || row.date),
      serviceType: safeValue(row.serviceType),
      serviceCost: safeValue(row.serviceCost),
      vehicleNumber: safeValue(row.vehicleNumber),
      vehicleAvailabilityLocation: safeValue(row.vehicleAvailabilityLocation),
      lpoAdditional: safeValue(row.lpoAdditional),
    }));

    const headers = [
      'Request ID', 'City', 'Client', 'Date', 'Service Type', 'Service Cost', 'Vehicle Number', 'Location',
      'LPO Additional'
    ];

    const csvRows = sanitizedRows.map((row) => [
      row.requestId,
      row.city,
      row.clientName,
      row.date,
      row.serviceType,
      row.serviceCost,
      row.vehicleNumber,
      row.vehicleAvailabilityLocation,
      row.lpoAdditional,
    ]);

    const csvBuffer = buildCsvBuffer(headers, csvRows);

    await transporter.sendMail({
      from: 'anupgogeri4@gmail.com',
      to: foEmail,
      subject: 'GPS Service Initiated – Consolidated Summary',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
          <h2>GPS Service Initiated – Consolidated Summary</h2>
          <p>Dear ${safeValue(foName) || 'Field Operator'},</p>
          <p>Attached CSV contains your consolidated vehicle-level update including service cost and LPO details.</p>
          <p>Total rows: ${sanitizedRows.length}</p>
        </div>
      `,
      attachments: [{
        filename: `fo_consolidated_${new Date().toISOString().slice(0, 10)}.csv`,
        content: csvBuffer,
      }],
    });

    return res.json({ success: true, count: sanitizedRows.length, foEmail });
  } catch (error) {
    console.error('❌ Error sending consolidated FO email:', error);
    return res.status(500).json({ error: 'Failed to send consolidated FO email', details: error.message });
  }
});

// ============================================================
// SERVER START
// ============================================================

const BASE_PORT = Number(process.env.DEV_EMAIL_PORT || process.env.PORT || 3001);
const MAX_PORT_ATTEMPTS = 10;

const startServer = (port, attempt = 0) => {
  const server = app.listen(port, () => {
    console.log(`\n🚀 Development Email Server running on http://localhost:${port}`);
    if (port !== BASE_PORT) {
      console.log(`⚠️ Port ${BASE_PORT} was busy. Using fallback port ${port}.`);
    }
    console.log(`📧 Ready to send emails from: anupgogeri4@gmail.com\n`);
    console.log('📝 Endpoints:');
    console.log('   POST /sendOTP - Send OTP verification email');
    console.log('   POST /sendVendorBulkNotification - Send consolidated vendor email');
    console.log('   POST /sendFoBulkNotification - Send consolidated FO email');
    console.log('');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      const nextPort = port + 1;
      console.warn(`⚠️ Port ${port} is in use. Retrying on ${nextPort}...`);
      startServer(nextPort, attempt + 1);
      return;
    }

    throw error;
  });
};

startServer(BASE_PORT);
