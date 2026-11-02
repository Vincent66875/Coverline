// Relations between tasks that people record in My work (or that already exist as Jira links).
// "A <label> B": A is the newer task, B the earlier/other one.
// context: people who worked on B have context for A (warm task, green badge, green ring). Never an arrow.
// Pure, no React.

export const RELATION_TYPES = {
  builds_on: { label: 'builds on', inverse: 'is built on by', jira: 'Builds on', context: true },
  follows_up: { label: 'follows up on', inverse: 'is followed up by', jira: 'Follows up', context: true },
  replaces: { label: 'replaces', inverse: 'is replaced by', jira: 'Replaces', context: true },
  fixes: { label: 'fixes', inverse: 'is fixed by', jira: 'Fixes', context: true },
  related: { label: 'is related to', inverse: 'is related to', jira: 'Relates', context: false },
};
export const RELATION_ORDER = ['builds_on', 'follows_up', 'replaces', 'fixes', 'related'];
export const DEFAULT_RELATION = 'builds_on';

export const relationLabel = (type) => RELATION_TYPES[type]?.label ?? type;
export const givesContext = (type) => !!RELATION_TYPES[type]?.context;

/** Which relation a Jira link type is, from its name and wording; null when it is none of them. */
export function relationTypeOfJira(type) {
  const text = `${type?.name ?? ''} ${type?.outward ?? ''} ${type?.inward ?? ''}`;
  if (/\bfix/i.test(text)) return 'fixes';
  if (/replac|supersed/i.test(text)) return 'replaces';
  if (/follow/i.test(text)) return 'follows_up';
  if (/build|continu|based on/i.test(text)) return 'builds_on';
  if (/relat/i.test(text)) return 'related';
  return null;
}

/**
 * For a relation link type: 'outward-newer' when "source <outward> target" reads as the newer task
 * acting on the earlier one ("builds on", "fixes"), 'outward-earlier' when the outward wording is the
 * passive side ("is built on by", "is fixed by").
 */
export function relationDirection(type) {
  return /\bby\b/i.test(type?.outward ?? '') ? 'outward-earlier' : 'outward-newer';
}
