function validateHazard(low, fever, high, interval) {
    low = truncateTemp(low);
    fever = truncateTemp(fever);
    high = truncateTemp(high);
    const { lowLimit: lowName, feverLimit: feverName, highFeverLimit: highName, maxIntervalMinutes: gapName } = hazardLabels;
    const f = value => `${value.toFixed(1)}°F`;
    const invalid = message => ({ valid: false, message });
    const missing = [[lowName, low], [feverName, fever], [highName, high], [gapName, interval]].filter(([, value]) => !Number.isFinite(value)).map(([name]) => name);
    if (missing.length) return invalid(`${missing.join(' and ')} must be ${missing.length > 1 ? 'valid numbers' : 'a valid number'}, but ${missing.length > 1 ? 'those fields are' : 'that field is'} empty or not numeric.`);
    const outOfRange = [[lowName, low], [feverName, fever], [highName, high]].filter(([, value]) => value < 90 || value > 106).map(([name, value]) => `${name} (${f(value)}) must be between 90.0°F and 106.0°F.`);
    if (outOfRange.length) return invalid(outOfRange.join('\n'));
    const tooClose = [];
    if (fever - low < 1) tooClose.push(`${feverName} (${f(fever)}) must be at least 1.0°F higher than ${lowName} (${f(low)}). The difference is ${f(fever - low)}.`);
    if (high - fever < 1) tooClose.push(`${highName} (${f(high)}) must be at least 1.0°F higher than ${feverName} (${f(fever)}). The difference is ${f(high - fever)}.`);
    if (tooClose.length) return invalid(tooClose.join('\n'));
    if (!Number.isInteger(interval)) return invalid(`${gapName} (${interval} min) must be a whole number of minutes.`);
    if (interval < 1 || interval > 1440) return invalid(`${gapName} (${interval} min) must be between 1 and 1440 minutes (24 hours).`);
    return { valid: true, value: { lowLimit: low, feverLimit: fever, highFeverLimit: high, maxIntervalMinutes: interval } };
}
function saveHazard(event) {
    const input = event.target;
    const key = hazardKeys.get(input);
    if (!key) return;
    const raw = input.value.trim() === '' ? NaN : Number(input.value);
    exclusive(async () => {
        const next = { ...hazard, [key]: raw };
        const result = validateHazard(next.lowLimit, next.feverLimit, next.highFeverLimit, next.maxIntervalMinutes);
        if (!result.valid) {
            input.value = hazard[key];
            return alert(`❌ ${result.message}\n\nYour entry was not accepted. ${hazardLabels[key]} has been restored to its previous value: ${key === 'maxIntervalMinutes' ? `${hazard[key]} min` : `${hazard[key].toFixed(1)}°F`}.`);
        }
        input.value = result.value[key];
        await applyHazard(result.value);
    });
}
function cleanHazard(stored) {
    const result = stored ? validateHazard(Number(stored.lowLimit), Number(stored.feverLimit), Number(stored.highFeverLimit), Number(stored.maxIntervalMinutes)) : { valid: false };
    return result.valid ? result.value : { ...DEFAULT_HAZARD };
}
function cleanRecords(list) {
    if (!Array.isArray(list)) return [];
    const toISO = value => {
        if (value == null || value === '') return null;
        const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return list.map(record => ({ temperature: Number(record && record.temperature), recorded_on: toISO(record && record.recorded_on) })).filter(record => record.temperature >= 90 && record.temperature <= 106 && record.recorded_on);
}
function fillHazardInputs() {
    hazardKeys.forEach((key, input) => { if (input !== document.activeElement) input.value = hazard[key]; });
    const v = (value, cls) => `<b class = '${cls}'>${value.toFixed(1)}°F</b>`;
    const lo = v(hazard.lowLimit, 'hv-low'), fe = v(hazard.feverLimit, 'hv-fever'), hi = v(hazard.highFeverLimit, 'hv-high');
    hazardSummary.innerHTML = `<span class = 'hz-low'>Dangerously low: below ${lo}</span> · <span class = 'hz-normal'>Normal: ${lo} to below ${fe}</span> · <span class = 'hz-fever'>Fever: ${fe} to below ${hi}</span> · <span class = 'hz-high'>High fever: ${hi} and above.</span>\nReadings expected within <b class = 'hv-gap'>${hazard.maxIntervalMinutes} min</b> of each other`;
}
function getTemperatureClass(temperature) {
    if (temperature < hazard.lowLimit) return 'temperature-low';
    if (temperature < hazard.feverLimit) return 'temperature-normal';
    if (temperature < hazard.highFeverLimit) return 'temperature-fever';
    return 'temperature-danger';
}
function parseInputDateTime(dateValue, timeValue) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeValue);
    if (!d || !t) return null;
    const date = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] || 0));
    return Number.isNaN(date.getTime()) ? null : date;
}
function addTemperatureRecord() {
    const validation = validateTemperature(temperatureInput.value.trim());
    if (!validation.valid) {
        alert(`❌ ${validation.message}`);
        temperatureInput.focus();
        return;
    }
    let recordedOn = new Date();
    if (currentRecordMode === 'past') {
        recordedOn = parseInputDateTime(pastDateInput.value, pastTimeInput.value);
        if (!recordedOn) return alert('❌ Please select both a date and a time for the past reading.');
        if (recordedOn > new Date()) return alert('❌ A past reading cannot be in the future.');
    }
    clearRecordInputs();
    const newRecord = { temperature: validation.value, recorded_on: recordedOn.toISOString() };
    exclusive(async () => {
        temperatureRecords.push(newRecord);
        sortRecords();
        if (!(await saveAll())) temperatureRecords.splice(temperatureRecords.indexOf(newRecord), 1);
    });
}
function validateTemperature(value) {
    if (value === '') return { valid: false, message: 'Please enter a temperature.' };
    const temperature = Number(value);
    if (!Number.isFinite(temperature)) return { valid: false, message: 'Temperature must be a valid number.' };
    if (temperature < 90) return { valid: false, message: `Invalid temperature: ${temperature}°F is outside the valid range of 90.0°F to 106.0°F, so it cannot be recorded.\n\n⚠️ A reading this low suggests moderate to severe hypothermia (core body temperature below about 90°F / 32°C), or a measuring or typing error.\n\nCommon causes (often unintentional): staying too long in the cold, wind or rain; wet clothing; falling into cold water; sleeping outdoors or in a very cold room; alcohol or drugs; very young or old age; low food intake; thyroid problems; and severe infection (sepsis).\n\nHow it feels and what it does: it starts with intense shivering, numb hands and feet, and cold, pale skin. As it worsens, the shivering stops, thinking slows, speech slurs, balance and coordination are lost, and the person can feel very sleepy or strangely calm without realising how serious it is. The heartbeat and breathing become slow and irregular. Below about 82°F / 28°C, unconsciousness, dangerous heart rhythms and cardiac arrest can occur.\n\nHow dangerous: this is a life-threatening emergency and it can be fatal, especially if the person is not warmed and treated quickly.\n\n🚨 Seek emergency medical help immediately instead of logging this reading. While help is on the way, move the person somewhere warm and dry, remove any wet clothing, wrap them in blankets and handle them gently. If you may have mistyped the value, correct it and try again, but if the reading is real or the person seems unwell, do not delay getting help.` };
    if (temperature > 106) return { valid: false, message: `Invalid temperature: ${temperature}°F is outside the valid range of 90.0°F to 106.0°F, so it cannot be recorded.\n\n⚠️ A reading this high suggests hyperpyrexia (core body temperature above about 106°F / 41.1°C), an extreme and life-threatening fever or heat illness, or a measuring or typing error.\n\nCommon causes (often unintentional): heat stroke from hot weather, a hot room or a parked car; hard exercise without enough fluids; too much clothing in the heat; severe infection (sepsis); reactions to certain drugs or medicines, such as stimulants; thyroid storm; and brain injury or stroke.\n\nHow it feels and what it does: the person feels burning hot, weak and dizzy, with a pounding headache, nausea and a racing heart. The skin can be flushed and, in heat stroke, dry with no sweating. Confusion, agitation, hallucinations and seizures follow, and then fainting or coma. At this level the body's proteins and cells begin to break down, harming the brain, heart, kidneys, liver and muscles and stopping the blood from clotting properly.\n\nHow dangerous: this is a life-threatening emergency. It can cause permanent organ damage and can be fatal, and the risk rises with every minute the temperature stays this high.\n\n🚨 Seek emergency medical help immediately instead of logging this reading. While help is on the way, move the person somewhere cool, remove excess clothing and cool them with damp cloths, fans or cool water. Give nothing by mouth unless they are fully alert. If you may have mistyped the value, correct it and try again, but if the reading is real or the person seems unwell, do not delay getting help.` };
    return { valid: true, value: truncateTemp(temperature) };
}
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
}
function formatTime(date) {
    const hours = String(date.getHours() % 12 || 12).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds} ${date.getHours() >= 12 ? 'pm' : 'am'}`;
}
function destroyTemperatureChart() {
    if (temperatureChart) {
        temperatureChart.destroy();
        temperatureChart = null;
    }
}
function renderTemperatureChart() {
    destroyTemperatureChart();
    if (!temperatureRecords.length || typeof Chart === 'undefined') return;
    const step = hazard.maxIntervalMinutes * 60000;
    const points = temperatureRecords.map(record => ({ x: new Date(record.recorded_on).getTime(), y: Number(record.temperature) }));
    const first = points[0].x;
    const last = points[points.length - 1].x;
    const firstDate = new Date(first);
    const anchor = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate()).getTime();
    const start = anchor + (Math.ceil((first - anchor) / step) - 1) * step;
    const end = anchor + (Math.floor((last - anchor) / step) + 1) * step;
    temperatureChart = new Chart(temperatureChartCanvas.getContext('2d'), {
        type: 'line', data: { datasets: [{ label: 'Temperature (°F)', data: points, borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, tension: 0.25, fill: false }] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'nearest', axis: 'x' }, plugins: {
                legend: { display: true }, tooltip: { callbacks: { title: items => { const date = new Date(items[0].parsed.x); return `${formatDate(date)} ${formatTime(date)}`; }, label: context => ` Temperature: ${context.parsed.y.toFixed(1)}°F` } },
                zoom: { limits: { x: { min: start, max: end, minRange: 60000 } }, pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode: 'x' } }
            }, scales: {
                x: {
                    type: 'linear', min: start, max: end, title: { display: true, text: 'Date / Time' },
                    afterBuildTicks: scale => { const stride = step * Math.max(1, Math.ceil((scale.max - scale.min) / step / 20)); const ticks = []; for (let value = anchor + Math.ceil((scale.min - anchor) / stride) * stride; value <= scale.max; value += stride) ticks.push({ value }); scale.ticks = ticks; },
                    ticks: { maxRotation: 45, minRotation: 0, callback: value => { const date = new Date(value); return [formatDate(date), formatTime(date)]; } }
                }, y: { title: { display: true, text: 'Temperature (°F)' }, suggestedMin: 90, suggestedMax: 106 }
            }
        }
    });
}
function renderSummary() {
    totalRecordings.textContent = temperatureRecords.length;
    if (temperatureRecords.length === 0) {
        lowestTemperature.textContent = '—';
        highestTemperature.textContent = '—';
        noGraphData.classList.remove('hidden');
        temperatureChartContainer.classList.add('hidden');
        destroyTemperatureChart();
        return;
    }
    const values = temperatureRecords.map(record => Number(record.temperature));
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    lowestTemperature.textContent = `${lowest.toFixed(1)}°F`;
    highestTemperature.textContent = `${highest.toFixed(1)}°F`;
    lowestTemperature.className = `stat-value ${getTemperatureClass(lowest)}`;
    highestTemperature.className = `stat-value ${getTemperatureClass(highest)}`;
    noGraphData.classList.add('hidden');
    temperatureChartContainer.classList.remove('hidden');
    renderTemperatureChart();
}
function getIntervalInformation(index) {
    if (index === 0) return { text: '—', className: 'interval-first' };
    const current = new Date(temperatureRecords[index].recorded_on);
    const previous = new Date(temperatureRecords[index - 1].recorded_on);
    const differenceMinutes = Math.round((current - previous) / 60000);
    const hours = Math.floor(differenceMinutes / 60);
    const minutes = differenceMinutes % 60;
    const text = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return { text, className: differenceMinutes <= hazard.maxIntervalMinutes ? 'interval-good' : 'interval-bad' };
}
function renderDateFilter() {
    const keys = [...new Set(temperatureRecords.map(record => dateKey(new Date(record.recorded_on))))].sort().reverse();
    if (selectedDate !== 'all' && !keys.includes(selectedDate)) selectedDate = 'all';
    dateFilterSelect.innerHTML = '';
    dateFilterSelect.add(new Option('All dates', 'all'));
    keys.forEach(key => { const [y, m, d] = key.split('-'); dateFilterSelect.add(new Option(`${d}/${m}/${y}`, key)); });
    dateFilterSelect.value = selectedDate;
}
function renderRecords() {
    recordsTableBody.innerHTML = '';
    const total = temperatureRecords.length;
    dateFilterRow.classList.toggle('hidden', total === 0);
    if (total === 0) {
        recordCountBadge.textContent = '0 Records';
        emptyRecords.classList.remove('hidden');
        recordsTableWrapper.classList.add('hidden');
        return;
    }
    const visible = temperatureRecords.map((record, index) => ({ record, index })).filter(({ record }) => selectedDate === 'all' || dateKey(new Date(record.recorded_on)) === selectedDate);
    recordCountBadge.textContent = selectedDate === 'all' ? `${total} ${total === 1 ? 'Record' : 'Records'}` : `${visible.length} of ${total} Records`;
    emptyRecords.classList.add('hidden');
    recordsTableWrapper.classList.remove('hidden');
    visible.forEach(({ record, index }) => {
        const date = new Date(record.recorded_on);
        const temperature = Number(record.temperature);
        const interval = getIntervalInformation(index);
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => deleteRecord(record);
        const row = document.createElement('tr');
        row.append(makeCell(index + 1, 'serial-cell'), makeCell(makeBadge(`temperature-badge ${getTemperatureClass(temperature)}`, `${temperature.toFixed(1)}°F`)), makeCell(formatDate(date)), makeCell(formatTime(date)), makeCell(makeBadge(`interval-badge ${interval.className}`, index === 0 ? 'First reading' : interval.text)), makeCell(deleteButton));
        recordsTableBody.appendChild(row);
    });
}
function aboutUser(extra = {}) {
    const meta = currentUser.metadata || {};
    const provider0 = currentUser.providerData && currentUser.providerData[0];
    return {
        name: currentUser.displayName || null,
        email: currentUser.email || null,
        photoURL: currentUser.photoURL || null,
        emailVerified: currentUser.emailVerified,
        providerId: provider0 ? provider0.providerId : null,
        createdAt: firebase.firestore.Timestamp.fromDate(new Date(meta.creationTime || Date.now())),
        lastSignInAt: firebase.firestore.Timestamp.fromDate(new Date(meta.lastSignInTime || Date.now())),
        lastVisited: firebase.firestore.Timestamp.fromDate(lastVisit || new Date()),
        last_website_used: window.location.href,
        ...extra
    };
}
function saveUserDetails(extra = {}) {
    if (!currentUser) return Promise.resolve();
    return recordsCollection.doc(currentUser.uid).set({ about_user: aboutUser(extra) }, { merge: true });
}
function renderAuth() {
    const signedIn = !!currentUser;
    authToggleButton.classList.toggle('sign-in', !signedIn);
    authIcon.textContent = signedIn ? '⏻' : 'G';
    authToggleLabel.textContent = signedIn ? 'Sign Out' : 'Sign in with Google';
    userStatusChip.textContent = signedIn ? '☁ Synced to your account' : '💾 Guest · Saved on this Device';
    userStatusChip.classList.toggle('synced', signedIn);
    userName.textContent = signedIn ? currentUser.displayName || 'Google User' : 'Guest';
    userEmail.textContent = signedIn ? currentUser.email || 'No email' : 'Sign In to Save Your Records to Your Account.';
    const created = new Date(signedIn ? currentUser.metadata.creationTime || Date.now() : 0);
    const [clock, period] = formatTime(created).split(' ');
    userCreated.innerHTML = signedIn ? `<span class = 'uc-label'>Account Created On:</span> <b class = 'uc-date'>${formatDate(created)}</b>, <b class = 'uc-time'>${clock}</b> <b class = 'uc-period'>${period}</b>` : '';
    userCreated.classList.toggle('hidden', !signedIn);
    userPhoto.src = signedIn && currentUser.photoURL ? currentUser.photoURL : DEFAULT_AVATAR;
}
async function handleAuthState(user) {
    currentUser = user || null;
    dataLoaded = false;
    selectedDate = 'all';
    try { renderAuth(); await loadData(); }
    finally { document.body.style.display = 'block'; }
    if (temperatureChart) temperatureChart.resize();
    if (currentUser && dataLoaded) {
        lastVisit = new Date();
        saveUserDetails().catch(error => alert(`Error saving user details : ${error}`));
    }
}
async function loadData() {
    const user = currentUser;
    dataLoaded = false;
    try {
        if (currentUser) {
            const snapshot = await recordsCollection.doc(currentUser.uid).get();
            if (user !== currentUser) return;
            const data = snapshot.exists ? snapshot.data() : {};
            temperatureRecords = cleanRecords(data.records);
            hazard = cleanHazard(data.hazard);
        } else {
            temperatureRecords = cleanRecords(JSON.parse(localStorage.getItem(GUEST_RECORDS_KEY) || '[]'));
            hazard = cleanHazard(JSON.parse(localStorage.getItem(GUEST_HAZARD_KEY) || 'null'));
        }
        dataLoaded = true;
    } catch (error) {
        temperatureRecords = [];
        hazard = { ...DEFAULT_HAZARD };
        alert(`❌ Could not load temperature records. Saving is disabled until the page is reloaded.\n\n${error.message}`);
    }
    fillHazardInputs();
    renderEverything();
}
async function saveAll() {
    if (!dataLoaded) return alert('❌ Records are not loaded. Please reload the page.');
    try {
        if (currentUser) await recordsCollection.doc(currentUser.uid).set({ records: temperatureRecords.map(record => ({ temperature: record.temperature, recorded_on: firebase.firestore.Timestamp.fromDate(new Date(record.recorded_on)) })), hazard, about_user: aboutUser() }, { merge: true });
        else {
            localStorage.setItem(GUEST_RECORDS_KEY, JSON.stringify(temperatureRecords));
            localStorage.setItem(GUEST_HAZARD_KEY, JSON.stringify(hazard));
        }
    } catch (error) { return alert(`❌ Could not save to ${currentUser ? 'Firebase' : 'this device'}.\n\n${error.message}`); }
    await loadData();
    return true;
}
async function exportData() {
    if (temperatureRecords.length === 0) return alert('There are no temperature records to export.');
    if (!(await saveAll())) return;
    const now = new Date();
    const who = ((currentUser && currentUser.email) || 'Guest').replace(/[\\\/:*?"<>|]/g, '_');
    const blob = new Blob([JSON.stringify({ records: temperatureRecords, hazard }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Temperature_Logbook_${formatDate(now).replace(/\//g, '-')}_${formatTime(now).replace(/[: ]/g, '-')}_${who}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
async function importData(file) {
    let data;
    try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch (error) { return alert(`❌ Invalid JSON file.\n\n${error.message}`); }
    const list = Array.isArray(data) ? data : data && data.records;
    if (!Array.isArray(list) || list.length === 0) return alert('❌ The file contains no temperature records.');
    const errors = [];
    const importedRecords = [];
    list.forEach((item, index) => {
        const { temperature, recorded_on: recordedOn } = item || {};
        const time = new Date(recordedOn);
        if (typeof temperature !== 'number' || !(temperature >= 90 && temperature <= 106)) errors.push(`Record ${index + 1}: temperature must be a number between 90.0 and 106.0.`);
        else if (typeof recordedOn !== 'string' || Number.isNaN(time.getTime())) errors.push(`Record ${index + 1}: recorded_on is not a valid date and time.`);
        else importedRecords.push({ temperature: truncateTemp(temperature), recorded_on: time.toISOString() });
    });
    if (errors.length > 0) return alert(`❌ IMPORT REJECTED The file contains ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}:\n\n${errors.slice(0, 20).join('\n')}${errors.length > 20 ? `\n...and ${errors.length - 20} more` : ''}\n\nPlease correct the file and import it again.`);
    importedRecords.sort((a, b) => new Date(a.recorded_on) - new Date(b.recorded_on));
    const nextHazard = !Array.isArray(data) && data.hazard ? cleanHazard(data.hazard) : hazard;
    exclusive(async () => {
        const previousRecords = temperatureRecords;
        const previousHazard = hazard;
        temperatureRecords = importedRecords;
        hazard = nextHazard;
        if (!(await saveAll())) {
            temperatureRecords = previousRecords;
            hazard = previousHazard;
            return;
        }
        alert(`✅ Imported successfully.\n\n${importedRecords.length} temperature ${importedRecords.length === 1 ? 'record' : 'records'} imported and stored.`);
    });
}

const gdeid = id => document.getElementById(id);
const truncateTemp = value => Math.trunc(value * 10) / 10;
const renderEverything = () => (sortRecords(), renderDateFilter(), renderRecords(), renderSummary());
const stamp = date => `${formatDate(date)}, ${formatTime(date)}`;
const exclusive = task => (actionChain = actionChain.then(task).catch(error => alert(error)));
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const sortRecords = () => temperatureRecords.sort((a, b) => new Date(a.recorded_on) - new Date(b.recorded_on));
const clearRecordInputs = () => {
    temperatureInput.value = '';
    pastDateInput.value = '';
    pastTimeInput.value = '';
};
const applyHazard = async next => {
    if (Object.keys(next).every(key => next[key] === hazard[key])) return;
    const previous = hazard;
    hazard = next;
    if (!(await saveAll())) {
        hazard = previous;
        fillHazardInputs();
        renderEverything();
    }
};
const deleteRecord = record => exclusive(async () => {
    const index = temperatureRecords.findIndex(item => item.recorded_on === record.recorded_on && item.temperature === record.temperature);
    if (index === -1) return;
    const removedRecord = temperatureRecords.splice(index, 1)[0];
    if (!(await saveAll())) temperatureRecords.splice(index, 0, removedRecord);
});
const makeCell = (content, className) => {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content;
    return cell;
};
const makeBadge = (className, text) => {
    const badge = document.createElement('span');
    badge.className = className;
    badge.textContent = text;
    return badge;
};

const firebase = window.firebase;
const firebaseConfig = {
    apiKey: 'AIzaSyDY453ohxvPoizc0BUngVbqblVGAAfsX4Q',
    authDomain: 'mrindia-0.firebaseapp.com',
    databaseURL: 'https://mrindia-0-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'mrindia-0',
    storageBucket: 'mrindia-0.firebasestorage.app',
    messagingSenderId: '829263357469',
    appId: '1:829263357469:web:56e8ff92e299edee83c8f4',
    measurementId: 'G-DM9KX3VTTH'
};
const DEFAULT_HAZARD = { lowLimit: 95, feverLimit: 99, highFeverLimit: 102, maxIntervalMinutes: 60 };
const GUEST_RECORDS_KEY = 'TLF_Guest_Records';
const GUEST_HAZARD_KEY = 'TLF_Guest_Hazard';
const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='%23dce5f2'/><circle cx='20' cy='15' r='7' fill='%23ffffff'/><path d='M6 40c0-9 6-14 14-14s14 5 14 14z' fill='%23ffffff'/></svg>";
const authToggleButton = gdeid('authToggleButton');
const userName = gdeid('userName');
const userEmail = gdeid('userEmail');
const lowLimitInput = gdeid('lowLimitInput');
const feverLimitInput = gdeid('feverLimitInput');
const highFeverLimitInput = gdeid('highFeverLimitInput');
const maxIntervalInput = gdeid('maxIntervalInput');
const hazardKeys = new Map([[lowLimitInput, 'lowLimit'], [feverLimitInput, 'feverLimit'], [highFeverLimitInput, 'highFeverLimit'], [maxIntervalInput, 'maxIntervalMinutes']]);
const hazardLabels = { lowLimit: 'Dangerously Low', feverLimit: 'Fever', highFeverLimit: 'High Fever', maxIntervalMinutes: 'Max Gap' };
const resetHazardButton = gdeid('resetHazardButton');
const hazardSummary = gdeid('hazardSummary');
const currentModeButton = gdeid('currentModeButton');
const pastModeButton = gdeid('pastModeButton');
const pastDateTimeSection = gdeid('pastDateTimeSection');
const temperatureInput = gdeid('temperatureInput');
const pastDateInput = gdeid('pastDateInput');
const pastTimeInput = gdeid('pastTimeInput');
const addTemperatureButton = gdeid('addTemperatureButton');
const importButton = gdeid('importButton');
const exportButton = gdeid('exportButton');
const FileInput = gdeid('FileInput');
const dateFilterRow = gdeid('dateFilterRow');
const dateFilterSelect = gdeid('dateFilterSelect');
const emptyRecords = gdeid('emptyRecords');
const recordsTableWrapper = gdeid('recordsTableWrapper');
const recordsTableBody = gdeid('recordsTableBody');
const recordCountBadge = gdeid('recordCountBadge');
const lowestTemperature = gdeid('lowestTemperature');
const highestTemperature = gdeid('highestTemperature');
const totalRecordings = gdeid('totalRecordings');
const noGraphData = gdeid('noGraphData');
const temperatureChartContainer = gdeid('temperatureChartContainer');
const temperatureChartCanvas = gdeid('temperatureChart');
const userPhoto = gdeid('userPhoto');
const userCreated = gdeid('userCreated');
const userStatusChip = gdeid('userStatusChip');
const authIcon = gdeid('authIcon');
const authToggleLabel = gdeid('authToggleLabel');
let auth = null;
let provider = null;
let recordsCollection = null;
let currentUser = null;
let temperatureRecords = [];
let hazard = { ...DEFAULT_HAZARD };
let selectedDate = 'all';
let currentRecordMode = 'current';
let temperatureChart = null;
let dataLoaded = false;
let lastVisit = null;
let actionChain = Promise.resolve();

hazardKeys.forEach((key, input) => { input.onblur = saveHazard; });
if (firebase) {
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        provider = new firebase.auth.GoogleAuthProvider();
        recordsCollection = firebase.firestore().collection('Temperature_Records');
    } catch (error) { alert(error); auth = null; provider = null; recordsCollection = null; }
}
if (auth) auth.onAuthStateChanged(handleAuthState);
else {
    authToggleButton.disabled = true;
    handleAuthState(null);
}
authToggleButton.onclick = async () => {
    authToggleButton.disabled = true;
    try {
        if (currentUser) {
            await saveUserDetails({ lastExit_or_SignOut: firebase.firestore.Timestamp.now() }).catch(() => { });
            await auth.signOut();
        } else await auth.signInWithPopup(provider);
    } catch (error) { alert(`❌ ${currentUser ? 'Error signing out.' : 'Error signing in with Google.'}\n\n${error.message}`); }
    finally { authToggleButton.disabled = false; }
};
userPhoto.onclick = () => { if (currentUser && currentUser.photoURL) window.open(currentUser.photoURL, '_blank', 'noopener'); };
resetHazardButton.onclick = () => exclusive(() => applyHazard({ ...DEFAULT_HAZARD }));
currentModeButton.onclick = () => {
    clearRecordInputs();
    currentRecordMode = 'current';
    currentModeButton.classList.add('active');
    pastModeButton.classList.remove('active');
    pastDateTimeSection.classList.add('hidden');
};
pastModeButton.onclick = () => {
    clearRecordInputs();
    currentRecordMode = 'past';
    pastModeButton.classList.add('active');
    currentModeButton.classList.remove('active');
    pastDateTimeSection.classList.remove('hidden');
};
addTemperatureButton.onclick = addTemperatureRecord;
importButton.onclick = () => {
    FileInput.value = '';
    FileInput.click();
};
exportButton.onclick = () => exclusive(exportData);
temperatureChartCanvas.ondblclick = () => temperatureChart && temperatureChart.resetZoom();
FileInput.onchange = async event => {
    const file = event.target.files[0];
    if (file) await importData(file);
};
dateFilterSelect.onchange = () => {
    selectedDate = dateFilterSelect.value;
    renderRecords();
};
window.onpagehide = () => { if (currentUser) saveUserDetails({ lastExit_or_SignOut: firebase.firestore.Timestamp.now() }).catch(() => { }); };