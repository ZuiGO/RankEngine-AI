import { Card, CardBody } from '../components/ui';

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-app-text-muted text-sm mt-1">Application settings.</p>
      </div>

      <Card>
        <CardBody>
          <h2 className="text-sm font-bold text-white mb-2">About</h2>
          <p className="text-xs text-app-text-muted">
            RankEngine AI — Internal SEO Audit Tool.
          </p>
          <p className="text-xs text-app-text-muted mt-1">v1.0</p>
        </CardBody>
      </Card>
    </div>
  );
}
