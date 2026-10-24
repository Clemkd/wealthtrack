import { useState, useEffect, useRef } from 'react';
import { Cloud, CloudOff, X, Upload, Download, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { Transaction } from '../types/database';
import AutoBackupSwitch from './AutoBackupSwitch';
import Dialog from './Dialog';
import Notice from './Notice';
import { shouldScheduleBackup, signatureHash, transactionsSignature } from '../lib/autoBackup';
import { saveTransactions } from '../lib/storage';
import { restoredMessage } from '../lib/format';
import {
  initGoogleDrive,
  areSettingsSaved,
  consumeRedirectResponse,
  describeRedirectOutcome,
  restoreSession,
  signIn,
  signOut,
  isSignedIn,
  attemptBackup,
  loadBackedUpBaseline,
  recordRestore,
  BackupConflictError,
  backupToDrive,
  restoreFromDrive,
  getBackupInfo,
  getGDriveSettings,
  updateGDriveSettings,
  GDriveSettings,
} from '../lib/googleDrive';

const AUTO_BACKUP_DEBOUNCE_MS = 3000;

interface GoogleDriveBackupProps {
  transactions: Transaction[];
  onRestore: () => void;
  // Opens the panel at once (the panel is otherwise opened by its button)
  initiallyOpen?: boolean;
}

export default function GoogleDriveBackup({ transactions, onRestore, initiallyOpen = false }: GoogleDriveBackupProps) {
  const [showPanel, setShowPanel] = useState(initiallyOpen);
  const [settings, setSettings] = useState<GDriveSettings>(() => getGDriveSettings());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoBackupError, setAutoBackupError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(settings.lastBackupDate);
  const [clientIdInput, setClientIdInput] = useState(settings.clientId);
  const [gisLoaded, setGisLoaded] = useState(false);
  const [gisError, setGisError] = useState(false);
  // Fingerprint of the last state known to be on Drive: null until the first render
  const lastBackedUpRef = useRef<string | null>(null);
  // Fingerprint of the data as of the last render, and a counter that re-evaluates
  // the effect when the data changed while a backup was running
  const latestHashRef = useRef('');
  // Set while a restore is in progress: the automatic backup must not write then
  const restoringRef = useRef(false);
  const [backupRound, setBackupRound] = useState(0);

  const [showRedirectOption, setShowRedirectOption] = useState(false);

  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const effectiveClientId = envClientId || settings.clientId;

  useEffect(() => {
    // The answer of a redirect sign-in is handled (and removed from the address bar)
    // whether or not the Google script manages to load
    const outcome = consumeRedirectResponse();
    const shown = describeRedirectOutcome(outcome);
    if (shown.openPanel) setShowPanel(true);
    if (shown.error) setError(shown.error);
    if (shown.success) setSuccess(shown.success);
    const restored = outcome === 'accepted' || restoreSession();
    if (restored) {
      setConnected(true);
      getBackupInfo()
        .then((info) => {
          if (info) setLastBackup(info.modifiedTime);
        })
        .catch((err) => {
          console.warn('Impossible de récupérer les infos de sauvegarde:', err);
        });
    }

    loadGoogleScript();
  }, []);

  const loadGoogleScript = () => {
    setGisError(false);
    initGoogleDrive()
      .then(() => setGisLoaded(true))
      .catch(() => setGisError(true));
  };

  // Auto-backup when the transactions differ from what is on Drive: not on page
  // load, not when only the connection or the option changes
  useEffect(() => {
    const signature = signatureHash(transactionsSignature(transactions));
    latestHashRef.current = signature;
    if (lastBackedUpRef.current === null) {
      // After a reload, what was changed but not backed up yet is still due
      lastBackedUpRef.current = loadBackedUpBaseline(signature);
    }
    if (
      !shouldScheduleBackup({
        signature,
        lastBackedUp: lastBackedUpRef.current,
        autoBackup: settings.autoBackup,
        connected,
      })
    ) {
      return;
    }

    const timer = setTimeout(async () => {
      if (restoringRef.current) return;
      const result = await attemptBackup();
      if (result.ok) {
        lastBackedUpRef.current = signature;
        updateGDriveSettings({ lastBackedUpHash: signature });
        setLastBackup(result.date);
        setAutoBackupError('');
        // The data changed while the backup was running: another one is due
        if (latestHashRef.current !== signature) setBackupRound((round) => round + 1);
      } else {
        console.error('Erreur lors de la sauvegarde automatique:', result.message);
        setAutoBackupError(result.message);
        setConnected(result.connected);
      }
    }, AUTO_BACKUP_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [transactions, settings.autoBackup, connected, backupRound]);

  const handleConnect = async (useRedirect = false) => {
    if (!effectiveClientId) {
      setError('Veuillez configurer un Client ID Google');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setShowRedirectOption(false);
    try {
      await signIn(effectiveClientId, useRedirect);
      setConnected(true);
      setAutoBackupError('');
      setSuccess('Connecté à Google Drive');
      // The connection is made: failing to read the backup date must not turn it into
      // an error shown next to "connected"
      try {
        const info = await getBackupInfo();
        if (info) setLastBackup(info.modifiedTime);
      } catch (err) {
        console.warn('Impossible de récupérer les infos de sauvegarde:', err);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      setError(message);
      if (!useRedirect) {
        setShowRedirectOption(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    signOut();
    setConnected(false);
    setAutoBackupError('');
    setSuccess('');
    setError('');
    setSettings(updateGDriveSettings({ autoBackup: false }));
  };

  const handleBackup = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      let date: string;
      try {
        date = await backupToDrive();
      } catch (err) {
        if (!(err instanceof BackupConflictError)) throw err;
        const overwrite = window.confirm(
          `${err.message}\n\nÉcraser quand même la sauvegarde Google Drive par les ${transactions.length} transaction(s) de cet appareil ?`
        );
        if (!overwrite) {
          setError(err.message);
          return;
        }
        date = await backupToDrive({ force: true });
      }
      const hash = signatureHash(transactionsSignature(transactions));
      lastBackedUpRef.current = hash;
      updateGDriveSettings({ lastBackedUpHash: hash });
      setAutoBackupError('');
      setLastBackup(date);
      setSuccess('Sauvegarde effectuée avec succès');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
      setConnected(isSignedIn());
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!window.confirm('Cela remplacera toutes les données locales par la sauvegarde Google Drive. Continuer ?')) {
      return;
    }
    restoringRef.current = true;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { transactions: restored, skipped, modifiedTime } = await restoreFromDrive();
      const saved = saveTransactions(restored);
      // Only now that it is saved locally is this device in sync with that file, and
      // what was just restored is what is on Drive: no backup is due for it
      const hash = signatureHash(transactionsSignature(restored));
      lastBackedUpRef.current = hash;
      recordRestore({ modifiedTime, transactionsHash: hash });
      setSettings(getGDriveSettings());
      setAutoBackupError('');
      onRestore();
      setSuccess(
        restoredMessage(restored.length, skipped) +
          (saved
            ? ''
            : " — mais elles n'ont pas pu être enregistrées sur cet appareil (stockage plein ou refusé) : elles seront perdues à la fermeture de la page.")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la restauration');
      setConnected(isSignedIn());
    } finally {
      restoringRef.current = false;
      // Evaluate again what is due now that the restore is over
      setBackupRound((round) => round + 1);
      setLoading(false);
    }
  };

  const handleToggleAutoBackup = () => {
    setSettings(updateGDriveSettings({ autoBackup: !settings.autoBackup }));
  };

  const handleSaveClientId = () => {
    setSettings(updateGDriveSettings({ clientId: clientIdInput }));
    setSuccess(
      areSettingsSaved()
        ? 'Client ID enregistré'
        : "Client ID retenu pour cette session seulement : le stockage du navigateur ne peut pas l'enregistrer pour le moment."
    );
  };

  return (
    <>
      <button
        onClick={() => setShowPanel(true)}
        className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border font-semibold rounded-lg transition-colors ${
          autoBackupError
            ? 'border-red-300 text-red-700 hover:bg-red-50'
            : connected
              ? 'border-green-300 text-green-700 hover:bg-green-50'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
        }`}
        title={
          autoBackupError
            ? `Sauvegarde automatique en échec : ${autoBackupError}`
            : 'Sauvegarde Google Drive'
        }
        aria-label="Sauvegarde Google Drive"
      >
        {connected ? <Cloud aria-hidden="true" className="w-5 h-5" /> : <CloudOff aria-hidden="true" className="w-5 h-5" />}
        <span className="hidden lg:inline">Drive</span>
      </button>

      {showPanel && (
        <Dialog
          titleId="gdrive-panel-title"
          onClose={() => setShowPanel(false)}
          className="bg-white rounded-xl shadow-2xl max-w-md"
        >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Cloud aria-hidden="true" className="w-5 h-5 text-blue-600" />
                <h2 id="gdrive-panel-title" className="text-lg font-semibold text-gray-900">
                  Sauvegarde Google Drive
                </h2>
              </div>
              <button
                onClick={() => setShowPanel(false)}
                aria-label="Fermer"
                className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <X aria-hidden="true" className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {autoBackupError && (
                <Notice tone="error">
                  <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0" />
                  Sauvegarde automatique en échec : {autoBackupError}
                </Notice>
              )}
              {error && (
                <Notice tone="error">
                  <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0" />
                  {error}
                </Notice>
              )}
              {showRedirectOption && !connected && (
                <button
                  onClick={() => handleConnect(true)}
                  disabled={loading}
                  className="w-full text-sm text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
                >
                  Essayer la connexion par redirection
                </button>
              )}
              {success && (
                <Notice tone="success">
                  <Check aria-hidden="true" className="w-4 h-4 shrink-0" />
                  {success}
                </Notice>
              )}

              {!envClientId && (
                <div className="space-y-2">
                  <label htmlFor="gdrive-client-id" className="block text-sm font-medium text-gray-700">
                    Google Client ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="gdrive-client-id"
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
                {!gisLoaded && gisError && (
                  <button
                    onClick={loadGoogleScript}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    Google indisponible, réessayer
                  </button>
                )}
                {gisLoaded && (
                  <button
                    onClick={connected ? handleDisconnect : () => handleConnect()}
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
                  <AutoBackupSwitch enabled={settings.autoBackup} onToggle={handleToggleAutoBackup} />
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
                      <RefreshCw aria-hidden="true" className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload aria-hidden="true" className="w-4 h-4" />
                    )}
                    Sauvegarder
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Download aria-hidden="true" className="w-4 h-4" />
                    Restaurer
                  </button>
                </div>
              )}
            </div>
        </Dialog>
      )}
    </>
  );
}
