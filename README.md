# Fetch Sync Via Deno

Provides a synchronous-like fetch implementation for Deno by spawning a separate
Deno process for each request.

This module offers a workaround for specific scenarios where true asynchronous
operations are not feasible. However, it comes with significant drawbacks:

- **Blocking:** The `fetchSyncViaDeno` function blocks the main Deno process
  until the subprocess completes the network request.
- **Performance Overhead:** Spawning a new process for each fetch request incurs
  substantial overhead compared to the native asynchronous `fetch`.

**Use this module with extreme caution.** Prefer the standard asynchronous
`fetch` API whenever possible. This synchronous approach should only be
considered as a last resort in constrained environments or specific integration
scenarios where blocking is absolutely required and the performance impact is
acceptable.

## Examples

**Example 1**

```ts
import { fetchSyncViaDeno } from "./mod.ts";

// Warning: This blocks!
const result = fetchSyncViaDeno("https://api.github.com/users/denoland");

if (result.ok && result.body) {
  const data = JSON.parse(result.body);
  console.log("GitHub User:", data.login);
  console.log("Headers:", result.headers);
} else {
  console.error(`Fetch failed: ${result.error || result.statusText}`);
}
```
