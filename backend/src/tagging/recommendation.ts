import { lookupTag, type TagPriority } from './tag-dictionary';
import type { FindingSeverity } from '../types/assessment.types';

export interface BestPracticeRecommendation {
  tagKey: string;
  found: boolean;
  what: string;
  how: string;
  when: string;
  where: string;
  why: string;
  priority: TagPriority | null;
}

/**
 * Looks up the authoritative what/why/how/when/where guidance for a tag key
 * from the tag dictionary. Falls back to an empty (found: false) shape when
 * the key (or one of its aliases) isn't in the dictionary.
 */
export function recommendationForTagKey(tagKey: string): BestPracticeRecommendation {
  const def = lookupTag(tagKey);
  if (!def) {
    return { tagKey, found: false, what: '', how: '', when: '', where: '', why: '', priority: null };
  }
  return {
    tagKey: def.key,
    found: true,
    what: def.what,
    how: def.how,
    when: def.when,
    where: def.where,
    why: def.why,
    priority: def.priority,
  };
}

/** Maps a tag-dictionary priority to the Finding severity scale used by the rules engine. */
export function severityFromPriority(priority: TagPriority): FindingSeverity {
  switch (priority) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate': return 'medium';
    case 'low': return 'low';
    default: return 'medium';
  }
}
