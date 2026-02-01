# Exec Allowed Domains

The `exec` tool can optionally allow outbound network access for specific domains. The list is explicit: exact domains are allowed, and subdomain wildcards like `*.example.com` are supported. A global wildcard (`*`) is not allowed.

```mermaid
flowchart TD
  A[exec args] --> B{allowedDomains provided?}
  B -- no --> C[network.allowedDomains = []]
  B -- yes --> D[trim + dedupe]
  D --> E{contains "*"?}
  E -- yes --> F[error: wildcard not allowed]
  E -- no --> G{web permission enabled?}
  G -- no --> H[error: web permission required]
  G -- yes --> I[build sandbox config with allowedDomains]
```
