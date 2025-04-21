// fetchSyncViaDeno/tests/mod.test.ts
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
  fail, // Import fail for error handling
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchSyncViaDeno } from "../src/mod.ts"; // Import the function to test

// --- Test URLs ---
const port = 9501;
const BASE_URL = `http://localhost:${port}`;
const urlSuccess = `${BASE_URL}/get`;
const urlDelay = `${BASE_URL}/delay/1`;
const urlNotFound = `${BASE_URL}/status/404`;
const urlServerError = `${BASE_URL}/status/500`;
const urlPost = `${BASE_URL}/post`; // Added for POST testing
const urlHeaders = `${BASE_URL}/headers`; // Added for headers testing
const urlEcho = `${BASE_URL}/echo`; // Added to echo back request info
const urlBadDomain = "https://nonexistent-domain-abcdefghijklmnop.test";

// --- Test Server Worker Management ---
let testServerWorker: Worker | null = null;

function startTestServerWorker(portToUse: number): Promise<void> {
  // Use Promise to wait for the worker to signal it's listening
  return new Promise((resolve, reject) => {
    console.log("Main Test: Creating Test Server Worker...");
    const workerPath = import.meta.resolve("./test_server.worker.ts"); // Path relative to this test file

    // Create worker with necessary permissions
    testServerWorker = new Worker(
      workerPath,
      {
        type: "module", // Important for using imports/exports in worker
      },
    );

    testServerWorker.onmessage = (event) => {
      console.log("Main Test: Received message from worker:", event.data);
      if (event.data?.status === "listening") {
        console.log(
          `Main Test: Test server worker is listening on port ${event.data.port}.`,
        );
        resolve(); // Server is ready
      } else if (event.data?.status === "error") {
        console.error(
          "Main Test: Test server worker failed to start:",
          event.data.message,
        );
        // Terminate worker if it reported an error during startup
        testServerWorker?.terminate();
        testServerWorker = null;
        reject(new Error(event.data.message));
      } else if (event.data?.status === "stopped") {
        console.log("Main Test: Test server worker confirmed stop.");
      }
    };

    testServerWorker.onerror = (event) => {
      console.error(
        "Main Test: Uncaught error in test server worker:",
        event.message,
      );
      event.preventDefault(); // Prevent Deno from exiting due to worker error
      // Terminate worker if it reports an error
      testServerWorker?.terminate();
      testServerWorker = null;
      reject(new Error(`Worker error: ${event.message}`));
    };

    // Send the start command to the worker
    console.log(
      `Main Test: Sending start command to worker for port ${portToUse}`,
    );
    testServerWorker.postMessage({ command: "start", port: portToUse });
  });
}

function stopTestServerWorker() {
  if (testServerWorker) {
    console.log("Main Test: Terminating Test Server Worker...");
    testServerWorker.terminate();
    testServerWorker = null;
  }
}

