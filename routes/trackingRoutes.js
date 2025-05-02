const express = require('express');
const router = express.Router();
const {
    trackEmailOpen,
    getTrackingData,
    generateTrackingId,
    getStatistics
} = require('../controllers/trackingController');

// Main tracking endpoint for email opens
router.get('/track', trackEmailOpen);

// API endpoints
router.get('/tracking-data/:id', getTrackingData);
router.get('/generate-tracking-id', generateTrackingId);
router.get('/statistics', getStatistics);

module.exports = router;