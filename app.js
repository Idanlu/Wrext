/**
 * Wrext Application Controller
 */

// Application State
let state = {
  settings: {
    sheetUrl: "",
    apiToken: "",
    restDuration: 90,
    soundEnabled: true
  },
  routines: [],
  programs: [],
  activeProgramId: null,
  programWeekFilter: "ALL",
  history: [],
  activeSession: null, // Holds active workout session data
  streak: 0,
  lastWorkoutDate: null
};

// Web Audio API Synthesizer for Rest Timer Completion Chime (Offline Friendly)
function playTimerDoneChime() {
  if (!state.settings.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Play three ascending neon-like synth notes (C5 -> E5 -> G5)
    const playNote = (frequency, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);
      
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    
    const now = ctx.currentTime;
    playNote(523.25, now, 0.15); // C5
    playNote(659.25, now + 0.12, 0.15); // E5
    playNote(783.99, now + 0.24, 0.3); // G5
  } catch (err) {
    console.error("Audio playback error:", err);
  }
}

// Default program for demonstration and initial state
const DEFAULT_PROGRAM = {
  id: "prog-calisthenics-mastery",
  name: "4-Week Calisthenics Mastery",
  routines: [
    {
      id: "rt-w1-d1",
      weekNumber: 1,
      name: "Week 1 Day 1 - Heavy Upper",
      dayType: "Heavy",
      completed: false,
      completedAt: null,
      exercises: [
        { name: "Weighted Pull-up", weight: 20, setsCount: 3, reps: "8", restTime: 120, notes: "Chest to bar" },
        { name: "Deep Push-ups", weight: 0, setsCount: 3, reps: "12", restTime: 90, notes: "Full ROM" },
        { name: "Hanging Knee Raises", weight: 0, setsCount: 3, reps: "15", restTime: 60, notes: "Controlled negative" }
      ]
    },
    {
      id: "rt-w1-d2",
      weekNumber: 1,
      name: "Week 1 Day 2 - Lower & Core",
      dayType: "Volume",
      completed: false,
      completedAt: null,
      exercises: [
        { name: "Cossack Squats", weight: 8, setsCount: 4, reps: "10", restTime: 90, notes: "Deep stretch" },
        { name: "Active Hang", weight: 0, setsCount: 3, reps: "45", restTime: 60, notes: "Scapular depression" }
      ]
    },
    {
      id: "rt-w2-d1",
      weekNumber: 2,
      name: "Week 2 Day 1 - Heavy Upper Overload",
      dayType: "Heavy",
      completed: false,
      completedAt: null,
      exercises: [
        { name: "Weighted Pull-up", weight: 22.5, setsCount: 3, reps: "8", restTime: 120, notes: "+2.5kg overload" },
        { name: "Deep Push-ups", weight: 5, setsCount: 3, reps: "10", restTime: 90, notes: "Weighted" },
        { name: "Hanging Knee Raises", weight: 0, setsCount: 3, reps: "15", restTime: 60, notes: "Strict execution" }
      ]
    }
  ]
};

// Default routines based on the user's spreadsheet logs
const DEFAULT_ROUTINES = [
  {
    id: "default-heavy",
    name: "Heavy Day (Monday)",
    dayType: "Heavy",
    exercises: [
      { name: "Weighted Pull-up", weight: 20, setsCount: 3, restTime: 120 },
      { name: "Deep Push-ups", weight: 0, setsCount: 3, restTime: 90 },
      { name: "Hanging Knee Raises", weight: 0, setsCount: 3, restTime: 60 },
      { name: "Active Hang", weight: 0, setsCount: 2, restTime: 60 }
    ]
  },
  {
    id: "default-volume",
    name: "Volume Day (Wednesday)",
    dayType: "Volume",
    exercises: [
      { name: "Weighted Pull-up", weight: 15, setsCount: 4, restTime: 120 },
      { name: "Cossack Squats", weight: 7, setsCount: 3, restTime: 90 },
      { name: "Plank", weight: 0, setsCount: 2, restTime: 60 }
    ]
  }
];

// Helper: Format elapsed time in hh:mm:ss
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getISOWeek(dateObj) {
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getAutoWeekNumber() {
  const now = new Date();
  
  if (state.history && state.history.length > 0) {
    const lastLog = state.history[0];
    
    // 1. If last log explicitly has weekNumber stored
    if (lastLog.weekNumber && !isNaN(parseInt(lastLog.weekNumber))) {
      let weekNum = parseInt(lastLog.weekNumber);
      
      // Check if last log date is in a previous ISO week
      if (lastLog.date) {
        const parsedLastDate = new Date(lastLog.date);
        if (!isNaN(parsedLastDate.getTime())) {
          const lastIsoWeek = getISOWeek(parsedLastDate);
          const currentIsoWeek = getISOWeek(now);
          if (currentIsoWeek > lastIsoWeek) {
            weekNum += (currentIsoWeek - lastIsoWeek);
          }
        } else {
          // If weekday string e.g. "Wed", check transition to "Mon"
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const todayName = days[now.getDay()];
          if (lastLog.date.includes('Wed') || lastLog.date.includes('Fri')) {
            if (todayName === 'Mon') {
              weekNum += 1;
            }
          }
        }
      }
      return weekNum;
    }
    
    // 2. Check if date field contained (W<N>)
    if (lastLog.date) {
      const match = lastLog.date.match(/W(\d+)/i);
      if (match) {
        let weekNum = parseInt(match[1]);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const todayName = days[now.getDay()];
        if (lastLog.date.includes('Wed') && todayName === 'Mon') {
          weekNum += 1;
        }
        return weekNum;
      }
    }
  }
  
  return getISOWeek(now);
}

// Helper: Get formatted date string for inputs (e.g., "Mon, 03 Aug")
function getDefaultWorkoutDate() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const dayName = days[now.getDay()];
  const monthName = months[now.getMonth()];
  const dayOfMonth = String(now.getDate()).padStart(2, '0');
  
  return `${dayName}, ${dayOfMonth} ${monthName}`;
}

