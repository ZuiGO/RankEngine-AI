import mongoose from 'mongoose';
import app from './app';
import config from './config';
import { initAuditScheduler } from './services/auditSchedulerService';

const PORT = config.PORT;

mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log('[server]: MongoDB connection established successfully.');

    initAuditScheduler();

    app.listen(PORT, () => {
      console.log(`[server]: Server is running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server]: MongoDB connection failed to initialize:', err);
    process.exit(1);
  });
