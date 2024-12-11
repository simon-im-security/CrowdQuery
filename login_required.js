/*
  Title: Login Script for NG-SIEM Toolkit
  Description: Handles dynamic login URLs, error handling for missing CrowdStrike session or base URL, and resuming the last search after login.
  Author: Simon .I
  Version: 2024.12.11
*/

document.addEventListener("DOMContentLoaded", () => {
  // Fetch the base URL and last session data from Chrome storage
  chrome.storage.local.get(["baseUrl", "lastInvestigationSession"], (data) => {
    const baseUrl = data.baseUrl;
    const lastSession = data.lastInvestigationSession;

    if (baseUrl) {
      // Base URL exists; construct login URLs
      const ssoUrl = `${baseUrl}/login/sso`;
      const localUrl = `${baseUrl}/login`;

      // Dynamically assign hrefs to the buttons
      const localLoginBtn = document.getElementById("localLogin");
      const ssoLoginBtn = document.getElementById("ssoLogin");

      localLoginBtn.href = localUrl;
      ssoLoginBtn.href = ssoUrl;

      console.log("Login URLs set:", { localUrl, ssoUrl });
    } else {
      // No base URL set; inform the user
      const container = document.querySelector(".container");
      container.innerHTML = `
        <h1>Base URL Not Set</h1>
        <p>Please configure the CrowdStrike Base URL in the extension settings before logging in.</p>
        <a href="#" id="settingsLink" class="local-login">Go to Settings</a>
      `;

      // Add functionality to open the settings page
      const settingsLink = document.getElementById("settingsLink");
      settingsLink.addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
      });

      console.warn("Base URL is not set. User has been informed.");
      return; // Exit if baseUrl is missing
    }

    // The resume button does not belong on this page, so it's not included here
    // No actions related to resuming the search are needed here
  });
});
