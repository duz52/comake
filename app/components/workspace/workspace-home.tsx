import { useMemo } from 'react';
import { Form, Link, useNavigation } from 'react-router';
import { presentationSlidePath, workspacePath } from '../../lib/presentation/location';
import { CREATE_PROJECT_INTENT, MAX_PROJECT_TITLE_LENGTH } from '../../lib/server/project-protocol';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { PresentationTemplate } from '../../lib/presentation/template';
import { blankTemplate, findTemplate, listGalleryTemplates } from '../../lib/presentation/templates';
import { SlideArtwork } from '../presentation/slide-artwork';
import { ThemeToggle } from '../theme-toggle';
import type { WorkspaceActionFailure, WorkspaceProject } from '../../lib/server/project-service';

/**
 * Deterministic UTC date label from a persisted ISO timestamp. The same
 * string on the server and the first client paint, so hydration never sees
 * a timezone-dependent mismatch.
 */
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

function formatUtcDate(iso: string): string {
  return UTC_DATE_FORMATTER.format(new Date(iso));
}

/** A non-interactive snapshot of one template, rendered by the real slide artwork. */
function templatePreviewSnapshot(template: PresentationTemplate): PresentationSnapshot {
  return {
    presentation: {
      id: `template-${template.id}`,
      revision: 0,
      size: { ...template.size },
      slideOrder: [...template.slideOrder],
      slides: template.slides,
      title: template.title,
    },
    comments: {},
    changeSets: {},
    changeSetOrder: [],
    session: {
      activeSlideId: template.initialSlideId,
      focusRevision: 0,
      selectedElementIds: [],
      zoom: 1,
    },
    userUndoStack: [],
    userRedoStack: [],
  };
}

function CreationForm({
  children,
  className,
  templateId,
}: {
  children: React.ReactNode;
  className?: string;
  templateId: string;
}) {
  return (
    <Form className={className} method="post">
      <input name="intent" type="hidden" value={CREATE_PROJECT_INTENT} />
      <input name="templateId" type="hidden" value={templateId} />
      {children}
    </Form>
  );
}

function CreationError({ failure }: { failure: WorkspaceActionFailure | null }) {
  if (!failure) {
    return null;
  }
  return (
    <p className="ws-form-error" role="alert">
      {failure.detail}
    </p>
  );
}

/**
 * The workspace home: compact app header, a real New presentation form that
 * clones the blank template, a launch-template gallery card, and the
 * persisted project list of this anonymous session.
 */
