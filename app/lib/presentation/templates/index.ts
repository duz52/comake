import type { PresentationTemplate } from '../template';
import { blankTemplate } from './blank';
import { launchTemplate } from './launch';

export { blankTemplate } from './blank';
export { launchTemplate } from './launch';

/** The immutable template catalog, keyed by template id. */
const templates: Readonly<Record<string, PresentationTemplate>> = {
  [blankTemplate.id]: blankTemplate,
  [launchTemplate.id]: launchTemplate,
};

/** Resolve a template by id; undefined when the id names no template. */
export function findTemplate(templateId: string): PresentationTemplate | undefined {
  return templates[templateId];
}

/** Catalog order (stable insertion order), for creation surfaces like the workspace home. */
export function listTemplates(): PresentationTemplate[] {
  return Object.values(templates);
}

/**
 * Templates shown as gallery cards. The blank template is created from the
 * dedicated New presentation action, not duplicated here.
 */
export function listGalleryTemplates(): PresentationTemplate[] {
  return listTemplates().filter((template) => template.id !== blankTemplate.id);
}
