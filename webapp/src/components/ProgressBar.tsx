'use client';

import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

interface ProgressBarProps {
  progress: {
    current: number;
    total: number;
    percent: number;
    currentPackage?: string;
    success?: number;
    failed?: number;
    broken?: number;
    phase?: string;
    errors?: Array<{ package: string; error: string }>;
  } | null;
  status: {
    status: string;
    message: string;
  } | null;
  isRunning: boolean;
}

export function ProgressBar({ progress, status, isRunning }: ProgressBarProps) {
  if (!progress && !status) {
    return null;
  }

  const getStatusIcon = () => {
    if (isRunning) {
      return <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />;
    }
    
    switch (status?.status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'completed_with_errors':
      case 'completed_with_issues':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = () => {
    if (isRunning) return 'bg-blue-500';
    
    switch (status?.status) {
      case 'completed':
        return 'bg-green-500';
      case 'completed_with_errors':
      case 'completed_with_issues':
        return 'bg-yellow-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="font-medium">
            {status?.message || 'Загрузка...'}
          </span>
        </div>
        {progress && (
          <span className="text-sm text-gray-500">
            {progress.current} / {progress.total}
          </span>
        )}
      </div>

      {progress && progress.total > 0 && (
        <div className="space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${getStatusColor()}`}
              style={{ width: `${Math.min(progress.percent, 100)}%` }}
            />
          </div>
          
          <div className="flex justify-between text-sm text-gray-500">
            <span>{progress.percent.toFixed(1)}%</span>
            {progress.currentPackage && (
              <span className="truncate max-w-xs">
                {progress.currentPackage}
              </span>
            )}
          </div>

          {(progress.success !== undefined || progress.failed !== undefined) && (
            <div className="flex gap-4 text-sm">
              {progress.success !== undefined && (
                <span className="text-green-600">
                  ✓ Успешно: {progress.success}
                </span>
              )}
              {progress.failed !== undefined && progress.failed > 0 && (
                <span className="text-red-600">
                  ✗ Ошибок: {progress.failed}
                </span>
              )}
              {progress.broken !== undefined && progress.broken > 0 && (
                <span className="text-yellow-600">
                  ⚠ Битых: {progress.broken}
                </span>
              )}
            </div>
          )}

          {/* Список ошибок */}
          {progress.errors && progress.errors.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <details className="text-sm">
                <summary className="cursor-pointer text-red-600 hover:text-red-700 font-medium">
                  Показать ошибки ({progress.errors.length})
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
                  {progress.errors.map((err, idx) => (
                    <div key={idx} className="bg-red-50 border border-red-200 rounded p-2">
                      <div className="font-mono text-red-800 font-medium">{err.package}</div>
                      <div className="text-red-600 text-xs mt-1 break-all">{err.error}</div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
