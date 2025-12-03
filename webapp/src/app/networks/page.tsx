'use client';

import { useState } from 'react';
import { NetworksPanel } from '@/components/NetworksPanel';

export default function NetworksPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div key={refreshKey} className="max-w-2xl">
      <NetworksPanel onNetworksChange={handleRefresh} />
    </div>
  );
}
