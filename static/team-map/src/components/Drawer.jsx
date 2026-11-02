import { useEffect, useRef } from 'react';

/**
 * Detail panel. Wide frame: docked beside the map (non-modal) so the map stays visible.
 * Narrow frame: modal overlay. Closes with ×, Esc, or a click outside.
 */
export default function Drawer({ open, compact, title, onClose, onBack, children }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    if (!compact) return;
    const d = dialogRef.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, compact]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, title]);

  const header = (
    <header className="jtm-dialog-header">
      <div>
        {onBack && <button type="button" className="jtm-btn jtm-back" onClick={onBack}>← Back</button>}
        <h2 id="jtm-drawer-title" ref={headingRef} tabIndex={-1}>{title}</h2>
      </div>
      <button type="button" className="jtm-close" aria-label="Close panel" onClick={onClose}>×</button>
    </header>
  );

  if (compact)
    return (
      <dialog
        ref={dialogRef}
        className="jtm-dialog"
        aria-labelledby="jtm-drawer-title"
        data-testid="drawer"
        onCancel={(ev) => {
          ev.preventDefault();
          onClose();
        }}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) onClose(); // click on the backdrop
        }}
      >
        {open && header}
        {open && <div className="jtm-dialog-body">{children}</div>}
      </dialog>
    );

  if (!open) return null;
  return (
    <aside className="jtm-drawer" role="dialog" aria-modal="false" aria-labelledby="jtm-drawer-title" data-testid="drawer">
      {header}
      <div className="jtm-dialog-body">{children}</div>
    </aside>
  );
}
