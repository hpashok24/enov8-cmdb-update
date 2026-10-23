# 🛡️ Enov8 - Governed Deployment Version Update GitHub Action

## 🚀 Overview

> **New in v1.3.0:** governed updates are on by default. Every run is checked against the Enov8 user mapped to the GitHub user who triggered it. Before upgrading, map each person who runs deployments to their Enov8 user — see [One-time setup](#-one-time-setup-map-github-users-to-enov8-users).

This action updates the deployed version for an Environment Instance, System Component, System Interface, or MicroService in Enov8 directly from GitHub Actions, and can create the resource if it does not exist yet.

Every change is made **as the GitHub user who ran the workflow**. The action reads that identity from GitHub itself, maps it to an Enov8 user, and checks that user's access before anything is written to the CMDB. There is no user ID to type into the workflow, so a workflow author cannot act as someone else.

## ✨ Key Features

- **Identity from GitHub, not from the workflow** — the user is taken from `GITHUB_TRIGGERING_ACTOR` (falling back to `GITHUB_ACTOR`), which GitHub sets and a workflow cannot overwrite
- **Mapped to an Enov8 user** — the GitHub username must match an Enov8 user's **User ID** (not case-sensitive)
- **User validation** — the Enov8 user must be active (`ActiveUser`) and have Login Access `Yes`
- **System access control** — for Environment Instances and MicroServices, on both create and update, the user must be a member of the associated System's **Assigned To** group
- **Validation before write** — rejected requests make no changes in Enov8
- **System lookup by Resource ID** — the System is found by `Resource ID` (e.g. an APM ID) first, then by name
- Creates missing resources on request, cascading through System Instance and System where needed
- **System ↔ System links** — records Upstream and Downstream connections between Systems (not instances), each identified by its Resource ID

## 👤 One-time setup: map GitHub users to Enov8 users

Each person who will run deployments needs an Enov8 user whose **User ID** is the same as their **GitHub username** (for example GitHub `jsmith-dev` → Enov8 User ID `jsmith-dev`). Upper and lower case don't matter.

- Because users are created in Enov8, only Enov8 administrators can decide who is who.
- Runs triggered by bots (for example `dependabot[bot]`) are rejected. Deployments must be triggered by a mapped person.

## 🔐 How validation works

### 1. Identity and user validation (all resource types)

The action reads the GitHub user who triggered the run and looks up the Enov8 user whose **User ID** matches it (`GET /api/User`). The request is rejected if:

- the run was triggered by a bot account,
- no Enov8 user is mapped to that GitHub username, or more than one is,
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

System Component and System Interface requests only need the identity and user validation in step 1.

## 🧩 Supported Resource Types

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

## 📥 Required Inputs

| Name | Required | Description |
|---|---|---|
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

### Step 2 — Map your GitHub users

See [One-time setup](#-one-time-setup-map-github-users-to-enov8-users).

### Step 3 — Create Workflow

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
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
```

### 🔄 Update an existing MicroService

```yaml
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "MicroService"
          resourceName: "Web Portal"
          systemInstance: "GDW (DEV)"
          version: "4.1"
```

### 🆕 Create an Environment Instance on an existing System

```yaml
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
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
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
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

### 🔗 Create the resource and its System, with Upstream and Downstream links

```yaml
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1.3.0
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
              "Core": "True",
              "Resource ID": "APM-12345",
              "Upstream": [
                { "Resource ID": "APM-1001", "ConnectionTechnology": "ESB" }
              ],
              "Downstream": [
                { "Resource ID": "APM-2002", "ConnectionTechnology": "ESB" },
                { "Resource ID": "APM-3003", "ConnectionTechnology": "FTP" }
              ]
            }
```

The action creates `NewSystem` (with Resource ID `APM-12345`) and the instance `NewSystem (DEV)`, then links `NewSystem` to the Systems whose Resource IDs are listed. Each entry creates one link in `System_REL_System`:

| Entry | SOURCE_ID | TARGET_ID | Connection Type |
|---|---|---|---|
| Upstream `APM-1001` | NewSystem | System with Resource ID `APM-1001` | ESB |
| Downstream `APM-2002` | System with Resource ID `APM-2002` | NewSystem | ESB |
| Downstream `APM-3003` | System with Resource ID `APM-3003` | NewSystem | FTP |

The same `Upstream` / `Downstream` lists also work when the System already exists, and on a plain version update: the links are added to the instance's System, and links that already exist are skipped.

## 🔍 Example Output

```text
🔐 GitHub user "jsmith-dev" — looking up the mapped Enov8 user (User ID)
✅ GitHub user "jsmith-dev" → Enov8 user "jsmith-dev" (User Status: ActiveUser)
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

### System links: `Upstream` and `Downstream`

These keys link **Systems to Systems** (stored in `System_REL_System`). They never link instances or MicroServices.

The System being linked is the System of the request: the `System` / `Resource ID` in `metadata` when it is created, or the System of the instance (or of the MicroService's `systemInstance`) when it already exists. That is why the keys can be sent with `resourceType` `Environment Instance` or `MicroService`, the request types that belong to a System. They are read on **both create and update**.

Each entry in the lists names the **other System** by its Resource ID:

| Key | Required | Notes |
|---|---|---|
| `Resource ID` | ✅ | Resource ID (e.g. APM ID) of the other System. Looked up with `GET /api/System`; it must already exist. |
| `ConnectionTechnology` | ✅ | Sent as the link's `Connection Type`. Must be a value configured in Enov8 (e.g. `ESB`, `FTP`, `WebService`, `BatchService`). |

How links are handled:

- Every entry is checked, and every Resource ID resolved, **before** anything is written. A missing `Resource ID` or `ConnectionTechnology`, or a Resource ID that doesn't exist, rejects the whole request.
- Links are created after the version update or create. If Enov8 rejects a `Connection Type`, the run fails at that link; the log shows which links were already created.
- A link that already exists (same SOURCE and TARGET) is skipped and left unchanged.
- A System cannot be linked to itself.
- Access is checked for this System only (its Assigned To group), not for the linked Systems.

### `System Component`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | |
| `Type` | Required, no default | Must match the tenant's Component Type picklist (e.g. `Server`, `Database`). |
| `Monitored` | `False` | |

## 🐛 Troubleshooting

**❌ GitHub user "…" is not mapped to any Enov8 user**

- There is no Enov8 user whose **User ID** equals your GitHub username (shown in the log). Ask an Enov8 administrator to create one, or to use your GitHub username as your User ID

**❌ This run was triggered by a bot account**

- Governed updates must be started by a person. Trigger the workflow manually, or from a push or merge by a mapped user

**❌ Enov8 user "…" is not active / does not have login access**

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

**❌ Upstream / Downstream link rejected**

- `"Resource ID" is required` or `"ConnectionTechnology" is required`: every entry needs both keys
- `no System found with Resource ID "…"`: check the linked System's Resource ID in Enov8
- `Failed to link …`: Enov8 rejected the link, most often because the Connection Type isn't a configured value
- `only supported for Environment Instance and MicroService`: links can't be sent with System Component or System Interface

**❌ Authentication failed**

- Verify `ENOV8_APP_ID`, `ENOV8_APP_KEY` and `ENOV8_BASE_URL`
- `ENOV8_BASE_URL` must end in `/ecosystem`, without `/api`

## 🔒 Security notes

This action makes sure the **person who ran the workflow** has access in Enov8. To keep that guarantee, also protect the Enov8 credentials themselves, since anyone who can read `ENOV8_APP_KEY` could call the Enov8 API directly:

- Store the secrets in a GitHub **Environment** and add **required reviewers** or **deployment branch rules** to it
- Restrict who can push to the branches that are allowed to deploy
- Secrets are not passed to workflows triggered from forks

## 📥 Support

For assistance, contact support@enov8.com.
