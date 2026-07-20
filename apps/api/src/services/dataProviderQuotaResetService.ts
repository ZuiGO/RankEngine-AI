import cron from 'node-cron';
import User from '../models/User';

export const resetAllQuotas = async (): Promise<void> => {
  const now = new Date();
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const result = await User.updateMany(
    { dataProviderCallsThisMonth: { $gt: 0 } },
    {
      $set: {
        dataProviderCallsThisMonth: 0,
        dataProviderQuotaResetAt: nextReset,
      },
    }
  );

  console.log(
    `[DataProviderQuotaReset]: Reset quotas for ${result.modifiedCount} users. Next reset: ${nextReset.toISOString().split('T')[0]}`
  );
};

export const initDataProviderQuotaReset = (): void => {
  cron.schedule('0 0 1 * *', async () => {
    console.log('[DataProviderQuotaReset]: Monthly quota reset cron triggered');
    try {
      await resetAllQuotas();
    } catch (err) {
      console.error('[DataProviderQuotaReset]: Failed to reset quotas:', err);
    }
  });

  console.log(
    '[DataProviderQuotaReset]: Monthly quota reset cron scheduled for 1st of each month at midnight'
  );
};
