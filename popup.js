// Title: Popup Script for CrowdQuery
// Description: Manages input input, base URL configuration, and time-based detection searches.
// Author: Simon .I
// Version: 2025.05.27

// Declare global variables
let inputInput, detectionTimeInput, timeRangeSelect, scanButton, updateButton, settingsButton, recentSearchesContainer;

document.addEventListener("DOMContentLoaded", () => {
  // Initialise variables with DOM elements
  inputInput = document.getElementById("inputInput");
  detectionTimeInput = document.getElementById("detectionTimeInput");
  timeRangeSelect = document.getElementById("timeRangeSelect");
  scanButton = document.getElementById("scanButton");
  updateButton = document.getElementById("reloadInvestigationButton");
  settingsButton = document.getElementById("settingsButton");
  recentSearchesContainer = document.getElementById("recentSearchesContainer");

  // Validate that all elements are correctly initialised
  if (!inputInput || !detectionTimeInput || !scanButton || !updateButton || !timeRangeSelect) {
    console.error("One or more required DOM elements are missing.");
    return;
  }

  // Load settings and recent searches on page load
  loadSettings();

  // Event listeners for UI interactions
  scanButton.addEventListener("click", executeSearch);
  updateButton.addEventListener("click", updateInvestigationTabs);
  settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

  // Clear detection time when the input is edited
  inputInput.addEventListener(
    "input",
    debounce(() => {
      if (inputInput.value.trim()) {
        detectionTimeInput.value = ""; // Clear detection time
        console.log("Cleared detection time as input is being edited.");
      }
      saveFields(); // Save the current state
    }, 300)
  );

  // Save fields and toggle controls on input
  [inputInput, detectionTimeInput, timeRangeSelect].forEach((el) => {
    el.addEventListener("input", debounce(saveFields, 300));
    el.addEventListener("input", debounce(toggleControls, 300));
  });

  // Initial control toggle
  toggleControls();
});

document.addEventListener("DOMContentLoaded", () => {
    const inputLabel = document.getElementById("inputLabel");
    const inputInput = document.getElementById("inputInput");

    // Ensure the input label remains consistent
    inputLabel.textContent = "Hostname";
    inputInput.placeholder = "e.g., MacBook Pro-100";
});
;  

/**
 * Toggle controls based on user input
 */
