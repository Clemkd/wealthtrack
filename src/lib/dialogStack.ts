// The open dialogs, the last opened being on top. Escape closes the one on top only:
// with an error shown over the transaction form, Escape must not discard the form.
const dialogs: Array<{ onClose: () => void }> = [];
let listening = false;

export function closeTopDialog(): boolean {
  const top = dialogs[dialogs.length - 1];
  if (!top) return false;
  top.onClose();
  return true;
}

export function handleEscapeKey(event: { key: string; preventDefault: () => void }): void {
  if (event.key === 'Escape' && closeTopDialog()) event.preventDefault();
}

function listen(on: boolean): void {
  if (typeof document === 'undefined' || on === listening) return;
  if (on) document.addEventListener('keydown', handleEscapeKey);
  else document.removeEventListener('keydown', handleEscapeKey);
  listening = on;
}

// Returns the function that unregisters the dialog
export function registerDialog(onClose: () => void): () => void {
  const entry = { onClose };
  dialogs.push(entry);
  listen(true);
  return () => {
    const index = dialogs.indexOf(entry);
    if (index >= 0) dialogs.splice(index, 1);
    if (dialogs.length === 0) listen(false);
  };
}
