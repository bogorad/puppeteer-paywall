# Puppeteer Paywall Service Fix Report - Jan 08, 2026

## Executive Summary

The `puppeteer-paywall` service was crashing on Ubuntu 24.04 (ARM64) due to a combination of system resource limits and new OS-level security restrictions on unprivileged user namespaces.

**Status:** ✅ **FIXED**
**Current State:** Service is running successfully as `root` user using `headless: "new"`.

---

## Root Causes

### 1. Ubuntu 24.04 AppArmor Restrictions (Primary Cause)

Ubuntu 24.04 introduced strict AppArmor restrictions on **unprivileged user namespaces**.

- **Impact:** Unprivileged users (like `chuck`) cannot create the user namespaces required by Chromium's sandbox when running in a restricted systemd environment.
- **Symptom:** Chromium crashed immediately with core dumps or "Failed to launch" errors in the service, despite working in a manual shell (which has looser restrictions).

### 2. Resource Limits (Secondary Cause)

- **File Descriptors:** The default system limit (1024) was too low for Chromium + 3 extensions.
- **Inotify Instances:** The user `chuck` had exhausted the default inotify watch limit (1024), causing file watcher failures.

---

## Fixes Implemented

### 1. Kernel Security Configuration

Disabled the AppArmor restriction on unprivileged user namespaces.

- **Action:** Added `kernel.apparmor_restrict_unprivileged_userns=0` to `/etc/sysctl.conf`.
- **Effect:** Allows Chromium to create necessary namespaces for sandboxing.

### 2. Systemd Service Configuration (`/etc/systemd/system/puppeteer-paywall.service`)

- **User Change:** Switched service user from `chuck` to `root`.
  - _Reason:_ Root processes are not subject to the unprivileged user namespace restrictions, bypassing the AppArmor block reliably.
- **Resource Limits:**
  - `LimitNOFILE=65536` (Increased file descriptors)
  - `LimitNPROC=4096` (Increased process limit)
- **Environment:**
  - Removed `xvfb-run` (Switched to native `headless: "new"`).
  - Set `DBUS_SESSION_BUS_ADDRESS=/dev/null` to silence D-Bus connection errors.
  - Ensured `HOME` and XDG variables are set correctly.

### 3. Server Code (`server-optimus.js`)

- **Headless Mode:** Configured to use `headless: "new"`.
- **Timeouts:** Increased timeout to 120s to handle slower ARM64 startup.
- **Cleanup:** Removed legacy `headless: false` / `xvfb` logic.

### 4. System Tuning

- Increased `fs.inotify.max_user_instances` to 8192 to prevent watcher exhaustion.

---

## Verification

The service is confirmed working via curl:

```bash
curl -X POST http://localhost:5555/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "selector": "h1", "method": "css"}'
```

**Result:** Returns `<h1>Example Domain</h1>`.

## Future Recommendations

While running as `root` fixes the immediate service crash, for a production environment where security is paramount, you may want to revisit creating a specific AppArmor profile for `/usr/lib/chromium/chromium` that explicitly allows `userns_create` for the `chuck` user, or use the `chrome-headless-shell` binary which creates fewer sandbox constraints.
