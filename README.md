# 📦 Enov8 – Deployment Version Update GitHub Action

Update the version of Enov8 CMDB resources, environments, and microservices directly from your CI/CD pipelines using GitHub Actions — creating the resource automatically if it doesn't exist yet.

---

# 🚀 Overview

This GitHub Action enables you to:

- 🔄 Update resource versions
- 🎯 Target specific Enov8 resources by name
- 🆕 Automatically create a resource (by name lookup, no ECO IDs required) if it doesn't already exist
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
| `metadata` | ❌ | JSON object used only when `resourceName` doesn't exist yet, to create it. Supported keys: `System`, `Environment`, `Assigned To` (all by name — resolved to ECO IDs automatically). `Organisation` is resolved automatically and never needs to be supplied. |

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

If `resourceName` doesn't exist yet, supply `metadata` (names only — no ECO IDs) and the action will create it:

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

          metadata: |
            {
              "System": "GDW",
              "Environment": "DEV Env",
              "Assigned To": "Support Team"
            }
```

`Organisation` is resolved automatically — do not include it in `metadata`.

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
metadata: |
  {
    "System": "GDW",
    "Environment": "DEV Env",
    "Assigned To": "Support Team"
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

- Verify the `System`, `Environment`, or `Assigned To` name in `metadata` matches exactly (these are looked up by name against Enov8)
- Only `System`, `Environment`, and `Assigned To` are supported keys in `metadata` — do not include `Organisation`, it's resolved automatically

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
