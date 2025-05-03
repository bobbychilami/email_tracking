const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_tracking (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tracking_id VARCHAR(64) NOT NULL,
        original_recipient VARCHAR(255) NOT NULL,
        current_recipient VARCHAR(255),
        is_forwarded BOOLEAN DEFAULT FALSE,
        forwarded_chain TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        referer TEXT,
        country VARCHAR(64),
        region VARCHAR(64),
        city VARCHAR(64),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        timestamp DATETIME
      );
    `);
    logger.info('Database initialized successfully');
  } catch (err) {
    logger.error('Error initializing database:', err.message);
  }
};

module.exports = { pool, initDb };