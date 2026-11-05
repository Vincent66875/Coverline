// Small Jira-style line icons (24-unit grid, drawn at 16px, rounded strokes in the text colour).
// Every icon is used through <Icon name="…" />, so swapping in another icon set later only touches this file.
const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  person: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20.5c.6-3.9 3.7-6.5 7.5-6.5s6.9 2.6 7.5 6.5" />
    </>
  ),
  personOut: (
    <>
      <circle cx="9.5" cy="8" r="3.75" />
      <path d="M2.5 20.5c.6-3.9 3.4-6.5 7-6.5 1.5 0 2.9.5 4 1.3" />
      <path d="M16 15.5l5 5M21 15.5l-5 5" />
    </>
  ),
  personIn: (
    <>
      <circle cx="9.5" cy="8" r="3.75" />
      <path d="M2.5 20.5c.6-3.9 3.4-6.5 7-6.5 1.5 0 2.9.5 4 1.3" />
      <path d="M15.5 18l2 2 4-4.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M2.5 20c.5-3.5 3.1-5.8 6.5-5.8s6 2.3 6.5 5.8" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M16.5 14.4c2.6.2 4.5 2.2 5 5.1" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l9 4.5-9 4.5-9-4.5z" />
      <path d="M3 12.5l9 4.5 9-4.5" />
      <path d="M3 16.5l9 4.5 9-4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M7.5 15l4-4.5 3 3L20 7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" className="jtm-icon-dot" />
      <circle cx="12" cy="12" r="1.4" className="jtm-icon-dot" />
      <circle cx="18.5" cy="12" r="1.4" className="jtm-icon-dot" />
    </>
  ),
  chevronDown: <path d="M7 10l5 5 5-5" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  map: (
    <>
      <path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`jtm-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
