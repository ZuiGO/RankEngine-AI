import mongoose from 'mongoose';
import app from './app';
import config from './config';
import { initRankTrackerScheduler } from './services/rankTrackerService';
import { initAuditScheduler } from './services/auditSchedulerService';

const PORT = config.PORT;

// Connect to MongoDB using the validated MONGODB_URI
mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log('[server]: MongoDB connection established successfully.');

    // Initialize scheduled rank tracking jobs
    initRankTrackerScheduler();

    // Initialize scheduled auto-audit jobs
    initAuditScheduler();

    app.listen(PORT, () => {
      console.log(`[server]: Server is running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server]: MongoDB connection failed to initialize:', err);
    process.exit(1);
  });
