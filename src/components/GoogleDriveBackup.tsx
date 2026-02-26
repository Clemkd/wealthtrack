import { useState, useEffect, useRef } from 'react';
import { Cloud, CloudOff, X, Upload, Download, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { Transaction } from '../types/database';
import { saveTransactions } from '../lib/storage';
import {
  initGoogleDrive,
  signIn,
  signOut,
  isSignedIn,
  backupToDrive,
  restoreFromDrive,
  getBackupInfo,
  getGDriveSettings,
  saveGDriveSettings,
  GDriveSettings,
} from '../lib/googleDrive';

const AUTO_BACKUP_DEBOUNCE_MS = 3000;

interface GoogleDriveBackupProps {
  transactions: Transaction[];
  onRestore: () => void;
}

export default function GoogleDriveBackup({ transactions, onRestore }: GoogleDriveBackupProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [settings, setSettings] = useState<GDriveSettings>(getGDriveSettings());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(settings.lastBackupDate);
  const [clientIdInput, setClientIdInput] = useState(settings.clientId);
  const [gisLoaded, setGisLoaded] = useState(false);
  const mountedRef = useRef(false);
  const backupTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const effectiveClientId = envClientId || settings.clientId;

  useEffect(() => {
    initGoogleDrive()
      .then(() => setGisLoaded(true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setConnected(isSignedIn());
  }, []);

  // Auto-backup on transaction changes
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    if (!settings.autoBackup || !connected) return;

    if (backupTimerRef.current) {
      clearTimeout(backupTimerRef.current);
    }

    backupTimerRef.current = setTimeout(async () => {
      try {
        const date = await backupToDrive();
        setLastBackup(date);
      } catch (e) {
        console.error('Erreur lors de la sauvegarde automatique:', e);
      }
    }, AUTO_BACKUP_DEBOUNCE_MS);

    return () => {
      if (backupTimerRef.current) {
        clearTimeout(backupTimerRef.current);
      }
    };
  }, [transactions, settings.autoBackup, connected]);

  const handleConnect = async () => {
    if (!effectiveClientId) {
      setError('Veuillez configurer un Client ID Google');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await signIn(effectiveClientId);
      setConnected(true);
      setSuccess('Connecté à Google Drive');
      const info = await getBackupInfo();
      if (info) {
        setLastBackup(info.modifiedTime);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    signOut();
    setConnected(false);
    setSuccess('');
    setError('');
    const newSettings = { ...settings, autoBackup: false };
    setSettings(newSettings);
    saveGDriveSettings(newSettings);
  };

  const handleBackup = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const date = await backupToDrive();
      setLastBackup(date);
      setSuccess('Sauvegarde effectuée avec succès');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!window.confirm('Cela remplacera toutes les données locales par la sauvegarde Google Drive. Continuer ?')) {
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const restoredTransactions = await restoreFromDrive();
      saveTransactions(restoredTransactions);
      onRestore();
      setSuccess(`${restoredTransactions.length} transactions restaurées`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la restauration');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoBackup = () => {
    const newSettings = { ...settings, autoBackup: !settings.autoBackup };
    setSettings(newSettings);
    saveGDriveSettings(newSettings);
  };

  const handleSaveClientId = () => {
    const newSettings = { ...settings, clientId: clientIdInput };
    setSettings(newSettings);
    saveGDriveSettings(newSettings);
    setSuccess('Client ID enregistré');
  };

  return (
    <>
      <button
        onClick={() => setShowPanel(true)}
        className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border font-semibold rounded-lg transition-colors ${
          connected
            ? 'border-green-300 text-green-700 hover:bg-green-50'
            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
        }`}
        title="Sauvegarde Google Drive"
      >
        {connected ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
        <span className="hidden sm:inline">Drive</span>
      </button>

      {showPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Sauvegarde Google Drive</h2>
              </div>
              <button
                onClick={() => setShowPanel(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm">
                  <Check className="w-4 h-4 shrink-0" />
                  {success}
                </div>
              )}

              {!envClientId && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Google Client ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="Votre Client ID Google"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      onClick={handleSaveClientId}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
                    >
                      OK
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Créez un projet sur{' '}
                    <a
                      href="https://console.cloud.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline"
                    >
                      Google Cloud Console
                    </a>{' '}
                    et activez l&apos;API Google Drive.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-700">
                    {connected ? 'Connecté à Google Drive' : 'Non connecté'}
                  </span>
                </div>
                {gisLoaded && (
                  <button
                    onClick={connected ? handleDisconnect : handleConnect}
                    disabled={loading || (!effectiveClientId && !connected)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      connected
                        ? 'text-red-600 hover:bg-red-50 border border-red-200'
                        : 'text-blue-600 hover:bg-blue-50 border border-blue-200'
                    } disabled:opacity-50`}
                  >
                    {connected ? 'Déconnecter' : 'Connecter'}
                  </button>
                )}
              </div>

              {connected && (
                <div className="flex items-center justify-between py-2 border-t border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Sauvegarde automatique</p>
                    <p className="text-xs text-gray-500">Sauvegarde après chaque modification</p>
                  </div>
                  <button
                    onClick={handleToggleAutoBackup}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.autoBackup ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings.autoBackup ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              )}

              {lastBackup && (
                <div className="text-xs text-gray-500 py-1">
                  Dernière sauvegarde : {new Date(lastBackup).toLocaleString('fr-FR')}
                </div>
              )}

              {connected && (
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={handleBackup}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    Sauvegarder
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Restaurer
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
