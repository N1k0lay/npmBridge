'use client';

import { useState } from 'react';
import { DiffPanel } from '@/components/DiffPanel';
import { NetworksPanel } from '@/components/NetworksPanel';

export default function DiffPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div key={refreshKey} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <DiffPanel onRefresh={handleRefresh} />
      </div>
      <div>
        <NetworksPanel onNetworksChange={handleRefresh} />
      </div>
    </div>
  );
}
