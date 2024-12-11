// Title: Popup Script for NG-SIEM Toolkit
// Description: Manages hostname input, base URL configuration, and time-based detection searches for the NG-SIEM Toolkit.
// Author: Simon .I
// Version: 2024.12.11

// Declare global variables
let hostnameInput, detectionTimeInput, timeRangeSelect, scanButton, updateButton, settingsButton, recentSearchesContainer;

document.addEventListener("DOMContentLoaded", () => {
  // Initialise variables with DOM elements
  hostnameInput = document.getElementById("hostnameInput");
  detectionTimeInput = document.getElementById("detectionTimeInput");
  timeRangeSelect = document.getElementById("timeRangeSelect");
  scanButton = document.getElementById("scanButton");
  updateButton = document.getElementById("reloadInvestigationButton");
  settingsButton = document.getElementById("settingsButton");
  recentSearchesContainer = document.getElementById("recentSearchesContainer");

  // Validate that all elements are correctly initialised
  if (!hostnameInput || !detectionTimeInput || !scanButton || !updateButton || !timeRangeSelect) {
    console.error("One or more required DOM elements are missing.");
    return;
  }

  // Load settings and recent searches on page load
  loadSettings();

  // Event listeners for UI interactions
  scanButton.addEventListener("click", executeSearch);
  updateButton.addEventListener("click", updateInvestigationTabs);
  settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

  // Clear detection time when the hostname is edited
  hostnameInput.addEventListener(
    "input",
    debounce(() => {
      if (hostnameInput.value.trim()) {
        detectionTimeInput.value = ""; // Clear detection time
        console.log("Cleared detection time as hostname is being edited.");
      }
      saveFields(); // Save the current state
    }, 300)
  );

  // Save fields and toggle controls on input
  [hostnameInput, detectionTimeInput, timeRangeSelect].forEach((el) => {
    el.addEventListener("input", debounce(saveFields, 300));
    el.addEventListener("input", debounce(toggleControls, 300));
  });

  // Initial control toggle
  toggleControls();
});

/**
 * Toggle controls based on user input
 */
function toggleControls() {
  // Check if the hostname and detection time inputs have valid characters
  const hasHostname = hostnameInput?.value.trim().length > 0;
  const hasDetectionTime = detectionTimeInput?.value.trim().length > 0;

  try {
    // Enable the "Scan" button if hostname is valid
    scanButton.disabled = !hasHostname;

    // Enable the "Update Investigation Tabs" button only if both hostname and detection time are valid
    updateButton.disabled = !(hasHostname && hasDetectionTime);

    // Disable the time range dropdown if the hostname is empty
    timeRangeSelect.disabled = !hasHostname;

    // Debugging logs to monitor state
    console.log("Controls updated:", {
      hasHostname,
      hasDetectionTime,
      scanButtonDisabled: scanButton.disabled,
      updateButtonDisabled: updateButton.disabled,
      timeRangeSelectDisabled: timeRangeSelect.disabled,
    });
  } catch (error) {
    console.error("Error in toggleControls:", error);
  }
}

/**
 * Load saved settings and populate recent searches.
 */
function loadSettings() {
  chrome.storage.local.get(
    ["lastHostname", "lastDetectionTime", "lastTimeRange", "hostnameHistory"],
    (data) => {
      if (!hostnameInput || !detectionTimeInput || !timeRangeSelect) {
        console.error("One or more required DOM elements are missing during loadSettings.");
        return;
      }

      hostnameInput.value = data.lastHostname || "";
      detectionTimeInput.value = data.lastDetectionTime || ""; // Leave blank by default
      timeRangeSelect.value = data.lastTimeRange || "Select Time Range";
      updateHistoryDisplay(data.hostnameHistory || []);
      toggleControls(); // Ensure buttons reflect the correct initial state
    }
  );
}

/**
 * Update investigation tabs with refreshed URLs based on the last session.
 */
