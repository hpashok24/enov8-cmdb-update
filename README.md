# 📦 Enov8 – CMDB Update GitHub Action

Update Enov8 CMDB resources (Environment Instance, System Component, System Interface) directly from your CI/CD pipelines.

---

## 🚀 Overview

This GitHub Action enables you to:

* 🔄 Update **Version**
* 🚦 Update **Status**
* 🎯 Target specific CMDB resources by name
* ⚡ Automate Enov8 updates as part of your deployment pipeline

---

## 🧩 Supported Resource Types

* `Environment Instance`
* `System Component`
* `System Interface`

---

## 📥 Inputs

| Name             | Required | Description                     |
| ---------------- | -------- | ------------------------------- |
| `enov8_url`      | ✅        | Base Enov8 URL (without `/api`) |
| `app_id`         | ✅        | Enov8 App ID                    |
| `app_key`        | ✅        | Enov8 App Key                   |
| `resourceType`   | ✅        | Resource type                   |
| `resourceName`   | ✅        | Exact CMDB resource name        |
| `includeVersion` | ❌        | Set `true` to update version    |
| `version`        | ❌        | Version value                   |
| `includeStatus`  | ❌        | Set `true` to update status     |
| `status`         | ❌        | Status value                    |

---

# ⚙️ Setup Guide

## Step 1 — Add GitHub Secrets

Go to your repository:

👉 **Settings → Secrets and variables → Actions**

Click **New repository secret** and add:

| Secret Name      | Example Value                             |
| ---------------- | ----------------------------------------- |
| `ENOV8_BASE_URL` | `https://enov8-india.enov8.com/ecosystem` |
| `ENOV8_APP_ID`   | your_app_id                               |
| `ENOV8_APP_KEY`  | your_app_key                              |

---

## 🔐 What are these secrets?

* **ENOV8_BASE_URL** → Your Enov8 ecosystem base URL
* **ENOV8_APP_ID / APP_KEY** → Credentials for API authentication

⚠️ Never hardcode these values in workflows.

---

## Step 2 — Create Workflow

Create a file:

```bash
.github/workflows/enov8.yml
```

---

## Step 3 — Add Action to Workflow

```yaml
name: Enov8 CMDB Update

on:
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest

    steps:
      -   name: Enov8 - CMDB Update
          uses: hpashok24/enov8-cmdb-update@v2.0.1
          with:
            enov8_url: ${{ secrets.ENOV8_BASE_URL }}
            app_id: ${{ secrets.ENOV8_APP_ID }}
            app_key: ${{ secrets.ENOV8_APP_KEY }}
            resourceType: "Environment Instance"
            resourceName: "GDW (DEV)"
            includeVersion: true
            version: "18.0.10"
            includeStatus: true
            status: "UnplannedOutage"
```

---

## Step 4 — Run Workflow

1. Go to **Actions** tab
2. Select **Enov8 CMDB Update**
3. Click **Run workflow**

---

## 🔍 Example Output

```text
📡 PUT https://.../api/SystemInstance
📦 Payload ...
✅ Enov8 CMDB updated successfully
```

---

# ⚠️ Important Notes

### ✅ Correct URL format

```
https://<your-enov8-instance>/ecosystem
```

### ❌ Do NOT include

```
/api
```

---

### ⚠️ Resource Name

Must exactly match Enov8 CMDB entry:

```
GDW (DEV) ✅
gdw dev ❌
```

---

### ⚠️ Status Values

Status must be valid in your Enov8 system:

```
UnplannedOutage ✅
Deployed ❌ (if not configured)
```

---

# 💡 Usage Examples

## Update only version

```yaml
includeVersion: true
version: "18.0.10"
includeStatus: false
```

---

## Update only status

```yaml
includeVersion: false
includeStatus: true
status: "UnplannedOutage"
```

---

## Full update

```yaml
includeVersion: true
includeStatus: true
```

---

# 🐛 Troubleshooting

### ❌ HTTP 400 / Invalid class

* Wrong `resourceType`

---

### ❌ No update

* Resource name mismatch

---

### ❌ Authentication failed

* Check secrets

---

# 🚀 Use Cases

* CI/CD deployment tracking
* Environment status automation
* Release version tracking
* DevOps CMDB integration

---

# 📄 License

MIT License
