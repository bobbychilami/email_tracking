const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create reusable transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify connection configuration
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    logger.info('Email server connection established successfully');
    return true;
  } catch (error) {
    logger.error('Email server connection failed:', error);
    return false;
  }
};

module.exports = { transporter, verifyEmailConfig };