export function WorkspaceHome({
  actionFailure,
  projects,
  workspaceId,
}: {
  actionFailure: WorkspaceActionFailure | null;
  projects: WorkspaceProject[];
  workspaceId: string;
}) {
  const galleryTemplates = useMemo(() => listGalleryTemplates(), []);
  const galleryIds = useMemo(() => new Set(galleryTemplates.map((template) => template.id)), [galleryTemplates]);
  const navigation = useNavigation();
  const creating =
    navigation.state === 'submitting' && navigation.formData?.get('intent') === CREATE_PROJECT_INTENT;
  const submittingTemplateId = creating ? String(navigation.formData?.get('templateId') ?? '') : '';
  const submittingBlank = submittingTemplateId === blankTemplate.id;

  const blankFailure =
    actionFailure &&
    (actionFailure.templateId === blankTemplate.id ||
      actionFailure.templateId === undefined ||
      !galleryIds.has(actionFailure.templateId));

  return (
    <main className="workspace-app">
      <header className="app-header">
        <Link
          aria-label="Open workspace"
          className="hdr-mark"
          title="Open workspace"
          to={workspacePath(workspaceId)}
        >
          C
        </Link>
        <div aria-hidden="true" className="hdr-divider" />
        <div className="hdr-crumb">
          <div className="hdr-title">
            <span className="hdr-title-text">Workspace</span>
            <span className="hchip">{workspaceId}</span>
          </div>
        </div>
        <div className="hdr-actions">
          <ThemeToggle />
        </div>
      </header>

      <div className="workspace-body">
        <div className="workspace-container">
          <div className="ws-hero">
            <div className="ws-hero-copy">
              <h1 className="ws-hero-title">Your presentations</h1>
              <p className="ws-hero-meta">
                Create a blank presentation or start from a template. Everything you make stays in this
                workspace.
              </p>
            </div>
            <div className="ws-hero-create">
              <CreationForm templateId={blankTemplate.id}>
                <button className="hbutton is-brand" disabled={creating} type="submit">
                  {submittingBlank ? 'Creating...' : 'New presentation'}
                </button>
              </CreationForm>
              <CreationError failure={blankFailure ? actionFailure : null} />
            </div>
          </div>

          <section aria-labelledby="ws-create-heading" className="ws-create">
            <div className="ws-section-head">
              <h2 className="ws-section-title" id="ws-create-heading">
                Start from a template
              </h2>
              <span className="ws-section-meta">A new project is a copy, so the template never changes.</span>
            </div>
            <div className="ws-template-grid">
              {galleryTemplates.map((template) => (
                <TemplateCard
                  actionFailure={actionFailure?.templateId === template.id ? actionFailure : null}
                  creating={creating}
                  key={template.id}
                  submitting={submittingTemplateId === template.id}
                  template={template}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="ws-recent-heading" className="ws-recent">
            <div className="ws-section-head">
              <h2 className="ws-section-title" id="ws-recent-heading">
                Recent presentations
              </h2>
              <span className="ws-section-meta">
                {projects.length === 1 ? '1 project' : `${projects.length} projects`}
              </span>
            </div>
            {projects.length === 0 ? (
              <div className="ws-empty">
                <p className="ws-empty-title">No presentations yet</p>
                <p className="ws-empty-body">
                  Every presentation you create stays in this workspace, persisted as you edit it.
                </p>
                <CreationForm templateId={blankTemplate.id}>
                  <button className="hbutton" disabled={creating} type="submit">
                    {submittingBlank ? 'Creating...' : 'New presentation'}
                  </button>
                </CreationForm>
                <CreationError failure={blankFailure ? actionFailure : null} />
              </div>
            ) : (
              <ul className="ws-project-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      className="ws-project-row"
                      to={presentationSlidePath(workspaceId, project.id, project.initialSlideId)}
                    >
                      <span className="ws-project-title">{project.title}</span>
                      <span className="ws-project-template">
                        {findTemplate(project.templateId)?.title ?? project.templateId}
                      </span>
                      <time className="ws-project-date ws-project-created" dateTime={project.createdAt}>
                        Created {formatUtcDate(project.createdAt)}
                      </time>
                      <time className="ws-project-date ws-project-edited" dateTime={project.updatedAt}>
                        Edited {formatUtcDate(project.updatedAt)}
                      </time>
                      <span aria-hidden="true" className="ws-project-open">
                        Open
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function TemplateCard({
  actionFailure,
  creating,
  submitting,
  template,
}: {
  actionFailure: WorkspaceActionFailure | null;
  creating: boolean;
  submitting: boolean;
  template: PresentationTemplate;
}) {
  const snapshot = useMemo(() => templatePreviewSnapshot(template), [template]);
  const titleFieldId = `project-title-${template.id}`;

  return (
    <article className="ws-template-card">
      <div
        aria-label={`Preview of the ${template.title} template`}
        className="ws-template-preview"
        role="img"
      >
        <div className="ws-template-slide">
          <SlideArtwork slideId={template.initialSlideId} snapshot={snapshot} />
        </div>
      </div>
      <CreationForm className="ws-template-form" templateId={template.id}>
        <div className="ws-template-form-head">
          <h3 className="ws-template-name">{template.title}</h3>
          <span className="ws-template-slides">
            {template.slideOrder.length} slides
          </span>
        </div>
        <label className="ws-field-label" htmlFor={titleFieldId}>
          Presentation title
        </label>
        <input
          autoComplete="off"
          className="ws-title-input"
          disabled={creating}
          id={titleFieldId}
          maxLength={MAX_PROJECT_TITLE_LENGTH}
          name="title"
          type="text"
        />
        <CreationError failure={actionFailure} />
        <button className="hbutton is-brand ws-use-template" disabled={creating} type="submit">
          {submitting ? 'Creating...' : 'Use template'}
        </button>
      </CreationForm>
    </article>
  );
}
