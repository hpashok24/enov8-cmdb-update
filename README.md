# 📦 Enov8 – Deployment Version Update GitHub Action

Update the version of Enov8 CMDB resources, environments, and microservices directly from your CI/CD pipelines using GitHub Actions — creating the resource automatically if it doesn't exist yet.

---

# 🚀 Overview

This GitHub Action enables you to:

- 🔄 Update resource versions
- 🎯 Target specific Enov8 resources by name
- 🆕 Automatically create a resource (referenced entities looked up by name) if it doesn't already exist
- ⚡ Automate Enov8 updates as part of deployment pipelines
- 🧩 Update MicroServices linked to System Instances

---

# 🧩 Supported Resource Types

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

---

# 📥 Inputs

| Name | Required | Description |
|------|------|------|
| `enov8_url` | ✅ | Base Enov8 URL (without `/api`) |
| `app_id` | ✅ | Enov8 App ID |
| `app_key` | ✅ | Enov8 App Key |
| `resourceType` | ✅ | Resource type |
| `resourceName` | ✅ | Exact Enov8 resource name |
| `version` | ✅ | Version value to update |
| `systemInstance` | ❌ | Required only for `MicroService` updates |
| `autocreate` | ❌ | Boolean — `true` to create `resourceName` when it doesn't exist (using `metadata`). Defaults to `false` — a not-found resource is always an error unless this is set. Can be written unquoted (`true`/`false`) in YAML. |
| `metadata` | ❌ | Used when `autocreate` is `true` and `resourceName` doesn't exist yet. Shape depends on `resourceType` — see [Configuring `metadata`](#-configuring-metadata) below. `Assigned To` and `Organisation` are always resolved automatically in every case and must not be supplied. |

---

# 🔧 Configuring `metadata`

`metadata` is a JSON object. It is **only ever read when `autocreate: true` and `resourceName` doesn't already exist** — if the resource is found, `metadata` is never parsed, and none of this applies.

Its shape is different for `System Component` than for everything else, because System Component has no System/Environment dependency at all.

## `Environment Instance` / `System Interface` / `MicroService`