// ----------------------------------------------------
// Core Initialization & LocalStorage
// ----------------------------------------------------
function initApp() {
  // 1. Load data from LocalStorage
  const savedSettings = localStorage.getItem('wrext_settings');
  if (savedSettings) {
    state.settings = JSON.parse(savedSettings);
  }
  
  const savedRoutines = localStorage.getItem('wrext_routines');
  if (savedRoutines) {
    state.routines = JSON.parse(savedRoutines);
    // Migration: clean up any legacy supersetType properties from saved routines
    let migrated = false;
    state.routines.forEach(r => {
      if (r.exercises) {
        r.exercises.forEach(ex => {
          if (ex.hasOwnProperty('supersetType')) {
            delete ex.supersetType;
            migrated = true;
          }
        });
      }
    });
    if (migrated) {
      localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
    }
    // Sync routines to Google Sheets on init if available
    if (state.settings.sheetUrl) {
      (async () => {
        const res = await SheetsSyncService.syncRoutines(state.routines, state.settings);
        if (!res.success) {
          console.warn('Routines sync failed:', res.error);
        }
      })();
    }
  } else {
    state.routines = [...DEFAULT_ROUTINES];
    localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
  }

  const savedPrograms = localStorage.getItem('wrext_programs');
  if (savedPrograms) {
    try {
      state.programs = JSON.parse(savedPrograms);
    } catch (e) {
      state.programs = [DEFAULT_PROGRAM];
    }
  } else {
    state.programs = [DEFAULT_PROGRAM];
    localStorage.setItem('wrext_programs', JSON.stringify(state.programs));
  }

  state.activeProgramId = localStorage.getItem('wrext_active_program_id') || (state.programs[0] ? state.programs[0].id : null);
  
  const savedHistory = localStorage.getItem('wrext_history');
  if (savedHistory) {
    state.history = JSON.parse(savedHistory);
  }
  
  state.streak = parseInt(localStorage.getItem('wrext_streak')) || 0;
  state.lastWorkoutDate = localStorage.getItem('wrext_last_workout_date');
  
  // 2. Register Navigation Events
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.getAttribute('data-view');
      switchView(targetView);
    });
  });
  
  // 3. Register Event Listeners for Buttons/Forms
  setupEventListeners();
  
  // 4. Update sync dot connection status
  updateConnectionStatus();
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  
  // 5. Initial views rendering
  renderDashboard();
  renderRoutines();
  renderPrograms();
  renderHistory();
  loadSettingsForm();

  // Auto-sync routines, programs, and history from Google Sheet (authoritative DB)
  (async () => {
    if (state.settings.sheetUrl) {
      // 1. Sync routines from Google Sheet
      const routinesResult = await SheetsSyncService.fetchRoutines(state.settings.sheetUrl, state.settings.apiToken);
      if (routinesResult.success && routinesResult.routines && routinesResult.routines.length > 0) {
        state.routines = routinesResult.routines;
        localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
        renderRoutines();
        renderDashboard();
      } else if (routinesResult.success && (!routinesResult.routines || routinesResult.routines.length === 0) && state.routines.length > 0) {
        await SheetsSyncService.syncRoutines(state.routines, state.settings);
      }

      // 2. Sync programs from Google Sheet
      const programsResult = await SheetsSyncService.fetchPrograms(state.settings.sheetUrl, state.settings.apiToken);
      if (programsResult.success && programsResult.programs && programsResult.programs.length > 0) {
        // Merge completed statuses if local program completed routine exists
        programsResult.programs.forEach(fetchedProg => {
          const localProg = state.programs.find(p => p.id === fetchedProg.id || p.name === fetchedProg.name);
          if (localProg) {
            fetchedProg.routines.forEach(fRt => {
              const lRt = localProg.routines.find(r => r.id === fRt.id || r.name === fRt.name);
              if (lRt && lRt.completed) {
                fRt.completed = true;
                fRt.completedAt = lRt.completedAt;
              }
            });
          }
        });
        state.programs = programsResult.programs;
        if (!state.activeProgramId && state.programs[0]) {
          state.activeProgramId = state.programs[0].id;
        }
        localStorage.setItem('wrext_programs', JSON.stringify(state.programs));
        renderPrograms();
        renderDashboard();
      } else if (programsResult.success && (!programsResult.programs || programsResult.programs.length === 0) && state.programs.length > 0) {
        await SheetsSyncService.syncPrograms(state.programs, state.settings);
      }

      // 3. Sync history from Google Sheet
      const result = await SheetsSyncService.fetchHistory(state.settings.sheetUrl, state.settings.apiToken);
      if (result.success && result.workouts) {
        state.history = result.workouts.map(w => ({ ...w, synced: true }));
        localStorage.setItem('wrext_history', JSON.stringify(state.history));
        renderDashboard();
        renderHistory();
        showToast('Sheet auto-sync complete.', true);
      } else {
        console.warn('Auto-sync failed:', result.error);
      }
    }
  })();
  
  // Check if active session was saved (crash prevention)
  const savedSession = localStorage.getItem('wrext_active_session');
  if (savedSession) {
    if (confirm("You have an unsaved active workout session. Would you like to resume?")) {
      state.activeSession = JSON.parse(savedSession);
      if (state.activeSession.exercises) {
        state.activeSession.exercises.forEach(ex => {
          if (ex.hasOwnProperty('supersetType')) {
            delete ex.supersetType;
          }
        });
      }
      resumeWorkoutSession();
    } else {
      localStorage.removeItem('wrext_active_session');
    }
  }
}

// Switch SPA tab views
function switchView(viewId) {
  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    }
  });
  
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
  }
  
  // Custom actions on switching view
  if (viewId === 'view-dashboard') {
    renderDashboard();
  } else if (viewId === 'view-programs') {
    renderPrograms();
  } else if (viewId === 'view-history') {
    renderHistory();
  }
}

// Monitor Internet Connection
function updateConnectionStatus() {
  const badge = document.getElementById('connection-badge');
  const dot = badge.querySelector('.sync-dot');
  const text = badge.querySelector('.sync-status-text');
  
  if (navigator.onLine) {
    badge.className = 'sync-badge online';
    text.textContent = 'Online';
    // Auto sync when online
    syncPendingLogs();
  } else {
    badge.className = 'sync-badge offline';
    text.textContent = 'Offline';
  }
}

// ----------------------------------------------------
// UI Renderers
// ----------------------------------------------------

