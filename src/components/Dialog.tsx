import { ReactNode } from 'react';

interface DialogProps {
  // Id of the element that names the dialog
  titleId: string;
  className?: string;
  children: ReactNode;
}

// A modal that stays reachable on a short window (phone in landscape, zoom): it
// scrolls instead of overflowing above and below the screen.
export default function Dialog({ titleId, className = '', children }: DialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-h-[90vh] overflow-y-auto ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
