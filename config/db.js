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
        id SERIAL PRIMARY KEY,
        tracking_id VARCHAR(255) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        ip VARCHAR(50),
        user_agent TEXT,
        country VARCHAR(50),
        region VARCHAR(100),
        city VARCHAR(100),
        latitude NUMERIC,
        longitude NUMERIC
      )
    `);
    logger.info('Database initialized successfully');
  } catch (err) {
    logger.error('Error initializing database:', err.message);
  }
};

module.exports = { pool, initDb };