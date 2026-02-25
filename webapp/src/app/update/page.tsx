'use client';

import { useState } from 'react';
import { UpdatePanel } from '@/components/UpdatePanel';
import { HistoryPanel } from '@/components/HistoryPanel';

export default function UpdatePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div key={refreshKey} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <UpdatePanel onUpdate={handleRefresh} />
      <HistoryPanel />
    </div>
  );
}
