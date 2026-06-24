/**
 * Wrext Google Sheets Synchronization Service
 */

const SheetsSyncService = {
  // Sync a single workout to Google Sheets
  async syncWorkout(workout, settings) {
    if (!settings || !settings.sheetUrl) {
      throw new Error("Google Sheets Web App URL is not configured in Settings.");
    }

    // Format payload matching google-apps-script.js structure
    // We log each exercise as a row in the spreadsheet.
    const payload = {
      token: settings.apiToken || "",
      sets: workout.exercises.map((ex, index) => {
        // Map sets to array of reps (Set 1 to Set 4)
        // Ensure sets has exactly 4 entries (padded with empty strings)
        const setsArray = [];
        for (let i = 0; i < 4; i++) {
          setsArray.push(ex.sets[i] !== undefined ? String(ex.sets[i]) : "");
        }

        return {
          date: workout.date || "",
          dayType: workout.dayType || "",
          order: index + 1,
          name: ex.name || "",
          weight: parseFloat(ex.weight) || 0,
          sets: setsArray,
          supersetType: ex.supersetType || "",
          notes: ex.notes || ""
        };
      })
    };

    console.log("[Sync Service] Syncing payload to Sheets:", payload);

    try {
      // Use text/plain to avoid CORS preflight options request which Google Apps Script doesn't support
      const response = await fetch(settings.sheetUrl, {
        method: "POST",
        mode: "cors",
        headers: {
          // Sending text/plain keeps it a "simple request", avoiding CORS preflight block
          "Content-Type": "text/plain"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.status === "success") {
        return { success: true, message: result.message };
      } else {
        throw new Error(result.message || "Failed syncing to Google Sheets");
      }
    } catch (error) {
      console.error("[Sync Service] Synchronization failed:", error);
      return { success: false, error: error.message };
    }
  },

  // Test connection to Google Sheets Web App
  async testConnection(sheetUrl, apiToken) {
    if (!sheetUrl) {
      return { success: false, error: "URL is required" };
    }
    
    const payload = {
      token: apiToken || "",
      sets: [] // Empty sets is a ping/test connection
    };

    try {
      const response = await fetch(sheetUrl, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "text/plain"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return { success: false, error: `Server returned status ${response.status}` };
      }

      const result = await response.json();
      if (result.status === "success") {
        return { success: true, message: "Connection successful! Sheets endpoint is active." };
      } else {
        return { success: false, error: result.message || "Endpoint returned an error status" };
      }
    } catch (error) {
      return { success: false, error: `Connection failed: ${error.message}. Check URL or CORS settings.` };
    }
  }
};

// Export to window object for global availability
window.SheetsSyncService = SheetsSyncService;
