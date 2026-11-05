import { useState } from 'react';

export const initials = (name) => (name ?? '?').slice(0, 2);

// Sizing lives here too (not only in styles.css), so a large picture can never spill out of its circle.
const BOX = { overflow: 'hidden', padding: 0 };
const IMG = { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' };

/**
 * The person's Jira avatar (the picture set in their Atlassian profile), or their initials when there is
 * no picture or it fails to load. Decorative: the name is always shown or read next to it.
 */
export default function Avatar({ name, url, className = 'jtm-avatar', title }) {
  const [brokenUrl, setBrokenUrl] = useState(null);
  const show = Boolean(url) && url !== brokenUrl;
  return (
    <span className={`${className}${show ? ' jtm-avatar--img' : ''}`} aria-hidden="true" title={title} style={show ? BOX : undefined}>
      {show ? <img src={url} alt="" width="48" height="48" style={IMG} referrerPolicy="no-referrer" draggable={false} onError={() => setBrokenUrl(url)} /> : initials(name)}
    </span>
  );
}
