// Title: Background Script for CrowdQuery.
// Description: Manages detection and investigation pages with session tracking and notification support.
// Author: Simon .I
// Version: 2025.05.27

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

// Map to track debounce timers for tabs
const urlDebounceTimers = new Map();

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
        console.log(`[DEBUG][${new Date().toISOString()}] Tab Updated - ID: ${tabId}, URL: ${tab.url}`);

        // Clear any existing debounce timer for this tab
        clearTimeout(urlDebounceTimers.get(tabId));

        // Set a debounce timer to process the tab after a delay
        const debounceDelay = 500; // Adjust delay as needed
        const debounceTimer = setTimeout(() => {
            processTabUpdate(tabId, tab.url);
            urlDebounceTimers.delete(tabId); // Remove timer from map after processing
        }, debounceDelay);

        urlDebounceTimers.set(tabId, debounceTimer);
    }
});

// Function to check the session cookie
function checkFalconSession(callback) {
    chrome.storage.local.get(["baseUrl"], (data) => {
        const baseUrl = data.baseUrl;
        
        if (!baseUrl) {
            logWarn("Base URL is not set in the settings.");
            callback(false); // Session invalid as there's no base URL
            return;
        }

        // Extract the domain from the baseUrl
        const url = new URL(baseUrl);
        const cookieDomain = url.hostname; // e.g., "falcon.us-2.crowdstrike.com"
        const cookieName = "id";

        chrome.cookies.getAllCookieStores((stores) => {
            const incognitoStore = stores.find(store => store.incognito);
            const storeId = incognitoStore ? incognitoStore.id : stores[0].id;
          
            chrome.cookies.get({
              url: `https://${cookieDomain}`,
              name: cookieName,
              storeId
            }, (cookie) => {
              if (!cookie) {
                logDebug("No session cookie found. Login required.");
                callback(false);
                return;
              }
          
              const currentTime = Date.now() / 1000;
              if (cookie.expirationDate && cookie.expirationDate < currentTime) {
                logDebug("Session cookie expired. Login required.");
                callback(false);
                return;
              }
          
              logDebug("Session cookie is valid.");
              callback(true);
            });
          });
          
            if (!cookie) {
                logDebug("No session cookie found. Login required.");
                callback(false); // Session invalid
                return;
            }

            logDebug("Found session cookie:", cookie);

            const currentTime = Date.now() / 1000; // Convert to seconds
            if (cookie.expirationDate && cookie.expirationDate < currentTime) {
                logDebug("Session cookie expired. Login required.");
                callback(false); // Session expired
                return;
            }

            logDebug("Session cookie is valid.");
            callback(true); // Session valid
        });
}

// Function to open tabs or redirect to login page
function openTabsOrLogin() {
    checkFalconSession((isLoggedIn) => {
        if (isLoggedIn) {
            console.log("[DEBUG] Session is active. Opening tabs.");
            // Open investigation tabs
            openInvestigationTabs();
        } else {
            console.log("[DEBUG] Session inactive. Redirecting to login_required.html.");
            chrome.tabs.query({ url: chrome.runtime.getURL("login_required.html") }, (tabs) => {
                if (tabs.length > 0) {
                    console.log("[DEBUG] login_required.html is already open. Not opening a new tab.");
                } else {
                    chrome.tabs.create({ url: chrome.runtime.getURL("login_required.html") });
                }
            });
        }
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        console.log("[INFO] First install detected. No session check performed.");
        // Do not check for cookies here
    }
});

/**
 * Processes tab updates after the debounce period.
 * @param {number} tabId - The ID of the updated tab.
 * @param {string} url - The updated tab's URL.
 */
const processedTabs = new Map(); // Track processed tab states

function processTabUpdate(tabId, url) {
    if (processedTabs.get(tabId) === url) {
        console.log(`[DEBUG][${new Date().toISOString()}] URL already processed for Tab ID ${tabId}: ${url}`);
        return;
    }

    processedTabs.set(tabId, url); // Update the map with the current tab state

    chrome.storage.local.get(["baseUrl"], (data) => {
        const baseUrl = data.baseUrl || "";
        const regexPattern = /^https:\/\/falcon\..*\.crowdstrike\.com\/dashboards(-v2)?\/[^?]*$/;

        if (url.includes("/login")) {
            console.log(`[DEBUG][${new Date().toISOString()}] Excluding intermediate login URL: ${url}`);
            return;
        }

        if (regexPattern.test(url)) {
            console.log(`[DEBUG][${new Date().toISOString()}] Valid dashboard URL detected: ${url}`);
            handleSuccessfulLogin(tabId, url, baseUrl);
        } else {
            console.log(`[DEBUG][${new Date().toISOString()}] URL does not match valid dashboard pattern: ${url}`);
        }
    });
}

