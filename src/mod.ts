/**
 * # Fetch Sync Via Deno
 *
 * Provides a synchronous-like fetch implementation for Deno by spawning a
 * separate Deno process for each request. Accepts standard `RequestInit` options.
 *
 * This module offers a workaround for specific scenarios where true
 * asynchronous operations are not feasible. However, it comes with significant
 * drawbacks:
 * - **Blocking:** The `fetchSyncViaDeno` function blocks the main Deno process
 *   until the subprocess completes the network request.
 * - **Performance Overhead:** Spawning a new process for each fetch request incurs
 *   substantial overhead compared to the native asynchronous `fetch`.
 * - **Body Handling:** Request bodies are serialized as part of the input JSON,
 *   which may be inefficient for very large bodies.
 *
 * **Use this module with extreme caution.** Prefer the standard asynchronous
 * `fetch` API whenever possible. This synchronous approach should only be
 * considered as a last resort in constrained environments or specific integration
 * scenarios where blocking is absolutely required and the performance impact
 * is acceptable.
 *
 * @example
 * ```ts
 * import { fetchSyncViaDeno } from "jsr:@sigmasd/fetch-sync-via-deno";
 *
 * // Simple GET
 * const getResult = fetchSyncViaDeno("https://httpbin.org/get");
 * console.log("GET Status:", getResult.status);
 *
 * // POST with JSON body
 * const postResult = fetchSyncViaDeno("https://httpbin.org/post", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ message: "Hello from sync fetch!" }),
 * });
 *
 * if (postResult.ok && postResult.body) {
 *   console.log("POST Response Body:", JSON.parse(postResult.body).json);
 * } else {
 *   console.error(`POST failed: ${postResult.error || postResult.statusText}`);
 * }
 * ```
 * @module
 */

// Import Node.js child_process module for spawnSync
import { spawnSync } from "node:child_process";

// Re-define the expected structure from the worker
/**
 * Represents the result of a synchronous fetch operation performed via a Deno subprocess.
 * It mirrors parts of the standard `Response` object but includes an explicit error field.
 */
export interface FetchResult {
  /** The HTTP status code of the response (e.g., 200, 404). Null if the fetch failed before getting a response. */
  status: number | null;
  /** The HTTP status text corresponding to the status code (e.g., "OK", "Not Found"). Null if the fetch failed. */
  statusText: string | null;
  /** A boolean indicating whether the response status code was in the successful range (200-299). */
  ok: boolean;
  /** An object containing the response headers, with header names as keys and values as strings. */
  headers: Record<string, string>;
  /** The response body as a string. Null if the body couldn't be read or if the fetch failed. */
  body: string | null;
  /** An error message string if the fetch operation failed at any point (subprocess spawn, network error, parsing error). Null if the fetch succeeded. */
  error: string | null;
}

/**
 * Represents the data structure passed to the worker script via stdin.
 * @internal
 */
interface WorkerInput {
  url: string;
  options: RequestInit;
}

/**
 * Performs a synchronous-like fetch by spawning a separate Deno process.
 *
 * @param url The URL to fetch.
 * @param options Standard `RequestInit` options (method, headers, body, etc.).
 *                Note: Request bodies are serialized and passed via stdin.
 * @returns An object containing the fetch result or error information.
 *
 * @warning This function is **synchronous** and **blocks** the Deno event loop
 *          until the fetch operation (including network delay) completes in the
 *          subprocess. It incurs significant overhead due to process spawning.
 *          Use with extreme caution and only when standard asynchronous `fetch`
 *          is not viable for your specific use case.
 */
