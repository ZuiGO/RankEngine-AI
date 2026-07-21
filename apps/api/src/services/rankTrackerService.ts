import mongoose from 'mongoose';
import cron from 'node-cron';
import { TrackedKeyword } from '../models/TrackedKeyword';
import { RankSnapshot } from '../models/RankSnapshot';
import { Project } from '../models/Project';
import { Notification } from '../models/Notification';
import { getSerpProvider } from './serpService';
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
    let position = 101;
    let aioPresence = false;

    const results = await serpProvider.fetchTop10(keyword);

    if (
      config.SERP_API_PROVIDER === 'mock' ||
      !config.SERP_API_KEY ||
      config.SERP_API_KEY === 'mock-serp-key'
    ) {
      const hash = keyword.length + targetUrl.length;
      position = (hash % 15) + 1;
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

    const latestSnapshotBeforeToday = await RankSnapshot.findOne({
      keywordId: new mongoose.Types.ObjectId(keywordId),
      date: { $lt: today },
    }).sort({ date: -1 });

    const competitorRanks: { domain: string; position: number }[] = [];

    if (competitorDomains && competitorDomains.length > 0) {
      for (const comp of competitorDomains) {
        const compLower = comp.toLowerCase().trim();
        let compPos = 101;

        if (
          config.SERP_API_PROVIDER === 'mock' ||
          !config.SERP_API_KEY ||
          config.SERP_API_KEY === 'mock-serp-key'
        ) {
          const index = results.findIndex((r) => r.url.toLowerCase().includes(compLower));
          compPos = index !== -1 ? index + 1 : 101;
        } else {
          const index = results.findIndex((r) => r.url.toLowerCase().includes(compLower));
          if (index !== -1) {
            compPos = index + 1;
          }
        }

        competitorRanks.push({ domain: comp, position: compPos });

        if (latestSnapshotBeforeToday) {
          const prevComp = latestSnapshotBeforeToday.competitors.find(
            (c) => c.domain.toLowerCase().trim() === compLower
          );
          if (prevComp) {
            const prevPos = prevComp.position;
            const improvement = prevPos - compPos;

            if (improvement > 3 && compPos !== 101 && prevPos !== 101) {
              const project = await Project.findById(projectId);
              if (project) {
                const message = `Competitor "${comp}" jumped ${improvement} positions from #${prevPos} to #${compPos} for keyword "${keyword}"`;

                const notification = new Notification({
                  projectId: project._id,
                  keywordId: new mongoose.Types.ObjectId(keywordId),
                  message,
                });
                await notification.save();
              }
            }
          }
        }
      }
    }

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
