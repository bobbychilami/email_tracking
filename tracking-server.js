// tracking-server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const requestIp = require('request-ip');
const geoip = require('geoip-lite');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your_password',
  database: process.env.DB_NAME || 'email_tracking',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize database
async function initDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    
    // Create tracking table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email_id VARCHAR(64) NOT NULL,
        recipient_email VARCHAR(255),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        country VARCHAR(100),
        region VARCHAR(100),
        city VARCHAR(100),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        user_agent TEXT,
        referrer TEXT,
        is_forward BOOLEAN DEFAULT FALSE,
        event_type ENUM('open', 'forward_open', 'click') NOT NULL
      )
    `);
    
    // Create emails table to store email metadata
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS emails (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email_id VARCHAR(64) UNIQUE NOT NULL,
        sender VARCHAR(255) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        sent_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        opened BOOLEAN DEFAULT FALSE,
        forwarded BOOLEAN DEFAULT FALSE
      )
    `);
    
    connection.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

// Load 1x1 transparent GIF
let TRACKING_PIXEL;
try {
  TRACKING_PIXEL = fs.readFileSync(path.join(__dirname, 'transparent.gif'));
  console.log('Loaded tracking pixel image');
} catch (error) {
  console.error('Failed to load tracking pixel image:', error);
  // Generate a transparent GIF on the fly if file doesn't exist
  TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
}

// Helper function to send tracking pixel
function sendTrackingPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(TRACKING_PIXEL);
}

// Generate a unique ID for each email
app.get('/generate-id', async (req, res) => {
  const sender = req.query.sender;
  const recipient = req.query.recipient;
  const subject = req.query.subject || 'No Subject';
  
  if (!sender || !recipient) {
    return res.status(400).json({ error: 'Sender and recipient are required' });
  }
  
  try {
    // Generate a unique ID
    const emailId = crypto.randomBytes(16).toString('hex');
    
    // Store email metadata
    await pool.execute(
      'INSERT INTO emails (email_id, sender, recipient, subject) VALUES (?, ?, ?, ?)',
      [emailId, sender, recipient, subject]
    );
    
    // Generate HTML snippet for easy copying
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const trackingPixelUrl = `${baseUrl}/track.gif?id=${emailId}`;
    const redirectUrl = `${baseUrl}/redirect?id=${emailId}&url=DESTINATION_URL`;
    
    const htmlSnippet = `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;">`;
    const linkSnippet = `<a href="${redirectUrl.replace('DESTINATION_URL', 'https://example.com')}">Click here</a>`;
    
    res.json({ 
      emailId, 
      trackingPixelUrl,
      redirectUrlTemplate: redirectUrl,
      htmlSnippet,
      linkSnippet
    });
  } catch (error) {
    console.error('Error generating email ID:', error);
    res.status(500).json({ error: 'Failed to generate email ID' });
  }
});

