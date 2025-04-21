// fetchSyncViaDeno/tests/test_server.worker.ts
/// <reference lib="webworker" />
// This worker runs the HTTP server independently.

interface StartMessage {
  command: "start";
  port: number;
}

// Simple type guard
function isStartMessage(msg: unknown): msg is StartMessage {
  return typeof msg === "object" && msg !== null &&
    (msg as StartMessage).command === "start" &&
    typeof (msg as StartMessage).port === "number";
}

self.onmessage = async (event: MessageEvent) => {
  if (!isStartMessage(event.data)) {
    console.error("Test Server Worker: Received invalid message", event.data);
    self.postMessage({ status: "error", message: "Invalid start message" });
    return;
  }

  const { port } = event.data;
  console.log(`Test Server Worker: Received start command for port ${port}`);

  try {
    // Controller to eventually stop the server if needed (though terminate is simpler)
    const abortController = new AbortController();
    const { signal } = abortController;

    // Start serving
    await Deno.serve({
      port,
      signal,
      onListen: ({ hostname, port }) => {
        console.log(
          `Test Server Worker: Listening on http://${hostname}:${port}`,
        );
        // Signal back to the main test script that the server is ready
        self.postMessage({ status: "listening", hostname, port });
      },
      onError: (error) => {
        console.error("Test Server Worker Error:", error);
        return new Response("Server error", { status: 500 });
      },
    }, async (req) => {
      const url = new URL(req.url);
      console.log(
        `Test Server Worker Received: ${req.method} ${url.pathname}`,
      );

      // Handle original routes
      if (url.pathname === "/get") {
        return new Response(JSON.stringify({ message: "Success" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Test-Header": "value1",
          },
        });
      }

      // Handle delay routes
      if (url.pathname.startsWith("/delay/")) {
        const delaySeconds = parseInt(url.pathname.split("/")[2] || "1", 10);
        await new Promise((resolve) =>
          setTimeout(resolve, delaySeconds * 1000)
        );
        return new Response(`Delayed by ${delaySeconds}s`, { status: 200 });
      }

      // NEW ROUTE: Handle POST route
      if (url.pathname === "/post") {
        try {
          // Get content type to handle differently based on type
          const contentType = req.headers.get("Content-Type") || "";
          let receivedData;

          // Handle based on content type
          if (contentType.includes("application/json")) {
            receivedData = await req.json();
          } else {
            receivedData = await req.text();
          }

          // Return response with info about what we received
          return new Response(
            JSON.stringify({
              receivedData: receivedData,
              method: req.method,
              contentType: contentType,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (error) {
          return new Response(JSON.stringify({ error: String(error) }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // NEW ROUTE: Echo back headers
      if (url.pathname === "/headers") {
        // Collect all headers into an object
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return new Response(JSON.stringify({ headers }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // NEW ROUTE: Echo back general request info
      if (url.pathname === "/echo") {
        const bodyText = await req.text(); // Get the request body

        return new Response(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers: Object.fromEntries(req.headers.entries()),
            bodyText: bodyText,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Handle status code routes
      if (url.pathname.startsWith("/status/")) {
        const status = parseInt(url.pathname.split("/")[2] || "404", 10);
        return new Response(`Responding with ${status}`, { status });
      }

      // Default 404 response
      return new Response("Not Found", { status: 404 });
    }).finished;

    // This part is reached when the server is stopped (e.g., by signal/terminate)
    console.log("Test Server Worker: Server shut down.");
    self.postMessage({ status: "stopped" });
  } catch (e) {
    console.error(`Test Server Worker: Failed to start on port ${port}:`, e);
    if (e instanceof Deno.errors.AddrInUse) {
      self.postMessage({
        status: "error",
        message: `Port ${port} already in use.`,
      });
    } else {
      self.postMessage({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    // Ensure worker exits if server fails to start catastrophically
    self.close();
  }
};

// Initial log to confirm worker script loaded
console.log("Test Server Worker: Script loaded.");
