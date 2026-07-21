import { useNotifications } from '../context/NotificationContext';

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, refresh } = useNotifications();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-app-text">Notifications</h1>
        <button
          onClick={refresh}
          className="text-sm text-app-signal hover:text-app-signal/80 transition-colors"
        >
          Refresh
        </button>
      </div>
      {unreadCount > 0 && (
        <p className="text-sm text-app-text-muted mb-4">{unreadCount} unread</p>
      )}
      {notifications.length === 0 ? (
        <p className="text-app-text-muted">No notifications yet.</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n._id}
              className={`p-4 rounded-lg border transition-colors ${
                n.read
                  ? 'bg-app-surface border-app-border'
                  : 'bg-app-signal/5 border-app-signal/20'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <p className={`text-sm ${n.read ? 'text-app-text-muted' : 'text-app-text'}`}>
                  {n.message}
                </p>
                {!n.read && (
                  <button
                    onClick={() => markRead(n._id)}
                    className="text-xs text-app-signal hover:text-app-signal/80 whitespace-nowrap"
                  >
                    Mark read
                  </button>
                )}
              </div>
              <p className="text-xs text-app-text-muted mt-1">
                {new Date(n.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
