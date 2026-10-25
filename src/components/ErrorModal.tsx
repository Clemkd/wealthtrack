import { useState } from 'react';
import Dialog from './Dialog';
import { X, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

interface ErrorModalProps {
  error: string;
  stackTrace?: string;
  onClose: () => void;
}

export default function ErrorModal({ error, stackTrace, onClose }: ErrorModalProps) {
  const [showStack, setShowStack] = useState(false);

  return (
    <Dialog
      titleId="error-modal-title"
      onClose={onClose}
      className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 max-w-lg"
    >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle aria-hidden="true" className="w-5 h-5" />
            <h2 id="error-modal-title" className="text-lg font-semibold">Erreur</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 text-gray-300 hover:text-white transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-gray-200">{error}</p>

          {stackTrace && (
            <div>
              <button
                onClick={() => setShowStack(!showStack)}
                aria-expanded={showStack}
                aria-controls="error-modal-stack"
                className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
              >
                {showStack ? (
                  <ChevronDown aria-hidden="true" className="w-4 h-4" />
                ) : (
                  <ChevronRight aria-hidden="true" className="w-4 h-4" />
                )}
                Détails techniques
              </button>
              {showStack && (
                <pre id="error-modal-stack" className="mt-2 p-3 bg-gray-800 rounded-lg text-xs text-gray-300 overflow-auto max-h-60 whitespace-pre-wrap break-words">
                  {stackTrace}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            Fermer
          </button>
        </div>
    </Dialog>
  );
}
