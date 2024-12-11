// Title: Background Script for NG-SIEM Toolkit
// Description: Manages detection and investigation pages with session tracking and notification support for the NG-SIEM Toolkit.
// Author: Simon .I
// Version: 2024.12.11

// Listens for unhandled promise rejections in the service worker context, other unhandled rejections are logged for debugging purposes.
self.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (
      reason &&
      ((typeof reason === "string" && (reason.includes("No tab with id") || reason.includes("Frame with ID 0 was removed"))) ||
        (typeof reason === "object" && reason.message && (reason.message.includes("No tab with id") || reason.message.includes("Frame with ID 0 was removed"))))
    ) {
      // Suppress specific errors
      event.preventDefault();
    } else {
      console.warn("Unhandled rejection:", reason);
    }
});

// Monitor tabs opened during search for navigation to the login page
let loginPageOpen = false; // Flag to track if login page is already open
let triggeredTabs = new Set(); // Track tabs that have triggered post-login actions

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log(`[DEBUG] Tab Updated - ID: ${tabId}, URL: ${tab.url || "N/A"}`);

    chrome.storage.local.get(["baseUrl", "lastInvestigationSession"], (data) => {
        const baseUrl = data.baseUrl;
        const session = data.lastInvestigationSession || {};
        const { tabIds = [] } = session;

        // Debug: Log current session details and tab monitoring
        console.log(`[DEBUG] Base URL: ${baseUrl}`);
        console.log(`[DEBUG] Last Investigation Session:`, session);

        // Skip if baseUrl is missing or invalid
        if (!baseUrl || !isValidUrl(baseUrl)) {
            console.warn("[DEBUG] Base URL is not set or invalid.");
            return;
        }

        // Debug: Check if the tab is part of the monitored tabs
        console.log(`[DEBUG] Is Tab Monitored? ${tabIds.includes(tabId)}`);

        // Handle navigation to the login page
        if (changeInfo.status === "complete" && tab.url.startsWith(`${baseUrl}/login`)) {
            console.log(`[DEBUG] Login page detected in monitored tab: ${tabId}`);

            // Check if `login_required.html` is already open
            chrome.tabs.query({ url: chrome.runtime.getURL("login_required.html") }, (existingTabs) => {
                if (existingTabs.length > 0 || loginPageOpen) {
                    console.log("[DEBUG] Login required page already open. Skipping new tab creation.");
                    return; // Prevent duplicate tabs
                }

                // Set the flag to indicate the login page is open
                loginPageOpen = true;

                // Close all monitored tabs
                tabIds.forEach((id) => {
                    console.log(`[DEBUG] Closing monitored tab ID: ${id}`);
                    chrome.tabs.remove(id, () => {
                        if (chrome.runtime.lastError) {
                            console.warn(`[DEBUG] Failed to close tab ${id}: ${chrome.runtime.lastError.message}`);
                        }
                    });
                });

                // Open the custom login-required HTML page
                console.log("[DEBUG] Opening login_required.html");
                chrome.tabs.create({
                    url: chrome.runtime.getURL("login_required.html"),
                    active: true,
                });

                // Clear the session data
                chrome.storage.local.remove("lastInvestigationSession", () => {
                    console.log("[DEBUG] Cleared last investigation session.");
                });
            });
        }

        // Monitor successful login navigation (e.g., `https://falcon.*.crowdstrike.com/dashboards*`)
        const regexPattern = /^https:\/\/falcon\..*\.crowdstrike\.com\/dashboards.*$/;
        console.log(`[DEBUG] Regex Pattern: ${regexPattern}`);

        if (
            changeInfo.status === "complete" &&
            regexPattern.test(tab.url) &&
            !triggeredTabs.has(tabId)
        ) {
            console.log(`[DEBUG] Successful login detected at URL: ${tab.url}`);

            // Mark the tab as triggered to prevent duplicate actions
            triggeredTabs.add(tabId);

        } else if (changeInfo.status === "complete") {
            // Debug: Log why the URL didn't match
            console.log(`[DEBUG] Tab URL did not match regex or action already triggered. URL: ${tab.url}`);
        }
    });
});