// Listener to reset loginPageOpen when login_required.html tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.tabs.query({ url: chrome.runtime.getURL("login_required.html") }, (existingTabs) => {
        if (existingTabs.length === 0) {
            console.log("[DEBUG] All login_required.html tabs closed. Resetting loginPageOpen flag.");
            loginPageOpen = false; // Reset the flag
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

        case "checkAndOpenTabs":
            logDebug("Received message to check session and open tabs.");
            checkFalconSession((isLoggedIn) => {
                if (isLoggedIn) {
                    logDebug("Session is active. Proceeding to open tabs.");

                    // Open the primary tab first
                    chrome.tabs.create({ url: message.primaryUrl, active: true }, (primaryTab) => {
                        if (chrome.runtime.lastError) {
                            logError("Failed to open primary tab:", chrome.runtime.lastError.message);
                            sendResponse({ success: false, message: "Failed to open primary tab." });
                            return;
                        }

                        const investigationTabIds = [];
                        let tabsOpened = 1; // Start with the primary tab

                        // Open investigation tabs
                        message.investigationUrls.forEach((url, index) => {
                            chrome.tabs.create({ url, active: false }, (tab) => {
                                if (chrome.runtime.lastError) {
                                    logError(`Failed to open investigation tab ${index + 1}: ${chrome.runtime.lastError.message}`);
                                } else {
                                    investigationTabIds.push(tab.id);
                                    tabsOpened++;
                                    logDebug(`Investigation tab ${index + 1} opened:`, tab.id);

                                    // Save session once all tabs are opened
                                    if (tabsOpened === 4) {
                                        chrome.storage.local.set({
                                            lastInvestigationSession: {
                                                input: message.input,
                                                selectedType: message.selectedType,
                                                primaryTabId: primaryTab.id,
                                                investigationTabIds,
                                                primaryUrl: message.primaryUrl,
                                                investigationUrls: message.investigationUrls,
                                                startTime: message.start,
                                                endTime: message.end,
                                            },
                                        });
                                        sendResponse({ success: true });
                                    }
                                }
                            });
                        });

                        // Fallback for saving session if not all tabs were opened
                        setTimeout(() => {
                            if (tabsOpened < 4) {
                                logWarn("Some tabs failed to open. Partial session saved.");
                                chrome.storage.local.set({
                                    lastInvestigationSession: {
                                        input: message.input,
                                        selectedType: message.selectedType,
                                        primaryTabId: primaryTab.id,
                                        investigationTabIds,
                                        primaryUrl: message.primaryUrl,
                                        investigationUrls: message.investigationUrls,
                                        startTime: message.start,
                                        endTime: message.end,
                                    },
                                });
                                sendResponse({ success: true });
                            }
                        }, 5000); // Wait 5 seconds for all tabs to open
                    });
                } else {
                    logWarn("Session is inactive. Redirecting to login_required.html.");
                    chrome.tabs.query({ url: chrome.runtime.getURL("login_required.html") }, (tabs) => {
                        if (tabs.length === 0) {
                            chrome.tabs.create({ url: chrome.runtime.getURL("login_required.html") });
                        } else {
                            logDebug("login_required.html is already open.");
                        }
                    });
                    sendResponse({ success: false, message: "Session inactive. Redirected to login page." });
                }
            });
            return true;

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
        ["lastinput", "lastDetectionTime", "baseUrl", "tab1", "tab2", "tab3"],
        (data) => {
            const { lastinput, lastDetectionTime, baseUrl, tab1, tab2, tab3 } = data;

            if (!lastinput) {
                logError("Missing required parameter: lastinput");
                sendResponse({ success: false, error: "No search data found." });
                return;
            }

            if (!baseUrl || !tab1 || !tab2 || !tab3) {
                logError("Missing required settings for tabs or base URL.");
                sendResponse({ success: false, error: "Configuration is incomplete." });
                return;
            }

            logDebug(`Resuming search for input: ${lastinput}`);

            const startTime = lastDetectionTime || Date.now() - 7 * 24 * 60 * 60 * 1000; // Default: past 7 days
            const endTime = Date.now(); // Default: now

            logDebug("Resolved Start Time:", startTime, "Resolved End Time:", endTime);

            const detectionUrl = generateDetectionUrl(baseUrl, lastinput, startTime, endTime);
            const investigationUrls = generateInvestigationUrls(baseUrl, lastinput, startTime, endTime, {
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

            handleOpenTabs(detectionUrl, investigationUrls, lastinput, startTime, endTime, sendResponse);
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
            const { input, start, end } = resolveTimesAndUrls(message, session);

            logDebug("Resolved Values from Request:", { input, start, end });

            if (!input) {
                logWarn("input is required.");
                sendResponse({ success: false, message: "input is required." });
                return;
            }

            const detectionUrl = generateDetectionUrl(baseUrl, input, start, end);
            const investigationUrls = generateInvestigationUrls(baseUrl, input, start, end, { tab1, tab2, tab3 }, message.detectionTime);

             // Debug logs
             console.log("[DEBUG] Detection URL:", detectionUrl);
             console.log("[DEBUG] Investigation URLs:", investigationUrls);
             console.log("[DEBUG] Query for Tab 1:", tab1);
             console.log("[DEBUG] Query for Tab 2:", tab2);
             console.log("[DEBUG] Query for Tab 3:", tab3);

            handleOpenTabs(detectionUrl, investigationUrls, input, start, end, sendResponse, message.detectionTime);
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
 * Resolve input, start, and end times for URL generation.
 */
function resolveTimesAndUrls(request, session) {
    const start = request.start ?? session.startTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const end = request.end ?? session.endTime ?? Date.now();

    console.log("[DEBUG] Resolved Start Time (epoch):", start);
    console.log("[DEBUG] Resolved Start Time (formatted):", new Date(start).toISOString());
    console.log("[DEBUG] Resolved End Time (epoch):", end);
    console.log("[DEBUG] Resolved End Time (formatted):", new Date(end).toISOString());

    return { input: request.input || session.input || "", start, end };
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
 * Generate the detection URL for the input.
 * @param {string} baseUrl - Base URL for CrowdStrike.
 * @param {string} input - input to investigate.
 * @param {number} start - Start time in milliseconds (epoch).
 * @param {number} end - End time in milliseconds (epoch).
 * @returns {string} - The URL for the detection page.
 */
function generateDetectionUrl(baseUrl, input, start, end) {
    if (!baseUrl) {
        logError("Base URL is missing. Cannot generate detection URL.");
        return null;
    }

    return `${baseUrl}/activity-v2/detections?filter=hostname%3A%27${hostname}%27&pageSize=200&start=${start}&end=${end}`;
}

/**
 * Generate investigation URLs based on input, time range, and user-defined queries.
 * @param {string} baseUrl - Base URL for CrowdStrike.
 * @param {string} input - input to investigate.
 * @param {number} start - Start time in milliseconds (epoch).
 * @param {number} end - End time in milliseconds (epoch).
 * @param {Object} tabsFromSettings - Object containing tab queries (tab1, tab2, tab3).
 * @param {number} [detectionTime] - Optional detection time in milliseconds (epoch).
 * @returns {string[]} - List of URLs for investigation tabs.
 */
function generateInvestigationUrls(baseUrl, input, start, end, tabsFromSettings, detectionTime) {
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
                .replace(/\$input/g, input)
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
 * @param {string} input - input being investigated.
 * @param {number} start - Start time for the investigation.
 * @param {number} end - End time for the investigation.
 * @param {Function} sendResponse - Callback to notify the caller.
 * @param {number} [detectionTime] - Optional detection time.
 */
function handleOpenTabs(detectionUrl, investigationUrls, input, start, end, sendResponse) {
    let detectionTabId;
    const investigationTabIds = [];
    const tabIds = [];
    const expectedTabs = 1 + investigationUrls.length; // Detection + Investigation tabs

    logDebug("Opening tabs with the following URLs:", { detectionUrl, investigationUrls });

    // Open Detection Tab
    chrome.tabs.create({ url: detectionUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab) {
            logError("Failed to open Detection Tab:", chrome.runtime.lastError?.message);
            sendResponse({ success: false, message: "Failed to open Detection tab." });
            return;
        }
        detectionTabId = tab.id;
        tabIds.push(tab.id);
        logDebug("Detection Tab Opened:", tab.id);

        // Open Investigation Tabs
        investigationUrls.forEach((url, index) => {
            chrome.tabs.create({ url, active: false }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    logError(`Failed to open Investigation Tab ${index + 1}:`, chrome.runtime.lastError?.message);
                    return;
                }
                investigationTabIds.push(tab.id);
                tabIds.push(tab.id);
                logDebug(`Investigation Tab ${index + 1} Opened:`, tab.id);

                // If all tabs are opened, save the session and send the response
                if (tabIds.length === expectedTabs) {
                    saveSessionAndRespond();
                }
            });
        });

        // Fallback for saving the session if not all tabs opened
        setTimeout(() => {
            if (tabIds.length < expectedTabs) {
                logWarn("Some tabs failed to open. Proceeding with partial save.");
                saveSessionAndRespond();
            }
        }, 5000);
    });

    function saveSessionAndRespond() {
        logDebug("Saving session with the following data:", { detectionTabId, investigationTabIds, tabIds });
        chrome.storage.local.set({
            lastInvestigationSession: {
                input,
                detectionTabId,
                investigationTabIds,
                tabIds,
                startTime: start,
                endTime: end,
            },
        });
        sendResponse({ success: true, detectionTabId, investigationTabIds });
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

    const { input, startTime, endTime, tabIds } = session;

    if (!input || !tabIds) {
        console.warn("Incomplete session data.");
        sendResponse({ success: false, message: "Incomplete session data." });
        return;
    }

    const investigationUrls = generateInvestigationUrls(baseUrl, input, startTime, endTime, tabs);
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
 * Display a toast notification in a specific tab.
 */
function showToastInTab(tabId, title = "Notification", message = "This is a toast message.", bgColor = "#4CAF50") {
    chrome.scripting.executeScript({
        target: { tabId },
        func: (title, msg, bgColor) => {
            // Remove existing toast to prevent duplicates
            const existingToast = document.getElementById("toast-notification");
            if (existingToast) existingToast.remove();

            // Create toast container
            const toast = document.createElement("div");
            toast.id = "toast-notification";
            toast.innerHTML = `
                <div id="toast-header" style="cursor: grab; padding: 10px; background: rgba(0, 0, 0, 0.1); border-bottom: 1px solid rgba(255, 255, 255, 0.2); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 16px; font-weight: bold;">${title}</span>
                    <button id="toast-close" style="background: none; border: none; color: #fff; font-size: 14px; cursor: pointer;">✖</button>
                </div>
                <div id="toast-body" style="padding: 15px; font-size: 14px; line-height: 1.5;">${msg}</div>
            `;

            // Apply styles
            Object.assign(toast.style, {
                position: "fixed",
                top: "5%",
                left: "50%",
                transform: "translate(-50%, 0)",
                backgroundColor: bgColor,
                color: "#fff",
                width: "320px",
                borderRadius: "12px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
                zIndex: "10000",
                fontFamily: "Roboto, Arial, sans-serif",
                overflow: "hidden",
                opacity: "0",
                transition: "opacity 0.3s ease, transform 0.3s ease",
            });

            document.body.appendChild(toast);

            // Fade in
            setTimeout(() => {
                toast.style.opacity = "1";
            }, 50);

            // Dragging functionality
            const header = document.getElementById("toast-header");
            let isDragging = false;
            let startX, startY, initialX, initialY;

            header.addEventListener("mousedown", (e) => {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = toast.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;
                toast.style.cursor = "grabbing";
            });

            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                toast.style.left = `${initialX + deltaX}px`;
                toast.style.top = `${initialY + deltaY}px`;
                toast.style.transform = ""; // Reset transform to enable manual positioning
            });

            document.addEventListener("mouseup", () => {
                isDragging = false;
                toast.style.cursor = "grab";
            });

            // Close button logic
            document.getElementById("toast-close").addEventListener("click", () => {
                toast.style.opacity = "0";
                setTimeout(() => toast.remove(), 300); // Allow fade-out
            });
        },
        args: [title, message, bgColor],
    });
}