function toggleControls() {
  // Check if the input and detection time inputs have valid characters
  const hasinput = inputInput?.value.trim().length > 0;
  const hasDetectionTime = detectionTimeInput?.value.trim().length > 0;

  try {
      // Enable the "Scan" button if input is valid
      scanButton.disabled = !hasinput;

      // Enable the "Update Investigation Tabs" button only if both input and detection time are valid
      updateButton.disabled = !(hasinput && hasDetectionTime);

      // Disable the time range dropdown until both input and detection time are filled
      timeRangeSelect.disabled = !(hasinput && hasDetectionTime);

      // Debugging logs to monitor state
      console.log("Controls updated:", {
          hasinput,
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
    ["lastinput", "lastDetectionTime", "lastTimeRange", "inputHistory"],
    (data) => {
      if (!inputInput || !detectionTimeInput || !timeRangeSelect) {
        console.error("One or more required DOM elements are missing during loadSettings.");
        return;
      }

      inputInput.value = data.lastinput || "";
      detectionTimeInput.value = data.lastDetectionTime || ""; // Leave blank by default
      timeRangeSelect.value = data.lastTimeRange || "Select Time Range";
      updateHistoryDisplay(data.inputHistory || []);
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

      const { investigationTabIds, input } = lastInvestigationSession;

      if (!input) {
          showToast("No input found in the active session. Please perform a search first.", false);
          console.warn("No input found in the session.");
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
          input,
          `Detection Time: ${formattedDetectionTime} (Start: ${new Date(startTime).toLocaleString()}, End: ${new Date(
              endTime
          ).toLocaleString()})`
      );

      const investigationUrls = [tab1, tab2, tab3]
          .filter(Boolean) // Skip invalid queries
          .map((query, index) => {
              try {
                  const expandedQuery = query
                      .replace(/\$input/g, encodeURIComponent(input))
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
    const input = inputInput.value.trim();

    if (!input) {
        showToast("Please enter an input before starting the search.", false);
        return;
    }

    const endTime = Date.now(); // Current time
    const startTime = endTime - 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const selectedType = "hostname"; // Hardcoded since we removed selector buttons

    console.log("Executing Search:");
    console.log("Input Type:", selectedType);
    console.log("Input Value:", input);
    console.log("Start Time:", new Date(startTime));
    console.log("End Time:", new Date(endTime));

    chrome.storage.local.get(["baseUrl", "tab1", "tab2", "tab3", "inputHistory"], (config) => {
        const { baseUrl, tab1, tab2, tab3, inputHistory = [] } = config;

        if (!baseUrl) {
            showToast("Base URL is not configured. Please check your settings.", false);
            return;
        }

        // Construct the primary URL (hostname only)
        let primaryUrl = `${baseUrl}/activity-v2/detections?filter=hostname%3A%27${encodeURIComponent(input)}%27&pageSize=200&start=${startTime}&end=${endTime}`;

        console.log("Primary URL:", primaryUrl);
 
        // Construct investigation URLs
        const investigationUrls = [tab1, tab2, tab3]
            .filter(Boolean) // Skip invalid queries
            .map((query) => {
                return `${baseUrl}/investigate/search?query=${encodeURIComponent(
                    query
                        .replace(/\$input/g, input)
                        .replace(/\$startTime/g, new Date(startTime).toISOString())
                        .replace(/\$endTime/g, new Date(endTime).toISOString())
                )}&repo=all&start=${startTime}&end=${endTime}`;
            });

        console.log("Investigation URLs:", investigationUrls);

        // Store the session data
        chrome.storage.local.set({
            lastSearchUrls: {
                primaryUrl,
                investigationUrls,
            },
            lastInvestigationSession: {
                input,
                selectedType,
                primaryUrl,
                investigationUrls,
                startTime,
                endTime,
            },
        });

        // Save the search to recent searches
        saveRecentSearch(input, null, selectedType);

        // Open all tabs (primary + investigation)
        chrome.runtime.sendMessage(
            {
                action: "checkAndOpenTabs",
                input,
                selectedType,
                start: startTime,
                end: endTime,
                primaryUrl,
                investigationUrls,
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Message Error:", chrome.runtime.lastError.message);
                } else if (response?.success) {
                    console.log("Tabs successfully opened:", {
                        input,
                        selectedType,
                        start: startTime,
                        end: endTime,
                        primaryUrl,
                        investigationUrls,
                    });
                    showToast(`Search initiated for ${selectedType}: ${input}`, true);
                } else {
                    console.warn("Search failed to initiate:", response.message || "No response received.");
                    showToast("Failed to open search tabs. Check settings or connection.", false);
                }
            }
        );
    });
}  

/**
 * Validate if a given string is a valid URL.
 * @param {string} url - The URL string to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function isValidUrl(url) {
    try {
        new URL(url); // Attempt to create a URL object
        return true;
    } catch (e) {
        return false;
    }
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
   * Save the input, detection time, and time range fields.
   */
  function saveFields() {
    const input = inputInput.value.trim();
    const detectionTime = detectionTimeInput.value.trim();
    const timeRange = timeRangeSelect.value;

    chrome.storage.local.set({
        lastinput: input,
        lastDetectionTime: detectionTime,
        lastTimeRange: timeRange,
    });

    toggleControls(); // Update control state
}

/**
 * Save the input to recent searches and update the display.
 * Handles parsing of dynamic detection times like "Last 7 days (up to ...)".
 * @param {string} input - The input to save.
 * @param {string} detectionTime - The detection time string, possibly dynamic.
 */
function saveRecentSearch(input, detectionTime) {
  const timestamp = new Date().toLocaleString(); // Current time when the search is saved
  let formattedDetectionTime = detectionTime;

  // Default to "Last 7 Days" if detectionTime is empty
  if (!detectionTime) {
      formattedDetectionTime = "Last 7 Days";
  } else {
      try {
          // Parse and format detection time if provided
          const parsedDate = new Date(detectionTime.trim());
          if (!isNaN(parsedDate.getTime())) {
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
              formattedDetectionTime = "Invalid Detection Time"; // Fallback for invalid format
          }
      } catch (error) {
          console.error("Error formatting detection time:", error);
          formattedDetectionTime = "Error Processing Detection Time";
      }
  }

  // Fetch and update the input history in Chrome storage
  chrome.storage.local.get("inputHistory", (data) => {
      const history = data.inputHistory || [];

      // Add the new search entry
      const newEntry = { input, detectionTime: formattedDetectionTime, timestamp };
      const updatedHistory = [
          newEntry,
          ...history.filter(
              (item) => item.input !== input || item.detectionTime !== formattedDetectionTime
          ),
      ].slice(0, 10); // Limit to the most recent 10 entries

      // Save the updated history to chrome.storage.local
      chrome.storage.local.set({ inputHistory: updatedHistory }, () => {
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

    history.forEach(({ input, detectionTime, timestamp }) => {
        const entry = document.createElement("div");
        entry.innerHTML = `
            <a href="#" class="history-link">${input}</a>
            <span class="timestamp">${timestamp}</span>
            <small>${detectionTime}</small>`;
        
        entry.querySelector(".history-link").addEventListener("click", (e) => {
            e.preventDefault();

            // Populate the input and detection time fields
            inputInput.value = input;
            detectionTimeInput.value = detectionTime === "Last 7 Days" ? "" : detectionTime;

            // Save fields to ensure they're remembered
            saveFields();

            // Feedback to the user
            showToast(`Loaded ${input} into the fields.`, true);

            // Debugging logs
            console.log("input loaded from history:", input);
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
