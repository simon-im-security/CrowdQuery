# CrowdQuery

CrowdQuery is a browser extension that streamlines detection and investigation workflows in CrowdStrike.  
Note: This project is not affiliated with CrowdStrike.

<div align="center">
  <img src="https://github.com/simon-im-security/CrowdQuery/blob/main/Images/main.png" alt="Main Interface - Popup HTML" width="45%">
  <img src="https://github.com/simon-im-security/CrowdQuery/blob/main/Images/settings.png" alt="Settings Page - Settings HTML" width="45%">
</div>

- **Left Image**: Main interface (Popup HTML) showing detection lookup and tab launching.
- **Right Image**: Settings interface (Settings HTML) used to customise investigation queries.

## Main Features

- 🔍 **Automates detection search queries**
- ⚙️ **Customisable investigation templates**
- 🧭 **Fast navigation into CrowdStrike Investigation views**

## Tab Breakdown

Each tab in CrowdQuery corresponds to a different investigation lens within CrowdStrike:

- **Tab 1 – Detection Overview:**  
  Quickly opens CrowdStrike's standard detection dashboard filtered by hostname.

- **Tab 2 – Command Line Activity:**  
  Raw command-line execution data from relevant processes.

- **Tab 3 – Script Activity:**  
  Extracts executed scripts (e.g., PowerShell, Bash).

- **Tab 4 – Network Connections:**  
  Displays remote IP connections and correlates them with process data.

## Installation

CrowdQuery works on Chromium-based browsers such as **Chrome**, **Edge**, **Brave**, and others.  
**⚠️ It must be installed on the same browser you use to access CrowdStrike.**

1. **Download the ZIP File:**
   - Visit the [download page](https://github.com/simon-im-security/CrowdQuery/releases/tag/main).
   - Click the **CrowdQuery_x.x.zip** to begin downloading the app.

2. **Extract the ZIP File:**
   - Unzip the file to a folder on your machine.

3. **Enable Developer Mode:**
   - Go to `chrome://extensions/` in your browser.
   - Toggle **Developer mode** in the top-right.

4. **Load the Extension:**
   - Click **Load unpacked** and select the folder from Step 2.

5. **Verify Installation:**
   - CrowdQuery will appear in your list of browser extensions.

---

## Supported Servers

- ✅ **Current Default:** `us-2`
- 🌐 Designed to support all CrowdStrike cloud regions.  
  If you encounter issues, provide your region’s base URL (e.g., `falcon.us-1.crowdstrike.com`) and any relevant error logs for troubleshooting.

## License

Released under the **Attribution-ShareAlike License (CC BY-SA)**.  
You may use and modify this extension, including for commercial purposes, but **must provide attribution** and **share any derivative works under the same license**.