function updateInvestigationTabs() {
  chrome.storage.local.get(["lastInvestigationSession", "tab1", "tab2", "tab3", "baseUrl"], (data) => {
      const { baseUrl, tab1, tab2, tab3, lastInvestigationSession } = data;

      if (!baseUrl) {
          showToast("Base URL is not configured. Please check your settings.", false);
          console.error("Base URL is missing.");
          return;
      }

      if (!lastInvestigationSession || !lastInvestigationSession.investigationTabIds) {
          showToast("No active investigation tabs found. Please perform a search first.", false);
          console.warn("No investigation tabs available in the session.");
          return;
      }

      const { investigationTabIds, hostname } = lastInvestigationSession;

      if (!hostname) {
          showToast("No hostname found in the active session. Please perform a search first.", false);
          console.warn("No hostname found in the session.");
          return;
      }

      const detectionTime = detectionTimeInput.value.trim();
      console.log("Detection Time Input Value:", detectionTime);

      // Parse the detection time and calculate the range
      const offsetMillis = parseInt(timeRangeSelect.value, 10) * 1000 || 86400000; // Default ±24 hours
      const { startTime, endTime } = parseTimeRange(detectionTime, offsetMillis);

      if (!startTime || !endTime) {
          showToast("Invalid time range. Unable to update investigation tabs.", false);
          console.error("Invalid time range for investigation tabs update.");
          return;
      }

      const formattedDetectionTime = detectionTime
          ? `${new Date(detectionTime).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            })} (${new Date(detectionTime).toISOString().replace("T", " ").split(".")[0]} UTC)`
          : "No Detection Time";

      saveRecentSearch(
          hostname,
          `Detection Time: ${formattedDetectionTime} (Start: ${new Date(startTime).toLocaleString()}, End: ${new Date(
              endTime
          ).toLocaleString()})`
      );

      const investigationUrls = [tab1, tab2, tab3]
          .filter(Boolean) // Skip invalid queries
          .map((query, index) => {
              try {
                  const expandedQuery = query
                      .replace(/\$hostname/g, encodeURIComponent(hostname))
                      .replace(/\$startTime/g, encodeURIComponent(formatTimestamp(startTime)))
                      .replace(/\$endTime/g, encodeURIComponent(formatTimestamp(endTime)))
                      .replace(/\$detectionTime/g, formattedDetectionTime);

                  console.log(`Expanded Query for Tab ${index + 1}:`, expandedQuery);
                  return `${baseUrl}/investigate/search?query=${encodeURIComponent(expandedQuery)}&repo=all&start=${startTime}&end=${endTime}`;
              } catch (error) {
                  console.error(`Error processing query for Tab ${index + 1}:`, error);
                  return null;
              }
          });

      if (investigationUrls.length === 0 || investigationUrls.includes(null)) {
          console.error("Investigation URLs generation failed:", investigationUrls);
          showToast("No valid queries found. Please check your settings.", false);
          return;
      }

      console.log("Generated Investigation URLs for Update:", investigationUrls);

      let successCount = 0; // Track the number of successfully updated tabs

      investigationTabIds.forEach((tabId, index) => {
          const url = investigationUrls[index];
          if (!url) {
              console.warn(`No URL for Investigation Tab ${index + 1}. Skipping.`);
              return;
          }

          chrome.tabs.update(tabId, { url }, () => {
              if (chrome.runtime.lastError) {
                  console.error(`Error updating tab ${tabId}: ${chrome.runtime.lastError.message}`);
                  showToast(`Failed to update Investigation Tab ${index + 1}: ${chrome.runtime.lastError.message}`, false);
              } else {
                  console.log(`Tab ${tabId} updated with URL: ${url}`);
                  successCount++;
                  showToast(`Investigation Tab ${index + 1} updated successfully.`, true);
              }

              // Show a final toast when all updates are processed
              if (index === investigationTabIds.length - 1) {
                  if (successCount > 0) {
                      showToast(`${successCount} Investigation Tab(s) updated successfully!`, true);
                  } else {
                      showToast("No Investigation Tabs were updated successfully.", false);
                  }
              }
          });
      });
  });
}

/**
 * Execute search for detections or investigations.
 */
