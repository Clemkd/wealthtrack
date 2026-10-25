import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { enterDialog } from '../lib/dialogFocus';
import { registerDialog } from '../lib/dialogStack';

interface DialogProps {
  // Id of the element that names the dialog
  titleId: string;
  // Called when the user presses Escape while this dialog is the one on top
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}

// A modal that stays reachable on a short window (phone in landscape, zoom): it
// scrolls instead of overflowing above and below the screen. It takes the focus when
// it opens and gives it back when it closes. It is rendered at the end of the page, so
// that what is on top on screen is the last one opened, whatever its place in the
// component tree (a panel inside the sticky header would otherwise stay below a modal
// opened before it, and Escape would close the one that is hidden).
export default function Dialog({ titleId, onClose, className = '', children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const leave = dialogRef.current ? enterDialog(dialogRef.current, document) : () => {};
    const unregister = registerDialog(() => closeRef.current?.());
    return () => {
      unregister();
      leave();
    };
  }, []);

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full max-h-[90vh] overflow-y-auto outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
  // Server rendering (tests) has no page to attach to
  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