// Handles various actions like resuming searches, applying defaults, and updating investigation tabs.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logDebug("Received message:", message);

    if (!message || !message.action) {
        logWarn("Invalid message format received. Missing action.");
        sendResponse({ success: false, message: "Invalid message format. Missing action." });
        return;
    }

    switch (message.action) {
        case "resumeSearch":
            handleResumeSearch(message, sendResponse);
            break;

        case "applyDefaults":
            logInfo("Applying default settings.");
            sendResponse({ success: true });
            break;

        case "openCrowdStrikePages":
        case "updateInvestigationTabs":
            handleCrowdStrikeActions(message, sendResponse);
            break;

        default:
            logWarn("Unhandled message action:", message.action);
            sendResponse({ success: false, message: "Unknown action." });
    }

    return true; // Keep listener open for async responses
});

/**
 * Handles resuming a search action.
 * @param {Object} message - The received message.
 * @param {Function} sendResponse - Callback to send response back to sender.
 */
function handleResumeSearch(message, sendResponse) {
    logDebug("Resume search triggered.");

    chrome.storage.local.get(
        ["lastHostname", "lastDetectionTime", "baseUrl", "tab1", "tab2", "tab3"],
        (data) => {
            const { lastHostname, lastDetectionTime, baseUrl, tab1, tab2, tab3 } = data;

            if (!lastHostname) {
                logError("Missing required parameter: lastHostname");
                sendResponse({ success: false, error: "No search data found." });
                return;
            }

            if (!baseUrl || !tab1 || !tab2 || !tab3) {
                logError("Missing required settings for tabs or base URL.");
                sendResponse({ success: false, error: "Configuration is incomplete." });
                return;
            }

            logDebug(`Resuming search for Hostname: ${lastHostname}`);

            const startTime = lastDetectionTime || Date.now() - 7 * 24 * 60 * 60 * 1000; // Default: past 7 days
            const endTime = Date.now(); // Default: now

            logDebug("Resolved Start Time:", startTime, "Resolved End Time:", endTime);

            const detectionUrl = generateDetectionUrl(baseUrl, lastHostname, startTime, endTime);
            const investigationUrls = generateInvestigationUrls(baseUrl, lastHostname, startTime, endTime, {
                tab1,
                tab2,
                tab3,
            });

            // Debug logs
            console.log("[DEBUG] Detection URL:", detectionUrl);
            console.log("[DEBUG] Investigation URLs:", investigationUrls);
            console.log("[DEBUG] Query for Tab 1:", tab1);
            console.log("[DEBUG] Query for Tab 2:", tab2);
            console.log("[DEBUG] Query for Tab 3:", tab3);

            logDebug("Generated URLs for Resume Search:", { detectionUrl, investigationUrls });

            if (message.resumeTabId) {
                chrome.tabs.remove(message.resumeTabId, () => {
                    if (chrome.runtime.lastError) {
                        logWarn(`Failed to close resume tab: ${chrome.runtime.lastError.message}`);
                    }
                });
            }

            handleOpenTabs(detectionUrl, investigationUrls, lastHostname, startTime, endTime, sendResponse);
        }
    );
}

/**
 * Handles actions related to CrowdStrike pages like opening or updating investigation tabs.
 * @param {Object} message - The received message.
 * @param {Function} sendResponse - Callback to send response back to sender.
 */