// Tracking pixel endpoint
app.get('/track.gif', async (req, res) => {
  const emailId = req.query.id;
  
  if (!emailId) {
    console.log('Missing email ID in tracking request');
    return sendTrackingPixel(res);
  }
  
  try {
    // Get client IP and location
    const ip = requestIp.getClientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referrer = req.headers.referer || 'Direct';
    
    console.log(`Tracking request for email ${emailId} from IP ${ip}`);
    
    // Check if this email exists
    const [emailRows] = await pool.execute(
      'SELECT * FROM emails WHERE email_id = ?',
      [emailId]
    );
    
    if (emailRows.length === 0) {
      console.log('Unknown email ID:', emailId);
      return sendTrackingPixel(res);
    }
    
    const email = emailRows[0];
    
    // Check if this is the first open or a subsequent open
    const [eventRows] = await pool.execute(
      'SELECT * FROM tracking_events WHERE email_id = ? ORDER BY timestamp ASC',
      [emailId]
    );
    
    // Extract location data
    const location = geo ? {
      country: geo.country || 'Unknown',
      region: geo.region || 'Unknown',
      city: geo.city || 'Unknown',
      latitude: geo.ll ? geo.ll[0] : null,
      longitude: geo.ll ? geo.ll[1] : null
    } : {
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      latitude: null,
      longitude: null
    };
    
    // Determine if this might be a forward
    let isForward = false;
    let eventType = 'open';
    
    if (eventRows.length > 0) {
      const firstEvent = eventRows[0];
      
      // If IP is different from the first open, it might be a forward
      if (firstEvent.ip_address && firstEvent.ip_address !== ip) {
        isForward = true;
        eventType = 'forward_open';
        
        // Update email record to mark as forwarded
        await pool.execute(
          'UPDATE emails SET forwarded = TRUE WHERE email_id = ?',
          [emailId]
        );
        
        console.log(`Detected potential forward of email ${emailId}`);
      }
    } else {
      // First open of the email
      await pool.execute(
        'UPDATE emails SET opened = TRUE WHERE email_id = ?',
        [emailId]
      );
      console.log(`First open of email ${emailId}`);
    }
    
    // Record the tracking event
    await pool.execute(
      `INSERT INTO tracking_events 
       (email_id, recipient_email, ip_address, country, region, city, latitude, longitude, 
        user_agent, referrer, is_forward, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        emailId, 
        email.recipient,
        ip,
        location.country,
        location.region,
        location.city,
        location.latitude,
        location.longitude,
        userAgent,
        referrer,
        isForward,
        eventType
      ]
    );
    
    // Send the tracking pixel
    sendTrackingPixel(res);
  } catch (error) {
    console.error('Tracking error:', error);
    sendTrackingPixel(res);
  }
});

// Redirect link for click tracking
app.get('/redirect', async (req, res) => {
  const { id, url } = req.query;
  
  if (!id || !url) {
    return res.status(400).send('Missing parameters');
  }
  
  try {
    // Get client IP and location
    const ip = requestIp.getClientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referrer = req.headers.referer || 'Direct';
    
    console.log(`Click tracking for email ${id} to URL ${url}`);
    
    // Check if this email exists
    const [emailRows] = await pool.execute(
      'SELECT * FROM emails WHERE email_id = ?',
      [id]
    );
    
    if (emailRows.length > 0) {
      const email = emailRows[0];
      
      // Extract location data
      const location = geo ? {
        country: geo.country || 'Unknown',
        region: geo.region || 'Unknown',
        city: geo.city || 'Unknown',
        latitude: geo.ll ? geo.ll[0] : null,
        longitude: geo.ll ? geo.ll[1] : null
      } : {
        country: 'Unknown',
        region: 'Unknown',
        city: 'Unknown',
        latitude: null,
        longitude: null
      };
      
      // Record the click event
      await pool.execute(
        `INSERT INTO tracking_events 
         (email_id, recipient_email, ip_address, country, region, city, latitude, longitude, 
          user_agent, referrer, is_forward, event_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, 
          email.recipient,
          ip,
          location.country,
          location.region,
          location.city,
          location.latitude,
          location.longitude,
          userAgent,
          referrer,
          false, // Not marking as forward for click events
          'click'
        ]
      );
    }
    
    // Redirect to the destination URL
    res.redirect(url);
  } catch (error) {
    console.error('Redirect error:', error);
    // Still redirect even if tracking fails
    res.redirect(url);
  }
});