function executeSearch() {
  const hostname = hostnameInput.value.trim();

  if (!hostname) {
      showToast("Please enter a hostname before starting the search.", false);
      return;
  }

  // Calculate the time range for the search
  const endTime = Date.now(); // Current time
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  console.log("Executing Search (Last 7 Days):");
  console.log("Start Time:", new Date(startTime));
  console.log("End Time:", new Date(endTime));

  // Generate the detection URL and investigation URLs
  chrome.storage.local.get(["baseUrl", "tab1", "tab2", "tab3", "hostnameHistory"], (config) => {
    const { baseUrl, tab1, tab2, tab3, hostnameHistory = [] } = config;

    if (!baseUrl) {
      showToast("Base URL is not configured. Please check your settings.", false);
      return;
    }

    const detectionUrl = `${baseUrl}/activity-v2/detections?filter=hostname%3A%27${encodeURIComponent(
      hostname
    )}%27&pageSize=200&start=${startTime}&end=${endTime}`;

    const investigationUrls = [tab1, tab2, tab3]
      .filter(Boolean) // Skip invalid queries
      .map((query) => {
        return `${baseUrl}/investigate/search?query=${encodeURIComponent(
          query
            .replace(/\$hostname/g, hostname)
            .replace(/\$startTime/g, new Date(startTime).toISOString())
            .replace(/\$endTime/g, new Date(endTime).toISOString())
        )}&repo=all&start=${startTime}&end=${endTime}`;
      });

    // Update hostname history
    const timestamp = new Date().toLocaleString();
    const updatedHistory = [
      { hostname, timestamp },
      ...hostnameHistory.filter((item) => item.hostname !== hostname),
    ].slice(0, 10); // Limit to 10 entries

    // Store the session data and history in chrome.storage.local
    chrome.storage.local.set({
      lastSearchUrls: {
        detectionUrl,
        investigationUrls,
      },
      hostnameHistory: updatedHistory,
      lastInvestigationSession: {
        hostname,
        detectionTabId: null, // Placeholder
        investigationTabIds: [],
        detectionUrl,
        investigationUrls,
        startTime,
        endTime,
      },
    });

    // Proceed with opening the tabs as usual
    chrome.runtime.sendMessage(
      {
        action: "openCrowdStrikePages",
        hostname,
        start: startTime,
        end: endTime,
        detectionUrl,
        investigationUrls,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Message Error:", chrome.runtime.lastError.message);
        } else if (response?.success) {
          console.log("Message Sent for Last 7 Days Search:", {
            hostname,
            start: startTime,
            end: endTime,
            detectionUrl,
            investigationUrls,
          });

          // Update the session data with tab IDs after tabs are opened
          chrome.storage.local.set({
            lastInvestigationSession: {
              hostname,
              detectionTabId: response.detectionTabId, // Track detection tab separately
              investigationTabIds: response.investigationTabIds,
              detectionUrl,
              investigationUrls,
              startTime,
              endTime,
            },
          });

          showToast(`Search initiated for hostname: ${hostname}`, true);
        } else {
          console.warn("Search failed to initiate. No response received.");
          showToast("Failed to open search tabs. Check settings or connection.", false);
        }
      }
    );
  });
}

  /**
   * Parse time range from detection time input.
   */
  function parseTimeRange(input, offsetMillis = 86400000) {
    if (!input) {
        const now = Date.now();
        return { startTime: now - offsetMillis, endTime: now + offsetMillis };
    }

    try {
        const detectionTime = new Date(input).getTime();
        if (isNaN(detectionTime)) {
            showToast("Invalid detection time format. Please use a valid date and time.", false);
            return { startTime: null, endTime: null };
        }
        return { startTime: detectionTime - offsetMillis, endTime: detectionTime + offsetMillis };
    } catch (error) {
        console.error("Error parsing detection time:", error);
        return { startTime: Date.now() - offsetMillis, endTime: Date.now() + offsetMillis };
    }
}

  /**
   * Utility to format timestamps.
   */
  function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString().replace("T", " ").split(".")[0] + " UTC";
  }

  /**
   * Save the hostname, detection time, and time range fields.
   */
  function saveFields() {
    const hostname = hostnameInput.value.trim();
    const detectionTime = detectionTimeInput.value.trim();
    const timeRange = timeRangeSelect.value;

    chrome.storage.local.set({
        lastHostname: hostname,
        lastDetectionTime: detectionTime,
        lastTimeRange: timeRange,
    });

    toggleControls(); // Update control state
}