function parseProgramCSV(csvText) {
  if (!csvText || !csvText.trim()) return [];
  
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  
  function splitCSVLine(line) {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawRows = lines.map(splitCSVLine);

  let startIndex = 0;
  if (rawRows.length > 0) {
    const firstRowStr = rawRows[0].join(' ').toLowerCase();
    if (firstRowStr.includes('program') || firstRowStr.includes('exercise') || firstRowStr.includes('routine') || firstRowStr.includes('week')) {
      startIndex = 1;
    }
  }

  const programMap = {};

  for (let i = startIndex; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.length < 3) continue;

    const progName = row[0] || "Imported Program";
    const weekNum = parseInt(row[1]) || 1;
    const routineName = row[2] || `Week ${weekNum} Routine`;
    const dayType = row[3] || "Heavy";
    const exName = row[4] || "";
    const weight = parseFloat(row[5]) || 0;
    const setsCount = parseInt(row[6]) || 3;
    const reps = String(row[7] !== undefined ? row[7] : "8");
    const restTime = parseInt(row[8]) !== undefined && row[8] !== "" ? parseInt(row[8]) : 90;
    const notes = row[9] || "";

    if (!exName) continue;

    const pId = 'prog-' + progName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (!programMap[pId]) {
      programMap[pId] = {
        id: pId,
        name: progName,
        routinesMap: {}
      };
    }

    const rId = `rt-${pId}-w${weekNum}-${routineName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    if (!programMap[pId].routinesMap[rId]) {
      programMap[pId].routinesMap[rId] = {
        id: rId,
        weekNumber: weekNum,
        name: routineName,
        dayType: dayType,
        completed: false,
        completedAt: null,
        exercises: []
      };
    }

    programMap[pId].routinesMap[rId].exercises.push({
      name: exName,
      weight: weight,
      setsCount: setsCount,
      reps: reps,
      restTime: restTime,
      notes: notes
    });
  }

  return Object.values(programMap).map(p => ({
    id: p.id,
    name: p.name,
    routines: Object.values(p.routinesMap)
  }));
}

function startProgramRoutine(programId, routineId) {
  const program = state.programs.find(p => p.id === programId);
  if (!program) return;
  const routine = program.routines.find(r => r.id === routineId);
  if (!routine) return;

  if (state.activeSession) {
    if (!confirm("Starting a new session will discard your current active workout. Proceed?")) {
      return;
    }
    cancelActiveWorkout();
  }

  state.activeSession = {
    programId: program.id,
    routineId: routine.id,
    routineName: routine.name,
    name: routine.name,
    dayType: routine.dayType || "Heavy",
    date: getDefaultWorkoutDate(),
    weekNumber: routine.weekNumber !== undefined ? routine.weekNumber : getAutoWeekNumber(),
    checkCounter: 0,
    exercises: routine.exercises.map(ex => {
      const setsCount = ex.setsCount || 3;
      const repParts = String(ex.reps || "8").split(',').map(s => s.trim());
      const sets = [];
      const checkedSets = [];
      const completionOrders = [];

      for (let i = 0; i < setsCount; i++) {
        sets.push(repParts[i] !== undefined ? repParts[i] : (repParts[0] || "8"));
        checkedSets.push(false);
        completionOrders.push(null);
      }

      return {
        name: ex.name,
        weight: parseFloat(ex.weight) || 0,
        sets: sets,
        checked: checkedSets,
        completionOrders: completionOrders,
        prevSets: repParts,
        prevWeight: ex.weight,
        restTime: ex.restTime !== undefined ? ex.restTime : (parseInt(state.settings.restDuration) || 90),
        notes: ex.notes || ""
      };
    })
  };

  sessionSeconds = 0;
  resumeWorkoutSession();
}

function renderPrograms() {
  const cardContainer = document.getElementById('active-program-card-container');
  const routinesList = document.getElementById('program-routines-list');
  const weekFilterBar = document.getElementById('week-filter-container');
  
  if (!cardContainer || !routinesList) return;

  if (state.programs.length === 0) {
    cardContainer.innerHTML = `
      <div class="program-overview-card" style="text-align: center; padding: 24px;">
        <h3 style="margin-bottom: 8px; color: #fff;">No Active Program</h3>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Import a program CSV or pull your trainer's program from Google Sheets to get started.
        </p>
      </div>
    `;
    routinesList.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 30px 0;">No program routines available.</div>';
    if (weekFilterBar) weekFilterBar.innerHTML = '';
    return;
  }

  let activeProg = state.programs.find(p => p.id === state.activeProgramId);
  if (!activeProg) {
    activeProg = state.programs[0];
    state.activeProgramId = activeProg.id;
  }

  const totalRoutines = activeProg.routines.length;
  const completedRoutines = activeProg.routines.filter(r => r.completed).length;
  const percent = totalRoutines > 0 ? Math.round((completedRoutines / totalRoutines) * 100) : 0;

  let selectHTML = '';
  if (state.programs.length > 1) {
    selectHTML = `
      <select id="program-select-dropdown" class="form-input" style="margin-top: 10px; font-size: 13px; padding: 6px 12px;">
        ${state.programs.map(p => `<option value="${p.id}" ${p.id === activeProg.id ? 'selected' : ''}>${p.name}</option>`).join('')}
      </select>
    `;
  }

  cardContainer.innerHTML = `
    <div class="program-overview-card">
      <div class="program-header-row">
        <div>
          <div class="program-title">${activeProg.name}</div>
          <div class="program-meta">${totalRoutines} Routines • ${completedRoutines} Completed</div>
        </div>
        <span style="font-size: 22px; font-weight: 700; color: var(--primary);">${percent}%</span>
      </div>
      
      <div class="program-progress-section">
        <div class="program-progress-header">
          <span>Overall Program Progress</span>
          <span>${completedRoutines} / ${totalRoutines} Done</span>
        </div>
        <div class="program-progress-bar">
          <div class="program-progress-fill" style="width: ${percent}%;"></div>
        </div>
      </div>
      
      ${selectHTML}
    </div>
  `;

  if (document.getElementById('program-select-dropdown')) {
    document.getElementById('program-select-dropdown').addEventListener('change', (e) => {
      state.activeProgramId = e.target.value;
      localStorage.setItem('wrext_active_program_id', state.activeProgramId);
      renderPrograms();
      renderDashboard();
    });
  }

  const weeks = [...new Set(activeProg.routines.map(r => r.weekNumber || 1))].sort((a, b) => a - b);
  if (weekFilterBar) {
    weekFilterBar.innerHTML = '';
    const allChip = document.createElement('button');
    allChip.className = `week-tab-chip ${state.programWeekFilter === 'ALL' ? 'active' : ''}`;
    allChip.textContent = 'All Weeks';
    allChip.addEventListener('click', () => {
      state.programWeekFilter = 'ALL';
      renderPrograms();
    });
    weekFilterBar.appendChild(allChip);

    weeks.forEach(w => {
      const chip = document.createElement('button');
      chip.className = `week-tab-chip ${state.programWeekFilter == w ? 'active' : ''}`;
      chip.textContent = `Week ${w}`;
      chip.addEventListener('click', () => {
        state.programWeekFilter = w;
        renderPrograms();
      });
      weekFilterBar.appendChild(chip);
    });
  }

  let routinesToDisplay = activeProg.routines;
  if (state.programWeekFilter !== 'ALL') {
    routinesToDisplay = activeProg.routines.filter(r => (r.weekNumber || 1) == state.programWeekFilter);
  }

  routinesList.innerHTML = '';
  if (routinesToDisplay.length === 0) {
    routinesList.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 20px 0;">No routines found for this week.</div>';
    return;
  }

  routinesToDisplay.forEach(rt => {
    const card = document.createElement('div');
    card.className = `program-routine-card ${rt.completed ? 'completed' : ''}`;
    
    const statusBadge = rt.completed
      ? `<span class="program-routine-badge completed">✓ Completed ${rt.completedAt ? `(${rt.completedAt})` : ''}</span>`
      : `<span class="program-routine-badge pending">Pending</span>`;

    const actionButton = rt.completed
      ? `<button class="btn btn-secondary btn-start-program-rt" data-prog-id="${activeProg.id}" data-rt-id="${rt.id}" style="font-size: 13px; padding: 10px;">Restart Routine</button>`
      : `<button class="btn btn-primary btn-start-program-rt" data-prog-id="${activeProg.id}" data-rt-id="${rt.id}" style="font-size: 13px; padding: 12px;">Start Routine</button>`;

    card.innerHTML = `
      <div class="program-routine-header">
        <div>
          <span class="program-routine-week">Week ${rt.weekNumber || 1}</span>
          <div class="program-routine-title">${rt.name}</div>
        </div>
        ${statusBadge}
      </div>

      <div class="program-exercise-list">
        ${(rt.exercises || []).map(ex => `
          <div class="program-exercise-item">
            <span class="program-exercise-name">${ex.name}</span>
            <span class="program-exercise-spec">${ex.weight > 0 ? `${ex.weight}kg • ` : ''}${ex.setsCount || (ex.sets ? ex.sets.length : 3)} × ${ex.reps || 8}</span>
          </div>
        `).join('')}
      </div>

      ${actionButton}
    `;

    card.querySelector('.btn-start-program-rt').addEventListener('click', () => {
      startProgramRoutine(activeProg.id, rt.id);
    });

    routinesList.appendChild(card);
  });
}

function renderDashboardProgram() {
  const container = document.getElementById('dashboard-program-container');
  if (!container) return;

  if (state.programs.length === 0) {
    container.innerHTML = '';
    return;
  }

  const activeProg = state.programs.find(p => p.id === state.activeProgramId) || state.programs[0];
  if (!activeProg) {
    container.innerHTML = '';
    return;
  }

  const total = activeProg.routines.length;
  const completed = activeProg.routines.filter(r => r.completed).length;
  const nextRoutine = activeProg.routines.find(r => !r.completed) || activeProg.routines[0];
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  container.innerHTML = `
    <div class="card" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(0, 240, 255, 0.1)); border-color: rgba(0, 240, 255, 0.25); margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div>
          <span style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px;">Active Program</span>
          <div style="font-size: 16px; font-weight: 700; color: #fff; margin-top: 2px;">${activeProg.name}</div>
        </div>
        <span style="font-size: 13px; font-weight: 700; color: var(--primary);">${completed}/${total} (${percent}%)</span>
      </div>

      <div class="program-progress-bar" style="margin-bottom: 14px;">
        <div class="program-progress-fill" style="width: ${percent}%;"></div>
      </div>

      ${nextRoutine ? `
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 10px 12px; border-radius: 8px;">
          <div>
            <div style="font-size: 11px; color: var(--text-muted);">Next Scheduled Routine</div>
            <div style="font-size: 13px; font-weight: 600; color: #fff;">${nextRoutine.name}</div>
          </div>
          <button class="btn btn-primary" id="btn-dashboard-start-program-rt" style="width: auto; padding: 8px 14px; font-size: 12px;">
            Start
          </button>
        </div>
      ` : ''}
    </div>
  `;

  if (nextRoutine && document.getElementById('btn-dashboard-start-program-rt')) {
    document.getElementById('btn-dashboard-start-program-rt').addEventListener('click', () => {
      startProgramRoutine(activeProg.id, nextRoutine.id);
    });
  }
}

function renderDashboard() {
  // Render Active Program Card
  renderDashboardProgram();

  // Render Streak
  document.getElementById('streak-days').textContent = state.streak;
  
  // Render Sync Pending Status Card
  const pendingLogs = state.history.filter(log => !log.synced);
  const syncCard = document.getElementById('sync-status-card');
  const countSpan = document.getElementById('offline-logs-count');
  
  if (pendingLogs.length > 0) {
    syncCard.style.display = 'flex';
    countSpan.textContent = pendingLogs.length;
  } else {
    syncCard.style.display = 'none';
  }
  
  // Render Quick Start list (top routines)
  const listContainer = document.getElementById('dashboard-routine-list');
  listContainer.innerHTML = '';
  
  state.routines.slice(0, 3).forEach(routine => {
    const card = document.createElement('div');
    card.className = `card routine-card`;
    const typeClass = (routine.dayType || '').toLowerCase().includes('heavy') ? 'heavy' : 'volume';
    
    card.innerHTML = `
      <div class="routine-card-header">
        <span class="routine-name">${routine.name}</span>
        <span class="routine-tag ${typeClass}">${routine.dayType || 'Workout'}</span>
      </div>
      <div class="routine-details">
        ${routine.exercises.map(ex => ex.name).join(' • ')}
      </div>
    `;
    card.addEventListener('click', () => {
      startWorkoutSession(routine);
    });
    listContainer.appendChild(card);
  });
  
  // Render Recent Activity (max 3)
  const recentLogsList = document.getElementById('recent-logs-list');
  recentLogsList.innerHTML = '';
  
  if (state.history.length === 0) {
    recentLogsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 20px 0;">No logged workouts yet.</div>';
    return;
  }
  
  state.history.slice(0, 3).forEach(log => {
    const card = document.createElement('div');
    card.className = 'card log-card';
    const statusText = log.synced ? 'Synced' : 'Pending';
    const statusClass = log.synced ? 'synced' : 'pending';
    
    card.innerHTML = `
      <div class="log-header">
        <span class="log-title">${log.name}</span>
        <span class="log-date">${log.date}</span>
      </div>
      <div class="log-exercises-summary">
        ${log.exercises.map(ex => {
          const setsStr = ex.sets.filter(s => s !== "").join('/');
          return `<div style="margin-bottom: 2px;"><strong>${ex.name}</strong> (${ex.weight}kg): ${setsStr || 'No sets'}</div>`;
        }).join('')}
      </div>
      <div class="log-footer">
        <span style="font-size: 12px; color: var(--text-muted)">Duration: ${log.duration || '00:00'}</span>
        <span class="sync-indicator ${statusClass}">
          <span class="sync-dot"></span> ${statusText}
        </span>
      </div>
    `;
    recentLogsList.appendChild(card);
  });
}

function renderRoutines() {
  const container = document.getElementById('routines-list');
  container.innerHTML = '';
  
  state.routines.forEach(routine => {
    const card = document.createElement('div');
    card.className = 'card';
    const typeClass = (routine.dayType || '').toLowerCase().includes('heavy') ? 'heavy' : 'volume';
    
    card.innerHTML = `
      <div class="routine-card-header">
        <span class="routine-name">${routine.name}</span>
        <span class="routine-tag ${typeClass}">${routine.dayType || 'Workout'}</span>
      </div>
      <div class="routine-details" style="margin-bottom: 14px;">
        ${routine.exercises.map(ex => `${ex.name} (${ex.setsCount} sets)`).join(' • ')}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-primary btn-start-routine" style="padding: 10px 14px; font-size: 13px;">Start Session</button>
        <button class="btn btn-secondary btn-edit-routine" style="padding: 10px 14px; font-size: 13px; width: auto;">Edit</button>
        <button class="btn btn-danger btn-delete-routine" style="padding: 10px 14px; font-size: 13px; width: auto; aspect-ratio: 1; padding-left: 10px; padding-right: 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    
    card.querySelector('.btn-start-routine').addEventListener('click', () => {
      startWorkoutSession(routine);
    });
    card.querySelector('.btn-edit-routine').addEventListener('click', () => {
      openRoutineModal(routine);
    });
    card.querySelector('.btn-delete-routine').addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete the routine "${routine.name}"?`)) {
        state.routines = state.routines.filter(r => r.id !== routine.id);
        localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
        // Sync routines after deletion
        if (state.settings.sheetUrl) {
          (async () => {
            const res = await SheetsSyncService.syncRoutines(state.routines, state.settings);
            if (!res.success) {
              console.warn('Routines sync failed:', res.error);
            }
          })();
        }
        renderRoutines();
        renderDashboard();
      }
    });
    
    container.appendChild(card);
  });
}

function renderHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '';
  
  if (state.history.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 40px 0;">No logged workouts yet.</div>';
    return;
  }
  
  state.history.forEach((log, index) => {
    const card = document.createElement('div');
    card.className = 'card log-card';
    const statusText = log.synced ? 'Synced' : 'Pending Sync';
    const statusClass = log.synced ? 'synced' : 'pending';
    
    card.innerHTML = `
      <div class="log-header">
        <span class="log-title">${log.name}</span>
        <span class="log-date">${log.date}</span>
      </div>
      <div class="log-exercises-summary" style="margin-bottom: 12px;">
        ${log.exercises.map(ex => {
          const setsStr = ex.sets.filter(s => s !== "").join('/');
          const noteText = ex.notes ? `<div style="font-size: 11px; color: var(--text-dark); font-style: italic; margin-left: 8px;">Note: ${ex.notes}</div>` : '';
          return `
            <div style="margin-bottom: 6px;">
              <strong>${ex.name}</strong> (${ex.weight}kg): ${setsStr || 'No sets'}
              ${noteText}
            </div>
          `;
        }).join('')}
      </div>
      <div class="log-footer">
        <span style="font-size: 12px; color: var(--text-muted)">Duration: ${log.duration || '00:00'}</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="sync-indicator ${statusClass}">
            <span class="sync-dot"></span> ${statusText}
          </span>
          <button class="btn btn-danger btn-delete-log" style="width: auto; padding: 4px 8px; font-size: 11px; font-weight: 500;" data-index="${index}">Delete</button>
        </div>
      </div>
    `;
    
    card.querySelector('.btn-delete-log').addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      if (confirm(`Are you sure you want to delete this workout log from your history?`)) {
        state.history.splice(idx, 1);
        localStorage.setItem('wrext_history', JSON.stringify(state.history));
        renderHistory();
        renderDashboard();
      }
    });
    
    container.appendChild(card);
  });
}

function loadSettingsForm() {
  document.getElementById('settings-sheet-url').value = state.settings.sheetUrl || "";
  document.getElementById('settings-api-token').value = state.settings.apiToken || "";
  document.getElementById('settings-rest-timer').value = state.settings.restDuration || 90;
  document.getElementById('settings-sound-enabled').checked = state.settings.soundEnabled !== false;
}

// ----------------------------------------------------
// Active Workout Session Logic
// ----------------------------------------------------
let sessionTimerInterval = null;
let sessionSeconds = 0;

function startWorkoutSession(routine) {
  // Warn if session already active
  if (state.activeSession) {
    if (!confirm("Starting a new session will discard your current active workout. Proceed?")) {
      return;
    }
    cancelActiveWorkout();
  }
  
  // Clone the routine exercises into active state
  state.activeSession = {
    routineId: routine.id,
    name: routine.name,
    dayType: routine.dayType || "Other",
    date: getDefaultWorkoutDate(),
    weekNumber: getAutoWeekNumber(),
    checkCounter: 0, // Global counter for ordering checked sets
    exercises: routine.exercises.map(ex => {
      // Find previous history weights/reps for this exercise to prefill placeholders
      const prevData = getPreviousExercisePerformance(ex.name);
      
      const sets = [];
      const checkedSets = [];
      const completionOrders = [];
      for (let i = 0; i < ex.setsCount; i++) {
        // Prefill with history or default
        sets.push(prevData.reps[i] || "");
        checkedSets.push(false);
        completionOrders.push(null);
      }
      
      return {
        name: ex.name,
        weight: prevData.weight !== null ? prevData.weight : ex.weight,
        sets: sets,
        checked: checkedSets,
        completionOrders: completionOrders, // Order of completion tracking
        prevSets: prevData.reps,
        prevWeight: prevData.weight,
        restTime: ex.restTime !== undefined ? ex.restTime : (parseInt(state.settings.restDuration) || 90),
        notes: ""
      };
    })
  };
  
  sessionSeconds = 0;
  resumeWorkoutSession();
}

function resumeWorkoutSession() {
  switchView('view-active-workout');
  
  // Render Workout Title & Date
  document.getElementById('active-workout-name').textContent = state.activeSession.name;
  document.getElementById('active-workout-date-input').value = state.activeSession.date || getDefaultWorkoutDate();
  document.getElementById('active-workout-week-input').value = state.activeSession.weekNumber !== undefined ? state.activeSession.weekNumber : getAutoWeekNumber();
  
  renderActiveExercises();
  
  // Start Timer
  document.getElementById('active-workout-time').textContent = formatTime(sessionSeconds);
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(() => {
    sessionSeconds++;
    document.getElementById('active-workout-time').textContent = formatTime(sessionSeconds);
    // Save state on every timer increment for recovery
    state.activeSession.seconds = sessionSeconds;
    localStorage.setItem('wrext_active_session', JSON.stringify(state.activeSession));
  }, 1000);
}

// Prefill sets based on history logs
function getPreviousExercisePerformance(exerciseName) {
  const result = { weight: null, reps: [] };
  
  // Scan history logs backwards (most recent first)
  for (const log of state.history) {
    const match = log.exercises.find(ex => ex.name.toLowerCase() === exerciseName.toLowerCase());
    if (match) {
      result.weight = match.weight;
      result.reps = match.sets.filter(s => s !== "");
      break;
    }
  }
  return result;
}

function renderActiveExercises() {
  const container = document.getElementById('active-exercises-list');
  container.innerHTML = '';
  
  state.activeSession.exercises.forEach((ex, exIndex) => {
    const card = document.createElement('div');
    card.className = 'card exercise-card';
    
    card.innerHTML = `
      <div class="exercise-header">
        <div>
          <span class="exercise-title">${ex.name}</span>
        </div>
        <button class="btn-text danger btn-delete-exercise-active" style="width: auto; padding: 4px;">Remove</button>
      </div>
      
      <div class="form-group" style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
        <div style="flex: 1;">
          <label class="form-label" style="font-size: 11px;">Weight (kg)</label>
          <input type="number" class="form-input exercise-weight-input" value="${ex.weight}" step="0.25">
        </div>
        <div style="flex: 1;">
          <label class="form-label" style="font-size: 11px;">Rest (s)</label>
          <input type="number" class="form-input exercise-rest-input" value="${ex.restTime !== undefined ? ex.restTime : 90}" min="0" max="600">
        </div>
        <div style="flex: 2;">
          <label class="form-label" style="font-size: 11px;">Exercise-specific Notes</label>
          <input type="text" class="form-input exercise-notes-input" value="${ex.notes}" placeholder="Optional info">
        </div>
      </div>
      
      <div class="sets-table">
        <div class="sets-header">
          <span>Set</span>
          <span>Previous</span>
          <span>Target</span>
          <span>Reps</span>
          <span>Done</span>
        </div>
        <div class="sets-rows-container">
          <!-- Rendered below -->
        </div>
        
        <div class="add-set-row">
          <button class="btn-text btn-add-set-active">+ Add Set</button>
          <button class="btn-text danger btn-remove-set-active">- Remove Set</button>
        </div>
      </div>
    `;
    
    const rowsContainer = card.querySelector('.sets-rows-container');
    
    // Render individual sets
    ex.sets.forEach((repValue, setIndex) => {
      const isCompleted = ex.checked[setIndex];
      const prevVal = ex.prevSets && ex.prevSets[setIndex] !== undefined ? 
                      `${ex.prevSets[setIndex]} ${ex.prevWeight !== null ? `@${ex.prevWeight}kg` : ''}` : '-';
      
      const row = document.createElement('div');
      row.className = `set-row ${isCompleted ? 'completed' : ''}`;
      
      row.innerHTML = `
        <span class="set-num">${setIndex + 1}</span>
        <span class="set-prev">${prevVal}</span>
        <span class="set-prev" style="color: var(--text-muted); font-size: 13px;">${ex.prevSets[setIndex] || '-'}</span>
        <div class="set-input-wrap">
          <input type="text" class="set-input reps-input" value="${repValue}" inputmode="search" placeholder="0">
        </div>
        <div class="set-check-wrap">
          <div class="set-checkbox ${isCompleted ? 'checked' : ''}">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
        </div>
      `;
      
      // Update local set state when typing
      const repsInput = row.querySelector('.reps-input');
      repsInput.addEventListener('input', (e) => {
        ex.sets[setIndex] = e.target.value;
        saveActiveSessionLocal();
      });
      
      // Set Checkbox click listener
      const checkbox = row.querySelector('.set-checkbox');
      checkbox.addEventListener('click', () => {
        const checkState = !ex.checked[setIndex];
        ex.checked[setIndex] = checkState;
        
        if (checkState) {
          row.classList.add('completed');
          checkbox.classList.add('checked');
          
          // Increment global counter and track order
          state.activeSession.checkCounter = (state.activeSession.checkCounter || 0) + 1;
          ex.completionOrders[setIndex] = state.activeSession.checkCounter;
          
          // Auto start Rest Timer!
          if (ex.restTime !== 0) {
            startRestTimer(ex.restTime);
          }
        } else {
          row.classList.remove('completed');
          checkbox.classList.remove('checked');
          ex.completionOrders[setIndex] = null;
        }
        
        saveActiveSessionLocal();
      });
      
      rowsContainer.appendChild(row);
    });
    
    // Add / Remove Set handlers
    card.querySelector('.btn-add-set-active').addEventListener('click', () => {
      ex.sets.push("");
      ex.checked.push(false);
      if (!ex.completionOrders) ex.completionOrders = [];
      ex.completionOrders.push(null);
      renderActiveExercises();
      saveActiveSessionLocal();
    });
    
    card.querySelector('.btn-remove-set-active').addEventListener('click', () => {
      if (ex.sets.length > 1) {
        ex.sets.pop();
        ex.checked.pop();
        if (ex.completionOrders) ex.completionOrders.pop();
        renderActiveExercises();
        saveActiveSessionLocal();
      }
    });
    
    // Remove Exercise completely
    card.querySelector('.btn-delete-exercise-active').addEventListener('click', () => {
      if (confirm(`Remove "${ex.name}" from this workout?`)) {
        state.activeSession.exercises.splice(exIndex, 1);
        renderActiveExercises();
        saveActiveSessionLocal();
      }
    });
    
    // Update Weight, Rest & Notes
    card.querySelector('.exercise-weight-input').addEventListener('input', (e) => {
      ex.weight = parseFloat(e.target.value) || 0;
      saveActiveSessionLocal();
    });
    
    card.querySelector('.exercise-rest-input').addEventListener('input', (e) => {
      ex.restTime = parseInt(e.target.value) || 0;
      saveActiveSessionLocal();
    });
    
    card.querySelector('.exercise-notes-input').addEventListener('input', (e) => {
      ex.notes = e.target.value;
      saveActiveSessionLocal();
    });
    
    container.appendChild(card);
  });
}

function saveActiveSessionLocal() {
  if (state.activeSession) {
    // Read date and week number from DOM inputs
    state.activeSession.date = document.getElementById('active-workout-date-input').value;
    state.activeSession.weekNumber = parseInt(document.getElementById('active-workout-week-input').value) || getAutoWeekNumber();
    localStorage.setItem('wrext_active_session', JSON.stringify(state.activeSession));
  }
}

function cancelActiveWorkout() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  state.activeSession = null;
  localStorage.removeItem('wrext_active_session');
  switchView('view-dashboard');
}

// ----------------------------------------------------
// Rest Timer Logic
// ----------------------------------------------------
let timerInterval = null;
let timerSecondsRemaining = 0;
let timerTotalSeconds = 90;
let timerMinimized = false;

function startRestTimer(duration = null) {
  // Determine duration
  if (duration === null) {
    const customRest = parseInt(state.settings.restDuration);
    timerTotalSeconds = isNaN(customRest) ? 90 : customRest;
  } else {
    timerTotalSeconds = duration;
  }
  
  if (timerTotalSeconds <= 0) {
    return;
  }
  
  timerSecondsRemaining = timerTotalSeconds;
  timerMinimized = false;
  
  // Show timer overlay and hide minimized bar
  document.getElementById('timer-overlay').classList.add('active');
  document.getElementById('minimized-timer-bar').classList.remove('active');
  
  updateTimerUI();
  
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSecondsRemaining--;
    updateTimerUI();
    
    if (timerSecondsRemaining <= 0) {
      clearInterval(timerInterval);
      playTimerDoneChime();
      // Dismiss after short delay
      setTimeout(() => {
        closeRestTimer();
      }, 800);
    }
  }, 1000);
}

function updateTimerUI() {
  const minutes = Math.floor(timerSecondsRemaining / 60);
  const seconds = timerSecondsRemaining % 60;
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  document.getElementById('timer-countdown-text').textContent = timeStr;
  document.getElementById('minimized-timer-text').textContent = timeStr;
  
  // Update circular SVG progress
  const circle = document.getElementById('timer-circle-progress');
  const totalOffset = 502; // stroke-dasharray length
  const progressRatio = timerSecondsRemaining / timerTotalSeconds;
  const offset = totalOffset * (1 - progressRatio);
  
  circle.style.strokeDashoffset = isNaN(offset) ? 0 : offset;
}

function closeRestTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById('timer-overlay').classList.remove('active');
  document.getElementById('minimized-timer-bar').classList.remove('active');
  timerMinimized = false;
}

function minimizeRestTimer() {
  timerMinimized = true;
  document.getElementById('timer-overlay').classList.remove('active');
  document.getElementById('minimized-timer-bar').classList.add('active');
}

function expandRestTimer() {
  timerMinimized = false;
  document.getElementById('minimized-timer-bar').classList.remove('active');
  document.getElementById('timer-overlay').classList.add('active');
}

// ----------------------------------------------------
// Workout Log Completion & Sync
// ----------------------------------------------------
// Helper to clean exercise name for superset label
function getCleanExerciseName(name) {
  const lower = name.toLowerCase();
  if (lower.includes("pull-up")) return "Pull-ups";
  if (lower.includes("push-up")) return "Push-ups";
  if (lower.includes("squat")) return "Squats";
  if (lower.includes("raise")) return "Raises";
  if (lower.includes("hang")) return "Hangs";
  if (lower.includes("plank")) return "Plank";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Helper to get default category for exercise if not in a superset
function getDefaultCategory(name) {
  const lower = name.toLowerCase();
  if (lower.includes("pull-up")) return "Straight Sets";
  if (lower.includes("squat")) return "Legs";
  if (lower.includes("raise")) return "Core";
  if (lower.includes("plank")) return "Core";
  if (lower.includes("hang")) return "Finisher";
  if (lower.includes("repeater")) return "Grip Finisher";
  return "Straight Sets";
}

// Compute superset / category types for each exercise based on execution sequence
function computeSupersetTypes(exercises) {
  const exSpans = exercises.map((ex, index) => {
    const orders = (ex.completionOrders || []).filter(val => val !== null && val !== undefined);
    if (orders.length === 0) return null;
    return {
      index: index,
      name: ex.name,
      min: Math.min(...orders),
      max: Math.max(...orders),
      orders: orders
    };
  });

  return exercises.map((ex, i) => {
    const spanI = exSpans[i];
    if (!spanI) {
      return getDefaultCategory(ex.name);
    }

    const partners = [];
    exSpans.forEach((spanJ, j) => {
      if (j === i || !spanJ) return;
      if (spanI.min < spanJ.max && spanJ.min < spanI.max) {
        partners.push(spanJ.name);
      }
    });

    if (partners.length > 0) {
      const cleanSelf = getCleanExerciseName(ex.name);
      const cleanPartners = partners.map(getCleanExerciseName);
      const uniquePartners = [...new Set(cleanPartners)];
      const partnerStr = uniquePartners.join(' & ');

      if ((cleanSelf === "Pull-ups" && partnerStr === "Push-ups") || 
          (cleanSelf === "Push-ups" && partnerStr === "Pull-ups")) {
        return `Antagonist Superset (with ${partnerStr})`;
      }
      return `Superset (with ${partnerStr})`;
    } else {
      return getDefaultCategory(ex.name);
    }
  });
}

// ----------------------------------------------------
// Workout Log Completion & Sync
// ----------------------------------------------------
async function completeActiveWorkout() {
  if (!state.activeSession) return;
  
  // Read date and week number from form
  const finalDate = document.getElementById('active-workout-date-input').value;
  const finalWeekNumber = parseInt(document.getElementById('active-workout-week-input').value) || getAutoWeekNumber();
  
  // Compute superset types dynamically based on set check order
  const supersetTypes = computeSupersetTypes(state.activeSession.exercises);
  
  // Map exercises data, only keeping logs where sets have value
  const loggedExercises = [];
  
  state.activeSession.exercises.forEach((ex, exIdx) => {
    // Keep sets that are checked or contain a valid number
    const activeSets = [];
    ex.sets.forEach((setVal, index) => {
      // If checked or filled, log it
      if (ex.checked[index] || setVal !== "") {
        activeSets.push(setVal || "0");
      }
    });
    
    if (activeSets.length > 0) {
      loggedExercises.push({
        name: ex.name,
        weight: ex.weight,
        sets: activeSets,
        supersetType: supersetTypes[exIdx], // Automatically calculated
        notes: ex.notes
      });
    }
  });
  
  if (loggedExercises.length === 0) {
    alert("You haven't logged any sets. Please mark at least one set as completed.");
    return;
  }
  
  // Stop Session Timer
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  
  const workoutLog = {
    id: 'workout-' + Date.now(),
    name: state.activeSession.name,
    dayType: state.activeSession.dayType,
    date: finalDate,
    weekNumber: finalWeekNumber,
    duration: formatTime(sessionSeconds),
    exercises: loggedExercises,
    synced: false
  };
  
  // Calculate Streak increment
  updateStreak();
  
  // Append to history
  state.history.unshift(workoutLog);
  localStorage.setItem('wrext_history', JSON.stringify(state.history));

  // If this workout session belonged to a Program, mark routine completed in Program
  if (state.activeSession.programId && state.activeSession.routineId) {
    const prog = state.programs.find(p => p.id === state.activeSession.programId);
    if (prog) {
      const rt = prog.routines.find(r => r.id === state.activeSession.routineId);
      if (rt) {
        rt.completed = true;
        rt.completedAt = finalDate;
        localStorage.setItem('wrext_programs', JSON.stringify(state.programs));
        
        if (state.settings.sheetUrl) {
          (async () => {
            const progSync = await SheetsSyncService.syncPrograms(state.programs, state.settings);
            if (!progSync.success) {
              console.warn("Failed to sync program completion to sheet:", progSync.error);
            }
          })();
        }
      }
    }
  }
  
  // Clear Active Session
  state.activeSession = null;
  localStorage.removeItem('wrext_active_session');
  
  // Switch back to dashboard
  switchView('view-dashboard');
  
  // Trigger Sync
  showToast("Saving workout...", true);
  try {
    const syncRes = await SheetsSyncService.syncWorkout(workoutLog, state.settings);
    if (syncRes.success) {
      workoutLog.synced = true;
      localStorage.setItem('wrext_history', JSON.stringify(state.history));
      showToast("Synced to Google Sheets! 👍");
    } else {
      showToast("Workout saved offline (Sync failed). ⚠️");
    }
  } catch (err) {
    showToast("Saved offline. Setup sheet URL in settings.", false);
  }
  
  renderDashboard();
  renderPrograms();
  renderHistory();
}

function updateStreak() {
  const today = new Date().toDateString();
  
  if (!state.lastWorkoutDate) {
    state.streak = 1;
  } else {
    const lastDate = new Date(state.lastWorkoutDate);
    const timeDiff = Math.abs(new Date(today) - lastDate);
    const dayDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    
    if (dayDiff === 1) {
      // Consecutive days
      state.streak += 1;
    } else if (dayDiff > 3) {
      // Streak broken (missed more than 3 days)
      state.streak = 1;
    }
    // If dayDiff is 0 (workout on same day), streak remains unchanged
  }
  
  state.lastWorkoutDate = today;
  localStorage.setItem('wrext_streak', state.streak.toString());
  localStorage.setItem('wrext_last_workout_date', today);
}

// Sync all unsynced items in history
async function syncPendingLogs() {
  const pendingLogs = state.history.filter(log => !log.synced);
  if (pendingLogs.length === 0) return;
  
  if (!state.settings.sheetUrl) {
    console.log("[Sync] Cannot auto-sync, Web App URL not set.");
    return;
  }
  
  console.log(`[Sync] Found ${pendingLogs.length} unsynced workouts. Syncing now...`);
  
  let successCount = 0;
  for (let log of pendingLogs) {
    try {
      const res = await SheetsSyncService.syncWorkout(log, state.settings);
      if (res.success) {
        log.synced = true;
        successCount++;
      }
    } catch (err) {
      console.error("[Sync] Auto-sync failed for log:", log.id, err);
      break; // Halt sync queue loop if a network/config error is hit
    }
  }
  
  if (successCount > 0) {
    localStorage.setItem('wrext_history', JSON.stringify(state.history));
    showToast(`Successfully synced ${successCount} queued workouts!`);
    renderDashboard();
    renderHistory();
  }
}

// ----------------------------------------------------
// Routine Builder Modal Logic
// ----------------------------------------------------
let editingRoutineId = null;

function openRoutineModal(routine = null) {
  const modal = document.getElementById('routine-modal-overlay');
  const title = document.getElementById('routine-modal-title');
  const nameInput = document.getElementById('modal-routine-name');
  const dayTypeInput = document.getElementById('modal-routine-day-type');
  const exercisesContainer = document.getElementById('modal-exercises-list');
  
  exercisesContainer.innerHTML = '';
  
  if (routine) {
    editingRoutineId = routine.id;
    title.textContent = "Edit Routine";
    nameInput.value = routine.name;
    dayTypeInput.value = routine.dayType || "";
    
    routine.exercises.forEach(ex => {
      addExerciseFieldToModal(ex.name, ex.weight, ex.setsCount, ex.restTime !== undefined ? ex.restTime : 90);
    });
  } else {
    editingRoutineId = null;
    title.textContent = "Create Routine";
    nameInput.value = "";
    dayTypeInput.value = "Heavy";
    // Add one empty field by default
    addExerciseFieldToModal();
  }
  
  modal.classList.add('active');
}

function addExerciseFieldToModal(name = "", weight = 0, sets = 3, restTime = 90) {
  const container = document.getElementById('modal-exercises-list');
  const row = document.createElement('div');
  row.className = 'modal-exercise-row';
  row.style.background = 'rgba(255, 255, 255, 0.02)';
  row.style.padding = '12px';
  row.style.borderRadius = '8px';
  row.style.border = '1px solid var(--border-light)';
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.gap = '8px';
  row.style.position = 'relative';
  
  row.innerHTML = `
    <button class="modal-close btn-remove-modal-row" style="position: absolute; top: 6px; right: 8px; font-size: 16px; color: var(--error)">&times;</button>
    <div class="form-group" style="margin-bottom: 0;">
      <label class="form-label" style="font-size: 11px;">Name</label>
      <input type="text" class="form-input modal-ex-name" value="${name}" placeholder="e.g. Weighted Pull-up">
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: 11px;">Weight (kg)</label>
        <input type="number" class="form-input modal-ex-weight" value="${weight}" step="0.25">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: 11px;">Sets</label>
        <input type="number" class="form-input modal-ex-sets" value="${sets}" min="1" max="10">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: 11px;">Rest (s)</label>
        <input type="number" class="form-input modal-ex-rest" value="${restTime}" min="0" max="600">
      </div>
    </div>
  `;
  
  row.querySelector('.btn-remove-modal-row').addEventListener('click', () => {
    if (container.children.length > 1) {
      row.remove();
    } else {
      alert("A routine must have at least one exercise.");
    }
  });
  
  container.appendChild(row);
}

function saveRoutineFromModal() {
  const nameInput = document.getElementById('modal-routine-name');
  const dayTypeInput = document.getElementById('modal-routine-day-type');
  const exercisesContainer = document.getElementById('modal-exercises-list');
  
  const routineName = nameInput.value.trim();
  const dayType = dayTypeInput.value.trim();
  
  if (!routineName) {
    alert("Please enter a routine name.");
    return;
  }
  
  const exercises = [];
  const rows = exercisesContainer.querySelectorAll('.modal-exercise-row');
  
  let valid = true;
  rows.forEach(row => {
    const exName = row.querySelector('.modal-ex-name').value.trim();
    const exWeight = parseFloat(row.querySelector('.modal-ex-weight').value) || 0;
    const exSets = parseInt(row.querySelector('.modal-ex-sets').value) || 3;
    const exRest = parseInt(row.querySelector('.modal-ex-rest').value) !== undefined ? parseInt(row.querySelector('.modal-ex-rest').value) : 90;
    
    if (!exName) {
      alert("Please enter a name for all exercises.");
      valid = false;
      return;
    }
    
    exercises.push({
      name: exName,
      weight: exWeight,
      setsCount: exSets,
      restTime: exRest
    });
  });
  
  if (!valid) return;
  
  const routineData = {
    id: editingRoutineId || 'routine-' + Date.now(),
    name: routineName,
    dayType: dayType,
    exercises: exercises
  };
  
  if (editingRoutineId) {
    // Edit existing
    state.routines = state.routines.map(r => r.id === editingRoutineId ? routineData : r);
  } else {
    // Create new
    state.routines.push(routineData);
  }
  
  localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
  
  // Sync routines to Google Sheets
  if (state.settings.sheetUrl) {
    (async () => {
      const res = await SheetsSyncService.syncRoutines(state.routines, state.settings);
      if (!res.success) {
        console.warn('Routines sync failed:', res.error);
      }
    })();
  }
  
  // Close and refresh
  document.getElementById('routine-modal-overlay').classList.remove('active');
  renderRoutines();
  renderDashboard();
}

// ----------------------------------------------------
// Toast Notifications
// ----------------------------------------------------
let toastTimeout = null;
function showToast(message, persistant = false) {
  const toast = document.getElementById('toast-banner');
  const msg = document.getElementById('toast-message');
  
  msg.textContent = message;
  toast.classList.add('active');
  
  if (toastTimeout) clearTimeout(toastTimeout);
  if (!persistant) {
    toastTimeout = setTimeout(() => {
      toast.classList.remove('active');
    }, 4000);
  }
}

// ----------------------------------------------------
// UI Events Setup
// ----------------------------------------------------
function setupEventListeners() {
  // Sync Banner Manual Action
  document.getElementById('btn-sync-now').addEventListener('click', () => {
    showToast("Syncing queued workouts...", true);
    syncPendingLogs();
  });
  
  // Dismiss Toast button
  document.getElementById('btn-dismiss-toast').addEventListener('click', () => {
    document.getElementById('toast-banner').classList.remove('active');
  });
  
  // Pull from Sheet button
  document.getElementById('btn-pull-from-sheet').addEventListener('click', async () => {
    if (!state.settings.sheetUrl) {
      alert("Please configure your Google Sheets Web App URL in Settings first.");
      return;
    }
    
    showToast("Pulling workout history from Google Sheet...", true);
    
    const result = await SheetsSyncService.fetchHistory(
      state.settings.sheetUrl,
      state.settings.apiToken
    );
    
    if (!result.success) {
      showToast("Pull failed. Check settings.");
      alert("Failed to pull history: " + result.error);
      return;
    }
    
    if (result.workouts.length === 0) {
      showToast("No workouts found in your sheet.");
      return;
    }
    
    // Merge imported workouts into history, skipping duplicates
    const existingIds = new Set(state.history.map(h => h.id));
    // Also build a set of existing date+dayType combos for smarter dedup
    const existingKeys = new Set(state.history.map(h => `${h.date}|||${h.dayType}`));
    
    let importedCount = 0;
    result.workouts.forEach(w => {
      const key = `${w.date}|||${w.dayType}`;
      if (!existingIds.has(w.id) && !existingKeys.has(key)) {
        state.history.push(w);
        importedCount++;
      }
    });
    
    if (importedCount > 0) {
      // Sort history: most recent first (by reverse insertion order from sheet)
      localStorage.setItem('wrext_history', JSON.stringify(state.history));
      renderHistory();
      renderDashboard();
      showToast(`Imported ${importedCount} workouts from your sheet!`);
    } else {
      showToast("All sheet workouts are already in your history.");
    }
  });
  
  // Active timer trigger rest timer modal manually
  document.getElementById('active-timer-trigger').addEventListener('click', () => {
    startRestTimer();
  });
  
  // Complete / Cancel Active Session
  document.getElementById('btn-complete-workout').addEventListener('click', completeActiveWorkout);
  document.getElementById('btn-cancel-workout').addEventListener('click', () => {
    if (confirm("Cancel this workout? Your current active logs will be lost.")) {
      cancelActiveWorkout();
    }
  });
  
  // Add exercise to active session
  document.getElementById('btn-add-exercise').addEventListener('click', () => {
    document.getElementById('exercise-modal-overlay').classList.add('active');
  });
  
  document.getElementById('btn-close-exercise-modal').addEventListener('click', () => {
    document.getElementById('exercise-modal-overlay').classList.remove('active');
  });
  document.getElementById('btn-cancel-exercise-modal').addEventListener('click', () => {
    document.getElementById('exercise-modal-overlay').classList.remove('active');
  });
  
  document.getElementById('btn-save-exercise').addEventListener('click', () => {
    const name = document.getElementById('modal-exercise-name').value.trim();
    const weight = parseFloat(document.getElementById('modal-exercise-weight').value) || 0;
    const setsCount = parseInt(document.getElementById('modal-exercise-sets').value) || 3;
    const restTime = parseInt(document.getElementById('modal-exercise-rest').value) || 90;
    
    if (!name) {
      alert("Please enter an exercise name.");
      return;
    }
    
    if (state.activeSession) {
      const sets = [];
      const checkedSets = [];
      const completionOrders = [];
      for(let i=0; i<setsCount; i++) {
        sets.push("");
        checkedSets.push(false);
        completionOrders.push(null);
      }
      
      state.activeSession.exercises.push({
        name,
        weight,
        sets,
        checked: checkedSets,
        completionOrders: completionOrders,
        restTime,
        notes: ""
      });
      
      renderActiveExercises();
      saveActiveSessionLocal();
      
      // Reset inputs & close modal
      document.getElementById('modal-exercise-name').value = "";
      document.getElementById('modal-exercise-weight').value = "0";
      document.getElementById('modal-exercise-sets').value = "3";
      document.getElementById('modal-exercise-rest').value = "90";
      document.getElementById('exercise-modal-overlay').classList.remove('active');
    }
  });
  
  // Timer Controls
  document.getElementById('btn-timer-sub-30').addEventListener('click', () => {
    timerSecondsRemaining = Math.max(10, timerSecondsRemaining - 30);
    updateTimerUI();
  });
  document.getElementById('btn-timer-add-30').addEventListener('click', () => {
    timerSecondsRemaining = Math.min(600, timerSecondsRemaining + 30);
    timerTotalSeconds += 30; // expand total duration to keep ratio accurate
    updateTimerUI();
  });
  document.getElementById('btn-timer-skip').addEventListener('click', closeRestTimer);
  document.getElementById('btn-timer-minimize').addEventListener('click', minimizeRestTimer);
  
  // Minimized Timer Controls
  document.getElementById('btn-timer-mini-add-30').addEventListener('click', () => {
    timerSecondsRemaining = Math.min(600, timerSecondsRemaining + 30);
    timerTotalSeconds += 30;
    updateTimerUI();
  });
  document.getElementById('btn-timer-mini-skip').addEventListener('click', closeRestTimer);
  document.getElementById('btn-timer-mini-expand').addEventListener('click', expandRestTimer);
  
  // Routine Modals Close
  document.getElementById('btn-close-routine-modal').addEventListener('click', () => {
    document.getElementById('routine-modal-overlay').classList.remove('active');
  });
  document.getElementById('btn-cancel-routine-modal').addEventListener('click', () => {
    document.getElementById('routine-modal-overlay').classList.remove('active');
  });
  document.getElementById('btn-save-routine').addEventListener('click', saveRoutineFromModal);
  document.getElementById('btn-modal-add-exercise-field').addEventListener('click', () => {
    addExerciseFieldToModal();
  });
  
  // Routine creation triggers
  document.getElementById('btn-create-routine').addEventListener('click', () => {
    openRoutineModal();
  });

  // CSV Import Modal & Programs Triggers
  const updateCSVPreview = () => {
    const text = document.getElementById('csv-text-input').value;
    const previewContainer = document.getElementById('csv-preview-container');
    if (!previewContainer) return;
    
    const parsed = parseProgramCSV(text);
    if (parsed.length > 0) {
      previewContainer.style.display = 'block';
      let totalRoutines = 0;
      let totalExercises = 0;
      parsed.forEach(p => {
        totalRoutines += p.routines.length;
        p.routines.forEach(r => { totalExercises += r.exercises.length; });
      });
      previewContainer.innerHTML = `
        <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">CSV Preview: ${parsed[0].name}</div>
        <div class="csv-preview-stat">Programs: <strong>${parsed.length}</strong></div>
        <div class="csv-preview-stat">Routines: <strong>${totalRoutines}</strong></div>
        <div class="csv-preview-stat">Exercises: <strong>${totalExercises}</strong></div>
      `;
    } else {
      previewContainer.style.display = 'none';
    }
  };

  if (document.getElementById('btn-import-csv-modal')) {
    document.getElementById('btn-import-csv-modal').addEventListener('click', () => {
      document.getElementById('csv-modal-overlay').classList.add('active');
      updateCSVPreview();
    });
  }

  if (document.getElementById('btn-close-csv-modal')) {
    document.getElementById('btn-close-csv-modal').addEventListener('click', () => {
      document.getElementById('csv-modal-overlay').classList.remove('active');
    });
  }

  if (document.getElementById('btn-cancel-csv-modal')) {
    document.getElementById('btn-cancel-csv-modal').addEventListener('click', () => {
      document.getElementById('csv-modal-overlay').classList.remove('active');
    });
  }

  if (document.getElementById('csv-file-input')) {
    document.getElementById('csv-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('csv-text-input').value = event.target.result;
        updateCSVPreview();
      };
      reader.readAsText(file);
    });
  }

  if (document.getElementById('csv-text-input')) {
    document.getElementById('csv-text-input').addEventListener('input', updateCSVPreview);
  }

  if (document.getElementById('btn-save-imported-csv')) {
    document.getElementById('btn-save-imported-csv').addEventListener('click', async () => {
      const text = document.getElementById('csv-text-input').value;
      const parsed = parseProgramCSV(text);

      if (parsed.length === 0) {
        alert("Unable to parse CSV. Please ensure the CSV contains rows with: Program Name, Week, Routine Name, Day Type, Exercise Name, Weight, Sets, Reps, Rest, Notes.");
        return;
      }

      parsed.forEach(prog => {
        const existingIdx = state.programs.findIndex(p => p.id === prog.id || p.name.toLowerCase() === prog.name.toLowerCase());
        if (existingIdx >= 0) {
          state.programs[existingIdx] = prog;
        } else {
          state.programs.push(prog);
        }
      });

      state.activeProgramId = parsed[0].id;
      localStorage.setItem('wrext_programs', JSON.stringify(state.programs));
      localStorage.setItem('wrext_active_program_id', state.activeProgramId);

      document.getElementById('csv-modal-overlay').classList.remove('active');
      showToast(`Imported ${parsed.length} program(s) successfully!`);

      if (state.settings.sheetUrl) {
        showToast("Syncing imported programs to Google Sheet...", true);
        const syncRes = await SheetsSyncService.syncPrograms(state.programs, state.settings);
        if (syncRes.success) {
          showToast("Programs synced to Google Sheet Programs tab! 👍");
        } else {
          showToast("Saved locally (Sheet sync failed). ⚠️");
        }
      }

      renderPrograms();
      renderDashboard();
    });
  }

  if (document.getElementById('btn-pull-programs-sheet')) {
    document.getElementById('btn-pull-programs-sheet').addEventListener('click', async () => {
      if (!state.settings.sheetUrl) {
        alert("Please configure your Google Sheets Web App URL in Settings first.");
        return;
      }

      showToast("Pulling programs from Google Sheet...", true);
      const res = await SheetsSyncService.fetchPrograms(state.settings.sheetUrl, state.settings.apiToken);

      if (res.success && res.programs && res.programs.length > 0) {
        state.programs = res.programs;
        if (!state.activeProgramId && state.programs[0]) {
          state.activeProgramId = state.programs[0].id;
        }
        localStorage.setItem('wrext_programs', JSON.stringify(state.programs));
        renderPrograms();
        renderDashboard();
        showToast(`Successfully pulled ${state.programs.length} program(s) from sheet!`);
      } else {
        alert(res.error || "No programs found in Google Sheet Programs tab.");
        showToast("Pull failed or no program rows found.");
      }
    });
  }
  
  // Settings Form listeners
  document.getElementById('settings-sheet-url').addEventListener('change', (e) => {
    state.settings.sheetUrl = e.target.value.trim();
    localStorage.setItem('wrext_settings', JSON.stringify(state.settings));
  });
  
  document.getElementById('settings-api-token').addEventListener('change', (e) => {
    state.settings.apiToken = e.target.value.trim();
    localStorage.setItem('wrext_settings', JSON.stringify(state.settings));
  });
  
  document.getElementById('settings-rest-timer').addEventListener('change', (e) => {
    state.settings.restDuration = parseInt(e.target.value) || 90;
    localStorage.setItem('wrext_settings', JSON.stringify(state.settings));
  });
  
  document.getElementById('settings-sound-enabled').addEventListener('change', (e) => {
    state.settings.soundEnabled = e.target.checked;
    localStorage.setItem('wrext_settings', JSON.stringify(state.settings));
  });
  
  // Test Settings endpoint
  document.getElementById('btn-test-connection').addEventListener('click', async () => {
    const url = document.getElementById('settings-sheet-url').value.trim();
    const token = document.getElementById('settings-api-token').value.trim();
    
    if (!url) {
      alert("Please configure an Apps Script URL first.");
      return;
    }
    
    showToast("Testing connection...", true);
    const testRes = await SheetsSyncService.testConnection(url, token);
    if (testRes.success) {
      alert(testRes.message);
      showToast("Sheets endpoint connection verified!");
    } else {
      alert(testRes.error);
      showToast("Connection failed. Check settings.");
    }
  });
  
  // Reset App
  document.getElementById('btn-reset-app').addEventListener('click', () => {
    if (confirm("WARNING: This will delete all routines, history, streaks, and settings from this browser. This cannot be undone. Proceed?")) {
      localStorage.clear();
      state = {
        settings: { sheetUrl: "", apiToken: "", restDuration: 90, soundEnabled: true },
        routines: [...DEFAULT_ROUTINES],
        history: [],
        activeSession: null,
        streak: 0,
        lastWorkoutDate: null
      };
      localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
      
      loadSettingsForm();
      renderDashboard();
      renderRoutines();
      renderHistory();
      switchView('view-dashboard');
      alert("Application database has been reset.");
    }
  });
  
  // Export Data (Backup)
  document.getElementById('btn-export-data').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `wrext_backup_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
  });
  
  // Import Data (Restore)
  document.getElementById('btn-import-data').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const importedState = JSON.parse(event.target.result);
        if (importedState.settings && importedState.routines && importedState.history) {
          state = importedState;
          localStorage.setItem('wrext_settings', JSON.stringify(state.settings));
          localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
          localStorage.setItem('wrext_history', JSON.stringify(state.history));
          localStorage.setItem('wrext_streak', (state.streak || 0).toString());
          if (state.lastWorkoutDate) localStorage.setItem('wrext_last_workout_date', state.lastWorkoutDate);
          
          loadSettingsForm();
          renderDashboard();
          renderRoutines();
          renderHistory();
          alert("Backup data imported successfully!");
        } else {
          alert("Invalid backup file structure.");
        }
      } catch (err) {
        alert("Failed to parse backup JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  });
}

// ----------------------------------------------------
// Page load initialization
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', initApp);
