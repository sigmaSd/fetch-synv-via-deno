/**
 * # Fetch Sync Via Deno
 *
 * Provides a synchronous-like fetch implementation for Deno by spawning a
 * separate Deno process for each request.
 *
 * This module offers a workaround for specific scenarios where true
 * asynchronous operations are not feasible. However, it comes with significant
 * drawbacks:
 * - **Blocking:** The `fetchSyncViaDeno` function blocks the main Deno process
 *   until the subprocess completes the network request.
 * - **Performance Overhead:** Spawning a new process for each fetch request incurs
 *   substantial overhead compared to the native asynchronous `fetch`.
 *
 * **Use this module with extreme caution.** Prefer the standard asynchronous
 * `fetch` API whenever possible. This synchronous approach should only be
 * considered as a last resort in constrained environments or specific integration
 * scenarios where blocking is absolutely required and the performance impact
 * is acceptable.
 *
 * @example
 * ```ts
 * import { fetchSyncViaDeno } from "./mod.ts";
 *
 * // Warning: This blocks!
 * const result = fetchSyncViaDeno("https://api.github.com/users/denoland");
 *
 * if (result.ok && result.body) {
 *   const data = JSON.parse(result.body);
 *   console.log("GitHub User:", data.login);
 *   console.log("Headers:", result.headers);
 * } else {
 *   console.error(`Fetch failed: ${result.error || result.statusText}`);
 * }
 * ```
 * @module
 */

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
 * Performs a synchronous-like fetch by spawning a separate Deno process.
 *
 * @param url The URL to fetch.
 * @returns An object containing the fetch result or error information.
 *
 * @warning This function is **synchronous** and **blocks** the Deno event loop
 *          until the fetch operation (including network delay) completes in the
 *          subprocess. It incurs significant overhead due to process spawning.
 *          Use with extreme caution and only when standard asynchronous `fetch`
 *          is not viable for your specific use case.
 */
export function fetchSyncViaDeno(url: string): FetchResult {
  const workerScriptPath = import.meta.resolve("./mod.worker.ts"); // Relative path to the worker script
  console.warn(
    `Executing synchronous fetch via Deno subprocess for ${url}. This WILL block.`,
  );

  try {
    const denoExecutable = Deno.execPath(); // Get path to current Deno executable

    // Prepare the command to run the worker script
    const command = new Deno.Command(denoExecutable, {
      args: [
        "run",
        "--allow-net", // Worker needs net access
        "--no-check", // Skip type-checking for the worker for faster startup
        workerScriptPath, // The script to run
        url, // Pass the URL as an argument
      ],
      stdout: "piped", // Capture the worker's standard output (where it prints JSON)
      stderr: "piped", // Capture the worker's standard error
      // Note: We don't pipe stdin as the worker doesn't read it.
    });

    // Execute the command synchronously
    const output = command.outputSync();

    const stdoutText = new TextDecoder().decode(output.stdout);
    const stderrText = new TextDecoder().decode(output.stderr);

    // Log any errors from the child process's stderr for debugging,
    // filtering out common noisy warnings if desired.
    const filteredStderr = stderrText.split("\n").filter((line) =>
      !line.includes("Warning The `--unstable` flag is deprecated") && // Example filter
      !line.includes("Check file:") // Example filter for "--no-check" related noise
    ).join("\n").trim();
    if (filteredStderr) {
      console.error(`Subprocess stderr (${url}):\n${filteredStderr}`);
    }

    // --- Process the output ---

    // Priority 1: Try parsing stdout, as the worker might have successfully
    // captured an error (like network error) and reported it via JSON.
    let parsedResult: FetchResult | null = null;
    if (stdoutText) {
      try {
        parsedResult = JSON.parse(stdoutText);
      } catch (parseError) {
        // If parsing fails, we'll construct an error result below based on exit code/stderr.
        console.error(
          `Failed to parse subprocess stdout JSON for ${url}: ${parseError}\nRaw stdout: ${stdoutText}`,
        );
      }
    }

    // Priority 2: Check the subprocess exit code.
    if (output.code === 0) {
      // Process exited successfully.
      if (parsedResult) {
        // Successfully parsed the result from stdout.
        // The worker might still have reported an internal error via the JSON structure (e.g., failed to read body).
        if (parsedResult.error) {
          console.warn(
            `Worker script reported an error for ${url}: ${parsedResult.error}`,
          );
        }
        return parsedResult;
      } else {
        // Exited successfully, but stdout wasn't valid JSON. This is unexpected.
        return {
          status: null,
          statusText: null,
          ok: false,
          headers: {},
          body: stdoutText, // Include raw output
          error:
            `Subprocess for ${url} exited successfully (code 0) but produced non-JSON stdout. Stderr: ${
              filteredStderr || "(empty)"
            }`,
        };
      }
    } else {
      // Process exited with an error code.
      if (parsedResult && parsedResult.error) {
        // Worker exited with error code AND reported an error via JSON. Use the JSON error.
        // This is typical for fetch errors caught within the worker (e.g., network error).
        return parsedResult;
      } else {
        // Worker exited with error code, but either didn't produce valid JSON
        // or the JSON didn't contain an explicit error message.
        // Construct a generic error based on exit code and stderr.
        const baseErrorMsg =
          `Subprocess for ${url} failed with code ${output.code}.`;
        const extraInfo = filteredStderr
          ? ` Stderr: ${filteredStderr}`
          : (stdoutText && !parsedResult ? ` Raw stdout: ${stdoutText}` : ""); // Include raw stdout if parsing failed

        return {
          status: null,
          statusText: null,
          ok: false,
          headers: parsedResult?.headers ?? {}, // Keep headers if we parsed them but it wasn't an error structure
          body: parsedResult?.body ?? null, // Keep body if we parsed it but it wasn't an error structure
          error: baseErrorMsg + extraInfo,
        };
      }
    }
  } catch (spawnError) {
    // Error spawning the Deno process itself (e.g., executable not found, permissions)
    console.error(`Failed to spawn Deno subprocess for ${url}:`, spawnError);
    return {
      status: null,
      statusText: null,
      ok: false,
      headers: {},
      body: null,
      error: `Failed to spawn Deno subprocess: ${
        spawnError instanceof Error ? spawnError.message : String(spawnError)
      }`,
    };
  } finally {
    console.warn(`Synchronous fetch via Deno subprocess finished for ${url}.`);
  }
}
