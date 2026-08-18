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
| `version` | ❌ | Version value to update |
| `systemInstance` | ❌ | Required only for `MicroService` updates |
| `autocreate` | ❌ | Boolean — `true` to create `resourceName` when it doesn't exist (using `metadata`). Defaults to `false` — a not-found resource is always an error unless this is set. Can be written unquoted (`true`/`false`) in YAML. |
| `metadata` | ❌ | Used when `autocreate` is `true` and `resourceName` doesn't exist yet. Supported keys, all optional with defaults: `Status` (default `"InOperation"`), `System`, `Environment`, `Business Unit` (default `"Other"`), `Type` (default `"Other"`), `Core` (default `"False"`). `System`/`Environment` are by name — resolved automatically. `Business Unit`/`Type`/`Core` are only used if `System` also doesn't exist and needs creating. `Assigned To` and `Organisation` are always resolved automatically and must not be supplied. |

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
