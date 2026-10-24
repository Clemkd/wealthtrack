import { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'warning';

const STYLES: Record<Tone, string> = {
  error: 'bg-red-50 border-red-200 text-red-700',
  success: 'bg-green-50 border-green-200 text-green-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
};

interface NoticeProps {
  tone: Tone;
  className?: string;
  children: ReactNode;
}

// A message that appears after an action: announced by screen readers (an alert for
// what went wrong, a status for what went well).
export default function Notice({ tone, className = '', children }: NoticeProps) {
  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={`flex items-center gap-2 border px-3 py-2 rounded-lg text-sm ${STYLES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
