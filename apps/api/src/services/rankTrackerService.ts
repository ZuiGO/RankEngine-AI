import mongoose from 'mongoose';
import cron from 'node-cron';
import { TrackedKeyword } from '../models/TrackedKeyword';
import { RankSnapshot } from '../models/RankSnapshot';
import { Project } from '../models/Project';
import { Organization } from '../models/Organization';
import { Notification } from '../models/Notification';
import { getSerpProvider } from './serpService';
import { getEmailService } from './emailService';
import config from '../config';

export const collectRankSnapshotForKeyword = async (
  projectId: string,
  keywordId: string,
  keyword: string,
  targetUrl: string,
  competitorDomains: string[] = []
): Promise<void> => {
  try {
    const serpProvider = getSerpProvider();
    let position = 101; // Default to unranked
    let aioPresence = false;

    const results = await serpProvider.fetchTop10(keyword);

    // Resolve targetUrl position
    if (
      config.SERP_API_PROVIDER === 'mock' ||
      !config.SERP_API_KEY ||
      config.SERP_API_KEY === 'mock-serp-key'
    ) {
      // Create a deterministic rank position based on string values for mock purposes
      const hash = keyword.length + targetUrl.length;
      position = (hash % 15) + 1; // Positions between 1 and 15
      aioPresence = hash % 2 === 0;
    } else {
      const index = results.findIndex((r) => r.url.toLowerCase().includes(targetUrl.toLowerCase()));
      if (index !== -1) {
        position = index + 1;
      }
      aioPresence = false;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Get the most recent preceding rank snapshot for comparison
    const latestSnapshotBeforeToday = await RankSnapshot.findOne({
      keywordId: new mongoose.Types.ObjectId(keywordId),
      date: { $lt: today },
    }).sort({ date: -1 });

    const competitorRanks: { domain: string; position: number }[] = [];

    // Parse and evaluate competitor position movements
    if (competitorDomains && competitorDomains.length > 0) {
      for (const comp of competitorDomains) {
        const compLower = comp.toLowerCase().trim();
        let compPos = 101;

        if (
          config.SERP_API_PROVIDER === 'mock' ||
          !config.SERP_API_KEY ||
          config.SERP_API_KEY === 'mock-serp-key'
        ) {
          // Semi-deterministic positioning for mock testing:
          const index = results.findIndex((r) => r.url.toLowerCase().includes(compLower));
          compPos = index !== -1 ? index + 1 : 101;
        } else {
          const index = results.findIndex((r) => r.url.toLowerCase().includes(compLower));
          if (index !== -1) {
            compPos = index + 1;
          }
        }

        competitorRanks.push({ domain: comp, position: compPos });

        // Compare position with previous snapshot
        if (latestSnapshotBeforeToday) {
          const prevComp = latestSnapshotBeforeToday.competitors.find(
            (c) => c.domain.toLowerCase().trim() === compLower
          );
          if (prevComp) {
            const prevPos = prevComp.position;
            const improvement = prevPos - compPos; // Decrease in index = improvement

            // If competitor improves by more than 3 positions (i.e. climbed 4 or more spots)
            if (improvement > 3 && compPos !== 101 && prevPos !== 101) {
              const project = await Project.findById(projectId);
              if (project) {
                const message = `Competitor "${comp}" jumped ${improvement} positions from #${prevPos} to #${compPos} for keyword "${keyword}"`;

                // Determine org owner for notifications
                const org = await Organization.findById(project.organizationId);
                const ownerUserId = org ? org.ownerId : project.organizationId;

                // Write Notification Document
                const notification = new Notification({
                  userId: ownerUserId,
                  projectId: project._id,
                  keywordId: new mongoose.Types.ObjectId(keywordId),
                  message,
                });
                await notification.save();

                // Send email alert
                const User = mongoose.model('User');
                const owner = await User.findById(ownerUserId);
                if (owner && owner.email) {
                  const emailService = getEmailService();
                  await emailService.sendEmail(
                    owner.email,
                    `SEO Alert: Competitor Jumped Ranks for "${keyword}"`,
                    `Hello,\n\nYour competitor "${comp}" improved their rankings by ${improvement} spots (from #${prevPos} to #${compPos}) for tracked keyword "${keyword}".\n\nProject: ${project.name}\nTarget URL: ${targetUrl}\n\nBest,\nRankEngine AI Team`
                  );
                }
              }
            }
          }
        }
      }
    }

    // Save rank snapshot
    await RankSnapshot.findOneAndUpdate(
      { keywordId, date: today },
      {
        projectId,
        position,
        aioPresence,
        competitors: competitorRanks,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error(`[RankTracker] Failed rank snap check for "${keyword}":`, err);
  }
};

export const collectAllRankSnapshots = async (): Promise<void> => {
  const keywords = await TrackedKeyword.find({});
  console.log(`[RankTracker]: Starting snapshots collection for ${keywords.length} keywords.`);
  for (const kw of keywords) {
    await collectRankSnapshotForKeyword(
      kw.projectId.toString(),
      kw._id.toString(),
      kw.keyword,
      kw.targetUrl,
      kw.competitorDomains
    );
  }
  console.log('[RankTracker]: Completed snapshots collection.');
};

/**
 * Initializes the Daily Rank Tracker cron job at midnight.
 */
export const initRankTrackerScheduler = () => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  cron.schedule('0 0 * * *', async () => {
    console.log('[RankTracker Scheduler]: Triggering daily rank snaps collection...');
    await collectAllRankSnapshots();
  });
  console.log('[RankTracker Scheduler]: Daily rank checks scheduled at midnight (0 0 * * *).');
};
