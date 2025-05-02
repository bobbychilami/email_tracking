require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./config/db');
const { verifyEmailConfig } = require('./config/email');
const trackingRoutes = require('./routes/trackingRoutes');
const emailRoutes = require('./routes/emailRoutes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Initialize express app
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Initialize database
initDb();

// Verify email configuration
verifyEmailConfig();

// Routes
app.use('/api', trackingRoutes);
app.use('/api', emailRoutes);

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});