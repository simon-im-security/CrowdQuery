// Title: Settings Script for CrowdQuery
// Description: Manages base URL and investigation search criteria settings.
// Author: Simon .I
// Version: 2025.05.27

document.addEventListener("DOMContentLoaded", () => {
    // Get references to the DOM elements
    const baseUrlInput = document.getElementById("baseUrl");
    const tab1Input = document.getElementById("searchTab1");
    const tab2Input = document.getElementById("searchTab2");
    const tab3Input = document.getElementById("searchTab3");
    const saveButton = document.getElementById("saveSettings");
    const baseUrlError = document.getElementById("baseUrlError");

// Default settings
const defaultSettings = {
  baseUrl: "https://falcon.us-2.crowdstrike.com",

  tab1: `// Commands for $input - $detectionTime

// Substitutes the input hostname dynamically from the extension
$input

// Filters for events where a command line was executed
| CommandLine=*

// Displays only the selected fields with a maximum of 10,000 rows
| table([
  @timestamp,             // Timestamp of the event
  UserName,               // The user who executed the process
  RawProcessId,           // The process ID assigned by the OS
  CommandLine,            // Full command line used to launch the process
  ImageFileName,          // Actual binary path that was executed
  MD5HashData,            // MD5 hash of the executable
  TargetFileName,         // File targeted by the command (e.g., opened, written)
  TargetDirectoryName,    // Directory path involved in the file operation
  SourceFileName          // File or path the action originated from (e.g., for copies)
], limit=10000)

// Sorts the results by timestamp, showing the most recent events first
| sort(@timestamp, order=desc, limit=10000)`,

  tab2: `// Scripts on $input - $detectionTime

// Filters relevant script control events associated with the input
(#event_simpleName = * or #ecs.version = *) 
| (#event_simpleName = "ScriptControlDetectInfo" and "$input") 
  or (#event_simpleName = "ScriptControlScanInfo" and "$input") 
  or (#event_simpleName = "ScriptControlBlocked" and "$input") 
  or (#event_simpleName = "ScriptControlDotNetMetadata" and "$input") 
  or (#event_simpleName = "ScriptControlErrorEvent" and "$input") 
  or (#event_simpleName = "ScriptControlScan Telemetry" and "$input") 
  or (#event_simpleName = "ScriptFileContentsDetectInfo" and "$input") 
  or (#event_simpleName = "ScriptFileWrittenInfo" and "$input")

// Limits results to the most recent 1000 matching events
| tail(1000)

// Selects relevant script-related fields for analysis
| table([
  @timestamp,                 // Event timestamp
  ScriptContent,              // The actual content of the script
  ScriptContentBytes,         // Encoded form of the script content
  ScriptContentCodePage,      // Encoding/character set used
  ScriptContentName,          // Script name or source filename
  ScriptContentScanId,        // Unique scan ID associated with script
  ScriptContentSource,        // Where the script was loaded from (e.g., file, memory)
  ScriptControlErrorCode,     // Error code if the script failed to execute
  ScriptEngineInvocationCount,// How many times the script engine was invoked
  ScriptingLanguageId,        // Language identifier (e.g., VBScript, PowerShell)
  ScriptModuleName            // Name of the module that triggered or ran the script
])`,

  tab3: `// Network Connections for $input - $detectionTime
$input

#repo=base_sensor #event_simpleName=NetworkConnectIP4
| in(ComputerName, values=["$input"], ignoreCase=true)
| rename([
  [RemoteAddressIP4, remoteAddressIp4],
  [ComputerName, computerName],
  [LocalPort, localPort],
  [RemotePort, remotePort]
])
| remoteAddressIp4 = *
| remoteAddressIp4 != "127.0.0.1"
| !in(remoteAddressIp4, values=[NONE])

// Join with ProcessRollup2 to get filename, commandLine, hash
| join({
  #repo=base_sensor
  | in(#event_simpleName, values=[ProcessRollup2, SyntheticProcessRollup2])
  | in(ComputerName, values=["$input"], ignoreCase=true)

  | join({
    #repo=base_sensor #event_simpleName=NetworkConnectIP4
    | in(ComputerName, values=["$input"], ignoreCase=true)
    | rename([[RemoteAddressIP4, remoteAddressIp4]])
    | remoteAddressIp4 = *
    | remoteAddressIp4 != "127.0.0.1"
    | !in(remoteAddressIp4, values=[NONE])
  }, field=TargetProcessId, key=ContextProcessId, limit=200000)
}, field=ContextProcessId, key=TargetProcessId, include=[
  FileName,
  MD5HashData,
  CommandLine
], mode=left)

| rename([
  [FileName, filename],
  [CommandLine, commandLine],
  [MD5HashData, md5HashData]
])

| filename =~ wildcard(*, ignoreCase=true, includeEverythingOnAsterisk=true)
| !in(filename, values=[NONE], ignoreCase=true)

// Final cleaned output
| table([
  @timestamp,
  computerName,
  remoteAddressIp4,
  localPort,
  remotePort,
  filename,
  commandLine,
  md5HashData
], limit=20000)`
};

    /**
     * Load settings or apply defaults if storage is empty.
     */
    function loadSettings() {
        chrome.storage.local.get(["baseUrl", "tab1", "tab2", "tab3"], (data) => {
            baseUrlInput.value = data.baseUrl || defaultSettings.baseUrl;
            tab1Input.value = data.tab1 || defaultSettings.tab1;
            tab2Input.value = data.tab2 || defaultSettings.tab2;
            tab3Input.value = data.tab3 || defaultSettings.tab3;
  
            if (!data.baseUrl && !data.tab1 && !data.tab2 && !data.tab3) {
                applyDefaults(() => console.log("Defaults applied on first load."));
            }
        });
    }
  
    /**
     * Save settings with validation.
     */
    function saveSettings() {
      const baseUrl = baseUrlInput.value.trim();
      const tab1 = tab1Input.value.trim();
      const tab2 = tab2Input.value.trim();
      const tab3 = tab3Input.value.trim();
  
      // Validate inputs
      if (!validateBaseUrl(baseUrl)) {
          showModal("Invalid base URL. Please correct it and try again.", false); // Error modal
          return;
      }
  
      const settings = {
          baseUrl,
          tab1: validateQuery(tab1, "Tab 1"),
          tab2: validateQuery(tab2, "Tab 2"),
          tab3: validateQuery(tab3, "Tab 3"),
      };
  
      if (!settings.tab1 || !settings.tab2 || !settings.tab3) {
          showModal("All queries must include the $input placeholder.", false); // Error modal
          return;
      }
  
      // Save settings to local storage
      chrome.storage.local.set(settings, () => {
          showModal("Settings saved successfully!", true); // Success modal
      });
    }
  
    /**
     * Apply default settings to local storage.
     */
    function applyDefaults(callback) {
      chrome.storage.local.set(defaultSettings, () => {
          console.log("Default settings applied.");
          showModal("Default settings applied.", true); // Success modal
          if (callback) callback();
      });
    }
  
    /**
     * Validate a URL.
     */
    function validateBaseUrl(url) {
        try {
            new URL(url);
            baseUrlError.style.display = "none";
            return true;
        } catch {
            baseUrlError.style.display = "block";
            baseUrlError.textContent = "Please enter a valid URL.";
            return false;
        }
    }
  
    /**
     * Validate a query input.
     */
    function validateQuery(query, tabName) {
        if (!query) {
            showModal(`${tabName} query cannot be empty.`, false); // Error modal
            return "";
        }
        if (!query.includes("$input")) {
            showModal(`${tabName} query must include the $input placeholder.`, false); // Error modal
            return "";
        }
        return query;
    }
  
    /**
     * Display a modal notification at the centre of the screen.
     * @param {string} message - The message to display.
     * @param {boolean} success - Whether the modal indicates success (true) or an error (false).
     */
    function showModal(message, success = true) {
        // Remove any existing modal to avoid overlap
        const existingModal = document.getElementById("settingsModal");
        if (existingModal) existingModal.remove();
  
        // Create the modal container
        const modal = document.createElement("div");
        modal.id = "settingsModal";
        Object.assign(modal.style, {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: success ? "#28a745" : "#f44336", // Green for success, red for errors
            color: "#fff",
            padding: "10px 20px",
            borderRadius: "8px",
            fontSize: "16px",
            zIndex: "10000",
            textAlign: "center",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)",
            maxWidth: "300px",
            width: "auto", // Dynamic sizing
            whiteSpace: "nowrap", // Prevents unnecessary blank space
        });
  
        // Set the message content
        modal.textContent = message;
  
        // Append the modal to the body
        document.body.appendChild(modal);
  
        // Auto-remove the modal after 5 seconds
        setTimeout(() => {
            modal.remove();
        }, 5000);
    }
  
    // Event listeners
    saveButton.addEventListener("click", saveSettings);
  
    // Load settings on page load
    loadSettings();
  });
  