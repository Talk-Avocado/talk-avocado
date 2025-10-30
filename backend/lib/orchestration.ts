/// <reference path="./ambient-handlers.d.ts" />
import { LoggingWrapper } from "./logging.js";

export interface OrchestrationContext {
  tenantId: string;
  jobId: string;
  correlationId: string;
}

// Lightweight local starter for Phase 1. In dev/local, it kicks off the first step.
export async function startStateMachine(
  context: OrchestrationContext
): Promise<void> {
  const logger = new LoggingWrapper("orchestration-starter");

  logger.addPersistentAttributes({
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    jobId: context.jobId,
    operation: "startStateMachine",
  });

  logger.info("Starting state machine (local stub)");

  // For Phase 1 local mode, invoke the initial step asynchronously
  if (
    process.env.TALKAVOCADO_ENV === "dev" ||
    process.env.TALKAVOCADO_ENV === "test"
  ) {
    // Do not block the API response
    setImmediate(async () => {
      try {
        const mod = await import("../services/mark-processing/handler.js");
        await mod.handler({
          tenantId: context.tenantId,
          jobId: context.jobId,
          correlationId: context.correlationId,
        });
        logger.info("mark-processing invoked successfully");
      } catch (error: any) {
        logger.error("Failed to invoke mark-processing", {
          error: error?.message || String(error),
        });
      }
    });
  }
}