| Key | Default if omitted | Only matters when... | Notes |
|---|---|---|---|
| `Status` | `"InOperation"` | Anything is being created | Shared across **every** level created in one run (e.g. if a MicroService, its System Instance, and its System are all created in the same run, all three get this one Status — there's no per-level override). |
| `Environment` | — *(no default — required if the resource being created needs one)* | Creating the resource itself, or cascading into a `System Instance` for a `MicroService` | Looked up by name. **Never auto-created** — if the name doesn't match an existing Environment, the run fails. Create the Environment in Enov8 first. |
| `System` | — *(omit if the System isn't relevant, e.g. resource already exists)* | Same as `Environment` above | Looked up by name. **Is** auto-created if missing (see cascade below). |
| `Business Unit` | `"Other"` | The `System` above doesn't exist and is being created | Ignored entirely if `System` already exists. |
| `Type` | `"Other"` | Same as `Business Unit` | The System's Type — must be a value already configured in your Enov8 tenant's **System** Type picklist — e.g. `Other`, `Cloud`, `Azure`, `AWS`, `GCP`, `Windows`, `Linux`, `Mainframe`, `Non-Mainframe`, `Middleware`, `Container`, `Interface`, `MicroService`, `Legacy`, `PC Client Server`. An unrecognized value fails with an Enov8 `[OBJ_ERROR]`. |
| `Core` | `"False"` | Same as `Business Unit` | |

### The cascade, level by level

**`Environment Instance` / `System Interface`**
1. The resource itself — needs `Environment` and `System` (both by name).
2. *(only if `System` doesn't exist)* the System — needs `Business Unit`, `Type`, `Core`.

**`MicroService`**
1. The MicroService itself — just needs the `systemInstance` input (a name) to already exist, or be created below.
2. *(only if `systemInstance` doesn't exist)* the System Instance — needs `Environment` and `System` from `metadata`, same as above.
3. *(only if that `System` doesn't exist)* the System — needs `Business Unit`, `Type`, `Core`, same as above.

At every level, the action checks "does this already exist?" **before** creating anything — so you never get duplicate creates, and you only need to supply whichever keys correspond to what's actually missing.

### Quick decision guide

| Your situation | What to put in `metadata` |
|---|---|
| `resourceName` already exists | Nothing — it's never read. Omit `metadata` entirely, or leave `autocreate` off. |
| Doesn't exist, but its `System`/`Environment` (or `systemInstance`) already do | `{}` — every key defaults. |
| Doesn't exist, `Environment` also doesn't exist | Not possible via this action — create the Environment in Enov8 first, then re-run. |
| Doesn't exist, `System` also doesn't exist | `{"System": "...", "Environment": "..."}` — add `Business Unit`/`Type`/`Core` only if the defaults (`Other`/`Other`/`False`) aren't right for this System. |
| Creating a MicroService whose System Instance and System are also both missing | `{"System": "...", "Environment": "...", "Business Unit": "...", "Type": "...", "Core": "..."}` — same shape, one level deeper via `systemInstance`. |

## `System Component`

No System, Environment, or cascade involved at all — a System Component stands alone.

| Key | Default if omitted | Notes |
|---|---|---|
| `Status` | `"InOperation"` | |
| `Type` | **Required — no default** | The component's own Type — a completely separate, tenant-specific **Component** Type picklist (different from System's Type above). There's no universally-safe default, so this must be supplied explicitly. Check existing components in your tenant for valid values (e.g. `Server`, `Database`, `Module`, `Integration`). |
| `Monitored` | `"False"` | Boolean-as-string. |

Example: `{"Type": "Server"}`

---

# ⚙️ Setup Guide

## Step 1 — Add GitHub Secrets

Go to your repository:

**Settings → Secrets and variables → Actions**

Click **New repository secret** and add:

| Secret Name | Example Value |
|------|------|
| `ENOV8_BASE_URL` | `https://yourcompany.enov8.cloud/ecosystem` |
| `ENOV8_APP_ID` | `your_app_id` |
| `ENOV8_APP_KEY` | `your_app_key` |

---

# 🔐 Using GitHub Environment Secrets (Recommended)

If your repository uses GitHub Environments, specify the environment in your workflow:

```yaml
environment: dev
```

This ensures GitHub uses the correct environment-specific secrets.

---

# ⚠️ Important

Without specifying the environment, GitHub may use repository-level secrets instead of environment secrets.

---

# 📂 Step 2 — Create Workflow

Create a file:

```bash
.github/workflows/enov8.yml
```

---

# 🚀 Step 3 — Add Action to Workflow

## Example — Environment Instance Update

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
        uses: enov8-Ltd/enov8-update-deployment-version@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}

          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"

          version: "18.0.12"
```

---

# 🆕 Example — Create Environment Instance If Missing

If `resourceName` doesn't exist yet, set `autocreate: true` and supply `metadata` (by name — no manual IDs needed) and the action will create it:

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.0.0
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

`Status` defaults to `"InOperation"` if omitted. `Assigned To` and `Organisation` are resolved automatically — do not include them in `metadata`.

---

# 🆕 Example — Create Environment Instance AND its System If Missing

If the `System` referenced in `metadata` doesn't exist either, the action creates it too. `Business Unit`, `Type`, and `Core` all default (`"Other"`, `"Other"`, `"False"`) if omitted — override any of them explicitly if needed:

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.0.0
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

`Business Unit`, `Type`, and `Core` are ignored if `System` already exists.

---

# 🆕 Example — Create System Component If Missing

No System/Environment involved — just its own Type (required, tenant-specific Component Type picklist) and optional Monitored flag:

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.0.0
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

Unlike every other resource type, `Type` here has **no default** — it must be supplied and must match a value already in your tenant's Component Type picklist.

---

# 🧩 Example — MicroService Update

```yaml
name: Enov8 MicroService Update

on:
  workflow_dispatch:

jobs:
  update-microservice:
    runs-on: ubuntu-latest

    environment: dev

    steps:
      - name: Enov8 - MicroService Update
        uses: hpashok24/enov8-cmdb-update@v2.2.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}

          resourceType: "MicroService"
          resourceName: "Web Portal"

          systemInstance: "GDW (DEV)"

          version: "4.1"
```

---

# 🆕 Example — Create MicroService, Cascading Through System Instance and System

If `resourceName` (the MicroService) doesn't exist, set `autocreate: true`. If `systemInstance` also doesn't exist, it's created too — and if the `System` referenced in `metadata` doesn't exist either, that's created first. Same `metadata` shape as the Environment Instance examples above:

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.0.0
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

If `systemInstance` already exists, `metadata` can be empty (`{}`) — nothing below the MicroService needs creating. `Status` is shared across every level that actually gets created (MicroService, System Instance, System) rather than set per-level.

---

# ▶️ Step 4 — Run Workflow

1. Go to the **Actions** tab  
2. Select your workflow  
3. Click **Run workflow**

---

# 🔍 Example Output

```text
📡 PUT https://.../api/SystemInstance
📦 Payload ...
📨 Response ...
✅ Enov8 CMDB updated successfully
```

---

# ⚠️ Important Notes

## ✅ Correct URL Format

```text
https://<your-enov8-instance>/ecosystem
```

## ❌ Do NOT include

```text
/api
```

---

# ⚠️ Resource Name Must Match Exactly

```text
GDW (DEV)   ✅
gdw dev     ❌
```

---

# 💡 Usage Examples

## Update only version

```yaml
version: "18.0.12"
```

---

## Create the resource if it doesn't exist

```yaml
version: "18.0.12"
autocreate: true
metadata: |
  {
    "System": "GDW",
    "Environment": "DEV Env"
  }
```

---

# 🐛 Troubleshooting

## ❌ No update applied

- Verify resource name spelling
- Check if the version is already up-to-date
- Confirm correct GitHub environment secrets are being used

---

## ❌ Create failed / could not resolve metadata name

- Verify `autocreate` is set to `true` — without it, a not-found resource is always an error
- Verify the `System` or `Environment` name in `metadata` matches exactly (these are looked up by name against Enov8)
- If `System` also needs creating and you overrode `Business Unit`, verify it matches an existing Business Unit name
- Do not include `Assigned To` or `Organisation` in `metadata` — both are resolved automatically

---

## ❌ System Component create failed — "metadata.Type is required"

- `System Component` has no default `Type` — you must supply one in `metadata` (e.g. `{"Type": "Server"}`)
- The value must match an existing Component Type in your tenant — this is a different picklist from System's `Type`

---

## ❌ Authentication failed

- Verify `ENOV8_APP_ID`
- Verify `ENOV8_APP_KEY`
- Verify `ENOV8_BASE_URL`

---

## ❌ Invalid resource type

Supported values:

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

---

## ❌ MicroService update failed

Ensure `systemInstance` is provided:

```yaml
systemInstance: "GDW (DEV)"
```

---

# 🚀 Common Use Cases

- CI/CD deployment tracking
- Automated version management
- DevOps CMDB integration
- MicroService deployment tracking
- Auto-provisioning environment instances on first deploy

---

# 📄 License

MIT License
