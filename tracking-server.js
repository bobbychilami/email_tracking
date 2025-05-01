// server.js - Main application file
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        email_id VARCHAR(36) REFERENCES emails(email_id),
        ip_address TEXT,
        user_agent TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT DEFAULT 'open'
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
  const { recipient, subject } = req.body;
  
  if (!recipient) {
    return res.status(400).json({ error: 'Recipient email is required' });
  }

  const emailId = uuidv4();
  
  try {
    await pool.query(
      'INSERT INTO emails (email_id, recipient, subject) VALUES ($1, $2, $3)',
      [emailId, recipient, subject || '']
    );

    const trackingUrl = `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/pixel/${emailId}.png`;
    
    res.json({
      emailId,
      trackingUrl,
      trackingHtml: `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none;" />`
    });
  } catch (err) {
    console.error('Error creating tracking pixel:', err);
    res.status(500).json({ error: 'Failed to create tracking pixel' });
  }
});

// Route to serve the tracking pixel
app.get('/pixel/:emailId.png', async (req, res) => {
  const { emailId } = req.params;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Create a 1x1 transparent pixel
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

  // Set response headers
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', pixel.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Log the tracking event
  try {
    await pool.query(
      'INSERT INTO tracking_events (email_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [emailId, ipAddress, userAgent]
    );
  } catch (err) {
    console.error('Error logging tracking event:', err);
  }
  
  // Send the pixel
  res.end(pixel);
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
    
    res.json({
      email: emailResult.rows[0],
      events: eventsResult.rows,
      openCount: eventsResult.rows.length
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
