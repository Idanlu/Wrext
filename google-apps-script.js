/**
 * Wrext Google Sheets Sync Script
 * 
 * Paste this script into your Google Sheet:
 * 1. Open your Google Sheet (https://docs.google.com/spreadsheets/d/15POYJcFxaTpEIcK0_Q73oGoTRkw4xSidooc-vJjUniE/edit)
 * 2. Click on Extensions -> Apps Script
 * 3. Delete any default code in Code.gs and paste this code.
 * 4. Click the Save icon (floppy disk).
 * 5. (Optional but recommended) Click Project Settings (gear icon) -> Script Properties -> Add Script Property.
 *    - Property: API_TOKEN
 *    - Value: Choose a random password/token (e.g., "mygymsecret123").
 *    - This secures your sheet so only your Wrext app can write to it.
 * 6. Click the Deploy button -> New deployment.
 *    - Select type: Web app
 *    - Description: Wrext Sync Endpoint
 *    - Execute as: Me (your-email@gmail.com)
 *    - Who has access: Anyone
 * 7. Click Deploy, authorize the permissions, and copy the "Web app URL" (it ends in /exec).
 * 8. Paste this URL and API Token (if set) into the Settings page of your Wrext web app.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  // Wait up to 30 seconds for sheet lock to prevent concurrent write overlap
  lock.tryLock(30000);
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return makeResponse("error", "No data received in request body.");
    }
    
    var data = JSON.parse(e.postData.contents);
    
    // 1. Verify API Token if configured
    var apiToken = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
    if (apiToken && data.token !== apiToken) {
      return makeResponse("error", "Unauthorized: API Token mismatch.");
    }
    
    // 2. Open spreadsheet and target sheet
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Sheet1");
    if (!sheet) {
      // Fallback to first sheet if Sheet1 doesn't exist
      sheet = ss.getSheets()[0];
    }
    
    // 3. Append rows
    var rowsAdded = 0;
    if (data.sets && Array.isArray(data.sets)) {
      data.sets.forEach(function(item) {
        // Expected item keys: date, dayType, order, name, weight, sets (array), supersetType, notes
        // Note: The sheet has columns F, G, H, I for Set 1, Set 2, Set 3, Set 4.
        var setsArray = item.sets || [];
        var rowData = [
          item.date || "",
          item.dayType || "",
          item.order || "",
          item.name || "",
          item.weight || 0,
          setsArray[0] || "",
          setsArray[1] || "",
          setsArray[2] || "",
          setsArray[3] || "",
          item.supersetType || "",
          item.notes || ""
        ];
        sheet.appendRow(rowData);
        rowsAdded++;
      });
    }
    
    return makeResponse("success", "Successfully added " + rowsAdded + " rows.", { rowsAdded: rowsAdded });
    
  } catch (error) {
    return makeResponse("error", "Apps Script error: " + error.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * doGet - Read all workout rows from Sheet1 and return as JSON.
 * Called via GET request: WebAppURL?token=YOUR_TOKEN
 */
function doGet(e) {
  try {
    // 1. Verify API Token if configured
    var apiToken = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
    var requestToken = (e && e.parameter && e.parameter.token) ? e.parameter.token : "";
    if (apiToken && requestToken !== apiToken) {
      return makeResponse("error", "Unauthorized: API Token mismatch.");
    }
    
    // 2. Open spreadsheet and target sheet
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Sheet1");
    if (!sheet) {
      sheet = ss.getSheets()[0];
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      // Only header row or empty sheet
      return makeResponse("success", "No data rows found.", { rows: [] });
    }
    
    // 3. Read all data rows (skip header row 1)
    var dataRange = sheet.getRange(2, 1, lastRow - 1, 11); // Columns A-K
    var values = dataRange.getValues();
    
    var rows = values.map(function(row, idx) {
      return {
        date: row[0] || "",
        dayType: row[1] || "",
        order: row[2] || "",
        name: row[3] || "",
        weight: row[4] || 0,
        set1: row[5] !== "" ? String(row[5]) : "",
        set2: row[6] !== "" ? String(row[6]) : "",
        set3: row[7] !== "" ? String(row[7]) : "",
        set4: row[8] !== "" ? String(row[8]) : "",
        supersetType: row[9] || "",
        notes: row[10] || ""
      };
    });
    
    return makeResponse("success", "Fetched " + rows.length + " rows.", { rows: rows });
    
  } catch (error) {
    return makeResponse("error", "Apps Script error: " + error.toString());
  }
}

// Helper to construct JSON response (handling CORS-friendly text outputs)
function makeResponse(status, message, extraData) {
  var response = {
    status: status,
    message: message
  };
  
  if (extraData) {
    for (var key in extraData) {
      if (extraData.hasOwnProperty(key)) {
        response[key] = extraData[key];
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
