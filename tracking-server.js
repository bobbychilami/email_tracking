// server.js - Main application file
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initializeDatabase() {
  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id SERIAL PRIMARY KEY,
        email_id VARCHAR(36) UNIQUE NOT NULL,
        subject TEXT,
        recipient TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        parent_email_id VARCHAR(36) DEFAULT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        email_id VARCHAR(36) REFERENCES emails(email_id),
        ip_address TEXT,
        user_agent TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT DEFAULT 'open',
        location JSON DEFAULT NULL,
        device_info JSON DEFAULT NULL,
        forwarded_to TEXT DEFAULT NULL
      );
    `);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
  }
}

// API route to create a new tracking pixel
app.post('/api/create-tracker', async (req, res) => {
  const { recipient, subject, parentEmailId } = req.body;
  
  if (!recipient) {
    return res.status(400).json({ error: 'Recipient email is required' });
  }

  const emailId = uuidv4();
  
  try {
    await pool.query(
      'INSERT INTO emails (email_id, recipient, subject, parent_email_id) VALUES ($1, $2, $3, $4)',
      [emailId, recipient, subject || '', parentEmailId || null]
    );

    const trackingUrl = `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/pixel/${emailId}.png`;
    
    // Create a unique forwarding tracker ID
    const forwardingId = uuidv4();
    const forwardingUrl = `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/forward/${emailId}/${forwardingId}`;
    
    res.json({
      emailId,
      trackingUrl,
      forwardingUrl,
      trackingHtml: `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none;" />
                    <a href="${forwardingUrl}" style="display:none;">f</a>`,
      forwardingInstructions: `To track forwarded emails, add a forward button with this link: ${forwardingUrl}`
    });
  } catch (err) {
    console.error('Error creating tracking pixel:', err);
    res.status(500).json({ error: 'Failed to create tracking pixel' });
  }
});

// Function to get location data from IP address
async function getLocationFromIp(ipAddress) {
  if (!ipAddress || ipAddress === '127.0.0.1' || ipAddress === '::1') {
    return { country: 'Unknown', city: 'Unknown', lat: 0, lng: 0 };
  }
  
  try {
    // Use ipinfo.io for geolocation (free tier has limits)
    const response = await axios.get(`https://ipinfo.io/${ipAddress}/json?token=${process.env.IPINFO_TOKEN || ''}`);
    
    const location = {
      country: response.data.country || 'Unknown',
      region: response.data.region || 'Unknown',
      city: response.data.city || 'Unknown',
      timezone: response.data.timezone || 'Unknown'
    };
    
    // Parse location coordinates if available
    if (response.data.loc) {
      const [lat, lng] = response.data.loc.split(',');
      location.lat = parseFloat(lat);
      location.lng = parseFloat(lng);
    }
    
    return location;
  } catch (error) {
    console.error('Error getting location data:', error);
    return { country: 'Unknown', city: 'Unknown', lat: 0, lng: 0 };
  }
}

// Function to parse user agent for device info
function parseUserAgent(userAgent) {
  const deviceInfo = {
    browser: 'Unknown',
    os: 'Unknown',
    device: 'Unknown'
  };
  
  // Simple browser detection
  if (userAgent.includes('Firefox')) {
    deviceInfo.browser = 'Firefox';
  } else if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    deviceInfo.browser = 'Chrome';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    deviceInfo.browser = 'Safari';
  } else if (userAgent.includes('Edg')) {
    deviceInfo.browser = 'Edge';
  } else if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    deviceInfo.browser = 'Internet Explorer';
  }
  
  // Simple OS detection
  if (userAgent.includes('Windows')) {
    deviceInfo.os = 'Windows';
  } else if (userAgent.includes('Mac OS')) {
    deviceInfo.os = 'MacOS';
  } else if (userAgent.includes('Linux')) {
    deviceInfo.os = 'Linux';
  } else if (userAgent.includes('Android')) {
    deviceInfo.os = 'Android';
    deviceInfo.device = 'Mobile';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    deviceInfo.os = 'iOS';
    deviceInfo.device = userAgent.includes('iPad') ? 'Tablet' : 'Mobile';
  }
  
  if (!deviceInfo.device) {
    deviceInfo.device = (deviceInfo.os === 'Android' || deviceInfo.os === 'iOS') ? 'Mobile' : 'Desktop';
  }
  
  return deviceInfo;
}

// Route to serve the tracking pixel
app.get('/pixel/:emailId.png', async (req, res) => {
  const { emailId } = req.params;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const referer = req.headers['referer'] || '';
  
  // Create a 1x1 transparent pixel
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

  // Set response headers
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', pixel.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Get location data and device info asynchronously
  const locationPromise = getLocationFromIp(ipAddress);
  const deviceInfo = parseUserAgent(userAgent);
  
  try {
    // Wait for location data
    const location = await locationPromise;
    
    // Log the tracking event with enhanced data
    await pool.query(
      'INSERT INTO tracking_events (email_id, ip_address, user_agent, location, device_info) VALUES ($1, $2, $3, $4, $5)',
      [emailId, ipAddress, userAgent, JSON.stringify(location), JSON.stringify(deviceInfo)]
    );
  } catch (err) {
    console.error('Error logging tracking event:', err);
  }
  
  // Send the pixel
  res.end(pixel);
});

