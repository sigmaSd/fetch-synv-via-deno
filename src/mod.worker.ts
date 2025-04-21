// Define the structure of the output JSON
interface WorkerOutput {
  status: number | null;
  statusText: string | null;
  ok: boolean;
  headers: Record<string, string>; // Include headers
  body: string | null; // Body as text
  error: string | null; // Error message if fetch failed
}

async function main() {
  // Expect the URL as the first argument
  if (Deno.args.length === 0 || !Deno.args[0]) {
    const errorResult: WorkerOutput = {
      status: null,
      statusText: null,
      ok: false,
      headers: {},
      body: null,
      error: "Usage: deno run --allow-net fetch_worker.ts <url>",
    };
    // Log usage error message to stderr (for potential debugging)
    console.error(errorResult.error);
    // Output the error structure as JSON to stdout (for the parent process)
    console.log(JSON.stringify(errorResult));
    Deno.exit(1); // Exit with failure code
    return; // Explicit return for clarity
  }

  const url = Deno.args[0];
  let output: WorkerOutput;
  let response: Response | undefined; // Define response here to access it in catch block if needed

  try {
    // Perform the asynchronous fetch operation
    response = await fetch(url);

    // Convert Headers object to a simple Record<string, string> for JSON serialization
    // Do this *before* reading body, as we might want headers even if body fails
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Read the response body as text.
    // Note: This assumes text-based content. Binary content would need different handling (e.g., base64).
    let body: string | null = null;
    try {
      // Use try-catch here because .text() can fail (e.g., large body, network interrupt during read, non-text content)
      body = await response.text();
    } catch (bodyError) {
      console.error(
        `Worker: Error reading response body for ${url}: ${bodyError}`,
      );
      // Still return status and headers, but report the body reading error
      output = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: headers, // Return headers we successfully got
        body: null,
        error: `Failed to read response body: ${
          bodyError instanceof Error ? bodyError.message : String(bodyError)
        }`,
      };
      console.log(JSON.stringify(output));
      // Exit with failure because we couldn't fully process the response
      // Parent might still consider status/headers useful depending on the use case.
      Deno.exit(1);
      return;
    }

    // Prepare the success output structure (even for 4xx/5xx responses)
    output = {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: headers,
      body: body,
      error: null, // No fetch or body read error occurred
    };

    // Output the result structure as JSON to stdout
    console.log(JSON.stringify(output));
    Deno.exit(0); // Exit with success code
  } catch (fetchError) {
    // An error occurred during the fetch call itself (e.g., network error, DNS resolution failure)
    console.error(`Worker: Fetch failed for ${url}: ${fetchError}`); // Log detailed error to worker's stderr
    output = {
      status: response?.status ?? null, // Include status if response object exists partially
      statusText: response?.statusText ?? null,
      ok: false, // Fetch failed or partially failed
      headers: {}, // Headers might be unreliable or non-existent
      body: null,
      // Format error message for the parent process
      error: fetchError instanceof Error
        ? `${fetchError.name}: ${fetchError.message}` // e.g., "TypeError: error sending request"
        : String(fetchError), // Fallback for non-Error objects
    };
    // Output the error structure as JSON to stdout
    console.log(JSON.stringify(output));
    Deno.exit(1); // Exit with failure code
  }
}

// Run the async main function
main();
