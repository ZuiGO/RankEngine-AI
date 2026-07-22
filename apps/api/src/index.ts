import mongoose from 'mongoose';
import app from './app';
import config from './config';
import { initAuditScheduler } from './services/auditSchedulerService';

const PORT = config.PORT;

async function connectWithRetry(maxRetries = 30, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(config.MONGODB_URI);
      console.log('[server]: MongoDB connection established successfully.');
      return;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error('[server]: MongoDB connection failed after max retries:', err);
        process.exit(1);
      }
      console.log(
        `[server]: MongoDB not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

connectWithRetry().then(() => {
  initAuditScheduler();

  app.listen(PORT, () => {
    console.log(`[server]: Server is running at http://localhost:${PORT}`);
  });
});