/**
 * Save the hostname to recent searches and update the display.
 * Handles parsing of dynamic detection times like "Last 7 days (up to ...)".
 * @param {string} hostname - The hostname to save.
 * @param {string} detectionTime - The detection time string, possibly dynamic.
 */
function saveRecentSearch(hostname, detectionTime) {
  const timestamp = new Date().toLocaleString(); // Current time when the search is saved
  let formattedDetectionTime = detectionTime || "No Detection Time"; // Default if detectionTime is empty

  try {
    // Check if detectionTime exists and contains "up to"
    if (detectionTime && detectionTime.includes("up to")) {
      const extractedDate = detectionTime.match(/up to\s+([\w\s:,/]+)$/); // Extract date after "up to"
      if (extractedDate && extractedDate[1]) {
        const parsedDate = new Date(extractedDate[1].trim());
        if (!isNaN(parsedDate.getTime())) {
          // Successfully parsed date, format it
          formattedDetectionTime = `${parsedDate.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })} (${parsedDate.toISOString().replace("T", " ").split(".")[0]} UTC)`;
        } else {
          formattedDetectionTime = "Invalid Detection Time"; // Fallback for invalid parsed date
        }
      } else {
        formattedDetectionTime = "Invalid Detection Time"; // Fallback for unexpected format
      }
    }
  } catch (error) {
    console.error("Error formatting detection time:", error);
    formattedDetectionTime = "Error Processing Detection Time"; // Explicit error fallback
  }

  // Fetch and update the hostname history in Chrome storage
  chrome.storage.local.get("hostnameHistory", (data) => {
    const history = data.hostnameHistory || [];

    // Add the new search entry
    const newEntry = { hostname, detectionTime: formattedDetectionTime, timestamp };
    const updatedHistory = [
      newEntry,
      ...history.filter(
        (item) => item.hostname !== hostname || item.detectionTime !== formattedDetectionTime
      ),
    ].slice(0, 10); // Limit to the most recent 10 entries

    // Save the updated history to chrome.storage.local
    chrome.storage.local.set({ hostnameHistory: updatedHistory }, () => {
      console.log("Recent search saved:", newEntry);
      updateHistoryDisplay(updatedHistory);
    });
  });
}
     
  /**
   * Update the recent searches display.
   */
  function updateHistoryDisplay(history) {
    recentSearchesContainer.innerHTML = "<h3>Recent Searches</h3>";
    if (!history.length) {
        recentSearchesContainer.innerHTML += "<p>No recent searches available.</p>";
        return;
    }

    history.forEach(({ hostname, detectionTime, timestamp }) => {
        const entry = document.createElement("div");
        entry.innerHTML = `
            <a href="#" class="history-link">${hostname}</a>
            <span class="timestamp">${timestamp}</span>
            <small>${detectionTime || "(Last 7 Days)"}</small>`;
        
        entry.querySelector(".history-link").addEventListener("click", (e) => {
            e.preventDefault();
            // Populate the hostname and detection time fields
            hostnameInput.value = hostname;
            detectionTimeInput.value = detectionTime === "(Last 7 Days)" ? "" : detectionTime;

            // Save fields to ensure they're remembered
            saveFields();

            // Save this search to recent history
            saveRecentSearch(hostname, detectionTime || "(Last 7 Days)");

            // Feedback to the user
            showToast(`Loaded ${hostname} into the fields.`, true);

            // Debugging logs
            console.log("Hostname loaded from history:", hostname);
            console.log("Detection Time loaded from history:", detectionTime);
        });

        recentSearchesContainer.appendChild(entry);
    });
}

  /**
   * Display a toast notification at the centre of the screen.
   */
  function showToast(message, isSuccess, bgColor = "#4CAF50") {
    const existingToast = document.getElementById("popupToast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "popupToast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      backgroundColor: bgColor,
      color: "#fff",
      padding: "20px 40px",
      borderRadius: "10px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
      fontSize: "18px",
      zIndex: "10000",
      textAlign: "center",
      opacity: "0",
      transition: "opacity 0.5s ease-in-out",
    });

    document.body.appendChild(toast);

    setTimeout(() => (toast.style.opacity = "1"), 100);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  /**
   * Utility to debounce frequent function calls.
   */
  function debounce(func, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => func(...args), delay);
    };
  }
