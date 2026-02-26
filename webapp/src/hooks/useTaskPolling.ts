'use client';

import { useState, useEffect, useCallback, useRef } from 'react';


export interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  currentPackage?: string;
  success?: number;
  failed?: number;
  broken?: number;
  phase?: string;
}

export interface TaskStatus {
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
  interval = 3000,
  onComplete,
}: UseTaskPollingOptions) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  
  // Используем ref для onComplete чтобы избежать пересоздания poll
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Защита от повторного вызова onComplete до срабатывания clearInterval
  const completedRef = useRef(false);

  const poll = useCallback(async () => {
    if (!taskId) return;

    try {
      const res = await fetch(`${endpoint}?taskId=${taskId}`);
      const data = await res.json();

      setProgress(data.progress);
      setStatus(data.status);
      setIsRunning(data.running);

      if (!data.running && data.status && !completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.(data.status);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [taskId, endpoint]);

  useEffect(() => {
    completedRef.current = false;

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
