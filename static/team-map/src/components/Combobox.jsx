import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import Avatar from './Avatar.jsx';

const MAX_SHOWN = 8;

/**
 * Text box with the app's own suggestion list (replaces the browser's <datalist>, which can't be styled).
 * options: [{ value, title, meta?, tag? }]. Typing filters by value or title. ↑/↓ move, Enter picks the
 * highlighted option (or submits what was typed), Esc closes. onSubmit(value) runs on Enter or a click.
 */
export function Combobox({ id, icon, placeholder, title, label, options, onSubmit, inputRef, testid, value, onChange, clearOnSubmit = false, emptyText = 'No matches' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const wrap = useRef(null);
  const q = value.trim().toLowerCase();
  const shown = useMemo(() => {
    const hits = q ? options.filter((o) => o.value.toLowerCase().includes(q) || (o.title ?? '').toLowerCase().includes(q)) : options;
    // keys that start with what was typed come first
    return [...hits].sort((a, b) => Number(!a.value.toLowerCase().startsWith(q)) - Number(!b.value.toLowerCase().startsWith(q))).slice(0, MAX_SHOWN);
  }, [options, q]);

  useEffect(() => setActive(-1), [q]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => {
      if (!wrap.current?.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const submit = (v) => {
    if (!v.trim()) return;
    setOpen(false);
    setActive(-1);
    onSubmit(v);
    onChange(clearOnSubmit ? '' : v);
  };
  const optId = (i) => `${listId}-o${i}`;

  return (
    <form
      className="jtm-search jtm-search--compact jtm-combo"
      role="search"
      ref={wrap}
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(active >= 0 && shown[active] ? shown[active].value : value);
      }}
    >
      <label htmlFor={id} className="jtm-sr-only">{label}</label>
      <Icon name={icon} className="jtm-search-icon" />
      <input
        id={id}
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        title={title}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        data-testid={testid}
        onFocus={() => setOpen(true)}
        onChange={(ev) => {
          onChange(ev.target.value);
          setOpen(true);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (ev.key === 'Escape' && open) {
            ev.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="jtm-menu-list jtm-combo-list" id={listId} role="listbox" aria-label={label}>
          {shown.length === 0 && <li className="jtm-combo-empty" role="presentation">{emptyText}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'jtm-combo-opt jtm-combo-opt--on' : 'jtm-combo-opt'}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => submit(o.value)}
              data-option={o.value}
            >
              <span className="jtm-combo-main">
                <span className="jtm-combo-value">{o.value}</span>
                {o.tag && <span className="jtm-combo-tag">{o.tag}</span>}
              </span>
              {o.title && <span className="jtm-combo-title">{o.title}</span>}
              {o.meta && <span className="jtm-combo-meta">{o.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/**
 * Person picker in the app's style: avatar + name button, list of people with avatars and teams.
 * people: [{ accountId, name, team, avatarUrl }].
 */
export function PersonPicker({ people, value, onChange, testid }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef(null);
  const btn = useRef(null);
  const listId = useId();
  const me = people.find((p) => p.accountId === value) ?? people[0];
  useEffect(() => {
    if (!open) return undefined;
    setActive(Math.max(0, people.findIndex((p) => p.accountId === value)));
    const away = (ev) => {
      if (!wrap.current?.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, people, value]);
  const choose = (p) => {
    setOpen(false);
    btn.current?.focus();
    if (p.accountId !== value) onChange(p.accountId);
  };
  const optId = (i) => `${listId}-p${i}`;
  return (
    <div
      className="jtm-menu jtm-person-pick"
      ref={wrap}
      onKeyDown={(ev) => {
        if (!open) return;
        if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((a) => Math.min(a + 1, people.length - 1)); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (people[active]) choose(people[active]); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setOpen(false); btn.current?.focus(); }
        else if (ev.key === 'Tab') setOpen(false);
      }}
    >
      <button
        type="button"
        ref={btn}
        className="jtm-tbtn jtm-person-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={`Person: ${me?.name ?? ''}`}
        title="Whose work to show"
        data-testid={testid}
        data-value={value}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(ev) => {
          if (!open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
            ev.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar name={me?.name} url={me?.avatarUrl} className="jtm-mini-avatar" />
        <span className="jtm-tbtn-text jtm-person-name">{me?.name}{me?.team ? <span className="jtm-muted"> · {me.team}</span> : null}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <ul className="jtm-menu-list jtm-combo-list" id={listId} role="listbox" aria-label="Person">
          {people.map((p, i) => (
            <li
              key={p.accountId}
              id={optId(i)}
              role="option"
              aria-selected={p.accountId === value}
              className={`jtm-combo-opt jtm-person-opt${i === active ? ' jtm-combo-opt--on' : ''}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              data-person-option={p.accountId}
            >
              <Avatar name={p.name} url={p.avatarUrl} className="jtm-mini-avatar" />
              <span className="jtm-combo-main">
                <span className="jtm-person-opt-name">{p.name}</span>
                <span className="jtm-combo-meta">{p.team ?? 'No team'}</span>
              </span>
              <span className="jtm-menu-check">{p.accountId === value && <Icon name="check" />}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
