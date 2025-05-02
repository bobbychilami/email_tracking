const { pool } = require('../config/db');
const logger = require('../utils/logger');

class trackingModel {
  // Record an email open event
  static async recordOpen(trackingData) {
    const {
      trackingId,
      timestamp,
      ip,
      userAgent,
      country,
      region,
      city,
      latitude,
      longitude
    } = trackingData;

    try {
      const query = `
        INSERT INTO email_tracking 
        (tracking_id, timestamp, ip, user_agent, country, region, city, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;

      const values = [
        trackingId,
        timestamp,
        ip,
        userAgent,
        country,
        region,
        city,
        latitude,
        longitude
      ];

      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Database error in recordOpen:', error);
      throw new Error('Failed to record email open event');
    }
  }

  // Get tracking data for a specific ID
  static async getTrackingData(trackingId) {
    try {
      // First get all opens for this tracking ID
      const result = await pool.query(
        'SELECT * FROM email_tracking WHERE tracking_id = $1 ORDER BY timestamp ASC',
        [trackingId]
      );

      const opens = result.rows;

      // If we have multiple opens, structure them as original + forwarded
      if (opens.length > 0) {
        const originalOpen = opens[0]; // The first open is the original

        // Any subsequent opens could be forwarded emails
        if (opens.length > 1) {
          // Add forwarded emails as child objects
          originalOpen.forwarded_data = opens.slice(1).map(open => {
            // For each forwarded open, determine if it's from a different IP/user-agent
            const isNewDevice = open.ip !== originalOpen.ip ||
              open.user_agent !== originalOpen.user_agent;

            return {
              ...open,
              is_forwarded: isNewDevice // Mark as likely forwarded if from different device/IP
            };
          });
        } else {
          originalOpen.forwarded_data = []; // No forwards detected
        }

        return [originalOpen]; // Return just the parent with children nested
      }

      return opens; // Return all opens if structuring isn't needed
    } catch (error) {
      logger.error('Database error in getTrackingData:', error);
      throw new Error('Failed to retrieve tracking data');
    }
  }

  // Get summary statistics for all tracking IDs
  static async getStatistics() {
    try {
      const result = await pool.query(`
        SELECT 
          tracking_id,
          COUNT(*) as open_count,
          MIN(timestamp) as first_open,
          MAX(timestamp) as last_open
        FROM email_tracking
        GROUP BY tracking_id
        ORDER BY last_open DESC
      `);
      return result.rows;
    } catch (error) {
      logger.error('Database error in getStatistics:', error);
      throw new Error('Failed to retrieve tracking statistics');
    }
  }
}

module.exports = trackingModel;