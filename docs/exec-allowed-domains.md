# Exec Allowed Domains

The `exec` tool can optionally allow outbound network access for specific domains.
The list is explicit: exact domains are allowed, and subdomain wildcards like
`*.example.com` are supported. A global wildcard (`*`) is not allowed.

`exec` now runs with **zero permissions by default**. To allow network or filesystem
writes, the call must include explicit `permissions` tags (for example `@network`,
`@write:/absolute/path`), and each tag is validated as a subset of the caller's
existing permissions.

`exec` and exec gates also support typed language ecosystem presets:
- `dart` -> `pub.dev`, `storage.googleapis.com`
- `dotnet` -> `nuget.org`, `api.nuget.org`, `globalcdn.nuget.org`
- `go` -> `proxy.golang.org`, `sum.golang.org`, `index.golang.org`, `golang.org`
- `java` -> `repo.maven.apache.org`, `repo1.maven.org`, `plugins.gradle.org`, `services.gradle.org`
- `node` -> `registry.npmjs.org`, `registry.yarnpkg.com`, `repo.yarnpkg.com`, `bun.sh` (covers npm/pnpm/yarn/bun)
- `php` -> `packagist.org`, `repo.packagist.org`
- `python` -> `pypi.org`, `files.pythonhosted.org`, `pypi.python.org`
- `ruby` -> `rubygems.org`
- `rust` -> `crates.io`, `index.crates.io`, `static.crates.io`

Presets are merged with explicit `allowedDomains`, deduped, then validated.

```mermaid
flowchart TD
  A[exec args] --> P{permissions provided?}
  P -- no --> Z[use zero-permission sandbox]
  P -- yes --> V[validate permission tags against caller]
  V --> S[build sandbox permissions from tags]
  Z --> B
  S --> B
  A[exec args] --> B[resolve allowedDomains]
  A --> C[expand packageManagers presets]
  B --> D[merge + dedupe]
  C --> D
  D --> E{contains "*"?}
  E -- yes --> F[error: wildcard not allowed]
  E -- no --> G{network permission enabled?}
  G -- no --> H[error: network permission required]
  G -- yes --> I[build sandbox config with resolved allowedDomains]
```
