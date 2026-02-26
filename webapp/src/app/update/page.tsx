'use client';

import { useState, useCallback } from 'react';
import { UpdatePanel } from '@/components/UpdatePanel';
import { HistoryPanel } from '@/components/HistoryPanel';

export default function UpdatePage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <UpdatePanel onUpdate={handleRefresh} />
      <HistoryPanel refreshTrigger={refreshTrigger} />
    </div>
  );
}
