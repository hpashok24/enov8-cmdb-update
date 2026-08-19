# 📦 Enov8 - Deployment Version Update GitHub Action

## 🚀 Overview

This action updates the deployed version for an Environment Instance, System Component, System Interface, or MicroService in Enov8 directly from GitHub Actions. If the target resource does not yet exist, the action can create it, resolving any related System, Environment, or System Instance records by name.

## ✨ Key Features

- Updates deployed version information for Environment Instances, System Components, System Interfaces, and MicroServices
- Creates a resource automatically when it does not already exist, resolving referenced records by name instead of requiring internal Enov8 IDs
- Cascades creation through dependent records where needed — a MicroService can create its System Instance, which can create its System
- Supports four resource types: Environment Instance, System Component, System Interface, and MicroService

## 📥 Required Inputs

| Input | Purpose |
|---|---|
| `enov8_url` | Base Enov8 URL, excluding `/api` |
| `app_id` | Enov8 App ID credential |
| `app_key` | Enov8 App Key credential |
| `resourceType` | One of: `Environment Instance`, `System Component`, `System Interface`, `MicroService` |
| `resourceName` | Exact resource name, matching Enov8 exactly |
| `version` | The version value to set |

## 📥 Optional Inputs

| Input | Purpose |
|---|---|
| `systemInstance` | Name of the parent System Instance. Required when `resourceType` is `MicroService`. |
| `autocreate` | When `true`, creates `resourceName` if it does not already exist, using `metadata`. Defaults to `false`, in which case a not-found resource always fails the run. |
| `metadata` | JSON object describing how to create the resource. Only read when `autocreate` is `true` and the resource is missing. See [Configuring metadata](#configuring-metadata). |

## ⚙️ Setup Instructions

Add three repository secrets under **Settings → Secrets and variables → Actions**:

- `ENOV8_BASE_URL`
- `ENOV8_APP_ID`
- `ENOV8_APP_KEY`

If the repository uses GitHub Environments, add `environment: <name>` to the job so the correct environment-scoped secrets are used, rather than falling back to repository-level secrets.

## 💡 Usage Examples

There is no tagged release yet, so workflows should reference `@main`.

### 🔄 Update an existing resource

```yaml
name: Enov8 CMDB Update

on:
  workflow_dispatch:

jobs:
  update-cmdb:
    runs-on: ubuntu-latest
    environment: dev

    steps:
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
```

### 🆕 Create the resource if it does not exist

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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

### 🆕 Create the resource and its System, if the System also does not exist

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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

`Business Unit`, `Type`, and `Core` are only used if `System` needs to be created, and are ignored otherwise.

### 🧩 MicroService, cascading through System Instance and System

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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

If `systemInstance` already exists, `metadata` can be `{}` — nothing below the MicroService needs creating.

### 🆕 System Component

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@main
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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

System Component has no System or Environment dependency. Unlike other resource types, `Type` has no default here and must be supplied.

## 🔧 Configuring `metadata`

`metadata` is only read when `autocreate` is `true` and `resourceName` does not already exist. Its shape depends on `resourceType`.

### `Environment Instance`, `System Interface`, `MicroService`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | Applied to every record created in one run. |
| `Environment` | — (required if needed) | Resolved by name. Not created automatically — the named Environment must already exist. |
| `System` | — (omit if not needed) | Resolved by name. Created automatically if it does not exist. |
| `Business Unit` | `Other` | Used only if `System` is being created. |
| `Type` | `Other` | The System's Type. Used only if `System` is being created. Must match a value already configured in the tenant's System Type picklist. |
| `Core` | `False` | Used only if `System` is being created. |

For `MicroService`, the same rules apply one level down: `systemInstance` is resolved first, and if it does not exist, it is created using `Environment`/`System`/`Business Unit`/`Type`/`Core` from `metadata`.

`Assigned To` and `Organisation` are always resolved automatically and should not be included in `metadata`.

### `System Component`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | |
| `Type` | Required, no default | A tenant-specific Component Type picklist, separate from System's Type. Check existing components for valid values (for example `Server`, `Database`, `Module`, `Integration`). |
| `Monitored` | `False` | |

## ⚠️ Important Considerations

- Resource names must match Enov8 records exactly, including case and spacing.
- `enov8_url` should follow the format `https://<instance>/ecosystem`, excluding `/api`.
- When updating or creating a MicroService, `systemInstance` must be specified.
- `Type` and `Status` values are validated against picklists configured per Enov8 tenant. An unrecognized value is rejected by the Enov8 API.
- `System Interface` autocreate has not been verified against the live API.
- The action writes the Enov8 API response to the `result` output, available to later steps as `${{ steps.<step-id>.outputs.result }}`.

## 📄 License

[MIT](LICENSE)
