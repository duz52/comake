/**
 * WebMCP tool registration lifecycle. `startWebMcpRegistration` opens one
 * registration generation owned by an AbortController; the returned cleanup
 * aborts it. A generation publishes readiness or failure only while it is
 * still active: once cleanup has aborted its signal, its late settlement is
 * expected teardown (the bridge rejects aborted registrations with
 * AbortError) — it must neither log a registration error nor touch app
 * state, so an obsolete generation can never overwrite a current status.
 */

export interface ModelContext {
  registerTool: (tool: RegisteredTool, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export interface RegisteredTool {
  description: string;
  execute: (input: unknown) => unknown | Promise<unknown>;
  inputSchema: Record<string, unknown>;
  name: string;
  /**
   * WebMCP imperative API metadata. `annotations.readOnlyHint: true` declares
   * that invocation never mutates the canonical document and does not change
   * the human's live view. Session-only tools that change the displayed slide
   * or slideshow omit annotations even though they create no ChangeSet.
   */
  annotations?: {
    readOnlyHint?: boolean;
  };
}

export interface WebMcpRegistrationReport {
  /** The full tool set of the active generation registered successfully. */
  onReady(): void;
  /** The active generation's registration failed; the error carries full details. */
  onFailed(error: unknown): void;
}

/**
 * Starts one registration generation: registers the full tool set on the
 * WebMCP context and reports `ready` only when the whole set is registered.
 * Returns the cleanup that aborts the generation. A generation publishes its
 * outcome only while its signal is not aborted — the signal is the active
 * generation token, so cleanup-triggered aborts can never report, log, or
 * overwrite status written by the current generation.
 */
export function startWebMcpRegistration(
  modelContext: ModelContext,
  tools: RegisteredTool[],
  report: WebMcpRegistrationReport,
): () => void {
  const controller = new AbortController();
  void Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
  ).then(
    () => {
      if (!controller.signal.aborted) {
        report.onReady();
      }
    },
    (error: unknown) => {
      if (!controller.signal.aborted) {
        report.onFailed(error);
      }
    },
  );
  return () => controller.abort();
}