export function fetchSyncViaDeno(
  url: string,
  options: RequestInit = {}, // Accept options, default to empty object
): FetchResult {
  const workerScriptPath = import.meta.resolve("./mod.worker.ts");
  const requestDesc = `${options.method || "GET"} ${url}`;
  console.warn(
    `Executing synchronous fetch via Deno subprocess for ${requestDesc}. This WILL block.`,
  );

  try {
    const denoExecutable = Deno.execPath();

    // Prepare the input data for the worker
    const workerInput: WorkerInput = {
      url: url,
      options: options, // Pass provided options
    };
    const workerInputJson = JSON.stringify(workerInput);

    // Use Node.js spawnSync to execute the process synchronously
    // and pipe the input JSON through stdin
    const spawnResult = spawnSync(
      denoExecutable,
      [
        "run",
        "--allow-net", // Worker needs net access for the fetch
        workerScriptPath, // The script to run
      ],
      {
        input: workerInputJson, // Pass the JSON directly as stdin input
        encoding: "utf8", // Use UTF-8 encoding for input/output text
        timeout: 30000, // Optional: Set timeout (30s) to prevent infinite blocking
        maxBuffer: 1024 * 1024, // Optional: Set max buffer size (1MB) for stdout/stderr
      },
    );

    // Process spawnSync result
    const stdoutText = spawnResult.stdout || "";
    const stderrText = spawnResult.stderr || "";
    const exitCode = spawnResult.status || 0;

    // Log any errors from the child process's stderr for debugging
    // deno-lint-ignore no-explicit-any
    const filteredStderr = stderrText.split("\n").filter((line: any) =>
      !line.includes("Warning The `--unstable` flag is deprecated") &&
      !line.includes("Check file:") &&
      !line.includes("Download") && !line.includes("Compile")
    ).join("\n").trim();

    if (filteredStderr) {
      console.error(`Subprocess stderr (${requestDesc}):\n${filteredStderr}`);
    }

    // Handle subprocess error cases
    if (spawnResult.error) {
      // Spawn itself failed (e.g., timeout, killed, etc.)
      const errorDetail = spawnResult.error instanceof Error
        ? spawnResult.error.message
        : String(spawnResult.error);

      return {
        status: null,
        statusText: null,
        ok: false,
        headers: {},
        body: null,
        error: `Failed to execute subprocess: ${errorDetail}`,
      };
    }

    // Parse the JSON result from stdout
    let parsedResult: FetchResult | null = null;
    if (stdoutText) {
      try {
        parsedResult = JSON.parse(stdoutText);
      } catch (parseError) {
        console.error(
          `Failed to parse subprocess stdout JSON for ${requestDesc}: ${parseError}\nRaw stdout: ${stdoutText}`,
        );
      }
    }

    // Check the subprocess exit code
    if (exitCode === 0) {
      // Process exited successfully
      if (parsedResult) {
        // Successfully parsed the result from stdout
        if (parsedResult.error) {
          console.warn(
            `Worker script reported an error for ${requestDesc}: ${parsedResult.error}`,
          );
        }
        return parsedResult;
      } else {
        // Exited successfully, but stdout wasn't valid JSON
        return {
          status: null,
          statusText: null,
          ok: false,
          headers: {},
          body: stdoutText, // Include raw output
          error:
            `Subprocess for ${requestDesc} exited successfully (code 0) but produced non-JSON stdout. Stderr: ${
              filteredStderr || "(empty)"
            }`,
        };
      }
    } else {
      // Process exited with an error code
      if (parsedResult && parsedResult.error) {
        // Worker exited non-zero AND reported an error via JSON
        return parsedResult;
      } else {
        // Worker exited non-zero, but didn't have valid JSON error
        const baseErrorMsg =
          `Subprocess for ${requestDesc} failed with code ${exitCode}.`;
        const extraInfo = filteredStderr
          ? ` Stderr: ${filteredStderr}`
          : (stdoutText && !parsedResult ? ` Raw stdout: ${stdoutText}` : "");

        return {
          status: parsedResult?.status ?? null,
          statusText: parsedResult?.statusText ?? null,
          ok: false,
          headers: parsedResult?.headers ?? {},
          body: parsedResult?.body ?? null,
          error: baseErrorMsg + extraInfo,
        };
      }
    }
  } catch (error) {
    // Error in the overall process
    console.error(
      `Failed to handle synchronous fetch for ${requestDesc}:`,
      error,
    );
    return {
      status: null,
      statusText: null,
      ok: false,
      headers: {},
      body: null,
      error: `Internal error in fetchSyncViaDeno: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    console.warn(
      `Synchronous fetch via Deno subprocess finished for ${requestDesc}.`,
    );
  }
}
