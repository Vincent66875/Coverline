import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';

/**
 * Jira-style toolbar button: 40px tall, an icon, one or two words.
 * `label` is the full name (tooltip + screen readers) when the visible text is short or hidden.
 * iconOnly: square button, text only in the tooltip. collapse: text hides on narrow frames, icon stays.
 */
export function ToolButton({ icon, text, label, count, countTodo = false, iconOnly = false, collapse = false, on = false, attn = false, className = '', ...rest }) {
  const cls = ['jtm-tbtn', iconOnly && 'jtm-tbtn--icon', collapse && 'jtm-tbtn--collapse', on && 'jtm-tbtn--on', attn && 'jtm-tbtn--attn', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} title={label ?? text} aria-label={iconOnly || label ? label ?? text : undefined} {...rest}>
      {icon && <Icon name={icon} />}
      {!iconOnly && text && <span className="jtm-tbtn-text">{text}</span>}
      {count != null && <span className={`jtm-count-pill${countTodo ? ' jtm-count-pill--todo' : ''}`}>{count}</span>}
    </button>
  );
}

/** Close on Esc (focus back to the trigger) or a click outside. */
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => {
      if (!ref.current?.contains(ev.target)) setOpen(false);
    };
    const esc = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open, setOpen, ref]);
}

/**
 * Dropdown menu behind a toolbar button.
 * items: [{ label, run, checked?, attrs? }]; any item with `checked` makes the menu a single-choice list.
 */
export function MenuButton({ items, testid, menuLabel, ...button }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const radio = items.some((i) => i.checked != null);
  return (
    <div className="jtm-menu" ref={ref}>
      <ToolButton {...button} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-testid={testid} />
      {open && (
        <ul className="jtm-menu-list" role="menu" aria-label={menuLabel ?? button.label ?? button.text}>
          {items.map((i) => (
            <li key={i.label} role="none">
              <button
                type="button"
                role={radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={radio ? Boolean(i.checked) : undefined}
                onClick={() => {
                  setOpen(false);
                  i.run();
                }}
                {...i.attrs}
              >
                {radio && <span className="jtm-menu-check">{i.checked && <Icon name="check" />}</span>}
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small information popover behind an icon button (e.g. a key). */
export function InfoButton({ label, testid, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  return (
    <div className="jtm-menu" ref={ref}>
      <ToolButton icon="info" iconOnly label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testid} />
      {open && (
        <div className="jtm-menu-list jtm-popover" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
