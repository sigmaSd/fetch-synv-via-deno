# Fetch Sync Via Deno

Provides a synchronous-like fetch implementation for Deno by spawning a separate
Deno process for each request. Accepts standard `RequestInit` options.

This module offers a workaround for specific scenarios where true asynchronous
operations are not feasible. However, it comes with significant drawbacks:

- **Blocking:** The `fetchSyncViaDeno` function blocks the main Deno process
  until the subprocess completes the network request.
- **Performance Overhead:** Spawning a new process for each fetch request incurs
  substantial overhead compared to the native asynchronous `fetch`.
- **Body Handling:** Request bodies are serialized as part of the input JSON,
  which may be inefficient for very large bodies.

**Use this module with extreme caution.** Prefer the standard asynchronous
`fetch` API whenever possible. This synchronous approach should only be
considered as a last resort in constrained environments or specific integration
scenarios where blocking is absolutely required and the performance impact is
acceptable.

## Examples

**Example 1**

```ts
import { fetchSyncViaDeno } from "jsr:@sigmasd/fetch-sync-via-deno";

// Simple GET
const getResult = fetchSyncViaDeno("https://httpbin.org/get");
console.log("GET Status:", getResult.status);

// POST with JSON body
const postResult = fetchSyncViaDeno("https://httpbin.org/post", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Hello from sync fetch!" }),
});

if (postResult.ok && postResult.body) {
  console.log("POST Response Body:", JSON.parse(postResult.body).json);
} else {
  console.error(`POST failed: ${postResult.error || postResult.statusText}`);
}
```
