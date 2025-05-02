const { v4: uuidv4 } = require('uuid');
const geoip = require('geoip-lite');
const trackingModel = require('../models/trackingModel');
const logger = require('../utils/logger');

// Transparent 1x1 GIF pixel (base64 encoded)
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Controller for tracking email opens
const trackEmailOpen = async (req, res) => {
    try {
        const trackingId = req.query.id;
        if (!trackingId) {
            return sendTrackingPixel(res); // Still send pixel but don't record
        }

        const userAgent = req.headers['user-agent'];
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const timestamp = new Date();

        // Get location data based on IP
        const geo = geoip.lookup(ip);

        // Prepare tracking data
        const trackingData = {
            trackingId,
            timestamp,
            ip,
            userAgent,
            country: geo ? geo.country : null,
            region: geo ? geo.region : null,
            city: geo ? geo.city : null,
            latitude: geo ? geo.ll[0] : null,
            longitude: geo ? geo.ll[1] : null
        };

        // Record the open event (don't await to speed up response)
        trackingModel.recordOpen(trackingData)
            .then(() => {
                logger.info(`Email ${trackingId} opened at ${timestamp}`);
                if (geo) {
                    logger.info(`Location: ${geo.city}, ${geo.region}, ${geo.country}`);
                }
            })
            .catch(err => {
                logger.error('Failed to record tracking data:', err);
            });

        // Return the tracking pixel immediately
        sendTrackingPixel(res);
    } catch (err) {
        logger.error('Error in trackEmailOpen:', err);
        sendTrackingPixel(res); // Still send pixel even if tracking fails
    }
};

// Helper function to send tracking pixel
const sendTrackingPixel = (res) => {
    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': TRACKING_PIXEL.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(TRACKING_PIXEL);
};

// Get tracking data for a particular ID
const getTrackingData = async (req, res) => {
    try {
        const trackingId = req.params.id;
        const data = await trackingModel.getTrackingData(trackingId);
        res.json(data);
    } catch (err) {
        logger.error('Error in getTrackingData:', err);
        res.status(500).json({ error: 'Failed to retrieve tracking data' });
    }
};

// Generate a new tracking ID
const generateTrackingId = (req, res) => {
    try {
        const trackingId = uuidv4();
        res.json({ trackingId });
    } catch (err) {
        logger.error('Error in generateTrackingId:', err);
        res.status(500).json({ error: 'Failed to generate tracking ID' });
    }
};

// Get statistics across all tracking IDs
const getStatistics = async (req, res) => {
    try {
        const stats = await trackingModel.getStatistics();
        res.json(stats);
    } catch (err) {
        logger.error('Error in getStatistics:', err);
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
};

module.exports = {
    trackEmailOpen,
    getTrackingData,
    generateTrackingId,
    getStatistics
};