function handleCrowdStrikeActions(message, sendResponse) {
    chrome.storage.local.get(["baseUrl", "tab1", "tab2", "tab3", "lastInvestigationSession"], (data) => {
        const { baseUrl, tab1, tab2, tab3, lastInvestigationSession: session = {} } = data;

        if (!isValidUrl(baseUrl)) {
            logWarn("Base URL is not set or invalid in extension settings.");
            sendResponse({ success: false, message: "Base URL is not set or invalid." });
            return;
        }

        if (message.action === "updateInvestigationTabs") {
            handleUpdateTabs(session, { tab1, tab2, tab3 }, baseUrl, sendResponse);
        } else if (message.action === "openCrowdStrikePages") {
            const { hostname, start, end } = resolveTimesAndUrls(message, session);

            logDebug("Resolved Values from Request:", { hostname, start, end });

            if (!hostname) {
                logWarn("Hostname is required.");
                sendResponse({ success: false, message: "Hostname is required." });
                return;
            }

            const detectionUrl = generateDetectionUrl(baseUrl, hostname, start, end);
            const investigationUrls = generateInvestigationUrls(baseUrl, hostname, start, end, { tab1, tab2, tab3 }, message.detectionTime);

             // Debug logs
             console.log("[DEBUG] Detection URL:", detectionUrl);
             console.log("[DEBUG] Investigation URLs:", investigationUrls);
             console.log("[DEBUG] Query for Tab 1:", tab1);
             console.log("[DEBUG] Query for Tab 2:", tab2);
             console.log("[DEBUG] Query for Tab 3:", tab3);

            handleOpenTabs(detectionUrl, investigationUrls, hostname, start, end, sendResponse, message.detectionTime);
        }
    });
}

/**
 * Utility: Logs debug messages consistently.
 * @param  {...any} messages - Messages to log.
 */
function logDebug(...messages) {
    console.debug(`[DEBUG]`, ...messages);
}

/**
 * Utility: Logs informational messages consistently.
 * @param  {...any} messages - Messages to log.
 */
function logInfo(...messages) {
    console.info(`[INFO]`, ...messages);
}

/**
 * Utility: Logs warning messages consistently.
 * @param  {...any} messages - Messages to log.
 */
function logWarn(...messages) {
    console.warn(`[WARN]`, ...messages);
}

/**
 * Utility: Logs error messages consistently.
 * @param  {...any} messages - Messages to log.
 */
function logError(...messages) {
    console.error(`[ERROR]`, ...messages);
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        console.log("First install detected. Initialising default settings...");
        chrome.runtime.openOptionsPage(); // Open settings page on first install
    }
});

/**
 * Resolve hostname, start, and end times for URL generation.
 */
function resolveTimesAndUrls(request, session) {
    const start = request.start ?? session.startTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const end = request.end ?? session.endTime ?? Date.now();

    console.log("[DEBUG] Resolved Start Time (epoch):", start);
    console.log("[DEBUG] Resolved Start Time (formatted):", new Date(start).toISOString());
    console.log("[DEBUG] Resolved End Time (epoch):", end);
    console.log("[DEBUG] Resolved End Time (formatted):", new Date(end).toISOString());

    return { hostname: request.hostname || session.hostname || "", start, end };
}

/**
 * Validate if the given string is a valid URL.
 * @param {string} url - The URL string to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Utility to format timestamps into CrowdStrike-compatible strings.
 */
function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString().replace("T", " ").split(".")[0] + " UTC";
}

/**
 * Generate the detection URL for the hostname.
 * @param {string} baseUrl - Base URL for CrowdStrike.
 * @param {string} hostname - Hostname to investigate.
 * @param {number} start - Start time in milliseconds (epoch).
 * @param {number} end - End time in milliseconds (epoch).
 * @returns {string} - The URL for the detection page.
 */
function generateDetectionUrl(baseUrl, hostname, start, end) {
    console.log("[DEBUG] Generating Detection URL with epoch times:", { start, end });
    return `${baseUrl}/activity-v2/detections?filter=hostname%3A%27${hostname}%27&pageSize=200&start=${start}&end=${end}`;
}

/**
 * Generate investigation URLs based on hostname, time range, and user-defined queries.
 * @param {string} baseUrl - Base URL for CrowdStrike.
 * @param {string} hostname - Hostname to investigate.
 * @param {number} start - Start time in milliseconds (epoch).
 * @param {number} end - End time in milliseconds (epoch).
 * @param {Object} tabsFromSettings - Object containing tab queries (tab1, tab2, tab3).
 * @param {number} [detectionTime] - Optional detection time in milliseconds (epoch).
 * @returns {string[]} - List of URLs for investigation tabs.
 */
