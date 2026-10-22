# 🛡️ Enov8 - User Validated Deployment Update GitHub Action

## 🚀 Overview

This action updates the deployed version for an Environment Instance, System Component, System Interface, or MicroService in Enov8 directly from GitHub Actions, and can create the resource if it does not exist yet.

Every request is made on behalf of an Enov8 user. Before anything is written to the CMDB, the action checks that the user exists and that they have access to the System the change affects. If any check fails, the request is rejected and nothing is created or updated.

## ✨ Key Features

- **Mandatory User ID** — every request must include `userid`
- **User validation** — the user must exist, be active and have login access in the Enov8 Ecosystem
- **System access control** — for Environment Instances and MicroServices, on both create and update, the user must be a member of the associated System's **Assigned To** group
- **Validation before write** — rejected requests make no changes in Enov8
- **System lookup by Resource ID** — the System is found by `Resource ID` (e.g. an APM ID) first, then by name
- Creates missing resources on request, cascading through System Instance and System where needed

## 🔐 How validation works

### 1. User validation (all resource types)

The action looks up `userid` in Enov8 (`GET /api/User`). The request is rejected if:

- no user with that **User ID** exists,
- the user's **User Status** is not active (for example `InactiveUser`), or
- the user's **Login Access** is not `Yes` (for example awaiting approval)

### 2. System access (Environment Instance and MicroService)

The action first works out which System the request affects:

| Operation | Associated System |
|---|---|
| Update an Environment Instance | The System of that instance |
| Create an Environment Instance | The System in `metadata` (by `Resource ID`, then `System` name) |
| Update or create a MicroService on an existing `systemInstance` | The System of that `systemInstance` |
| Create a MicroService on a new `systemInstance` | The System in `metadata` (by `Resource ID`, then `System` name) |

It then reads the System's **Assigned To** group (`GET /api/System`) and checks the group's **Group Users** (`GET /api/Group`). Access is granted only if the user is listed in that group.

If the System does not exist yet and is being created by the same run, there is no group to check against, so the access check is skipped and this is shown in the log.

System Component and System Interface requests only need the user validation in step 1.

## 🧩 Supported Resource Types

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

## 📥 Required Inputs

| Name | Required | Description |
|---|---|---|
| `userid` | ✅ | Enov8 User ID (login ID, e.g. `AD0001`). Must match the User ID in Enov8 exactly. |
| `enov8_url` | ✅ | Base Enov8 URL, excluding `/api` |
| `app_id` | ✅ | Enov8 App ID credential |
| `app_key` | ✅ | Enov8 App Key credential |
| `resourceType` | ✅ | One of the resource types listed above |
| `resourceName` | ✅ | Exact resource name, matching Enov8 exactly |
| `version` | ✅ | The version value to set |

## 📥 Optional Inputs

