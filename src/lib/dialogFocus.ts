interface Focusable {
  focus: () => void;
  isConnected?: boolean;
}

// Moves the focus into a dialog that opens and returns the function that gives it back
// to whatever had it (the button that opened the dialog) when the dialog closes.
export function enterDialog(dialog: Focusable, doc: { activeElement: unknown }): () => void {
  const opener = doc.activeElement as Focusable | null;
  dialog.focus();
  return () => {
    if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) opener.focus();
  };
}