// --- Test Suite ---
Deno.test("fetchSyncViaDeno Test Suite", async (t) => {
  // Setup: Start the server worker and wait for it to be ready
  try {
    await startTestServerWorker(port);
    console.log("Main Test: Server worker started successfully.");
  } catch (err) {
    fail(`Failed to start test server worker: ${err}`);
    // Stop Deno.test from proceeding if server setup failed
    return;
  }

  // Ensure worker is terminated even if tests fail
  try {
    await t.step("should fetch successfully (200 OK)", () => {
      console.log("Test Step: Fetching Success URL..."); // Added log
      const result = fetchSyncViaDeno(urlSuccess);
      console.log("Test Step: Fetch Success URL - Done."); // Added log

      assertEquals(result.error, null, "Error should be null on success");
      assertEquals(result.status, 200);
      assertEquals(result.statusText, "OK");
      assertEquals(result.ok, true);
      assertExists(result.body, "Body should exist");
      assertStringIncludes(result.body!, '"message":"Success"');
      assertEquals(result.headers["content-type"], "application/json");
      assertEquals(result.headers["x-test-header"], "value1");
    });

    await t.step("should handle delayed response (blocks)", () => {
      console.log("Test Step: Fetching Delay URL...");
      const startTime = performance.now();
      const result = fetchSyncViaDeno(urlDelay); // Expect ~1 second block
      const duration = performance.now() - startTime;
      console.log("Test Step: Fetch Delay URL - Done.");

      assertEquals(result.error, null, "Error should be null on delay success");
      assertEquals(result.status, 200);
      assertEquals(result.ok, true);
      assert(
        duration >= 900,
        `Execution time (${duration}ms) should be at least ~1000ms`,
      ); // Allow some leeway
      assertExists(result.body);
      assertEquals(result.body, "Delayed by 1s");
    });

    // NEW TEST: POST request with JSON body
    await t.step("should handle POST request with JSON body", () => {
      console.log("Test Step: Testing POST request with JSON body...");
      const testData = {
        name: "Test User",
        email: "test@example.com",
        timestamp: Date.now(),
      };

      const result = fetchSyncViaDeno(urlPost, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testData),
      });

      console.log("Test Step: POST request test - Done.");

      assertEquals(result.error, null, "Error should be null on POST success");
      assertEquals(result.status, 200);
      assertEquals(result.ok, true);
      assertExists(result.body);

      // Parse the response to verify the server received our data correctly
      const responseData = JSON.parse(result.body!);
      assertEquals(responseData.receivedData, testData);
      assertEquals(responseData.method, "POST");
      assertEquals(responseData.contentType, "application/json");
    });

    // NEW TEST: Custom headers
    await t.step("should send custom headers correctly", () => {
      console.log("Test Step: Testing custom headers...");
      const customHeaders = {
        "X-Custom-Header-1": "value1",
        "X-Custom-Header-2": "value2",
        "Authorization": "Bearer test_token",
      };

      const result = fetchSyncViaDeno(urlHeaders, {
        headers: customHeaders,
      });

      console.log("Test Step: Custom headers test - Done.");

      assertEquals(result.error, null, "Error should be null on success");
      assertEquals(result.status, 200);
      assertEquals(result.ok, true);
      assertExists(result.body);

      // Parse the response which should contain the headers we sent
      const responseData = JSON.parse(result.body!);

      // Check that our custom headers were received correctly
      Object.entries(customHeaders).forEach(([key, value]) => {
        assertEquals(responseData.headers[key.toLowerCase()], value);
      });
    });

    // NEW TEST: Different HTTP methods
    await t.step("should handle different HTTP methods", () => {
      console.log("Test Step: Testing HTTP methods...");

      // Test PUT method
      const putResult = fetchSyncViaDeno(urlEcho, {
        method: "PUT",
        body: "test put data",
      });

      assertEquals(putResult.error, null);
      assertEquals(putResult.status, 200);
      const putData = JSON.parse(putResult.body!);
      assertEquals(putData.method, "PUT");

      // Test DELETE method
      const deleteResult = fetchSyncViaDeno(urlEcho, {
        method: "DELETE",
      });

      assertEquals(deleteResult.error, null);
      assertEquals(deleteResult.status, 200);
      const deleteData = JSON.parse(deleteResult.body!);
      assertEquals(deleteData.method, "DELETE");

      console.log("Test Step: HTTP methods test - Done.");
    });

    await t.step("should handle client error (404 Not Found)", () => {
      console.log("Test Step: Fetching 404 URL...");
      const result = fetchSyncViaDeno(urlNotFound);
      console.log("Test Step: Fetch 404 URL - Done.");

      assertEquals(result.error, null, "Error should be null on 404");
      assertEquals(result.status, 404);
      assertEquals(result.statusText, "Not Found");
      assertEquals(result.ok, false, "ok should be false for 4xx/5xx");
      assertExists(result.body);
      assertEquals(result.body, "Responding with 404");
    });

    await t.step(
      "should handle server error (500 Internal Server Error)",
      () => {
        console.log("Test Step: Fetching 500 URL...");
        const result = fetchSyncViaDeno(urlServerError);
        console.log("Test Step: Fetch 500 URL - Done.");

        assertEquals(result.error, null, "Error should be null on 500");
        assertEquals(result.status, 500);
        assertEquals(result.statusText, "Internal Server Error");
        assertEquals(result.ok, false);
        assertExists(result.body);
        assertEquals(result.body, "Responding with 500");
      },
    );

    await t.step("should handle network error (bad domain)", () => {
      console.log("Test Step: Fetching Bad Domain...");
      const result = fetchSyncViaDeno(urlBadDomain);
      console.log("Test Step: Fetch Bad Domain - Done.");

      assertExists(result.error, "Error should exist for a bad domain");
      assert(
        result.error!.includes("error sending request") ||
          result.error!.includes("dns error") ||
          result.error!.includes("No such host is known") || // Added Windows variant
          result.error!.includes("No such host"),
        `Error message content mismatch: ${result.error}`,
      );
      assertEquals(result.status, null);
      assertEquals(result.statusText, null);
      assertEquals(result.ok, false);
      assertEquals(result.body, null);
      assertEquals(result.headers, {});
    });
  } finally {
    // Teardown: Stop the server worker
    stopTestServerWorker();
    console.log("Main Test: Test suite finished.");
  }
});
