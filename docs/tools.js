(() => {
  const TEAMS_KEY = 'waterboys.teams';
  const ROSTERS_KEY = 'waterboys.rosters';
  const MODE_KEY = 'waterboys.inputMode';
  const SCHEMA_VERSION = 1;

  // Position groups: forwards, defense, goalie.
  const POSITIONS = ['LW', 'C', 'RW', 'LD', 'RD', 'G'];
  const POSITION_GROUP = { LW: 'F', C: 'F', RW: 'F', LD: 'D', RD: 'D', G: 'G' };
  const groupOf = (pos) => POSITION_GROUP[pos] || 'F';

  const $ = (id) => document.getElementById(id);
  const q = (sel, root = document) => root.querySelector(sel);
  const qq = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    teams: [],
    rosters: [],
    currentTeamId: null,
    currentRoster: null,
    poolFilter: 'ALL',
    dirty: false,
    inputMode: 'tap', // 'tap' | 'drag'
    picker: null      // { slotKey, label, showAll }
  };

  const els = {
    toolsBtn: $('tools-btn'),
    loginView: $('login-view'),
    menuView: $('tools-menu-view'),
    teamsView: $('tools-teams-view'),
    rosterView: $('tools-roster-view'),
    header: $('app-header'),
    browserView: $('browser-view'),
    openTeams: $('open-teams-btn'),
    openRoster: $('open-roster-btn'),
    backLogin: $('tools-back-login'),
    importBtn: $('import-btn'),
    exportBtn: $('export-btn'),
    importFile: $('import-file'),
    newTeamBtn: $('new-team-btn'),
    teamsList: $('teams-list'),
    teamDetail: $('team-detail'),
    rosterTeamSelect: $('roster-team-select'),
    rosterDate: $('roster-date'),
    rosterTitle: $('roster-title'),
    savedStrip: $('saved-rosters-strip'),
    playerPool: $('player-pool'),
    forwardLines: $('forward-lines'),
    defenseLines: $('defense-lines'),
    addForwardLine: $('add-forward-line'),
    addDefenseLine: $('add-defense-line'),
    saveRosterBtn: $('save-roster-btn'),
    exportPdfBtn: $('export-pdf-btn'),
    deleteRosterBtn: $('delete-roster-btn'),
    dirtyFlag: $('roster-dirty-flag'),
    pickerOverlay: $('picker-overlay'),
    pickerTitle: $('picker-title'),
    pickerList: $('picker-list'),
    pickerClose: $('picker-close'),
    pickerClear: $('picker-clear')
  };

  // Bail if the login page hasn't rendered the Tools button (e.g. running on
  // a page that doesn't include the Tools UI markup).
  if (!els.toolsBtn) return;

  // ---------- persistence ----------

  function load() {
    try {
      state.teams = JSON.parse(localStorage.getItem(TEAMS_KEY) || '[]');
      state.rosters = JSON.parse(localStorage.getItem(ROSTERS_KEY) || '[]');
    } catch {
      state.teams = [];
      state.rosters = [];
    }
    migratePositions();
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === 'drag' || savedMode === 'tap') state.inputMode = savedMode;
  }

  // Legacy players had position "F" or "D". Widen those into a concrete slot so
  // the new dropdown has a valid selection.
  function migratePositions() {
    let changed = false;
    for (const t of state.teams) {
      for (const p of t.players) {
        if (p.position === 'F') { p.position = 'C'; changed = true; }
        else if (p.position === 'D') { p.position = 'LD'; changed = true; }
        else if (!POSITIONS.includes(p.position)) { p.position = 'C'; changed = true; }
      }
    }
    if (changed) saveTeams();
  }

  function saveMode() {
    localStorage.setItem(MODE_KEY, state.inputMode);
  }

  function saveTeams() {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(state.teams));
  }

  function saveRosters() {
    localStorage.setItem(ROSTERS_KEY, JSON.stringify(state.rosters));
  }

  // ---------- utilities ----------

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const todayISO = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60 * 1000);
    return local.toISOString().slice(0, 10);
  };

  const findTeam = (id) => state.teams.find((t) => t.id === id) || null;
  const findPlayer = (teamId, playerId) => {
    const t = findTeam(teamId);
    return t ? t.players.find((p) => p.id === playerId) || null : null;
  };

  // ---------- view switching ----------

  function showOnly(view) {
    for (const v of [els.loginView, els.menuView, els.teamsView, els.rosterView, els.browserView]) {
      if (v) v.hidden = v !== view;
    }
    if (els.header) els.header.hidden = view !== els.browserView;
    window.scrollTo(0, 0);
  }

  function showMenu() { showOnly(els.menuView); }
  function showLogin() { showOnly(els.loginView); }
  function showTeams() { renderTeams(); showOnly(els.teamsView); }
  function showRoster() { renderRosterBuilder(); showOnly(els.rosterView); }

  // ---------- Tools menu ----------

  els.toolsBtn.addEventListener('click', showMenu);
  els.backLogin.addEventListener('click', showLogin);
  els.openTeams.addEventListener('click', showTeams);
  els.openRoster.addEventListener('click', showRoster);

  qq('[data-nav="tools-menu"]').forEach((btn) => btn.addEventListener('click', showMenu));

  // ---------- Import / Export ----------

  els.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      teams: state.teams,
      rosters: state.rosters
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waterboys-hockey-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    els.importFile.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      alert('That file is not valid JSON.');
      return;
    }
    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.rosters)) {
      alert('That file does not look like an exported Waterboys backup (missing teams/rosters).');
      return;
    }
    const ok = confirm(
      `Import ${parsed.teams.length} team${parsed.teams.length === 1 ? '' : 's'} ` +
      `and ${parsed.rosters.length} roster${parsed.rosters.length === 1 ? '' : 's'}? ` +
      `This will replace ALL current data.`
    );
    if (!ok) return;
    state.teams = parsed.teams;
    state.rosters = parsed.rosters;
    saveTeams();
    saveRosters();
    alert('Imported.');
  });

  // ---------- Manage Teams ----------

  function renderTeams() {
    els.teamsList.innerHTML = '';
    if (state.teams.length === 0) {
      els.teamsList.innerHTML = '<li class="empty-state">No teams yet.</li>';
    } else {
      for (const t of state.teams) {
        const li = document.createElement('li');
        li.className = 'team-list-item' + (t.id === state.currentTeamId ? ' active' : '');
        li.innerHTML = `<span>${escapeHtml(t.name)}</span><small>${t.players.length} player${t.players.length === 1 ? '' : 's'}</small>`;
        li.addEventListener('click', () => { state.currentTeamId = t.id; renderTeams(); });
        els.teamsList.appendChild(li);
      }
    }
    renderTeamDetail();
  }

  function renderTeamDetail() {
    const team = findTeam(state.currentTeamId);
    if (!team) {
      els.teamDetail.innerHTML = '<div class="empty-state" id="team-empty">Select or create a team to manage its roster.</div>';
      return;
    }
    els.teamDetail.innerHTML = `
      <div class="panel-head">
        <input type="text" class="team-name-input" value="${escapeHtml(team.name)}" aria-label="Team name" />
        <button type="button" class="danger-btn" id="delete-team-btn">Delete Team</button>
      </div>
      <table class="players-table">
        <thead>
          <tr><th>#</th><th>Name</th><th>Pos</th><th></th></tr>
        </thead>
        <tbody id="players-tbody"></tbody>
      </table>
      <button type="button" id="add-player-btn" class="small-btn">+ Add Player</button>
    `;
    const nameInput = q('.team-name-input', els.teamDetail);
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (!v) { nameInput.value = team.name; return; }
      team.name = v;
      saveTeams();
      renderTeams();
    });
    q('#delete-team-btn', els.teamDetail).addEventListener('click', () => {
      if (!confirm(`Delete team "${team.name}" and its ${team.players.length} player${team.players.length === 1 ? '' : 's'}? This also removes any saved rosters for this team.`)) return;
      state.teams = state.teams.filter((t) => t.id !== team.id);
      state.rosters = state.rosters.filter((r) => r.teamId !== team.id);
      state.currentTeamId = null;
      saveTeams();
      saveRosters();
      renderTeams();
    });
    q('#add-player-btn', els.teamDetail).addEventListener('click', () => {
      team.players.push({ id: uuid(), name: '', number: '', position: 'C' });
      saveTeams();
      renderTeamDetail();
    });
    renderPlayersTable(team);
  }

  function renderPlayersTable(team) {
    const tbody = q('#players-tbody', els.teamDetail);
    tbody.innerHTML = '';
    if (team.players.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No players yet. Click "+ Add Player" to add one.</td></tr>';
      return;
    }
    for (const p of team.players) {
      const tr = document.createElement('tr');
      const posOptions = POSITIONS.map((v) => `<option value="${v}"${p.position === v ? ' selected' : ''}>${v}</option>`).join('');
      tr.innerHTML = `
        <td><input type="number" min="0" max="99" value="${escapeHtml(p.number)}" data-field="number" aria-label="Number" /></td>
        <td><input type="text" value="${escapeHtml(p.name)}" data-field="name" placeholder="Player name" aria-label="Name" /></td>
        <td>
          <select data-field="position" aria-label="Position">${posOptions}</select>
        </td>
        <td><button type="button" class="danger-btn small" data-action="delete-player" aria-label="Delete player">✕</button></td>
      `;
      qq('[data-field]', tr).forEach((input) => {
        input.addEventListener('change', () => {
          p[input.dataset.field] = input.dataset.field === 'number'
            ? (input.value === '' ? '' : Number(input.value))
            : input.value;
          saveTeams();
          renderTeams();
        });
      });
      q('[data-action="delete-player"]', tr).addEventListener('click', () => {
        if (!confirm(`Remove ${p.name || 'this player'}?`)) return;
        team.players = team.players.filter((x) => x.id !== p.id);
        saveTeams();
        renderTeamDetail();
      });
      tbody.appendChild(tr);
    }
  }

  els.newTeamBtn.addEventListener('click', () => {
    const name = prompt('Team name?');
    if (!name || !name.trim()) return;
    const team = { id: uuid(), name: name.trim(), players: [] };
    state.teams.push(team);
    state.currentTeamId = team.id;
    saveTeams();
    renderTeams();
  });

  // ---------- Roster Builder ----------

  function blankRoster(teamId, date) {
    return {
      id: uuid(),
      teamId,
      date,
      forwardLines: [[null, null, null]],
      defenseLines: [[null, null]],
      goalies: { primary: null, alternate: null }
    };
  }

  function findRoster(teamId, date) {
    return state.rosters.find((r) => r.teamId === teamId && r.date === date) || null;
  }

  function ensureCurrentRoster() {
    const teamId = els.rosterTeamSelect.value;
    const date = els.rosterDate.value;
    if (!teamId || !date) { state.currentRoster = null; return; }
    state.currentRoster = findRoster(teamId, date) || blankRoster(teamId, date);
    state.dirty = false;
  }

  function markDirty() {
    state.dirty = true;
    els.dirtyFlag.hidden = false;
  }

  function markClean() {
    state.dirty = false;
    els.dirtyFlag.hidden = true;
  }

  function renderRosterBuilder() {
    // populate team dropdown
    const prevTeam = els.rosterTeamSelect.value;
    els.rosterTeamSelect.innerHTML = state.teams.length
      ? state.teams.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')
      : '<option value="">(no teams — create one first)</option>';
    if (prevTeam && findTeam(prevTeam)) els.rosterTeamSelect.value = prevTeam;
    if (!els.rosterDate.value) els.rosterDate.value = todayISO();

    ensureCurrentRoster();
    updateModeButtons();
    renderRosterTitle();
    renderSavedStrip();
    renderPlayerPool();
    renderLines();
    renderGoalies();
    markClean();
  }

  function renderRosterTitle() {
    const team = findTeam(els.rosterTeamSelect.value);
    if (!team || !els.rosterDate.value) {
      els.rosterTitle.textContent = '';
      return;
    }
    els.rosterTitle.textContent = `${team.name} — ${els.rosterDate.value}`;
  }

  function renderSavedStrip() {
    const teamId = els.rosterTeamSelect.value;
    els.savedStrip.innerHTML = '';
    const forTeam = state.rosters
      .filter((r) => r.teamId === teamId)
      .sort((a, b) => b.date.localeCompare(a.date));
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'saved-roster-chip new';
    newBtn.textContent = '+ New';
    newBtn.addEventListener('click', () => {
      els.rosterDate.value = todayISO();
      ensureCurrentRoster();
      state.currentRoster = blankRoster(teamId, els.rosterDate.value);
      renderLines();
      renderGoalies();
      renderRosterTitle();
      renderSavedStrip();
      markClean();
    });
    els.savedStrip.appendChild(newBtn);
    for (const r of forTeam) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'saved-roster-chip' + (state.currentRoster && r.id === state.currentRoster.id ? ' active' : '');
      chip.textContent = r.date;
      chip.addEventListener('click', () => {
        if (state.dirty && !confirm('Discard unsaved changes and load this roster?')) return;
        els.rosterDate.value = r.date;
        state.currentRoster = r;
        renderLines();
        renderGoalies();
        renderRosterTitle();
        renderSavedStrip();
        markClean();
      });
      els.savedStrip.appendChild(chip);
    }
  }

  els.rosterTeamSelect.addEventListener('change', () => {
    if (state.dirty && !confirm('Discard unsaved changes and switch team?')) {
      // revert to previous selection
      if (state.currentRoster) els.rosterTeamSelect.value = state.currentRoster.teamId;
      return;
    }
    ensureCurrentRoster();
    renderRosterTitle();
    renderSavedStrip();
    renderPlayerPool();
    renderLines();
    renderGoalies();
    markClean();
  });

  els.rosterDate.addEventListener('change', () => {
    if (state.dirty && !confirm('Discard unsaved changes and switch date?')) {
      if (state.currentRoster) els.rosterDate.value = state.currentRoster.date;
      return;
    }
    ensureCurrentRoster();
    renderRosterTitle();
    renderSavedStrip();
    renderLines();
    renderGoalies();
    markClean();
  });

  qq('.filter-btn', els.rosterView).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.poolFilter = btn.dataset.filter;
      qq('.filter-btn', els.rosterView).forEach((b) => b.classList.toggle('active', b === btn));
      renderPlayerPool();
    });
  });

  qq('.mode-btn', els.rosterView).forEach((btn) => {
    btn.addEventListener('click', () => {
      state.inputMode = btn.dataset.mode;
      saveMode();
      updateModeButtons();
      renderPlayerPool();
      renderLines();
      renderGoalies();
    });
  });

  function updateModeButtons() {
    qq('.mode-btn', els.rosterView).forEach((b) => b.classList.toggle('active', b.dataset.mode === state.inputMode));
    els.rosterView.classList.toggle('mode-tap', state.inputMode === 'tap');
    els.rosterView.classList.toggle('mode-drag', state.inputMode === 'drag');
  }

  // ---------- Picker (tap mode) ----------

  function openPicker(slotEl) {
    if (!state.currentRoster) return;
    const team = findTeam(state.currentRoster.teamId);
    if (!team) return;
    const slotKey = slotEl.dataset.slot;
    const isGoalie = slotKey.startsWith('goalie');
    const label = isGoalie
      ? (slotKey === 'goalie-primary' ? 'Primary Goalie' : 'Alternate Goalie')
      : (slotEl.dataset.label || 'Player');
    // Exact position for this slot (LW/C/RW/LD/RD/G) and the broader group (F/D/G).
    const exact = isGoalie ? 'G' : (slotEl.dataset.label || null);
    const group = isGoalie ? 'G' : (POSITION_GROUP[exact] || 'ALL');
    state.picker = { slotKey, label, exact, group };
    renderPicker();
    els.pickerOverlay.hidden = false;
  }

  function closePicker() {
    els.pickerOverlay.hidden = true;
    state.picker = null;
  }

  function currentPlacements() {
    // Map of playerId → array of human-readable placement labels for the current roster.
    const r = state.currentRoster;
    const out = new Map();
    const add = (pid, where) => {
      if (!pid) return;
      if (!out.has(pid)) out.set(pid, []);
      out.get(pid).push(where);
    };
    r.forwardLines.forEach((line, i) => {
      const labels = ['LW', 'C', 'RW'];
      line.forEach((pid, j) => add(pid, `Line ${i + 1} ${labels[j]}`));
    });
    r.defenseLines.forEach((line, i) => {
      const labels = ['LD', 'RD'];
      line.forEach((pid, j) => add(pid, `D-Line ${i + 1} ${labels[j]}`));
    });
    add(r.goalies.primary, 'Primary G');
    add(r.goalies.alternate, 'Alternate G');
    return out;
  }

  function renderPicker() {
    const p = state.picker;
    if (!p) return;
    const team = findTeam(state.currentRoster.teamId);
    els.pickerTitle.textContent = `Choose ${p.label}`;
    const placements = currentPlacements();
    const players = team.players.slice();

    // Tier 1: exact position match (e.g. picking LW → LW-tagged players).
    // Tier 2: same group (e.g. LW → C, RW).
    // Tier 3: off-position — always shown, just sorted last.
    const tier = (pl) => {
      if (p.exact && pl.position === p.exact) return 1;
      if (p.group === 'ALL' || groupOf(pl.position) === p.group) return 2;
      return 3;
    };
    const list = players.slice().sort((a, b) => tier(a) - tier(b));

    els.pickerList.innerHTML = '';
    if (list.length === 0) {
      els.pickerList.innerHTML = `<li class="empty-state">No players on this team yet. Add some in Manage Teams.</li>`;
      return;
    }
    let lastTier = null;
    for (const pl of list) {
      const t = tier(pl);
      if (t !== lastTier) {
        const header = document.createElement('li');
        header.className = 'picker-section';
        header.textContent = t === 1 ? `Preferred ${p.exact}` : (t === 2 ? `Other ${p.group === 'G' ? 'Goalies' : (p.group === 'F' ? 'Forwards' : 'Defense')}` : 'Off-position');
        els.pickerList.appendChild(header);
        lastTier = t;
      }
      const placed = placements.get(pl.id) || [];
      const li = document.createElement('li');
      li.className = 'picker-item' + (placed.length ? ' placed' : '') + (t === 3 ? ' off-position' : '');
      li.innerHTML = `
        <span class="num">${escapeHtml(pl.number)}</span>
        <span class="name">${escapeHtml(pl.name || '(no name)')}</span>
        <span class="pos-badge group-${groupOf(pl.position)}">${pl.position}</span>
        ${placed.length ? `<span class="placement-badge">${escapeHtml(placed.join(' · '))}</span>` : ''}
      `;
      li.addEventListener('click', () => {
        setSlotPlayer(p.slotKey, pl.id);
        markDirty();
        renderLines();
        renderGoalies();
        closePicker();
      });
      els.pickerList.appendChild(li);
    }
  }

  els.pickerClose.addEventListener('click', closePicker);
  els.pickerOverlay.addEventListener('click', (e) => {
    if (e.target === els.pickerOverlay) closePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.picker) closePicker();
  });
  els.pickerClear.addEventListener('click', () => {
    if (!state.picker) return;
    setSlotPlayer(state.picker.slotKey, null);
    markDirty();
    renderLines();
    renderGoalies();
    closePicker();
  });

  function renderPlayerPool() {
    const team = findTeam(els.rosterTeamSelect.value);
    els.playerPool.innerHTML = '';
    if (!team || team.players.length === 0) {
      els.playerPool.innerHTML = '<li class="empty-state">No players. Add some in Manage Teams.</li>';
      return;
    }
    const filtered = state.poolFilter === 'ALL'
      ? team.players
      : team.players.filter((p) => p.position === state.poolFilter);
    for (const p of filtered) {
      const chip = document.createElement('li');
      chip.className = `player-chip pos-${p.position} group-${groupOf(p.position)}`;
      chip.dataset.playerId = p.id;
      chip.innerHTML = `<span class="num">${escapeHtml(p.number)}</span><span class="name">${escapeHtml(p.name || '(no name)')}</span><span class="pos-tag">${p.position}</span>`;
      els.playerPool.appendChild(chip);
    }
    // Drag source is only active in drag mode.
    if (state.inputMode === 'drag' && window.Sortable) {
      new window.Sortable(els.playerPool, {
        group: { name: 'players', pull: 'clone', put: false },
        sort: false,
        animation: 150,
        delay: 100,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        ghostClass: 'chip-ghost'
      });
    }
  }

  function renderLines() {
    const r = state.currentRoster;
    els.forwardLines.innerHTML = '';
    els.defenseLines.innerHTML = '';
    if (!r) return;
    r.forwardLines.forEach((line, i) => renderLineRow(els.forwardLines, 'forward', i, line, ['LW', 'C', 'RW']));
    r.defenseLines.forEach((line, i) => renderLineRow(els.defenseLines, 'defense', i, line, ['LD', 'RD']));
  }

  function renderLineRow(container, kind, index, line, labels) {
    const row = document.createElement('div');
    row.className = 'line-row';
    const num = document.createElement('div');
    num.className = 'line-num';
    num.textContent = String(index + 1);
    row.appendChild(num);
    const slots = document.createElement('div');
    slots.className = 'line-slots';
    for (let i = 0; i < labels.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slot = `${kind}:${index}:${i}`;
      slot.dataset.label = labels[i];
      const pid = line[i];
      if (pid) {
        const p = findPlayer(state.currentRoster.teamId, pid);
        if (p) slot.appendChild(makeChip(p));
      }
      slots.appendChild(slot);
    }
    row.appendChild(slots);
    if (kind === 'forward' ? state.currentRoster.forwardLines.length > 1 : state.currentRoster.defenseLines.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'line-remove';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', 'Remove line');
      removeBtn.addEventListener('click', () => {
        if (kind === 'forward') state.currentRoster.forwardLines.splice(index, 1);
        else state.currentRoster.defenseLines.splice(index, 1);
        markDirty();
        renderLines();
      });
      row.appendChild(removeBtn);
    }
    container.appendChild(row);
    qq('.slot', row).forEach(wireSlot);
  }

  function renderGoalies() {
    for (const key of ['goalie-primary', 'goalie-alternate']) {
      const slot = q(`.slot[data-slot="${key}"]`);
      slot.innerHTML = '';
      const r = state.currentRoster;
      if (!r) continue;
      const pid = key === 'goalie-primary' ? r.goalies.primary : r.goalies.alternate;
      if (pid) {
        const p = findPlayer(r.teamId, pid);
        if (p) slot.appendChild(makeChip(p));
      }
      wireSlot(slot);
    }
  }

  function makeChip(player) {
    const chip = document.createElement('div');
    chip.className = `player-chip placed pos-${player.position} group-${groupOf(player.position)}`;
    chip.dataset.playerId = player.id;
    chip.innerHTML = `<span class="num">${escapeHtml(player.number)}</span><span class="name">${escapeHtml(player.name || '(no name)')}</span>`;
    // In drag mode a click on a filled slot clears it. In tap mode the slot itself
    // opens the picker (handled by the slot's click listener); don't also fire here.
    return chip;
  }

  function wireSlot(slot) {
    if (state.inputMode === 'drag') {
      if (!window.Sortable) return;
      new window.Sortable(slot, {
        group: { name: 'players', pull: false, put: true },
        animation: 150,
        onAdd: (evt) => {
          const dropped = evt.item;
          const playerId = dropped.dataset.playerId;
          slot.innerHTML = '';
          const player = findPlayer(state.currentRoster.teamId, playerId);
          if (player) slot.appendChild(makeChip(player));
          setSlotPlayer(slot.dataset.slot, playerId);
          markDirty();
        }
      });
      // Drag mode: click filled chip to clear.
      slot.addEventListener('click', (e) => {
        const chip = e.target.closest('.player-chip');
        if (!chip) return;
        setSlotPlayer(slot.dataset.slot, null);
        slot.innerHTML = '';
        markDirty();
      });
    } else {
      // Tap mode: click anywhere on slot opens picker.
      slot.addEventListener('click', () => openPicker(slot));
    }
  }

  function setSlotPlayer(slotKey, playerId) {
    const r = state.currentRoster;
    if (!r) return;
    if (slotKey === 'goalie-primary') { r.goalies.primary = playerId; return; }
    if (slotKey === 'goalie-alternate') { r.goalies.alternate = playerId; return; }
    const [kind, i, j] = slotKey.split(':');
    const arr = kind === 'forward' ? r.forwardLines : r.defenseLines;
    arr[Number(i)][Number(j)] = playerId;
  }

  els.addForwardLine.addEventListener('click', () => {
    if (!state.currentRoster) return;
    state.currentRoster.forwardLines.push([null, null, null]);
    markDirty();
    renderLines();
  });

  els.addDefenseLine.addEventListener('click', () => {
    if (!state.currentRoster) return;
    state.currentRoster.defenseLines.push([null, null]);
    markDirty();
    renderLines();
  });

  els.saveRosterBtn.addEventListener('click', () => {
    const r = state.currentRoster;
    if (!r) return;
    const idx = state.rosters.findIndex((x) => x.teamId === r.teamId && x.date === r.date);
    if (idx >= 0) state.rosters[idx] = r;
    else state.rosters.push(r);
    saveRosters();
    markClean();
    renderSavedStrip();
  });

  els.deleteRosterBtn.addEventListener('click', () => {
    const r = state.currentRoster;
    if (!r) return;
    if (!confirm(`Delete the roster for ${r.date}?`)) return;
    state.rosters = state.rosters.filter((x) => !(x.teamId === r.teamId && x.date === r.date));
    saveRosters();
    ensureCurrentRoster();
    renderLines();
    renderGoalies();
    renderSavedStrip();
    markClean();
  });

  els.exportPdfBtn.addEventListener('click', () => exportRosterPdf());

  // ---------- PDF export ----------

  async function exportRosterPdf() {
    const r = state.currentRoster;
    if (!r) return;
    const team = findTeam(r.teamId);
    if (!team) return;
    if (!window.jspdf || !window.html2canvas) {
      alert('PDF libraries did not load. Reload the page and try again.');
      return;
    }
    const rinkEl = q('.rink-panel', els.rosterView);
    // temporarily add print class for cleaner render (light background)
    rinkEl.classList.add('for-pdf');
    let canvas;
    try {
      canvas = await window.html2canvas(rinkEl, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true
      });
    } finally {
      rinkEl.classList.remove('for-pdf');
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text(`${team.name} — ${r.date}`, margin, margin + 8);

    // Fit image within available width, leaving room for PK / goals.
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    // Cap the image height so we leave room below.
    const maxImgH = pageH - margin * 2 - 220;
    const drawH = Math.min(imgH, maxImgH);
    const drawW = (canvas.width * drawH) / canvas.height <= imgW
      ? (canvas.width * drawH) / canvas.height
      : imgW;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin + 20, drawW, drawH);

    // Penalty Killers box + Goals table
    let y = margin + 20 + drawH + 24;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('Penalty Killers', margin, y);
    y += 6;
    pdf.setDrawColor(120);
    pdf.rect(margin, y, pageW - margin * 2, 60);
    y += 60 + 20;

    pdf.text('Goals', margin, y);
    y += 6;
    const goalsBoxW = pageW - margin * 2;
    const goalsBoxH = pageH - margin - y;
    pdf.rect(margin, y, goalsBoxW, goalsBoxH);
    // Column header row
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Player', margin + 8, y + 14);
    pdf.text('Time', margin + goalsBoxW - 80, y + 14);
    pdf.setDrawColor(200);
    // Horizontal ruled lines for writing
    const rowH = 18;
    for (let ry = y + 22; ry + rowH < y + goalsBoxH; ry += rowH) {
      pdf.line(margin + 4, ry, margin + goalsBoxW - 4, ry);
    }
    // Column separator
    pdf.line(margin + goalsBoxW - 90, y + 4, margin + goalsBoxW - 90, y + goalsBoxH - 4);

    const filename = `${team.name.replace(/\s+/g, '_')}-${r.date}.pdf`;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      // iOS Safari: opening the blob in a new tab so the user can share/save.
      const blobUrl = URL.createObjectURL(pdf.output('blob'));
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } else {
      pdf.save(filename);
    }
  }

  // ---------- boot ----------

  load();
})();
