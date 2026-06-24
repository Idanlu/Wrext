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

// Default routines based on the user's spreadsheet logs
const DEFAULT_ROUTINES = [
  {
    id: "default-heavy",
    name: "Heavy Day (Monday)",
    dayType: "Heavy",
    exercises: [
      { name: "Weighted Pull-up", weight: 20, setsCount: 3 },
      { name: "Deep Push-ups", weight: 0, setsCount: 3 },
      { name: "Hanging Knee Raises", weight: 0, setsCount: 3 },
      { name: "Active Hang", weight: 0, setsCount: 2 }
    ]
  },
  {
    id: "default-volume",
    name: "Volume Day (Wednesday)",
    dayType: "Volume",
    exercises: [
      { name: "Weighted Pull-up", weight: 15, setsCount: 4 },
      { name: "Cossack Squats", weight: 7, setsCount: 3 },
      { name: "Plank", weight: 0, setsCount: 2 }
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

// Helper: Get formatted date string for inputs (e.g., "Mon (W1)") or calendar fallback
function getDefaultWorkoutDate() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const dayName = days[now.getDay()];
  
  // Calculate approximate week cycle if they have history
  let weekNum = 1;
  if (state.history.length > 0) {
    // Basic auto-increment or keep it simple
    const lastLog = state.history[0];
    const match = lastLog.date.match(/W(\d+)/);
    if (match) {
      weekNum = parseInt(match[1]);
      // If last log was Wed and today is Mon, maybe increment week
      if (lastLog.date.includes('Wed') && dayName === 'Mon') {
        weekNum += 1;
      }
    }
  }
  return `${dayName} (W${weekNum})`;
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
  } else {
    state.routines = [...DEFAULT_ROUTINES];
    localStorage.setItem('wrext_routines', JSON.stringify(state.routines));
  }
  
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
  renderHistory();
  loadSettingsForm();
  
  // Check if active session was saved (crash prevention)
  const savedSession = localStorage.getItem('wrext_active_session');
  if (savedSession) {
    if (confirm("You have an unsaved active workout session. Would you like to resume?")) {
      state.activeSession = JSON.parse(savedSession);
      // Migration: clean up legacy supersetType from active session exercises
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
  // If a session is active and user navigates away, allow it but keep warning
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

function renderDashboard() {
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
  document.getElementById('active-workout-date-input').value = state.activeSession.date;
  
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
          startRestTimer();
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
    
    // Update Weight & Notes
    card.querySelector('.exercise-weight-input').addEventListener('input', (e) => {
      ex.weight = parseFloat(e.target.value) || 0;
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
    // Read the date from the DOM input
    state.activeSession.date = document.getElementById('active-workout-date-input').value;
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

function startRestTimer(duration = null) {
  // Determine duration
  if (duration === null) {
    const customRest = parseInt(state.settings.restDuration);
    timerTotalSeconds = isNaN(customRest) ? 90 : customRest;
  } else {
    timerTotalSeconds = duration;
  }
  
  timerSecondsRemaining = timerTotalSeconds;
  
  // Show timer overlay
  const overlay = document.getElementById('timer-overlay');
  overlay.classList.add('active');
  
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
  document.getElementById('timer-countdown-text').textContent = 
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  // Update circular SVG progress
  const circle = document.getElementById('timer-circle-progress');
  const totalOffset = 502; // stroke-dasharray length
  const progressRatio = timerSecondsRemaining / timerTotalSeconds;
  const offset = totalOffset * (1 - progressRatio);
  
  circle.style.strokeDashoffset = isNaN(offset) ? 0 : offset;
}

function closeRestTimer() {
  if (timerInterval) clearInterval(timerInterval);
  document.getElementById('timer-overlay').classList.remove('active');
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
  
  // Read date from form
  const finalDate = document.getElementById('active-workout-date-input').value;
  
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
    duration: formatTime(sessionSeconds),
    exercises: loggedExercises,
    synced: false
  };
  
  // Calculate Streak increment
  updateStreak();
  
  // Append to history
  state.history.unshift(workoutLog);
  localStorage.setItem('wrext_history', JSON.stringify(state.history));
  
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
      addExerciseFieldToModal(ex.name, ex.weight, ex.setsCount);
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

function addExerciseFieldToModal(name = "", weight = 0, sets = 3) {
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
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: 11px;">Default Weight (kg)</label>
        <input type="number" class="form-input modal-ex-weight" value="${weight}" step="0.25">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: 11px;">Default Sets</label>
        <input type="number" class="form-input modal-ex-sets" value="${sets}" min="1" max="10">
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
    
    if (!exName) {
      alert("Please enter a name for all exercises.");
      valid = false;
      return;
    }
    
    exercises.push({
      name: exName,
      weight: exWeight,
      setsCount: exSets
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
        notes: ""
      });
      
      renderActiveExercises();
      saveActiveSessionLocal();
      
      // Reset inputs & close modal
      document.getElementById('modal-exercise-name').value = "";
      document.getElementById('modal-exercise-weight').value = "0";
      document.getElementById('modal-exercise-sets').value = "3";
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
