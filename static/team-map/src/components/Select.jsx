import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icons.jsx';

/**
 * Dropdown in the app's style (replaces the browser's <select>, whose open list can't be styled).
 * options: [{ value, label, hint?, action?: true, divider?: true }]
 *   action: an item that does something ("+ New team…") rather than pick a value; shown after a divider.
 * label: what the box is for ("Team for Ivy"); the button is announced as "<label>: <current>".
 * ↓/↑ open and move, Enter/Space pick, Esc closes, typing a letter jumps to the next match.
 */

/** useState whose latest value is also readable at once (keys can arrive faster than React redraws). */
export function useLiveState(initial) {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = (next) => {
    ref.current = typeof next === 'function' ? next(ref.current) : next;
    setValue(ref.current);
  };
  return [value, set, ref];
}

const Select = forwardRef(function Select({ value, options, onChange, label, disabled = false, testid, small = false, placeholder = 'Choose…', className = '' }, ref) {
  const [open, setOpen, openRef] = useLiveState(false);
  const [up, setUp] = useState(false);
  const [active, setActive, activeRef] = useLiveState(-1);
  const wrap = useRef(null);
  const btn = useRef(null);
  const listId = useId();
  const current = options.find((o) => !o.action && o.value === value);
  const setBtn = (el) => {
    btn.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const openList = () => {
    if (disabled) return;
    const r = btn.current?.getBoundingClientRect();
    setUp(Boolean(r) && window.innerHeight - r.bottom < Math.min(320, options.length * 36 + 16) && r.top > window.innerHeight - r.bottom);
    setActive(Math.max(0, options.findIndex((o) => !o.action && o.value === value)));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const pick = (o) => {
    close();
    if (o.action || o.value !== value) onChange(o.value);
  };
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => {
      if (!wrap.current?.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const optId = (i) => `${listId}-s${i}`;

  return (
    <div className={`jtm-select${small ? ' jtm-select--small' : ''} ${className}`} ref={wrap}>
      <button
        type="button"
        ref={setBtn}
        className="jtm-select-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        data-testid={testid}
        data-value={value ?? ''}
        onClick={() => (openRef.current ? close() : openList())}
        onKeyDown={(ev) => {
          if (!openRef.current) {
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
              ev.preventDefault();
              openList();
            }
            return;
          }
          if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (ev.key === 'Home') { ev.preventDefault(); setActive(0); }
          else if (ev.key === 'End') { ev.preventDefault(); setActive(options.length - 1); }
          else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (options[activeRef.current]) pick(options[activeRef.current]); }
          else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
          else if (ev.key === 'Tab') setOpen(false);
          else if (ev.key.length === 1) {
            const k = ev.key.toLowerCase();
            const n = options.length;
            for (let i = 1; i <= n; i++) {
              const j = (activeRef.current + i) % n;
              if (options[j].label.toLowerCase().startsWith(k)) { setActive(j); break; }
            }
          }
        }}
      >
        <span className={`jtm-select-value${current ? '' : ' jtm-muted'}`}>{current?.label ?? placeholder}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <ul className={`jtm-menu-list jtm-combo-list jtm-select-list${up ? ' jtm-select-list--up' : ''}`} id={listId} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={`${o.action ? 'a' : 'v'}:${o.value}`}
              id={optId(i)}
              role="option"
              aria-selected={!o.action && o.value === value}
              className={`jtm-combo-opt jtm-select-opt${i === active ? ' jtm-combo-opt--on' : ''}${o.action ? ' jtm-select-opt--action' : ''}${o.divider ? ' jtm-select-opt--divider' : ''}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              data-select-option={o.value}
            >
              <span className="jtm-select-opt-label">
                {o.label}
                {o.hint && <span className="jtm-combo-meta"> {o.hint}</span>}
              </span>
              <span className="jtm-menu-check">{!o.action && o.value === value && <Icon name="check" />}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default Select;