// API to get tracking data for a specific email
app.get('/api/tracking/:emailId', async (req, res) => {
  try {
    const emailId = req.params.emailId;
    
    // Get email metadata
    const [emailRows] = await pool.execute(
      'SELECT * FROM emails WHERE email_id = ?',
      [emailId]
    );
    
    if (emailRows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }
    
    // Get tracking events
    const [eventRows] = await pool.execute(
      'SELECT * FROM tracking_events WHERE email_id = ? ORDER BY timestamp ASC',
      [emailId]
    );
    
    res.json({
      email: emailRows[0],
      events: eventRows
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API to list all emails
app.get('/api/emails', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM emails ORDER BY sent_timestamp DESC');
    res.json(rows);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Dashboard homepage
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Email Tracking Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
          h1, h2 { color: #333; }
          .container { max-width: 1200px; margin: 0 auto; }
          .card { background: #f9f9f9; border-radius: 5px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 12px 15px; text-align: left; }
          th { background-color: #f2f2f2; }
          tr:hover { background-color: #f5f5f5; }
          .button { background-color: #4CAF50; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; }
          .button:hover { background-color: #45a049; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; }
          input[type="text"], input[type="email"] { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
          .badge { display: inline-block; padding: 3px 7px; border-radius: 3px; font-size: 12px; }
          .badge-success { background-color: #4CAF50; color: white; }
          .badge-warning { background-color: #ff9800; color: white; }
          pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Email Tracking Dashboard</h1>
          
          <div class="card">
            <h2>Generate New Tracking Pixel</h2>
            <div class="form-group">
              <label for="sender">Sender Email:</label>
              <input type="email" id="sender" placeholder="your@gmail.com" required>
            </div>
            <div class="form-group">
              <label for="recipient">Recipient Email:</label>
              <input type="email" id="recipient" placeholder="recipient@example.com" required>
            </div>
            <div class="form-group">
              <label for="subject">Subject:</label>
              <input type="text" id="subject" placeholder="Email Subject" required>
            </div>
            <button class="button" onclick="generateTrackingId()">Generate</button>
            
            <div id="result" style="display:none; margin-top: 20px;">
              <h3>Your Tracking Information</h3>
              <p><strong>Email ID:</strong> <span id="emailId"></span></p>
              <p><strong>Tracking Pixel URL:</strong> <span id="trackingUrl"></span></p>
              
              <h3>HTML to Copy</h3>
              <p>Add this to the bottom of your email in Gmail:</p>
              <pre id="htmlSnippet"></pre>
              
              <p>Example tracked link:</p>
              <pre id="linkSnippet"></pre>
            </div>
          </div>
          
          <div class="card">
            <h2>Your Tracked Emails</h2>
            <div id="emails">Loading...</div>
          </div>
        </div>
        
        <script>
          // Load emails on page load
          document.addEventListener('DOMContentLoaded', loadEmails);
          
          // Function to generate a tracking ID
          async function generateTrackingId() {
            const sender = document.getElementById('sender').value;
            const recipient = document.getElementById('recipient').value;
            const subject = document.getElementById('subject').value;
            
            if (!sender || !recipient || !subject) {
              alert('Please fill all fields');
              return;
            }
            
            try {
              const response = await fetch(\`/generate-id?sender=\${encodeURIComponent(sender)}&recipient=\${encodeURIComponent(recipient)}&subject=\${encodeURIComponent(subject)}\`);
              const data = await response.json();
              
              if (data.error) {
                alert('Error: ' + data.error);
                return;
              }
              
              // Display the results
              document.getElementById('emailId').textContent = data.emailId;
              document.getElementById('trackingUrl').textContent = data.trackingPixelUrl;
              document.getElementById('htmlSnippet').textContent = data.htmlSnippet;
              document.getElementById('linkSnippet').textContent = data.linkSnippet;
              document.getElementById('result').style.display = 'block';
              
              // Reload the emails list
              loadEmails();
            } catch (error) {
              alert('Error generating tracking ID: ' + error.message);
            }
          }
          
          // Function to load all emails
          async function loadEmails() {
            try {
              const response = await fetch('/api/emails');
              const data = await response.json();
              
              if (data.error) {
                document.getElementById('emails').innerHTML = 'Error loading emails: ' + data.error;
                return;
              }
              
              if (data.length === 0) {
                document.getElementById('emails').innerHTML = '<p>No tracked emails yet.</p>';
                return;
              }
              
              const table = document.createElement('table');
              table.innerHTML = \`
                <tr>
                  <th>Sender</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Sent Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              \`;
              
              data.forEach(email => {
                let status = 'Not opened';
                let statusClass = '';
                
                if (email.forwarded) {
                  status = 'Forwarded';
                  statusClass = 'badge-warning';
                } else if (email.opened) {
                  status = 'Opened';
                  statusClass = 'badge-success';
                }
                
                const row = document.createElement('tr');
                row.innerHTML = \`
                  <td>\${email.sender}</td>
                  <td>\${email.recipient}</td>
                  <td>\${email.subject}</td>
                  <td>\${new Date(email.sent_timestamp).toLocaleString()}</td>
                  <td><span class="badge \${statusClass}">\${status}</span></td>
                  <td><a href="#" onclick="viewDetails('\${email.email_id}')">View Details</a></td>
                \`;
                table.appendChild(row);
              });
              
              document.getElementById('emails').innerHTML = '';
              document.getElementById('emails').appendChild(table);
            } catch (error) {
              document.getElementById('emails').innerHTML = 'Error loading emails: ' + error.message;
            }
          }
          
          // Function to view email details
          async function viewDetails(emailId) {
            try {
              const response = await fetch(\`/api/tracking/\${emailId}\`);
              const data = await response.json();
              
              if (data.error) {
                alert('Error: ' + data.error);
                return;
              }
              
              // Create a modal or new page with the details
              let detailsHTML = \`
                <div style="background: white; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 800px; max-height: 80vh; overflow-y: auto; padding: 20px; box-shadow: 0 0 20px rgba(0,0,0,0.3); border-radius: 5px; z-index: 1000;">
                  <h2>Email Tracking Details</h2>
                  <p><strong>Subject:</strong> \${data.email.subject}</p>
                  <p><strong>From:</strong> \${data.email.sender}</p>
                  <p><strong>To:</strong> \${data.email.recipient}</p>
                  <p><strong>Sent:</strong> \${new Date(data.email.sent_timestamp).toLocaleString()}</p>
                  <p><strong>Status:</strong> \${data.email.opened ? 'Opened' : 'Not opened'} \${data.email.forwarded ? '(Forwarded)' : ''}</p>
                  
                  <h3>Events</h3>
                  <table>
                    <tr>
                      <th>Type</th>
                      <th>Timestamp</th>
                      <th>IP Address</th>
                      <th>Location</th>
                      <th>Device</th>
                    </tr>
              \`;
              
              if (data.events.length === 0) {
                detailsHTML += '<tr><td colspan="5">No events recorded yet</td></tr>';
              } else {
                data.events.forEach(event => {
                  let eventType = event.event_type;
                  if (eventType === 'open') eventType = 'Email Open';
                  if (eventType === 'forward_open') eventType = 'Forward Open';
                  if (eventType === 'click') eventType = 'Link Click';
                  
                  const location = [event.city, event.region, event.country].filter(Boolean).join(', ');
                  
                  detailsHTML += \`
                    <tr>
                      <td>\${eventType}</td>
                      <td>\${new Date(event.timestamp).toLocaleString()}</td>
                      <td>\${event.ip_address}</td>
                      <td>\${location || 'Unknown'}</td>
                      <td>\${event.user_agent}</td>
                    </tr>
                  \`;
                });
              }
              
              detailsHTML += \`
                  </table>
                  <div style="margin-top: 20px; text-align: right;">
                    <button onclick="document.getElementById('detailsModal').remove()">Close</button>
                  </div>
                </div>
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999;"></div>
              \`;
              
              const modalContainer = document.createElement('div');
              modalContainer.id = 'detailsModal';
              modalContainer.innerHTML = detailsHTML;
              document.body.appendChild(modalContainer);
            } catch (error) {
              alert('Error loading details: ' + error.message);
            }
          }
        </script>
      </body>
    </html>
  `);
});

// Initialize the database and start the server
async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Tracking server running on http://localhost:${PORT}`);
  });
}

startServer();