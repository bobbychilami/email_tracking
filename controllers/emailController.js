const emailModel = require('../models/emailModel');
const logger = require('../utils/logger');

// Send a tracked email
const sendEmail = async (req, res) => {
  try {
    const { to, subject, htmlContent } = req.body;
    
    // Validate required fields
    if (!to || !subject || !htmlContent) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: to, subject, and htmlContent are required' 
      });
    }
    
    // Send email with tracking
    const result = await emailModel.sendEmail({
      to,
      subject,
      htmlContent
    });
    
    res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      trackingId: result.trackingId
    });
  } catch (err) {
    logger.error('Error in sendEmail controller:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send email' 
    });
  }
};

// Send bulk emails with tracking
const sendBulkEmail = async (req, res) => {
  try {
    const { recipients, subject, htmlContent } = req.body;
    
    // Validate required fields
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0 || !subject || !htmlContent) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing or invalid required fields' 
      });
    }
    
    // Validate recipient structure
    for (const recipient of recipients) {
      if (!recipient.email) {
        return res.status(400).json({ 
          success: false, 
          error: 'Each recipient must have an email address' 
        });
      }
    }
    
    // Send bulk emails
    const result = await emailModel.sendBulkEmail({
      recipients,
      subject,
      htmlContent
    });
    
    res.status(200).json({
      success: true,
      message: `${result.totalSent} emails sent successfully`,
      results: result.results
    });
  } catch (err) {
    logger.error('Error in sendBulkEmail controller:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send bulk emails' 
    });
  }
};

module.exports = {
  sendEmail,
  sendBulkEmail
};