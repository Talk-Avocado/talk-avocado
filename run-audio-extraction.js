/* eslint-disable no-console */
// Temporary script to run audio extraction handler
(async () => {
  const handlerModule = await import(
    "./backend/services/audio-extraction/handler.cjs"
  );
  const handler = handlerModule.handler || handlerModule.default?.handler;

  const event = {
    env: "dev",
    tenantId: "demo-tenant",
    jobId: "44616081-1e82-4501-a387-1d9ba090cf53",
    inputKey:
      "dev/demo-tenant/44616081-1e82-4501-a387-1d9ba090cf53/input/sample.mp4",
    correlationId: "uat-test",
  };

  const context = {
    awsRequestId: "uat-test-request-id",
  };

  try {
    const result = await handler(event, context);
    // eslint-disable-next-line no-console
    console.log("Audio extraction completed successfully!");
    // eslint-disable-next-line no-console
    console.log("Result:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Audio extraction failed:", err.message);
    // eslint-disable-next-line no-console
    console.error("Error type:", err.type);
    // eslint-disable-next-line no-console
    console.error("Error details:", JSON.stringify(err.details, null, 2));
    process.exit(1);
  }
})();
