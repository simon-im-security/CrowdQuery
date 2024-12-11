// Title: Content Script for NG-SIEM Toolkit
// Description: Displays notifications for detection actions, managed by the background script for NG-SIEM Toolkit.
// Author: Simon .I
// Version: 2024.12.11

(() => {
    /**
     * Display a toast-like notification with a customizable message, color, and duration.
     * Optionally auto-dismiss after a specified timeout.
     * @param {string} message - The message to display.
     * @param {string} bgColor - Background color for the toast (default: dark blue).
     * @param {number} [autoDismiss=0] - Time in milliseconds to auto-dismiss the toast (0 = manual dismiss).
     * @param {string} position - Position of the toast ('top', 'middle', or 'bottom').
     */
    function showToast(message, bgColor = "#003366", autoDismiss = 0, position = "middle") {
        if (!message) {
            console.warn("showToast called without a message.");
            return;
        }

        // Remove any existing toast to avoid overlap
        const existingToast = document.getElementById("statusToast");
        if (existingToast) {
            console.warn("Existing toast detected. Removing it before displaying a new one.");
            existingToast.remove();
        }

        // Create the toast container
        const toast = document.createElement("div");
        toast.id = "statusToast";
        toast.textContent = message;

        Object.assign(toast.style, {
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: bgColor,
            color: "#fff",
            padding: "20px 40px",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            fontSize: "18px",
            zIndex: "10000",
            textAlign: "center",
            maxWidth: "80%",
            opacity: "1", // Visible until dismissed
            transition: "opacity 0.5s ease-in-out",
        });

        // Set vertical position
        if (position === "top") {
            toast.style.top = "10%";
        } else if (position === "bottom") {
            toast.style.bottom = "10%";
        } else {
            toast.style.top = "50%";
            toast.style.transform = "translate(-50%, -50%)";
        }

        document.body.appendChild(toast);

        // Create an OK button
        const okButton = document.createElement("button");
        okButton.textContent = "OK";
        Object.assign(okButton.style, {
            marginTop: "20px",
            padding: "10px 20px",
            backgroundColor: "#4CAF50",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: "16px",
        });
        toast.appendChild(okButton);

        // Add event listener to remove the toast when OK is clicked
        okButton.addEventListener("click", () => {
            console.log("Toast dismissed by user.");
            toast.remove();
        });

        // Auto-dismiss if the timeout is specified
        if (autoDismiss > 0) {
            const timeoutId = setTimeout(() => {
                if (toast.parentNode) {
                    console.log("Toast auto-dismissed.");
                    toast.remove();
                }
                clearTimeout(timeoutId);
            }, autoDismiss);
        }
    }

    /**
     * Handle incoming notification requests from the background script.
     * @param {Object} request - Notification request from the background script.
     */
    function handleNotification(request) {
        try {
            const {
                message = "",
                color = "#4CAF50",
                autoDismiss = 0,
                position = "middle",
            } = request;

            if (message) {
                showToast(message, color, autoDismiss, position);
            } else {
                console.warn("Invalid notification request: Missing message parameter.", request);
            }
        } catch (error) {
            console.error("Error handling notification request:", error);
        }
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request?.action === "showToast") {
            handleNotification(request);
            sendResponse({ success: true }); // Confirm receipt of the message
        } else {
            console.warn("Received unsupported action:", request);
            sendResponse({ success: false, message: "Unsupported action." });
        }
    });
})();