function generateInvestigationUrls(baseUrl, hostname, start, end, tabsFromSettings, detectionTime) {
    console.log("[DEBUG] Generating Investigation URLs with epoch times:", { start, end });

    const queries = [
        tabsFromSettings.tab1,
        tabsFromSettings.tab2,
        tabsFromSettings.tab3,
    ];

    return queries.map((query, index) => {
        if (!query) {
            console.warn(`[WARN] Query for Tab ${index + 1} is missing or invalid. Skipping.`);
            return null;
        }

        try {
            const expandedQuery = query
                .replace(/\$hostname/g, hostname)
                .replace(/\$startTime/g, new Date(start).toISOString())
                .replace(/\$endTime/g, new Date(end).toISOString())
                .replace(/\$detectionTime/g, detectionTime ? new Date(detectionTime).toISOString() : "");

            console.log(`[DEBUG] Expanded Query for Tab ${index + 1}:`, expandedQuery);

            return `${baseUrl}/investigate/search?query=${encodeURIComponent(
                expandedQuery
            )}&repo=all&start=${start}&end=${end}`;
        } catch (err) {
            console.error(`[ERROR] Failed to process query for Tab ${index + 1}:`, query, err);
            return null;
        }
    }).filter((url) => url !== null);
}

/**
 * Open tabs for detection and investigation URLs.
 * @param {string} detectionUrl - URL for the detection page.
 * @param {string[]} investigationUrls - URLs for investigation tabs.
 * @param {string} hostname - Hostname being investigated.
 * @param {number} start - Start time for the investigation.
 * @param {number} end - End time for the investigation.
 * @param {Function} sendResponse - Callback to notify the caller.
 * @param {number} [detectionTime] - Optional detection time.
 */
function handleOpenTabs(detectionUrl, investigationUrls, hostname, start, end, sendResponse, detectionTime) {
    let detectionTabId;
    const investigationTabIds = [];
    const tabIds = [];
    const expectedTabs = 1 + investigationUrls.length; // Detection + Investigation tabs

    const toastMessages = [
        "Detection Overview",
        "Command Analysis",
        "Potential Target",
        "Network Activity",
    ];

    const toastColors = [
        "#D4B21F", // Darker Mustard Yellow for Overview
        "#3CB371", // Medium Sea Green for Commands
        "#FF5722", // Deep Orange for Potential Target
        "#007BFF", // Blue for Network
    ];    
      
    console.log("[DEBUG] Opening tabs with the following URLs:");
    console.log("Detection URL:", detectionUrl);
    console.log("Investigation URLs:", investigationUrls);

    // Open Detection Tab
    chrome.tabs.create({ url: detectionUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab) {
            console.error("[ERROR] Failed to open Detection Tab:", chrome.runtime.lastError?.message);
            sendResponse({ success: false, message: "Failed to open Detection tab." });
            return;
        }
        detectionTabId = tab.id;
        tabIds.push(tab.id);
        console.log("[DEBUG] Detection Tab Opened:", tab.id);

        // Display Toast Notification
        showToastInTab(tab.id, toastMessages[0], toastColors[0]);

        saveSessionAndRespond();
    });

    // Open Investigation Tabs
    investigationUrls.forEach((url, index) => {
        chrome.tabs.create({ url, active: false }, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                console.error(`[ERROR] Failed to open Investigation Tab ${index + 1}:`, chrome.runtime.lastError?.message);
                return;
            }
            investigationTabIds.push(tab.id);
            tabIds.push(tab.id);
            console.log(`[DEBUG] Investigation Tab ${index + 1} Opened:`, tab.id);

            // Display Toast Notification
            showToastInTab(tab.id, toastMessages[index + 1] || "Investigation Tab Opened", toastColors[index + 1] || "#28a745");

            saveSessionAndRespond();
        });
    });

    // Timeout Fallback
    setTimeout(() => {
        if (tabIds.length < expectedTabs) {
            console.warn("[WARN] Some tabs failed to open. Proceeding with partial save.");
            saveSessionAndRespond(true); // Partial save
        }
    }, 5000); // 5-second timeout

    function saveSessionAndRespond(partial = false) {
        if (tabIds.length === expectedTabs || partial) {
            console.log("[DEBUG] Saving Session. Partial Save:", partial);
            chrome.storage.local.set({
                lastInvestigationSession: {
                    hostname,
                    detectionTabId,
                    investigationTabIds,
                    tabIds,
                    startTime: start,
                    endTime: end,
                    detectionTime,
                },
            });
            sendResponse({ success: true, detectionTabId, investigationTabIds });
        }
    }
}

