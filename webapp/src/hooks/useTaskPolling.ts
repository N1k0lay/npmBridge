'use client';

import { useState, useEffect, useCallback } from 'react';

interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  currentPackage?: string;
  success?: number;
  failed?: number;
  broken?: number;
  phase?: string;
}

interface TaskStatus {
  status: string;
  message: string;
}

interface UseTaskPollingOptions {
  taskId: string | null;
  endpoint: string;
  interval?: number;
  onComplete?: (status: TaskStatus) => void;
}

export function useTaskPolling({
  taskId,
  endpoint,
  interval = 1000,
  onComplete,
}: UseTaskPollingOptions) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const poll = useCallback(async () => {
    if (!taskId) return;

    try {
      const res = await fetch(`${endpoint}?taskId=${taskId}`);
      const data = await res.json();

      setProgress(data.progress);
      setStatus(data.status);
      setIsRunning(data.running);

      if (!data.running && data.status) {
        onComplete?.(data.status);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [taskId, endpoint, onComplete]);

  useEffect(() => {
    if (!taskId) {
      setProgress(null);
      setStatus(null);
      setIsRunning(false);
      return;
    }

    poll();
    const pollInterval = setInterval(poll, interval);

    return () => clearInterval(pollInterval);
  }, [taskId, poll, interval]);

  return { progress, status, isRunning };
}
