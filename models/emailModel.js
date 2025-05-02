const { transporter } = require('../config/email');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class emailModel {
  // Send email with tracking pixel
  static async sendEmail(emailData) {
    const { to, subject, htmlContent, trackingId = uuidv4() } = emailData;
    
    try {
      // Create tracking pixel HTML
      const trackingPixel = `<img src="${process.env.APP_URL}/api/track?id=${trackingId}" width="1" height="1" alt="" style="display:none !important;" border="0">`;
      
      // Append tracking pixel to HTML content
      const htmlWithTracker = htmlContent + trackingPixel;
      
      // Set up email data
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html: htmlWithTracker,
        // Adding header to prevent Gmail from clipping the tracking pixel
        headers: {
          'X-Entity-Ref-ID': trackingId
        }
      };
      
      // Send email
      const info = await transporter.sendMail(mailOptions);
      
      logger.info(`Email sent: ${info.messageId}`);
      
      return {
        success: true,
        trackingId,
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending email:', error);
      throw new Error('Failed to send email');
    }
  }
  
  // Send a bulk email to multiple recipients
  static async sendBulkEmail(bulkEmailData) {
    const { recipients, subject, htmlContent } = bulkEmailData;
    const results = [];
    
    try {
      // Process each recipient
      for (const recipient of recipients) {
        const trackingId = uuidv4();
        
        // Create personalized content if needed
        let personalizedHtml = htmlContent;
        if (recipient.name) {
          personalizedHtml = personalizedHtml.replace(/{{name}}/g, recipient.name);
        }
        
        // Send individual email with unique tracking ID
        const result = await this.sendEmail({
          to: recipient.email,
          subject,
          htmlContent: personalizedHtml,
          trackingId
        });
        
        results.push({
          email: recipient.email,
          trackingId: result.trackingId,
          success: result.success
        });
      }
      
      return {
        success: true,
        totalSent: results.length,
        results
      };
    } catch (error) {
      logger.error('Error sending bulk email:', error);
      throw new Error('Failed to send bulk email');
    }
  }
}

module.exports = emailModel;