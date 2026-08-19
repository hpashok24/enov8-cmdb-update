# Enov8 Deployment Version Update

A GitHub Action for updating Enov8 CMDB resource versions from a CI/CD pipeline, and provisioning the resource if it doesn't exist yet. It talks to the Enov8 REST API directly; no external dependencies.

## What it does

On every run, the action tries to update `resourceName` first. If that resource already exists, this is all you need — it updates the version and exits.

If the resource doesn't exist and `autocreate` is turned on, the action creates it instead, resolving anything it references (a System, an Environment, a parent System Instance) by name rather than requiring you to know Enov8's internal IDs. For resource types with dependencies, it will create those too if they're also missing — e.g. creating a MicroService can cascade into creating its System Instance, which can cascade into creating its System.

## Supported resource types

| Type | Update | Create (`autocreate: true`) |
|---|---|---|
| `Environment Instance` | Yes | Yes — resolves/creates its `System`, resolves its `Environment` |
| `System Component` | Yes | Yes — standalone, no System/Environment dependency |
| `MicroService` | Yes | Yes — resolves/creates its System Instance (and that instance's System) |
| `System Interface` | Yes | Not verified against the live API yet — avoid `autocreate` for this type until it's been checked |

## Inputs

| Name | Required | Description |
|---|---|---|
| `enov8_url` | yes | Base Enov8 URL, without `/api` (e.g. `https://yourcompany.enov8.cloud/ecosystem`) |
| `app_id` | yes | Enov8 App ID |
| `app_key` | yes | Enov8 App Key |
| `resourceType` | yes | One of the types listed above |
| `resourceName` | yes | Exact resource name — must match Enov8 exactly, including case and spacing |
| `version` | yes | Version value to set |
| `systemInstance` | only for `MicroService` | Name of the parent System Instance |
| `autocreate` | no, default `false` | Create `resourceName` if it doesn't exist, using `metadata`. Without this, a not-found resource is always a failed run. |
| `metadata` | only when `autocreate` is used and the resource is missing | JSON object — see below |

## Configuring `metadata`

`metadata` is only read when `autocreate: true` and `resourceName` doesn't already exist. If the resource is found, it's never parsed.

Its shape depends on `resourceType` — `System Component` has no System/Environment dependency, so it's documented separately below.

### `Environment Instance` / `System Interface` / `MicroService`

| Key | Default | Notes |
|---|---|---|
| `Status` | `"InOperation"` | Applied to every level created in one run — if a run creates a MicroService, its System Instance, and its System all in one go, all three get this same value. There's no per-level override. |
| `Environment` | — (required if the created resource needs one) | Resolved by name. Never auto-created — if the name doesn't match an existing Environment, the run fails. |
| `System` | — (omit if not relevant) | Resolved by name. Auto-created if missing. |
| `Business Unit` | `"Other"` | Only read if `System` needs creating. |
| `Type` | `"Other"` | The System's Type. Only read if `System` needs creating. Must match a value already configured in your tenant's System Type picklist — check what's valid before relying on a non-default value; common ones include `Cloud`, `Azure`, `AWS`, `GCP`, `Windows`, `Linux`, `Mainframe`, `Container`. |
| `Core` | `"False"` | Only read if `System` needs creating. |

Dependency chain, deepest first:

- `Environment Instance` / `System Interface`: the resource itself needs `Environment` + `System`; `System`, if missing, needs `Business Unit`/`Type`/`Core`.
- `MicroService`: the MicroService needs `systemInstance` to resolve; that System Instance, if missing, needs `Environment` + `System` from `metadata`; that System, if missing, needs `Business Unit`/`Type`/`Core`.

Each level is checked for existence before anything is created, so you only need to supply the keys for whatever's actually missing — everything else in `metadata` is ignored.

Never include `Assigned To` or `Organisation` — both are always resolved automatically (`Assigned To` from the Enov8 Group flagged for environment management, `Organisation` from the tenant's single Organisation record) and are simply not read from `metadata`.

### `System Component`

| Key | Default | Notes |
|---|---|---|
| `Status` | `"InOperation"` | |
| `Type` | required, no default | A separate, tenant-specific Component Type picklist — different from System's `Type` above. There's no safe universal default, so this must be supplied. Check existing components in your tenant for valid values (e.g. `Server`, `Database`, `Module`, `Integration`). |
| `Monitored` | `"False"` | |

## Setup

Add three repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Example |
|---|---|
| `ENOV8_BASE_URL` | `https://yourcompany.enov8.cloud/ecosystem` |
| `ENOV8_APP_ID` | your app ID |
| `ENOV8_APP_KEY` | your app key |

If you're using GitHub Environments, add `environment: dev` (or whichever environment) to the job — otherwise GitHub may fall back to repository-level secrets instead of environment-scoped ones.

There's no tagged release yet, so reference `@main` for now:

```yaml
name: Update Enov8 Environment Instance

on:
  workflow_dispatch:

jobs:
  update-cmdb:
    runs-on: ubuntu-latest
    environment: dev

    steps:
      - name: Enov8 - Deployment Version Update
        uses: hpashok24/enov8-cmdb-update@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
```

Once `resourceName` exists, that's the entire workflow. What follows covers the create path.

## Examples

### Create the resource if it's missing

```yaml
resourceType: "Environment Instance"
resourceName: "GDW (DEV)"
version: "18.0.12"
autocreate: true
metadata: |
  {
    "System": "GDW",
    "Environment": "DEV Env"
  }
```

### Create it and its System, if the System is also missing

```yaml
resourceType: "Environment Instance"
resourceName: "NewSystem (DEV)"
version: "1.0.0"
autocreate: true
metadata: |
  {
    "System": "NewSystem",
    "Environment": "DEV Env",
    "Business Unit": "IT",
    "Type": "Cloud",
    "Core": "True"
  }
```

`Business Unit`/`Type`/`Core` are ignored if `System` already exists — no harm in leaving them in.

### MicroService, cascading through System Instance and System

```yaml
resourceType: "MicroService"
resourceName: "Web Portal"
systemInstance: "GDW (DEV)"
version: "4.1"
autocreate: true
metadata: |
  {
    "System": "GDW",
    "Environment": "DEV Env",
    "Business Unit": "IT",
    "Type": "Cloud",
    "Core": "True"
  }
```

If `systemInstance` already exists, `metadata` can just be `{}` — nothing below the MicroService needs creating.

### System Component

```yaml
resourceType: "System Component"
resourceName: "AppServer_PROD_NewApp"
version: "1.0"
autocreate: true
metadata: |
  {
    "Type": "Server",
    "Monitored": "True"
  }
```

Unlike everything else, `Type` here has no default and must be supplied.

## Notes

- `enov8_url` should be the base URL without `/api` — e.g. `https://yourcompany.enov8.cloud/ecosystem`, not `.../ecosystem/api`.
- `resourceName` has to match exactly, including case and spacing (`GDW (DEV)`, not `gdw dev`).
- The action writes the raw Enov8 API response to the `result` output, so a later step can read it via `${{ steps.<step-id>.outputs.result }}`.

## Troubleshooting

**Run succeeds but "no update applied"** — the resource was found but the value you sent matches what's already there, or the field name is wrong. Not an error.

**Create fails / can't resolve a name in `metadata`** — confirm `autocreate: true` is actually set (without it, a missing resource is always a hard failure, `metadata` or not), and that `System`/`Environment` names match Enov8 exactly.

**System Component create fails with "metadata.Type is required"** — `Type` has no default for this resource type; supply one, and make sure it's a valid Component Type in your tenant (different picklist from System's `Type`).

**MicroService update fails** — `systemInstance` is required for this resource type and wasn't provided.

**Invalid resourceType** — must be exactly one of `Environment Instance`, `System Component`, `System Interface`, `MicroService`.

## License

[MIT](LICENSE)
