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
    
    // 2. Handle Routines Sync (full array)
    if (data.type === "routines" || (data.routines && Array.isArray(data.routines))) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var routineSheet = ss.getSheetByName("Routines");
      if (!routineSheet) {
        routineSheet = ss.insertSheet("Routines");
      }
      routineSheet.clearContents();
      routineSheet.appendRow(["ID", "Name", "DayType", "ExercisesJSON"]);
      var routineList = data.routines || [];
      routineList.forEach(function(rt) {
        routineSheet.appendRow([
          rt.id || "",
          rt.name || "",
          rt.dayType || "",
          JSON.stringify(rt.exercises || [])
        ]);
      });
      return makeResponse("success", "Synced " + routineList.length + " routines.");
    }
    
    // 3. Open spreadsheet and target sheet for workouts
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Sheet1");
    if (!sheet) {
      sheet = ss.getSheets()[0];
    }
    
    // 4. Append workout rows
    var rowsAdded = 0;
    if (data.sets && Array.isArray(data.sets)) {
      data.sets.forEach(function(item) {
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
          item.notes || "",
          item.restTime !== undefined ? item.restTime : "",
          item.weekNumber || ""
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
 * doGet - Read data from Sheet1 (history) or Routines tab and return as JSON.
 * Called via GET request: WebAppURL?token=YOUR_TOKEN[&type=routines]
 */
function doGet(e) {
  try {
    // 1. Verify API Token if configured
    var apiToken = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
    var requestToken = (e && e.parameter && e.parameter.token) ? e.parameter.token : "";
    if (apiToken && requestToken !== apiToken) {
      return makeResponse("error", "Unauthorized: API Token mismatch.");
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var requestType = (e && e.parameter && e.parameter.type) ? e.parameter.type : "";

    // 2. Check if fetching Routines
    if (requestType === "routines" || requestType === "routine") {
      var routineSheet = ss.getSheetByName("Routines");
      if (!routineSheet) {
        return makeResponse("success", "No routines sheet.", { routines: [] });
      }
      var lastRow = routineSheet.getLastRow();
      if (lastRow < 2) {
        return makeResponse("success", "No routines data.", { routines: [] });
      }
      var dataRange = routineSheet.getRange(2, 1, lastRow - 1, 4); // ID, Name, DayType, ExercisesJSON
      var values = dataRange.getValues();
      var routines = values.map(function(row) {
        var exercises = [];
        try {
          exercises = JSON.parse(row[3] || "[]");
        } catch (err) {}
        return {
          id: String(row[0] || ""),
          name: String(row[1] || ""),
          dayType: String(row[2] || ""),
          exercises: exercises
        };
      });
      return makeResponse("success", "Fetched " + routines.length + " routines.", { routines: routines });
    }
    
    // 3. Otherwise fetch Workout History from Sheet1
    var sheet = ss.getSheetByName("Sheet1");
    if (!sheet) {
      sheet = ss.getSheets()[0];
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return makeResponse("success", "No data rows found.", { rows: [] });
    }
    
    var dataRange = sheet.getRange(2, 1, lastRow - 1, 13); // Columns A-M
    var values = dataRange.getValues();
    
    var rows = values.map(function(row) {
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
        notes: row[10] || "",
        restTime: row[11] !== undefined ? row[11] : "",
        weekNumber: row[12] || ""
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