/**
 * Handle updating investigation tabs with updated times and URLs.
 */
function handleUpdateTabs(session, tabs, baseUrl, sendResponse) {
    if (!session.tabIds || session.tabIds.length === 0) {
        console.warn("No valid session data found.");
        sendResponse({ success: false, message: "No valid session found." });
        return;
    }

    const { hostname, startTime, endTime, tabIds } = session;

    if (!hostname || !tabIds) {
        console.warn("Incomplete session data.");
        sendResponse({ success: false, message: "Incomplete session data." });
        return;
    }

    const investigationUrls = generateInvestigationUrls(baseUrl, hostname, startTime, endTime, tabs);
    const toastMessages = ["Detection Source", "Detection Target", "Network Activity"];
    const toastColors = ["#FFCC00", "#28a745", "#FFA500"]; // Yellow, Green, Orange

    tabIds.forEach((tabId, index) => {
        const updatedUrl = investigationUrls[index];
        chrome.tabs.update(tabId, { url: updatedUrl }, () => {
            if (chrome.runtime.lastError) {
                console.error(`Error updating tab ${tabId}: ${chrome.runtime.lastError.message}`);
                showToastInTab(tabId, `Failed to update Investigation ${index + 1}: ${chrome.runtime.lastError.message}`, "#FF0000");
            } else {
                chrome.tabs.onActivated.addListener(({ tabId: activeTabId }) => {
                    if (tabId === activeTabId) {
                        showToastInTab(tabId, toastMessages[index], toastColors[index]);
                    }
                });
            }
        });
    });

    chrome.storage.local.set({
        lastInvestigationSession: { ...session, startTime, endTime, investigationUrls },
    });

    sendResponse({ success: true });
}

/**
 * Open a new tab and optionally display a toast message on load.
 */
function openTabWithToast(url, isActive, message, callback) {
    chrome.tabs.create({ url, active: isActive }, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.id) {
            console.error("Error opening tab:", chrome.runtime.lastError);
            return;
        }

        if (message) showToastInTab(tab.id, message, "#003366");

        if (callback) callback(tab.id);
    });
}

/**
 * Display a toast notification in a specific tab.
 */
function showToastInTab(tabId, message, color = "#003366") {
    if (!tabId) return;

    chrome.scripting.executeScript({
        target: { tabId },
        func: (msg, bgColor) => {
            const existingToast = document.getElementById("toast-notification");
            if (existingToast) existingToast.remove();

            const toast = document.createElement("div");
            toast.id = "toast-notification";
            toast.innerHTML = `
                <span>${msg}</span>
                <button id="toast-close-btn" style="
                    margin-left: 15px; 
                    border: none; 
                    background: transparent; 
                    color: #fff; 
                    font-size: 20px; 
                    cursor: pointer; 
                    font-weight: bold;">✖</button>
            `;
            Object.assign(toast.style, {
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                backgroundColor: bgColor,
                color: "#fff",
                padding: "20px 30px",
                borderRadius: "10px",
                fontSize: "16px",
                zIndex: "10000",
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0px 4px 15px rgba(0,0,0,0.2)",
                cursor: "grab",
            });

            document.body.appendChild(toast);

            let isDragging = false;
            let offsetX = 0;
            let offsetY = 0;

            const onMouseMove = (e) => {
                if (!isDragging) return;
                toast.style.left = `${e.clientX - offsetX}px`;
                toast.style.top = `${e.clientY - offsetY}px`;
            };

            const onMouseUp = () => {
                isDragging = false;
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };

            toast.onmousedown = (e) => {
                isDragging = true;
                offsetX = e.clientX - toast.getBoundingClientRect().left;
                offsetY = e.clientY - toast.getBoundingClientRect().top;
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            };

            const closeButton = document.getElementById("toast-close-btn");
            closeButton.onclick = () => {
                toast.remove();
            };

            toast.ondragstart = () => false; // Prevent default drag behavior
        },
        args: [message, color],
    });
}
