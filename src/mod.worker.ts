// fetchSyncViaDeno/src/mod.worker.ts
import { readAll } from "jsr:@std/io/read-all"; // Using std library for reading stdin

// Define the structure of the data expected from stdin
interface WorkerInput {
  url: string;
  options: RequestInit; // Standard fetch options
}

// Define the structure of the output JSON sent to stdout
interface WorkerOutput {
  status: number | null;
  statusText: string | null;
  ok: boolean;
  headers: Record<string, string>;
  body: string | null;
  error: string | null;
}

async function main() {
  let input: WorkerInput;
  let url: string;
  let options: RequestInit;
  let output: WorkerOutput;
  let response: Response | undefined; // Keep response accessible in catch blocks

  try {
    // 1. Read all data from stdin
    const stdinBytes = await readAll(Deno.stdin);

    // 2. Decode the bytes to a string (assuming UTF-8)
    const stdinText = new TextDecoder().decode(stdinBytes);

    // 3. Parse the JSON string into the WorkerInput structure
    input = JSON.parse(stdinText);
    url = input.url;
    options = input.options;

    // --- Input validation (basic) ---
    if (typeof url !== "string" || !url) {
      throw new Error("Invalid or missing 'url' in stdin JSON.");
    }
    if (typeof options !== "object" || options === null) {
      throw new Error("Invalid or missing 'options' object in stdin JSON.");
    }
    // Note: More specific validation of 'options' could be added if needed
  } catch (inputError) {
    // Handle errors during stdin reading, decoding, or parsing
    const errorMsg = `Worker: Failed to process stdin: ${
      inputError instanceof Error ? inputError.message : String(inputError)
    }`;
    console.error(errorMsg); // Log detail to stderr
    output = {
      status: null,
      statusText: null,
      ok: false,
      headers: {},
      body: null,
      error: errorMsg, // Report the input processing error
    };
    console.log(JSON.stringify(output));
    Deno.exit(1);
    return;
  }

  // --- Proceed with fetch using the parsed input ---
  const requestDesc = `${options.method || "GET"} ${url}`; // For logging

  try {
    // 4. Perform the asynchronous fetch operation using parsed url and options
    response = await fetch(url, options);

    // 5. Convert Headers object to a simple Record<string, string>
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // 6. Read the response body as text.
    let body: string | null = null;
    try {
      body = await response.text();
    } catch (bodyError) {
      console.error(
        `Worker: Error reading response body for ${requestDesc}: ${bodyError}`,
      );
      output = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: headers, // Return headers even if body fails
        body: null,
        error: `Failed to read response body: ${
          bodyError instanceof Error ? bodyError.message : String(bodyError)
        }`,
      };
      console.log(JSON.stringify(output));
      // Exit non-zero as we couldn't fully process the expected response
      Deno.exit(1);
      return;
    }

    // 7. Prepare the success output structure
    output = {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: headers,
      body: body,
      error: null, // No fetch or body read error
    };

    // 8. Output the result structure as JSON to stdout
    console.log(JSON.stringify(output));
    Deno.exit(0); // Success
  } catch (fetchError) {
    // 9. Handle errors during the fetch call itself
    const errorMsg = fetchError instanceof Error
      ? `${fetchError.name}: ${fetchError.message}`
      : String(fetchError);
    console.error(`Worker: Fetch failed for ${requestDesc}: ${errorMsg}`); // Log detailed error to stderr
    output = {
      status: response?.status ?? null, // Include status if response partially exists
      statusText: response?.statusText ?? null,
      ok: false, // Fetch failed
      headers: {}, // Headers might be unreliable
      body: null,
      error: `Fetch failed: ${errorMsg}`, // Report fetch error
    };
    console.log(JSON.stringify(output));
    Deno.exit(1); // Failure
  }
}

// Run the async main function
main();