| Name | Required | Description |
|---|---|---|
| `systemInstance` | Only for `MicroService` | Name of the parent System Instance |
| `autocreate` | ❌ (default `false`) | When `true`, creates `resourceName` if it does not already exist, using `metadata` |
| `metadata` | Only when `autocreate` is used and the resource is missing | JSON object describing how to create the resource — see [Configuring metadata](#-configuring-metadata) |

## ⚙️ Setup Guide

### Step 1 — Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Example Value |
|---|---|
| `ENOV8_BASE_URL` | `https://yourcompany.enov8.cloud/ecosystem` |
| `ENOV8_APP_ID` | `your_app_id` |
| `ENOV8_APP_KEY` | `your_app_key` |

If your repository uses GitHub Environments, add `environment: dev` (or your environment name) to the job so the environment's secrets are used.

### Step 2 — Create Workflow

Create `.github/workflows/enov8.yml` using one of the examples below.

## 💡 Usage Examples

### 🔄 Update an existing Environment Instance

```yaml
name: Enov8 CMDB Update

on:
  workflow_dispatch:

jobs:
  update-cmdb:
    runs-on: ubuntu-latest
    environment: dev

    steps:
      - name: Enov8 - User Validated Deployment Update
        uses: enov8-Ltd/enov8-user-validated-deployment-update@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          userid: "AD0001"
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
```

### 🔄 Update an existing MicroService

```yaml
      - name: Enov8 - User Validated Deployment Update
        uses: enov8-Ltd/enov8-user-validated-deployment-update@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          userid: "AD0001"
          resourceType: "MicroService"
          resourceName: "Web Portal"
          systemInstance: "GDW (DEV)"
          version: "4.1"
```

### 🆕 Create an Environment Instance on an existing System

```yaml
      - name: Enov8 - User Validated Deployment Update
        uses: enov8-Ltd/enov8-user-validated-deployment-update@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          userid: "AD0001"
          resourceType: "Environment Instance"
          resourceName: "GDW (UAT)"
          version: "18.0.12"
          autocreate: true
          metadata: |
            {
              "System": "GDW",
              "Environment": "UAT Env",
              "Resource ID": "APM-12345"
            }
```

### 🧩 Create a MicroService, cascading through System Instance and System

```yaml
      - name: Enov8 - User Validated Deployment Update
        uses: enov8-Ltd/enov8-user-validated-deployment-update@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          userid: "AD0001"
          resourceType: "MicroService"
          resourceName: "Web Portal"
          systemInstance: "NewSystem (DEV)"
          version: "1.0.0"
          autocreate: true
          metadata: |
            {
              "System": "NewSystem",
              "Environment": "DEV Env",
              "Business Unit": "IT",
              "Type": "Cloud",
              "Core": "True",
              "Resource ID": "APM-67890"
            }
```

If `systemInstance` already exists, `metadata` can be `{}`.

### 🆕 System Component

```yaml
      - name: Enov8 - User Validated Deployment Update
        uses: enov8-Ltd/enov8-user-validated-deployment-update@v1.0.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          userid: "AD0001"
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

## 🔍 Example Output

```text
🔐 Validating user "AD0001"
✅ User "AD0001" exists (User Status: ActiveUser)
🔐 Checking access of "AD0001" to System "GDW" (Assigned To: Enterprise IT)
✅ User "AD0001" is a member of "Enterprise IT" — access granted to System "GDW"
📡 PUT https://.../api/SystemInstance
📦 Payload ...
📨 Response ...
✅ Enov8 CMDB updated successfully
```

## 🔧 Configuring `metadata`

`metadata` is only read when `autocreate` is `true` and the resource does not already exist. `Resource ID` is also used to find the System for the access check.

### `Environment Instance`, `System Interface`, `MicroService`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | Applied to every record created in one run. |
| `Environment` | — (required if needed) | Resolved by name. Must already exist. |
| `System` | — | Resolved by name if no System matches `Resource ID`. Created automatically if it does not exist. |
| `Resource ID` | — (optional) | E.g. an APM ID. The System is looked up by this first. Saved to the System's Resource ID field when a new System is created. |
| `Business Unit` | `Other` | Used only if `System` is being created. |
| `Type` | `Other` | Used only if `System` is being created. Must match the tenant's System Type picklist. |
| `Core` | `False` | Used only if `System` is being created. |

`Assigned To` and `Organisation` are always resolved automatically and should not be included in `metadata`.

### `System Component`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | |
| `Type` | Required, no default | Must match the tenant's Component Type picklist (e.g. `Server`, `Database`). |
| `Monitored` | `False` | |

## 🐛 Troubleshooting

**❌ User "…" does not exist in the Enov8 Ecosystem**

- Check `userid` matches the user's **User ID** in Enov8 exactly (Configuration → Add Data → Access Management)
- Use the login User ID (e.g. `AD0001`), not the contact name or email

**❌ User "…" is not active / does not have login access**

- The user's **User Status** must be active (`ActiveUser`) and **Login Access** must be `Yes`
- Ask an Enov8 administrator to activate the user or approve their access (Configuration → Add Data → Access Management)

**❌ User "…" does not have access to System "…"**

- Open the System in Enov8 and check its **Assigned To** group
- Ask an administrator to add the user to that group's **Group Users**, or use a user who is already a member

**❌ Could not find the System linked to System Instance "…"**

- The instance exists but is not linked to a System, so access cannot be checked. Link the instance to its System in Enov8

**❌ Create failed / could not resolve a name in `metadata`**

- Verify `autocreate` is `true`
- Verify `System`, `Environment` and `Business Unit` names match Enov8 exactly

**❌ Authentication failed**

- Verify `ENOV8_APP_ID`, `ENOV8_APP_KEY` and `ENOV8_BASE_URL`
- `ENOV8_BASE_URL` must end in `/ecosystem`, without `/api`

## 🆘 Support

For assistance, contact support@enov8.com.

## 📄 License

[MIT](LICENSE)
