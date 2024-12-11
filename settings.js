// Title: Settings Script for NG-SIEM Toolkit
// Description: Manages base URL and investigation search criteria settings for the NG-SIEM Toolkit extension.
// Author: Simon .I
// Version: 2024.12.11

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
        tab1: `// Track command-line activity and parent process details for $hostname - $detectionTime
  $hostname
  | timestamp=*
  | CommandLine=*
  | table([@timestamp, UserName, CommandLine, ParentBaseFileName, TargetFileName, @id], limit=10000)`,
        tab2: `// Display detections with severity and techniques for $hostname - $detectionTime
  $hostname
  | @timestamp = *
  | DetectSeverity = *
  | table([@timestamp, DetectSeverity, Technique, TargetFileName, ImageFileName, TargetProcessImageFileName, ParentImageFileName, ParentCommandLine, CommandLine, DetectDescription], limit=10000)`,
        tab3: `// Show applications, domains, and IPs accessed by $hostname - $detectionTime
  $hostname
  | (IP4Records = * OR IP6Records = *)
  | CNAMERecords = *
  | ContextBaseFileName = *
  | DomainName = *
  | IPv4Formatted := replace(field=IP4Records, regex=";", with=", ") 
  | IPv6Formatted := replace(field=IP6Records, regex=";", with=", ") 
  | table([@timestamp, ContextBaseFileName, DomainName, CNAMERecords, IPv4Formatted, IPv6Formatted], limit=1000)`,
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
          showModal("All queries must include the $hostname placeholder.", false); // Error modal
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
        if (!query.includes("$hostname")) {
            showModal(`${tabName} query must include the $hostname placeholder.`, false); // Error modal
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
  