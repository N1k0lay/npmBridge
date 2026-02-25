'use client';

import { useState } from 'react';
import { BrokenPanel } from '@/components/BrokenPanel';

export default function BrokenPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div key={refreshKey}>
      <BrokenPanel onRefresh={handleRefresh} />
    </div>
  );
}
