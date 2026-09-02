import type { Presentation, Slide } from '../../types/presentation';
import { cloneElement, cloneSlide, type PresentationDocument } from './document';

/**
 * Immutable presentation template: read-only code data a project is cloned
 * from. Templates are never routed, never mutated, and never persisted; the
 * workspace row records provenance via `templateId`.
 */
export interface PresentationTemplate {
  readonly id: string;
  /** Landing slide of a freshly cloned project. */
  readonly initialSlideId: string;
  readonly size: Presentation['size'];
  /** Default project title; the creator may override it at clone time. */
  readonly title: string;
  readonly slideOrder: readonly string[];
  readonly slides: Readonly<Record<string, Slide>>;
}

/**
 * Deterministic per-project remap of a template slide or element id. The
 * project prefix guarantees cross-project uniqueness while the readable
 * template suffix survives for debugging and deep links.
 */
export function remapTemplateId(projectId: string, templateId: string): string {
  return `${projectId}__${templateId}`;
}

/** A cloned project: the fresh canonical document plus its landing slide id. */
export interface TemplateClone {
  document: PresentationDocument;
  initialSlideId: string;
}

/**
 * Pure template clone: builds a fresh `PresentationDocument` for one project.
 * The presentation id and title are set from the arguments, every slide and
 * element id is deterministically remapped for the project, order and values
 * are preserved, and histories start empty (revision 0, no comments or change
 * sets). The clone shares no structure with the template: every slide and
 * element is deep-copied through the kernel's own copy semantics, so later
 * dispatches can never mutate template data.
 */
export function cloneTemplateDocument(
  template: PresentationTemplate,
  projectId: string,
  title?: string,
): TemplateClone {
  const slides = Object.fromEntries(
    template.slideOrder.map((templateSlideId): [string, Slide] => {
      const templateSlide = template.slides[templateSlideId];
      const slideId = remapTemplateId(projectId, templateSlideId);
      return [
        slideId,
        {
          ...cloneSlide(templateSlide),
          id: slideId,
          elementOrder: templateSlide.elementOrder.map((elementId) => remapTemplateId(projectId, elementId)),
          elements: Object.fromEntries(
            templateSlide.elementOrder.map((elementId): [string, Presentation['slides'][string]['elements'][string]] => [
              remapTemplateId(projectId, elementId),
              { ...cloneElement(templateSlide.elements[elementId]), id: remapTemplateId(projectId, elementId) },
            ]),
          ),
        },
      ];
    }),
  );

  const document: PresentationDocument = {
    presentation: {
      id: projectId,
      revision: 0,
      size: { ...template.size },
      slideOrder: template.slideOrder.map((slideId) => remapTemplateId(projectId, slideId)),
      slides,
      title: title ?? template.title,
    },
    comments: {},
    changeSets: {},
    changeSetOrder: [],
  };

  return { document, initialSlideId: remapTemplateId(projectId, template.initialSlideId) };
}
