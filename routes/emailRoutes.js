const express = require('express');
const router = express.Router();
const {
    sendEmail,
    sendBulkEmail
} = require('../controllers/emailController');

router.post('/send-email', sendEmail);
router.get('/send-bulk-email', sendBulkEmail);

module.exports = router;