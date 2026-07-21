import { Router, Request, Response } from 'express';
import { Notification } from '../models/Notification';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({}).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ read: false }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[Notifications] GET /api/notifications error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json(notification);
  } catch (err) {
    console.error('[Notifications] PATCH error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