// Route to handle email forwarding tracking
app.get('/forward/:emailId/:forwardingId', async (req, res) => {
  const { emailId, forwardingId } = req.params;
  
  try {
    // Check if the email exists
    const emailResult = await pool.query(
      'SELECT * FROM emails WHERE email_id = $1',
      [emailId]
    );
    
    if (emailResult.rows.length === 0) {
      return res.status(404).send('Email not found');
    }
    
    // Render a simple form to track forwarded emails
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Forward Email</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; }
          input, button { width: 100%; padding: 8px; box-sizing: border-box; }
          button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
          button:hover { background-color: #45a049; }
        </style>
      </head>
      <body>
        <h2>Forward This Email</h2>
        <form id="forwardForm">
          <div class="form-group">
            <label for="recipient">Recipient Email:</label>
            <input type="email" id="recipient" required>
          </div>
          <div class="form-group">
            <button type="submit">Forward</button>
          </div>
        </form>
        
        <script>
          document.getElementById('forwardForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const recipient = document.getElementById('recipient').value;
            
            try {
              const response = await fetch('/api/create-tracker', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  recipient: recipient,
                  subject: 'Forwarded: ${emailResult.rows[0].subject}',
                  parentEmailId: '${emailId}'
                }),
              });
              
              const data = await response.json();
              
              // Record forwarding event
              await fetch('/api/record-forward', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  emailId: '${emailId}',
                  forwardingId: '${forwardingId}',
                  forwardedTo: recipient
                }),
              });
              
              alert('Email forwarded! A tracking link has been created.');
              document.body.innerHTML = '<h2>Email Forwarded</h2><p>The email has been forwarded with tracking enabled.</p>';
            } catch (error) {
              console.error('Error:', error);
              alert('Failed to forward the email.');
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error handling email forwarding:', err);
    res.status(500).send('An error occurred');
  }
});

// API route to record forwarding events
app.post('/api/record-forward', async (req, res) => {
  const { emailId, forwardingId, forwardedTo } = req.body;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    // Get location and device info
    const location = await getLocationFromIp(ipAddress);
    const deviceInfo = parseUserAgent(userAgent);
    
    // Record the forwarding event
    await pool.query(
      'INSERT INTO tracking_events (email_id, ip_address, user_agent, event_type, location, device_info, forwarded_to) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [emailId, ipAddress, userAgent, 'forward', JSON.stringify(location), JSON.stringify(deviceInfo), forwardedTo]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error recording forwarding event:', err);
    res.status(500).json({ error: 'Failed to record forwarding event' });
  }
});

// API route to get tracking data for an email
app.get('/api/tracking/:emailId', async (req, res) => {
  const { emailId } = req.params;
  
  try {
    // Get email details
    const emailResult = await pool.query(
      'SELECT * FROM emails WHERE email_id = $1',
      [emailId]
    );
    
    if (emailResult.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }
    
    // Get tracking events
    const eventsResult = await pool.query(
      'SELECT * FROM tracking_events WHERE email_id = $1 ORDER BY timestamp DESC',
      [emailId]
    );
    
    // Get forwarded emails
    const forwardedResult = await pool.query(
      'SELECT * FROM emails WHERE parent_email_id = $1',
      [emailId]
    );
    
    // Get forwarded email events
    const forwardedEvents = [];
    if (forwardedResult.rows.length > 0) {
      for (const forwardedEmail of forwardedResult.rows) {
        const forwardedEmailEvents = await pool.query(
          'SELECT * FROM tracking_events WHERE email_id = $1 ORDER BY timestamp DESC',
          [forwardedEmail.email_id]
        );
        
        forwardedEvents.push({
          forwardedEmail: forwardedEmail,
          events: forwardedEmailEvents.rows
        });
      }
    }
    
    res.json({
      email: emailResult.rows[0],
      events: eventsResult.rows,
      openCount: eventsResult.rows.filter(e => e.event_type === 'open').length,
      forwardCount: eventsResult.rows.filter(e => e.event_type === 'forward').length,
      forwardedEmails: forwardedResult.rows,
      forwardedEmailEvents: forwardedEvents
    });
  } catch (err) {
    console.error('Error fetching tracking data:', err);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

// API route to get all tracked emails
app.get('/api/emails', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, COUNT(t.id) AS open_count 
      FROM emails e 
      LEFT JOIN tracking_events t ON e.email_id = t.email_id 
      GROUP BY e.id 
      ORDER BY e.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching emails:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Basic index route for API info
app.get('/', (req, res) => {
  res.json({
    name: 'Email Tracking Pixel API',
    endpoints: [
      { method: 'POST', path: '/api/create-tracker', description: 'Create a new tracking pixel' },
      { method: 'GET', path: '/pixel/:emailId.png', description: 'Tracking pixel endpoint' },
      { method: 'GET', path: '/api/tracking/:emailId', description: 'Get tracking data for an email' },
      { method: 'GET', path: '/api/emails', description: 'Get all tracked emails' }
    ]
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
