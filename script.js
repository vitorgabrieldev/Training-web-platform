const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
let data = JSON.parse(localStorage.getItem("treinos_v1") || "{}");
if (!data.days) data.days = {};

function save() {
    localStorage.setItem("treinos_v1", JSON.stringify(data));
}

let firestoreDB = null;
function initFirebaseIfNeeded() {
    try {
        if (window.firestoreDB && !firestoreDB) {
            firestoreDB = window.firestoreDB;
            return;
        }

        if (!window.firebase) {
            console.warn('Firebase SDK not found on page');
            return;
        }

        const apps = firebase.apps || [];
        if (apps.length > 0 && !firestoreDB) {
            firestoreDB = firebase.firestore();
            return;
        }

        if (window.FIREBASE_CONFIG && !firestoreDB) {
            firebase.initializeApp(window.FIREBASE_CONFIG);
            firestoreDB = firebase.firestore();
            return;
        }
    } catch (e) {
        console.warn('Firebase init error', e);
        firestoreDB = null;
    }
}

async function fetchRemoteData() {
    initFirebaseIfNeeded();
    if (!firestoreDB) throw new Error('Firestore not initialized');

    const docRef = firestoreDB.collection('app').doc('treinos_v1');
    const doc = await docRef.get();
    if (!doc.exists) return null;
    return doc.data();
}

async function saveRemoteData(payload) {
    initFirebaseIfNeeded();
    if (!firestoreDB) throw new Error('Firestore not initialized');

    const docRef = firestoreDB.collection('app').doc('treinos_v1');
    await docRef.set(payload);
}

async function trySyncOnLoad() {
    try {
        const remote = await fetchRemoteData();
        if (remote && typeof remote === 'object') {
            // Write to localStorage and load
            localStorage.setItem('treinos_v1', JSON.stringify(remote));
            data = JSON.parse(JSON.stringify(remote));
            if (!data.days) data.days = {};
                render();
                initSortables();
            return;
        }
    } catch (err) {
        console.warn('Remote fetch failed, using local data', err);
        const msg = (err && err.message) ? err.message : String(err);
        Swal.fire({
            icon: 'warning',
            title: 'Sem sincronização',
            html: `Não foi possível sincronizar com o servidor. Usando dados locais.<br><small style="opacity:.8">${msg}</small>`
        });
    }
}

// --- Tabs: persist selected tab and switch handler -------------------------
const TAB_KEY = 'treinos_active_tab';
function switchTab(tabId) {
    // hide all tab-content
    $('.tab-content').addClass('hidden');
    // remove active from buttons
    $('.tab-btn').removeClass('active');
    // show selected
    $(`#tab-${tabId}`).removeClass('hidden');
    $(`#tab-btn-${tabId}`).addClass('active');
    localStorage.setItem(TAB_KEY, tabId);
}

$(document).on('click', '.tab-btn', function () {
    const t = $(this).data('tab');
    if (!t) return;
    switchTab(t);
});

function restoreTab() {
    const saved = localStorage.getItem(TAB_KEY) || 'ficha';
    // ensure element exists, fallback to ficha
    const el = $(`#tab-${saved}`);
    if (!el.length) return switchTab('ficha');
    switchTab(saved);
}

// --- Simple local AI-chat placeholder -------------------------------------
const CHAT_KEY = 'treinos_chat_msgs';
function loadChat() {
    const raw = localStorage.getItem(CHAT_KEY) || '[]';
    let msgs = [];
    try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    const container = $('#chatMessages');
    container.empty();
    msgs.forEach(m => {
        let cls = '';
        if (m.role === 'user') cls = 'chat-msg user';
        else if (m.role === 'ai') cls = 'chat-msg ai enter';
        else if (m.role === 'loading') cls = 'chat-msg ai';

        if (m.role === 'loading') {
            container.append(`<div class="${cls}"><span class="chat-loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`);
        } else if (m.role === 'ai') {
            const finalHtml = renderAiMessage(m.text);
            if (m.animate) {
                const el = $(`<div class="${cls} typing"></div>`);
                container.append(el);
                startAiTypewriter(el, m, finalHtml);
            } else {
                container.append(`<div class="${cls}">${finalHtml}</div>`);
            }
        } else {
            // user or other
            const safe = String(m.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            container.append(`<div class="${cls}">${safe}</div>`);
        }
    });
    container.scrollTop(container.prop('scrollHeight'));
}

function renderAiMessage(text) {
    if (!text) return '';
    // escape first
    let s = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Convert **bold** to <strong>
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert lines starting with - into a list
    const lines = s.split(/\r?\n/);
    let out = [];
    let inList = false;
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${trimmed.slice(2)}</li>`);
        } else if (trimmed === '---' || trimmed === '--') {
            if (inList) { out.push('</ul>'); inList = false; }
            out.push('<hr/>');
        } else {
            if (inList) { out.push('</ul>'); inList = false; }
            if (trimmed === '') out.push('<br/>'); else out.push(`<p>${trimmed}</p>`);
        }
    });
    if (inList) out.push('</ul>');
    return out.join('');
}

function saveChatMessage(role, text) {
    const raw = localStorage.getItem(CHAT_KEY) || '[]';
    let msgs = [];
    try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    msgs.push({ role, text, ts: Date.now() });
    localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
}

function replaceLastLoadingWithAi(text) {
    const raw = localStorage.getItem(CHAT_KEY) || '[]';
    let msgs = [];
    try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    const formatted = formatAiResponseText(text);
    // find last loading message
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'loading') {
            msgs[i] = { role: 'ai', text: formatted, ts: Date.now(), animate: true };
            localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
            return;
        }
    }
    // fallback: append
    msgs.push({ role: 'ai', text: formatted, ts: Date.now(), animate: true });
    localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
}

function formatAiResponseText(text) {
    if (text === null || text === undefined) return '';
    let s = String(text).trim();
    if (/^resposta[:\-]/i.test(s)) {
        s = s.replace(/^resposta[:\-]\s*/i, '');
    }
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    s = s.replace(/"/g, '');
    return s;
}

function buildContextForSend(maxMessages, currentInput) {
    const raw = localStorage.getItem(CHAT_KEY) || '[]';
    let msgs = [];
    try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    // filter only user/ai messages and take last maxMessages
    const convo = msgs.filter(m => m.role === 'user' || m.role === 'ai');
    const tail = convo.slice(-maxMessages);
    const parts = tail.map(m => (m.role === 'user' ? `User: ${m.text}` : `Assistant: ${m.text}`));
    parts.push(`User: ${currentInput}`);
    return parts.join('\n');
}

function buildTrainingSummary() {
    if (!data || !data.days) return '';
    const lines = [];
    lines.push(`Contexto do treino do usuário (gerado em ${new Date().toLocaleString('pt-BR')}):`);
    for (let i = 0; i < DAYS.length; i++) {
        const dayExercises = Array.isArray(data.days[i]) ? data.days[i] : [];
        if (!dayExercises.length) {
            lines.push(`- ${DAYS[i]}: descanso ou sem exercícios cadastrados.`);
            continue;
        }
        const exLines = dayExercises.slice(0, 5).map(ex => {
            const base = ex.name || 'Exercício sem nome';
            const seriesInfo = Array.isArray(ex.series) && ex.series.length
                ? ex.series.map((s, idx) => {
                    const peso = s.peso ? `${s.peso}kg` : '';
                    const reps = s.reps ? `${s.reps} reps` : '';
                    const descanso = s.descanso ? `${s.descanso}min descanso` : '';
                    const bits = [peso, reps, descanso].filter(Boolean).join(', ');
                    return `S${idx + 1}: ${bits || 'sem dados'}`;
                }).slice(0, 3).join(' | ')
                : 'sem séries detalhadas';
            return `${base} (${seriesInfo})`;
        }).join('; ');
        lines.push(`- ${DAYS[i]}: ${exLines}${dayExercises.length > 5 ? ' ...' : ''}`);
    }
    lines.push('Use essas informações para responder de forma personalizada sobre o treino.');
    return lines.join('\n');
}

function startAiTypewriter($el, messageMeta, finalHtml) {
    const words = String(messageMeta.text || '').split(/\s+/).filter(Boolean);
    if (!words.length) {
        $el.html(finalHtml);
        markAiMessageAnimated(messageMeta.ts);
        return;
    }
    let idx = 0;
    const step = () => {
        idx++;
        const current = words.slice(0, idx).join(' ');
        $el.text(current);
        if (idx >= words.length) {
            setTimeout(() => {
                $el.removeClass('typing').html(finalHtml);
                markAiMessageAnimated(messageMeta.ts);
            }, 120);
            return;
        }
        setTimeout(step, 130);
    };
    step();
}

function markAiMessageAnimated(ts) {
    if (!ts) return;
    const raw = localStorage.getItem(CHAT_KEY) || '[]';
    let msgs = [];
    try { msgs = JSON.parse(raw); } catch (e) { return; }
    let updated = false;
    msgs = msgs.map(m => {
        if (m.role === 'ai' && m.ts === ts && m.animate) {
            updated = true;
            return { ...m, animate: false };
        }
        return m;
    });
    if (updated) localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
}

// --- Chat integration via serverless proxy (`/api/mistral`) --------------
// The serverless function (on Vercel) should hold the API key in environment
// variable and forward the request to Mistral. Front-end simply posts to it.
const MISTRAL_AGENT_ID = 'ag_019a99f9c58677eea260bb701335c30b';

async function mistralProxySend(input) {
    const proxyUrl = window.MISTRAL_PROXY_URL || '/api/mistral';
    const payload = { agent_id: MISTRAL_AGENT_ID, inputs: input };
    const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Proxy error ${res.status}: ${text}`);
    }

    const json = await res.json();
    // Extract friendly text from known shapes and nested content
    function extractText(obj) {
        if (!obj) return null;
        if (typeof obj === 'string') return obj;
        if (typeof obj.text === 'string') return obj.text;
        if (typeof obj.content === 'string') return obj.content;
        // if content is array, join inner texts
        if (Array.isArray(obj.content)) {
            const parts = obj.content.map(c => extractText(c)).filter(Boolean);
            if (parts.length) return parts.join('\n\n');
        }
        // outputs -> content
        if (Array.isArray(obj.outputs)) {
            for (const out of obj.outputs) {
                const t = extractText(out);
                if (t) return t;
            }
        }
        // choices -> message -> content
        if (Array.isArray(obj.choices)) {
            for (const ch of obj.choices) {
                if (ch && ch.message) {
                    const t = extractText(ch.message);
                    if (t) return t;
                }
            }
        }
        // search recursively for any `text` string deep in the object
        try {
            const stack = [obj];
            while (stack.length) {
                const cur = stack.shift();
                if (!cur || typeof cur !== 'object') continue;
                if (typeof cur.text === 'string') return cur.text;
                if (typeof cur.content === 'string') return cur.content;
                for (const k of Object.keys(cur)) {
                    const v = cur[k];
                    if (typeof v === 'string' && (k.toLowerCase().includes('text') || k.toLowerCase().includes('content'))) return v;
                    if (typeof v === 'object') stack.push(v);
                }
            }
        } catch (e) {
            // ignore
        }

        return null;
    }

    let text = extractText(json) || JSON.stringify(json);
    return { raw: json, text };
}


$('#chatSend').on('click', function () {
    (async function () {
        const txt = $('#chatInput').val().trim();
        if (!txt) return;
        // save user message
        saveChatMessage('user', txt);
        $('#chatInput').val('');
        loadChat();

        // insert loading placeholder (role='loading')
        saveChatMessage('loading', '');
        loadChat();

        try {
            // build context: last 5 messages (user/ai only)
            const ctx = buildContextForSend(5, txt);
            const trainingCtx = buildTrainingSummary();
            const prompt = trainingCtx ? `${trainingCtx}\n\nHistórico recente:\n${ctx}` : ctx;
            const resp = await mistralProxySend(prompt);
            // replace last loading with AI response (with animation)
            replaceLastLoadingWithAi(resp && resp.text ? resp.text : JSON.stringify(resp && resp.raw ? resp.raw : resp));
        } catch (err) {
            replaceLastLoadingWithAi('Erro ao contatar o treinador: ' + (err && err.message ? err.message : String(err)));
        }
        loadChat();
    })();
});

// allow Enter to send in chat input
$('#chatInput').on('keydown', function (e) {
    if (e.key === 'Enter') { $('#chatSend').trigger('click'); }
});

// Clear chat button
$('#chatClear').on('click', function () {
    localStorage.removeItem(CHAT_KEY);
    loadChat();
});


// --- Sync queue / retry manager ---------------------------------------------
const PENDING_KEY = 'treinos_pending';
let retryTimer = null;
const RETRY_INTERVAL = 10000; // 10s

function showToast(icon, title) {
    Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 2000 });
}

function enqueuePending(payload) {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ payload, ts: Date.now() }));
    } catch (e) {
        console.warn('enqueue pending failed', e);
    }
    startRetryTimer();
}

function clearPending() {
    localStorage.removeItem(PENDING_KEY);
}

async function processPendingQueue() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    let item;
    try { item = JSON.parse(raw); } catch (e) { clearPending(); return; }

    // show loading
    Swal.fire({ title: 'Sincronizando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        await saveRemoteData(item.payload);
        clearPending();
        Swal.close();
        showToast('success', 'Sincronizado');
    } catch (err) {
        Swal.close();
        const m = err && err.message ? err.message : String(err);
        showToast('warning', 'Ainda não sincronizado');
        console.warn('Retry failed', m);
        // keep pending, will retry later
    }
}

function startRetryTimer() {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
        if (navigator.onLine) processPendingQueue();
    }, RETRY_INTERVAL);
}

window.addEventListener('online', () => { processPendingQueue(); });

// attempt save with retry/queue on fail
function attemptSaveWithRetry() {
    saveRemoteData(data).then(() => {
        showToast('success', 'Sincronizado');
    }).catch(err => {
        console.warn('saveRemoteData failed', err);
        enqueuePending(data);
        const m = err && err.message ? err.message : String(err);
        showToast('warning', 'Sincronização adiada');
        console.warn(m);
    });
}

// --- end retry manager -----------------------------------------------------

const today = (new Date().getDay() + 6) % 7;

// --- Calendar weekly view ----------------------------------------------------
const CALENDAR_STORAGE_KEY = 'treinos_calendar_v1';
const CALENDAR_STATE_KEY = 'treinos_calendar_state';
const CALENDAR_VISIBLE_WEEKS = 4;
const CAL_DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
let calendarData = {};
try {
    calendarData = JSON.parse(localStorage.getItem(CALENDAR_STORAGE_KEY) || '{}');
} catch (e) {
    calendarData = {};
}
if (!calendarData.weeks) calendarData.weeks = {};

let calendarState = loadCalendarState();
let weekModalKey = null;
let dayModalContext = { weekKey: null, dateKey: null };

function loadCalendarState() {
    const stored = localStorage.getItem(CALENDAR_STATE_KEY);
    if (stored) {
        const d = new Date(stored);
        if (!isNaN(d)) return getMonday(d);
    }
    return getMonday(new Date());
}

function saveCalendarState() {
    localStorage.setItem(CALENDAR_STATE_KEY, calendarState.toISOString());
}

function saveCalendarData() {
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendarData));
}

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 sunday
    const diff = (day + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diff);
    return d;
}

function addDays(base, num) {
    const d = new Date(base);
    d.setDate(d.getDate() + num);
    return d;
}

function cleanLocaleLabel(str) {
    return (str || '').replace(/\./g, '').replace(/\sde\s/gi, ' ').replace(/\s+/g, ' ').trim();
}

function formatShortDayLabel(date) {
    return cleanLocaleLabel(date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }));
}

function formatDateRange(start, end) {
    const sameYear = start.getFullYear() === end.getFullYear();
    const startStr = sameYear
        ? formatShortDayLabel(start)
        : cleanLocaleLabel(start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }));
    const endStr = cleanLocaleLabel(end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }));
    return `${startStr} — ${endStr}`;
}

function formatWeekRangeLabel(start, end) {
    return `${formatShortDayLabel(start)} — ${formatShortDayLabel(end)}`;
}

function getWeekKey(date) {
    return getMonday(date).toISOString().slice(0, 10);
}

function ensureWeekEntry(weekKey) {
    if (!calendarData.weeks[weekKey]) {
        calendarData.weeks[weekKey] = {
            type: 'Base',
            load: 100,
            note: '',
            days: {}
        };
    }
    return calendarData.weeks[weekKey];
}

function renderCalendarWeeks() {
    const container = $('#calendarWeeks');
    if (!container.length) return;
    container.empty();

    const start = calendarState;
    const end = addDays(start, CALENDAR_VISIBLE_WEEKS * 7 - 1);
    $('#calendarRangeLabel').text(formatDateRange(start, end));

    for (let i = 0; i < CALENDAR_VISIBLE_WEEKS; i++) {
        const weekStart = addDays(start, i * 7);
        const weekEnd = addDays(weekStart, 6);
        const weekKey = getWeekKey(weekStart);
        const entry = calendarData.weeks[weekKey] || null;
        const typeLabel = entry && entry.type ? entry.type : 'Base';
        const loadLabel = entry && typeof entry.load === 'number' ? entry.load : 100;
        const note = entry && entry.note ? entry.note : 'Sem observações para esta semana.';
        const noteClass = entry && entry.note ? '' : 'empty';

        const rangeLabel = formatWeekRangeLabel(weekStart, weekEnd);
        const card = $(`
            <div class="calendar-week-card" data-week-key="${weekKey}" tabindex="0" role="button">
                <div class="calendar-week-head">
                    <div class="calendar-week-title">Semana ${i + 1}</div>
                    <div class="calendar-week-range">${rangeLabel}</div>
                    <div class="calendar-week-meta">
                        <span class="badge">${typeLabel}</span>
                        <span class="badge load">${loadLabel}%</span>
                    </div>
                    <div class="calendar-week-actions">
                        <button class="btn-secondary small week-edit" data-week-key="${weekKey}">Editar semana</button>
                    </div>
                </div>
                <div class="calendar-week-days" id="week-days-${weekKey}"></div>
                <div class="calendar-week-note ${noteClass}">${note}</div>
            </div>
        `);
        container.append(card);

        const daysWrap = card.find('.calendar-week-days');
        for (let d = 0; d < 7; d++) {
            const dayDate = addDays(weekStart, d);
            const dateKey = dayDate.toISOString().slice(0, 10);
            const dayNote = entry && entry.days && entry.days[dateKey] ? entry.days[dateKey] : '';
            const hasNote = !!dayNote;
            const snippet = hasNote ? `<span class="week-day-note">${dayNote.slice(0, 40)}${dayNote.length > 40 ? '…' : ''}</span>` : '';
            const dayLabel = formatShortDayLabel(dayDate);
            const btn = $(`
                <button class="week-day ${hasNote ? 'has-note' : ''}" data-week-key="${weekKey}" data-date-key="${dateKey}">
                    <span class="week-day-label">${CAL_DAY_LABELS[d]}</span>
                    <span class="week-day-date">${dayLabel}</span>
                    ${snippet}
                </button>
            `);
            daysWrap.append(btn);
        }
    }
}

function openWeekModal(weekKey) {
    weekModalKey = weekKey;
    const entry = ensureWeekEntry(weekKey);
    $('#weekTypeSelect').val(entry.type || 'Base');
    $('#weekLoadInput').val(typeof entry.load === 'number' ? entry.load : 100);
    $('#weekNoteInput').val(entry.note || '');
    $('#weekModalWrap').removeClass('hidden').addClass('flex');
}

function closeWeekModal() {
    weekModalKey = null;
    $('#weekModalWrap').addClass('hidden').removeClass('flex');
}

function openDayModal(weekKey, dateKey) {
    dayModalContext = { weekKey, dateKey };
    const entry = ensureWeekEntry(weekKey);
    const note = entry.days && entry.days[dateKey] ? entry.days[dateKey] : '';
    const dateObj = new Date(dateKey);
    $('#dayModalTitle').text('Anotações do dia');
    $('#dayModalSubtitle').text(dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));
    $('#dayNoteInput').val(note);
    $('#dayModalWrap').removeClass('hidden').addClass('flex');
}

function closeDayModal() {
    dayModalContext = { weekKey: null, dateKey: null };
    $('#dayModalWrap').addClass('hidden').removeClass('flex');
}

let calendarUnsubscribe = null;

function getCalendarCollectionRef() {
    const db = getFirestore();
    if (!db) return null;
    return db.collection('app').doc('users').collection('users').doc(STATIC_USER_ID).collection('calendarWeeks');
}

async function persistWeekToFirestore(weekKey) {
    const col = getCalendarCollectionRef();
    if (!col) throw new Error('Firestore não inicializado');
    const entry = ensureWeekEntry(weekKey);
    const payload = {
        type: entry.type || 'Base',
        load: typeof entry.load === 'number' ? entry.load : 100,
        note: entry.note || '',
        days: entry.days || {},
        startDate: weekKey,
        updated_at: (firebase && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.serverTimestamp) ?
            firebase.firestore.FieldValue.serverTimestamp() : Date.now()
    };
    await col.doc(weekKey).set(payload, { merge: true });
}

function initCalendarRealtime() {
    try {
        const col = getCalendarCollectionRef();
        if (!col) {
            console.warn('Calendário: Firestore não disponível');
            return;
        }
        if (calendarUnsubscribe) calendarUnsubscribe();
        calendarUnsubscribe = col.onSnapshot(snapshot => {
            const weeks = {};
            snapshot.forEach(doc => {
                const data = doc.data() || {};
                weeks[doc.id] = {
                    type: data.type || 'Base',
                    load: typeof data.load === 'number' ? data.load : 100,
                    note: data.note || '',
                    days: data.days || {}
                };
            });
            calendarData.weeks = weeks;
            saveCalendarData();
            renderCalendarWeeks();
        }, err => {
            console.warn('Calendário snapshot error', err);
            showToast('warning', 'Falha ao sincronizar calendário');
        });
    } catch (e) {
        console.warn('initCalendarRealtime error', e);
    }
}

// --- end calendar ------------------------------------------------------------

function seededExtraMinutes(dayIndex, exIndex) {
    const seed = ((dayIndex + 1) * 73856093) ^ ((exIndex + 1) * 19349663);
    const x = Math.abs(Math.sin(seed) * 10000);
    return 1 + Math.floor((x - Math.floor(x)) * 3); // 1-3 minutos
}

function computeDayTimeMeta(dayIndex) {
    const exercises = Array.isArray(data.days[dayIndex]) ? data.days[dayIndex] : [];
    let descansoTotal = 0;
    let extras = 0;
    exercises.forEach((ex, exIdx) => {
        (ex.series || []).forEach(series => {
            const val = parseFloat(series.descanso);
            if (Number.isFinite(val) && val > 0) descansoTotal += val;
        });
        extras += seededExtraMinutes(dayIndex, exIdx);
    });
    const totalMinutes = Math.round(descansoTotal + extras);
    const start = new Date();
    const end = new Date(start.getTime() + totalMinutes * 60000);
    const fmt = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pretty = (mins) => {
        if (mins < 60) return `${mins} min`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const hours = h === 1 ? '1h' : `${h}h`;
        if (m === 0) return hours;
        return `${hours} e ${m} min`;
    };

    return {
        totalMinutes,
        totalLabel: pretty(totalMinutes),
        startLabel: fmt(start),
        endLabel: fmt(end)
    };
}

// --- PIN system --------------------------------------------------------------
// Notes:
// - The default PIN requested (0109) will be used on first run. For security, we store
//   and compare a SHA-256 hash (salt + pin). This is client-side protection only;
//   anyone with access to the device/browser can bypass by clearing storage or
//   manipulating code via devtools. A server-side auth would be required for strong protection.

const PIN_STORAGE_KEY = 'treinos_pin_hash';
const PIN_SALT_KEY = 'treinos_pin_salt';
const PIN_UNLOCKED_KEY = 'treinos_pin_unlocked';

// Default: use PIN '0109' on first run — we do NOT store it in plaintext in localStorage.
// We will initialize the stored hash on first load.
const DEFAULT_PIN = '0109';
const DEFAULT_SALT = 'v3ry-r4nd0m-salt';

async function sha256Hex(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensurePinInitialized() {
    if (!localStorage.getItem(PIN_STORAGE_KEY)) {
        // Initialize with default PIN (hash only)
        const salt = DEFAULT_SALT;
        const h = await sha256Hex(salt + DEFAULT_PIN);
        localStorage.setItem(PIN_SALT_KEY, salt);
        localStorage.setItem(PIN_STORAGE_KEY, h);
    }
}

async function verifyPinInput(pin) {
    const salt = localStorage.getItem(PIN_SALT_KEY) || DEFAULT_SALT;
    const expected = localStorage.getItem(PIN_STORAGE_KEY);
    const h = await sha256Hex(salt + pin);
    return expected === h;
}

function showPinOverlay() {
    $('#pinOverlay').removeClass('hidden');
    $('#pinInput').val('');
    $('#pinInput').focus();
}

function hidePinOverlay() {
    $('#pinOverlay').addClass('hidden');
}

async function lockCheckFlow() {
    await ensurePinInitialized();
    const unlocked = localStorage.getItem(PIN_UNLOCKED_KEY) === '1';
    if (unlocked) return true;

    // show overlay and wait for correct input
    showPinOverlay();

    return new Promise(resolve => {
        $('#pinSubmit').off('click').on('click', async () => {
            const pin = ($('#pinInput').val() || '').trim();
            if (!/^[0-9]{4}$/.test(pin)) {
                Swal.fire({ icon: 'warning', title: 'PIN inválido', text: 'Informe 4 dígitos numéricos.' });
                return;
            }
            const ok = await verifyPinInput(pin);
            if (ok) {
                // Always remember / mark unlocked on correct PIN (no checkbox)
                localStorage.setItem(PIN_UNLOCKED_KEY, '1');
                hidePinOverlay();
                resolve(true);
            } else {
                // show inline error: red border + small shake, then keep focus
                const $inp = $('#pinInput');
                // remove classes to restart animation
                $inp.removeClass('pin-error shake');
                // force reflow to restart animation
                // eslint-disable-next-line no-unused-expressions
                $inp[0].offsetWidth;
                $inp.addClass('pin-error shake');
                $inp.focus();

                // remove the shake class after animation so it can replay next time
                setTimeout(() => $inp.removeClass('shake'), 400);
                // when user starts typing again, remove error state
                $inp.off('input.pinClear').on('input.pinClear', function () {
                    $(this).removeClass('pin-error');
                });
            }
        });

        // allow Enter key
        $('#pinInput').off('keydown').on('keydown', function (e) {
            if (e.key === 'Enter') { $('#pinSubmit').trigger('click'); }
        });
    });
}

// --- end PIN system ----------------------------------------------------------

function render() {
    const g = $("#weekGrid");
    g.empty();

    for (let i = 0; i < 6; i++) {
        const key = i;
        if (!data.days[key]) data.days[key] = [];

        const col = $('<div class="col"></div>');
        if (i === today) col.addClass("today");
        const meta = computeDayTimeMeta(i);

        const head = $(`
            <div class='dayhead'>
                <span class='dayname'>${DAYS[i]}</span>
                <button class='editbtn' data-day='${i}'>Editar</button>
            </div>
        `);

        col.append(head);
        const metaEl = $(`
            <div class='day-meta'>
                <span class='day-meta-time'>≈ ${meta.totalLabel}</span>
                <span class='day-meta-hours'>${meta.startLabel} → ${meta.endLabel}</span>
            </div>
        `);
        col.append(metaEl);

        data.days[key].forEach((ex, exIndex) => {
            const card = $("<div class='card' data-ex-index='" + exIndex + "'></div>");
            let html = `
                <div class='title'>
                        <div>
                            <b>${ex.name}</b>
                            ${ex.obs ? `<div class='small obs'>${ex.obs}</div>` : ''}
                        </div>
                    </div>
            `;

                        if (ex.series && ex.series.length) {
                                html += `
                                        <div class="table-wrap">
                                            <table class="series-table">
                                                <thead>
                                                    <tr>
                                                        <th>Série</th>
                                                        <th>Peso</th>
                                                        <th>Repetições</th>
                                                        <th>RPE</th>
                                                        <th>Descanso</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                `;

                                ex.series.forEach((s, idx) => {
                                        html += `
                                                    <tr>
                                                        <td>${idx + 1}</td>
                                                        <td>${s.peso || ''}</td>
                                                        <td>${s.reps || ''}</td>
                                                        <td>${s.rpe || ''}</td>
                                                        <td>${s.descanso || ''}</td>
                                                    </tr>
                                        `;
                                });

                                html += `
                                                </tbody>
                                            </table>
                                        </div>
                                `;
                        } else {
                                html += `<div class='small note'>Nenhuma série</div>`;
                        }

            card.html(html);
            col.append(card);
        });

        g.append(col);
    }
}

// initialize Sortable on each column (exercise reorder)
function initSortables() {
    $('.col').each(function () {
        const $col = $(this);
        if ($col.data('sortable')) return; // already initialized
        const day = $col.find('.editbtn').data('day');
        if (typeof day === 'undefined') return;
        new Sortable(this, {
            group: 'days',
            animation: 150,
            // Só arrastar pelo handle
            handle: '.drag-handle',
            // Exige segurar por 2000ms em dispositivos touch para iniciar o drag
            delay: 2000,
            delayOnTouchOnly: true,
            // Pequena tolerância para evitar cancela em taps
            fallbackTolerance: 5,
            onEnd: function (evt) {
                // compute new order by reading data-ex-index from cards
                const cards = $col.children('.card');
                const newOrder = cards.map((i, c) => parseInt($(c).attr('data-ex-index'))).get();
                const oldArr = data.days[day] || [];
                const newArr = newOrder.map(idx => oldArr[idx]);
                data.days[day] = newArr;
                save();
                render();
                initSortables();
                attemptSaveWithRetry();
            }
        });
        $col.data('sortable', true);
    });
}

$(document).on("click", ".editbtn", function () {
    const d = $(this).data("day");
    openEditor(d);
});

let currentDay = null;
let editingIndex = null;

function addSeriesRow(peso = '', reps = '', rpe = '', descanso = '') {
    const row = $(
        `<tr class='seriesitem'>
            <td class='col-index'></td>
            <td><input placeholder='Peso' value='${peso}'></td>
            <td><input placeholder='Repetições' value='${reps}'></td>
            <td><input placeholder='RPE' value='${rpe}'></td>
            <td><input placeholder='Descanso' value='${descanso}'></td>
            <td><button class='remove' aria-label='Remover série'><i class="bi bi-x-lg"></i></button></td>
        </tr>`
    );

    $("#seriesTableBody").append(row);
    // update indices
    updateSeriesIndices();
    return row;
}

function updateSeriesIndices() {
    $('#seriesTableBody').children('.seriesitem').each(function (i) {
        $(this).find('.col-index').text(i + 1);
    });
}

function openEditor(d, exIndex = null) {
    currentDay = d;
    editingIndex = exIndex;

    $("#modalWrap").removeClass("hidden").addClass("flex");
    $("#seriesTableBody").empty();
    $("#modalTitle").text(DAYS[d]);

    if (exIndex !== null && data.days[d] && data.days[d][exIndex]) {
        const ex = data.days[d][exIndex];
        $("#exerciseName").val(ex.name);
        $("#exerciseObs").val(ex.obs || '');
        (ex.series || []).forEach(s => addSeriesRow(s.peso || '', s.reps || '', s.rpe || '', s.descanso || ''));
        $("#deleteExercise").removeClass('hidden');
    } else {
        $("#exerciseName").val('');
        $("#exerciseObs").val('');
        $("#deleteExercise").addClass('hidden');
    }

    // initialize sortable for series list (allow reordering series inside modal)
    try {
        const el = document.getElementById('seriesTableBody');
        if (el && !$(el).data('sortable')) {
            new Sortable(el, { animation: 120, draggable: '.seriesitem' });
            $(el).data('sortable', true);
        }
    } catch (e) { console.warn('series sortable init failed', e); }
}

$("#closeModal").click(() => {
    $("#modalWrap").addClass("hidden").removeClass("flex");
});

$("#addSeries").click(() => {
    addSeriesRow('', '', '', '');
});

$(document).on("click", ".remove", function () {
    $(this).closest('tr').remove();
    updateSeriesIndices();
});

// clear validation state when user edits series inputs
$(document).on('input', '.seriesitem input', function () {
    $(this).removeClass('input-error');
});

$("#saveExercise").click(() => {
    const nm = $("#exerciseName").val().trim();
    if (!nm) return Swal.fire({ icon: 'warning', title: 'Nome obrigatório', text: 'Preencha o nome do exercício.' });

    const obs = $("#exerciseObs").val().trim();
    const series = [];

    let validationError = null;
    $(".seriesitem").each(function () {
        const i = $(this).find("input");
        const pesoVal = i.eq(0).val().trim();
        const repsVal = i.eq(1).val().trim();
        const rpeVal = i.eq(2).val().trim();
        const descVal = i.eq(3).val().trim();

        // clear previous error state
        i.removeClass('input-error');

        // validations
        if (rpeVal !== '') {
            const r = Number(rpeVal);
            if (!Number.isFinite(r) || r < 1 || r > 10) {
                validationError = 'RPE deve ser um número entre 1 e 10.';
                i.eq(1).addClass('input-error');
            }
        }

        if (pesoVal !== '') {
            const p = Number(pesoVal);
            if (!Number.isFinite(p) || p < 0) {
                validationError = 'Peso deve ser um número válido.';
                i.eq(0).addClass('input-error');
            }
        }

        if (repsVal !== '') {
            const rv = Number(repsVal);
            if (!Number.isInteger(rv) || rv < 0) {
                validationError = 'Repetições devem ser um número inteiro >= 0.';
                i.eq(1).addClass('input-error');
            }
        }

        if (descVal !== '') {
            const dval = Number(descVal);
            if (!Number.isFinite(dval) || dval < 0) {
                validationError = 'Descanso deve ser um número (ex.: segundos).';
                i.eq(3).addClass('input-error');
            }
        }

        series.push({ peso: pesoVal, reps: repsVal, rpe: rpeVal, descanso: descVal });
    });

    if (validationError) {
        showToast('warning', validationError);
        return;
    }
    if (!data.days[currentDay]) data.days[currentDay] = [];

    if (editingIndex !== null && data.days[currentDay] && data.days[currentDay][editingIndex]) {
        data.days[currentDay][editingIndex] = { name: nm, obs, series };
    } else {
        data.days[currentDay].push({ name: nm, obs, series });
    }
    save();
    showToast('success', 'Treino salvo');
    attemptSaveWithRetry();

    $("#modalWrap").addClass("hidden").removeClass("flex");
    editingIndex = null;
    render();
    initSortables();
});

$("#deleteExercise").click(async () => {
    if (editingIndex === null) return;
    const result = await Swal.fire({
        title: 'Excluir exercício?',
        text: 'Esta ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Excluir',
        cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

        if (data.days[currentDay] && data.days[currentDay][editingIndex]) {
            data.days[currentDay].splice(editingIndex, 1);
            save();
            showToast('success', 'Exercício removido');
            attemptSaveWithRetry();
        }

    editingIndex = null;
    $("#modalWrap").addClass("hidden").removeClass("flex");
    render();
    initSortables();
});

// --- Firestore fichas (estrutura nativa compat v9) ---------------------------
const STATIC_USER_ID = 'hNceMxA9i1O71wDSRpWAEuCU8et2';
let currentFichaId = null;
let currentFichaName = '';
let fichaNamesCache = {};
let currentFichaMap = {};
let unsubscribes = { fichas: null, dias: null };

function getFirestore() {
    initFirebaseIfNeeded();
    if (!firestoreDB) firestoreDB = (window.firebase && firebase.firestore && firebase.firestore()) || null;
    return firestoreDB;
}

// helpers
async function deleteCollectionDocs(colRef) {
    try {
        const snap = await colRef.get();
        const batch = getFirestore().batch();
        let count = 0;
        snap.forEach(d => {
            batch.delete(d.ref);
            count++;
        });
        if (count > 0) await batch.commit();
    } catch (e) {
        console.warn('deleteCollectionDocs error', e);
        // fallback delete individually
        try {
            const snap = await colRef.get();
            for (const d of snap.docs) await d.ref.delete();
        } catch (e2) { console.error('fallback delete failed', e2); }
    }
}

async function criarNovaFicha(userId, nome = null) {
    try {
        const db = getFirestore();
        if (!db) throw new Error('Firestore não inicializado');
        const nomeFicha = nome || (await Swal.fire({
            title: 'Nome da nova ficha',
            input: 'text',
            inputPlaceholder: 'Ex.: PowerBuilder Semana 1',
            showCancelButton: true
        })).value;
        if (!nomeFicha) return;

        const fichasCol = db.collection('app').doc('users').collection('users').doc(userId).collection('fichas');
        const docRef = await fichasCol.add({ nomeFicha, created_at: firebase.firestore.FieldValue.serverTimestamp() });

        // criar dias padrão com índice para mapear na UI
        const diasCol = docRef.collection('dias');
        for (let i = 0; i < DAYS.length; i++) {
            const d = await diasCol.add({ titulo: DAYS[i], index: i });
            // await d.collection('exercicios').add({ nome: 'Exemplo', obs: '' });
        }

        showToast('success', 'Ficha criada');
        // refresh list and select new ficha
        carregarFichas(userId, docRef.id);
    } catch (e) {
        console.error('criarNovaFicha error', e);
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível criar ficha.' });
    }
}

async function carregarFichas(userId, selectFichaId = null) {
    try {
        const db = getFirestore();
        if (!db) return;
        // unsub existing listener
        if (unsubscribes.fichas) { unsubscribes.fichas(); unsubscribes.fichas = null; }

        const fichasCol = db.collection('app').doc('users').collection('users').doc(userId).collection('fichas').orderBy('created_at', 'desc');
        // realtime update of fichas list
        unsubscribes.fichas = fichasCol.onSnapshot(snapshot => {
            const $sel = $('#fichaSelect');
            // build options quickly
            const currentVal = $sel.val();
            $sel.empty();
            fichaNamesCache = {};
            snapshot.forEach(doc => {
                const d = doc.data() || {};
                const displayName = d.nomeFicha || doc.id;
                fichaNamesCache[doc.id] = displayName;
                const opt = $('<option>').attr('value', doc.id).text(displayName);
                $sel.append(opt);
            });
            // update select2 view
            try {
                $sel.trigger('change.select2'); // refresh
            } catch(e){ /* ignore if not select2 */ }
            syncFichaSelectLabel();

            // pick an item: explicit param > last saved > first option
            if (selectFichaId) {
                $sel.val(selectFichaId).trigger('change');
            } else {
                const last = localStorage.getItem('last_ficha_id');
                if (last && $sel.find(`option[value="${last}"]`).length) {
                    $sel.val(last).trigger('change');
                } else {
                    // keep previously selected if still present, otherwise choose first
                    if (currentVal && $sel.find(`option[value="${currentVal}"]`).length) {
                        $sel.val(currentVal).trigger('change');
                    } else {
                        const first = $sel.find('option').first().val();
                        if (first) $sel.val(first).trigger('change');
                        else {
                            // no fichas: clear data rapidamente
                            currentFichaId = null;
                            currentFichaName = '';
                            data.days = {};
                            render();
                            initSortables();
                            syncFichaSelectLabel();
                        }
                    }
                }
            }
        }, err => {
            console.warn('fichas snapshot error', err);
            showToast('warning', 'Falha ao listar fichas');
        });

        // hookup change handler once (works with select2)
        $('#fichaSelect').off('change').on('change', function () {
            const f = $(this).val();
            if (f) {
                currentFichaName = $(this).find('option:selected').text() || '';
                localStorage.setItem('last_ficha_id', f);
                // quick local UI reset so user sees immediate response
                data.days = {};
                render();
                initSortables();
                // show lightweight loader and load ficha
                showFichaLoader(true);
                loadFicha(f);
            } else {
                currentFichaId = null;
                currentFichaName = '';
                syncFichaSelectLabel();
            }
            syncFichaSelectLabel();
        });
    } catch (e) {
        console.error('carregarFichas error', e);
    }
}

async function loadFicha(fichaId) {
    try {
        const db = getFirestore();
        if (!db) throw new Error('Firestore não ready');

        // Show lightweight loader and disable select to prevent multiple switches
        showFichaLoader(true);

        // unsubscribe previous dias listener
        if (unsubscribes.dias) { unsubscribes.dias(); unsubscribes.dias = null; }
        currentFichaId = fichaId;
        currentFichaMap = {};
        currentFichaName = fichaNamesCache[fichaId] || $('#fichaSelect').find('option:selected').text() || '';
        syncFichaSelectLabel();

        const baseDocRef = db.collection('app').doc('users').collection('users').doc(STATIC_USER_ID).collection('fichas').doc(fichaId);
        const diasColRef = baseDocRef.collection('dias').orderBy('index', 'asc');

        // realtime: on any change to dias collection, rebuild local data for the whole ficha
        unsubscribes.dias = diasColRef.onSnapshot(async snap => {
            try {
                // If empty, ensure days exist locally quickly to avoid long blank UI
                const daysTmp = {};
                for (let i = 0; i < 6; i++) daysTmp[i] = [];

                // Prepare parallel fetch for each day doc
                const dayFetchers = snap.docs.map(async (doc, docPos) => {
                    const diaData = doc.data() || {};
                    const idx = (typeof diaData.index === 'number') ? diaData.index : docPos;
                    const diaId = doc.id;
                    // fetch exercicios for this dia (concurrently)
                    const exSnap = await doc.ref.collection('exercicios').get();
                    // for each exercise, fetch series in parallel
                    const exPromises = exSnap.docs.map(async exDoc => {
                        const exData = exDoc.data() || {};
                        // fetch series
                        const seriesSnap = await exDoc.ref.collection('series').get().catch(()=> ({docs:[]}));
                        const seriesArr = seriesSnap.docs.map(sdoc => {
                            const s = sdoc.data() || {};
                            return { peso: s.peso, reps: s.reps, rpe: s.rpe, descanso: s.descanso };
                        });
                        return { id: exDoc.id, name: exData.nome || '', obs: exData.obs || '', series: seriesArr };
                    });
                    const exArrWithIds = await Promise.all(exPromises);
                    return { idx, diaId, exercises: exArrWithIds };
                });

                // run all day fetchers in parallel
                const dayResults = await Promise.all(dayFetchers);

                // assemble daysTmp and mapping
                const mapTmp = {};
                dayResults.forEach(dr => {
                    if (typeof dr.idx === 'number') {
                        daysTmp[dr.idx] = dr.exercises.map(e => ({ name: e.name, obs: e.obs, series: e.series }));
                        mapTmp[dr.idx] = { id: dr.diaId, exercicios: dr.exercises.map(e=> e.id) };
                    }
                });

                // fill missing days with empty arrays (already initialized)
                data.days = daysTmp;
                currentFichaMap = { dias: mapTmp };
                save(); // persist local copy quickly
                render();
                initSortables();
            } catch (e) {
                console.warn('dias snapshot processing error', e);
                showToast('warning', 'Erro ao processar dados da ficha');
            } finally {
                // hide lightweight loader as soon as we processed the snapshot
                showFichaLoader(false);
            }
        }, err => {
            console.warn('dias snapshot error', err);
            // hide loader and notify via toast (no blocking modal)
            showFichaLoader(false);
            showToast('warning', 'Falha ao receber atualizações em tempo real.');
        });

    } catch (e) {
        console.error('loadFicha error', e);
        showFichaLoader(false);
        showToast('warning', 'Erro ao carregar ficha');
    }
}

// --- Integrations: JSON import/export, Mistral AI, etc. ----------------------

function createHiddenImportInput() {
    if (document.getElementById('jsonImportInput')) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.id = 'jsonImportInput';
    input.style.display = 'none';
    input.addEventListener('change', handleJsonImportFile);
    document.body.appendChild(input);
}

function triggerJsonImport() {
    let input = document.getElementById('jsonImportInput');
    if (!input) {
        createHiddenImportInput();
        input = document.getElementById('jsonImportInput');
    }
    if (input) input.click();
}

function exportTrainingJSON() {
    try {
        const payload = {
            version: 'treinos_v1',
            exportedAt: new Date().toISOString(),
            fichaId: currentFichaId,
            days: data.days || {}
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `treinos-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('success', 'JSON exportado');
    } catch (e) {
        console.error('exportTrainingJSON error', e);
        Swal.fire({ icon: 'error', title: 'Falha ao exportar', text: e && e.message ? e.message : 'Erro inesperado.' });
    }
}

function handleJsonImportFile(evt) {
    const file = evt.target.files && evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            await applyImportedData(parsed);
            showToast('success', 'Importação concluída');
        } catch (err) {
            console.error('JSON import error', err);
            Swal.fire({ icon: 'error', title: 'Importação falhou', text: err && err.message ? err.message : 'Arquivo inválido.' });
        } finally {
            evt.target.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function applyImportedData(payload) {
    const daysPayload = payload && payload.days ? payload.days : payload;
    if (!daysPayload || typeof daysPayload !== 'object') throw new Error('Arquivo não contém estrutura "days".');

    const normalized = {};
    for (let i = 0; i < DAYS.length; i++) {
        const entry = daysPayload[i] || daysPayload[DAYS[i]] || [];
        if (!Array.isArray(entry)) {
            normalized[i] = [];
            continue;
        }
        normalized[i] = entry.map(ex => ({
            name: (ex && ex.name) || '',
            obs: (ex && ex.obs) || '',
            series: Array.isArray(ex && ex.series) ? ex.series.map(s => ({
                peso: (s && s.peso) || '',
                reps: (s && s.reps) || '',
                rpe: (s && s.rpe) || '',
                descanso: (s && s.descanso) || ''
            })) : []
        }));
    }

    data.days = normalized;
    save();
    render();
    initSortables();
    attemptSaveWithRetry();

    if (currentFichaId !== null) {
        for (let i = 0; i < DAYS.length; i++) {
            try {
                await persistEntireDayToFirestore(i);
            } catch (e) {
                console.warn('persist day after import failed', i, e);
            }
        }
    }
}

async function persistEntireDayToFirestore(dayIndex) {
    if (currentFichaId === null) return;
    if (typeof dayIndex !== 'number' || dayIndex < 0 || dayIndex >= DAYS.length) return;

    const db = getFirestore();
    if (!db) throw new Error('Firestore não inicializado');
    if (!currentFichaMap.dias) currentFichaMap.dias = {};

    const fichaDoc = db.collection('app').doc('users').collection('users').doc(STATIC_USER_ID).collection('fichas').doc(currentFichaId);
    const diasCol = fichaDoc.collection('dias');

    let dayInfo = currentFichaMap.dias[dayIndex];
    let diaRef;

    if (dayInfo && dayInfo.id) {
        diaRef = diasCol.doc(dayInfo.id);
        await diaRef.set({ titulo: DAYS[dayIndex], index: dayIndex }, { merge: true });
    } else {
        diaRef = await diasCol.add({ titulo: DAYS[dayIndex], index: dayIndex });
        currentFichaMap.dias[dayIndex] = { id: diaRef.id, exercicios: [] };
    }

    const exerciciosCol = diaRef.collection('exercicios');
    const existingSnap = await exerciciosCol.get();
    if (!existingSnap.empty) {
        const batch = db.batch();
        existingSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    const dayExercises = Array.isArray(data.days[dayIndex]) ? data.days[dayIndex] : [];
    for (const ex of dayExercises) {
        const exDoc = await exerciciosCol.add({
            nome: ex && ex.name ? ex.name : '',
            obs: ex && ex.obs ? ex.obs : ''
        });
        if (Array.isArray(ex && ex.series)) {
            const seriesCol = exDoc.collection('series');
            for (const s of ex.series) {
                await seriesCol.add({
                    peso: s && s.peso ? s.peso : '',
                    reps: s && s.reps ? s.reps : '',
                    rpe: s && s.rpe ? s.rpe : '',
                    descanso: s && s.descanso ? s.descanso : ''
                });
            }
        }
    }
}

function openFichaModal() {
    if (!currentFichaId) {
        Swal.fire({ icon: 'info', title: 'Selecione uma ficha', text: 'Escolha uma ficha antes de editar.' });
        return;
    }
    const name = currentFichaName || fichaNamesCache[currentFichaId] || $('#fichaSelect').find('option:selected').text() || '';
    $('#fichaNameInput').val(name);
    $('#fichaModalWrap').removeClass('hidden').addClass('flex');
}

function closeFichaModal() {
    $('#fichaModalWrap').addClass('hidden').removeClass('flex');
}

async function renameCurrentFicha(newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
        Swal.fire({ icon: 'warning', title: 'Nome obrigatório', text: 'Informe um nome para a ficha.' });
        return;
    }
    if (!currentFichaId) return;
    const db = getFirestore();
    if (!db) throw new Error('Firestore não inicializado');
    const fichaDoc = db.collection('app').doc('users').collection('users').doc(STATIC_USER_ID).collection('fichas').doc(currentFichaId);
    await fichaDoc.set({ nomeFicha: trimmed }, { merge: true });
    currentFichaName = trimmed;
    fichaNamesCache[currentFichaId] = trimmed;
    const $sel = $('#fichaSelect');
    $sel.find(`option[value="${currentFichaId}"]`).text(trimmed);
    syncFichaSelectLabel();
    showToast('success', 'Ficha renomeada');
}

async function cascadeDeleteFicha(fichaId) {
    const db = getFirestore();
    if (!db) throw new Error('Firestore não inicializado');
    const fichaDoc = db.collection('app').doc('users').collection('users').doc(STATIC_USER_ID).collection('fichas').doc(fichaId);
    const diasSnap = await fichaDoc.collection('dias').get();
    for (const diaDoc of diasSnap.docs) {
        const exerciciosSnap = await diaDoc.ref.collection('exercicios').get();
        for (const exDoc of exerciciosSnap.docs) {
            const seriesSnap = await exDoc.ref.collection('series').get();
            for (const serieDoc of seriesSnap.docs) {
                await serieDoc.ref.delete();
            }
            await exDoc.ref.delete();
        }
        await diaDoc.ref.delete();
    }
    await fichaDoc.delete();
}

async function deleteCurrentFicha() {
    if (!currentFichaId) return;
    const confirm = await Swal.fire({
        title: 'Excluir ficha?',
        text: 'Todos os dias e exercícios serão removidos.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Excluir',
        cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;

    Swal.fire({ title: 'Excluindo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        if (unsubscribes.dias) { unsubscribes.dias(); unsubscribes.dias = null; }
        await cascadeDeleteFicha(currentFichaId);
        currentFichaId = null;
        currentFichaName = '';
        currentFichaMap = {};
        data.days = {};
        render();
        initSortables();
        syncFichaSelectLabel();
        Swal.close();
        closeFichaModal();
        showToast('success', 'Ficha removida');
    } catch (e) {
        console.error('delete ficha error', e);
        Swal.close();
        Swal.fire({ icon: 'error', title: 'Erro ao excluir', text: e && e.message ? e.message : 'Falha inesperada.' });
    }
}

// patch existing saveExercise handler to persist to Firestore after local save
// find the block where $("#saveExercise").click(() => { ... }) is defined and inside it,
// after save(); attemptSaveWithRetry(); add a call to persistEntireDayToFirestore(currentDay);

// We'll insert a small patch here to wire it (safe to call even if currentFichaId is null)
(function attachPersistenceHooks() {
    // Save hook already defined in code; we add an extra click handler that runs after
    $('#saveExercise').on('click', async function () {
        // small delay to allow original handler to finish updating data
        setTimeout(async () => {
            try {
                if (currentFichaId !== null) await persistEntireDayToFirestore(currentDay);
            } catch (e) {
                console.warn('post-save persistence failed', e);
            }
        }, 120);
    });

    $('#deleteExercise').on('click', async function () {
        // original handler deletes locally; after that, persist day
        setTimeout(async () => {
            try {
                if (currentFichaId !== null) await persistEntireDayToFirestore(currentDay);
            } catch (e) {
                console.warn('post-delete persistence failed', e);
            }
        }, 120);
    });

    // reorder: replace previous onEnd action call to also persist entire day
    // We patch by delegating to initSortables existing behavior; add additional listener to persist after re-render
    // Add a small global hook: whenever render() runs, we ensure initSortables called; but to persist reorder, we attach to sortable's onEnd in initSortables already.
    // To be safe, also listen for mouseup on .col to trigger persistence (no-op if nothing changed).
    $(document).on('mouseup touchend', '.col', async function () {
        // try to persist each column that belongs to currentFichaId
        try {
            if (!currentFichaId) return;
            const day = $(this).find('.editbtn').data('day');
            if (typeof day !== 'undefined') {
                await persistEntireDayToFirestore(day);
            }
        } catch (e) {
            // ignore noisy errors
        }
    });
})();

// Run PIN lock flow before initializing app UI
(async function initApp() {
    try {
        const ok = await lockCheckFlow();
        if (!ok) return;
    } catch (e) {
        console.error('PIN flow error', e);
    }

    // initial render uses localStorage; then try to sync remote
    render();
    initSortables();
    trySyncOnLoad();
    // restore previously selected tab and load chat messages
    try {
        restoreTab();
        loadChat();
    } catch (e) { console.warn('tab/chat restore failed', e); }
})();

$(document).on('click', '.card', function (e) {
    const day = $(this).closest('.col').find('.editbtn').data('day');
    const idx = $(this).index() - 1;
    const cards = $(this).closest('.col').children('.card');
    const cardIndex = cards.index(this);
    openEditor(day, cardIndex);
});

// added: lightweight ficha loader control (no Swal modal)
function showFichaLoader(show) {
    const $loader = $('#fichaLoader');
    const $sel = $('#fichaSelect');
    const toggleSelect2Overlay = (enable) => {
        if (!$sel.hasClass('select2-hidden-accessible')) return;
        const inst = $sel.data('select2');
        if (inst && inst.$container) {
            inst.$container.toggleClass('select-disabled-overlay', !enable);
        }
    };

    if (show) {
        $loader.show();
        $sel.addClass('select-disabled-overlay');
        $sel.prop('disabled', true);
        toggleSelect2Overlay(false);
    } else {
        $loader.hide();
        $sel.removeClass('select-disabled-overlay');
        $sel.prop('disabled', false);
        toggleSelect2Overlay(true);
    }
}

function syncFichaSelectLabel() {
    const $sel = $('#fichaSelect');
    if (!$sel.length) return;
    const text = $sel.find('option:selected').text() || '';
    if ($sel.hasClass('select2-hidden-accessible')) {
        const inst = $sel.data('select2');
        if (inst && inst.$container) {
            inst.$container.find('.select2-selection__rendered').text(text).attr('title', text);
            inst.$container.find('.select2-selection__rendered').attr('title', text);
        }
    }
}

// initialize Select2 and wire ficha select on DOM ready (run earlier in $(function(){...}))
$(function () {
    // ensure hidden input exists for import/export features
    createHiddenImportInput();

    // init select2 on fichaSelect if available
    try {
        const $sel = $('#fichaSelect');
        if ($sel.length && $.fn.select2) {
            $sel.select2({
                placeholder: 'Selecione a ficha',
                width: 'resolve',
                dropdownAutoWidth: true,
                // small CSS class to help customize if needed
                dropdownCssClass: 'select2-dark'
            });
        }
    } catch (e) {
        console.warn('Select2 init failed', e);
    }

    // hook up export/import buttons (already present in previous code)
    $('#exportJsonBtn').off('click').on('click', function () { exportTrainingJSON(); });
    $('#importJsonBtn').off('click').on('click', function () { triggerJsonImport(); });

    $('#manageFichaBtn').off('click').on('click', openFichaModal);
    $('#fichaModalClose').off('click').on('click', closeFichaModal);
    $('#fichaSaveBtn').off('click').on('click', async function () {
        try {
            await renameCurrentFicha($('#fichaNameInput').val());
            closeFichaModal();
        } catch (e) {
            console.warn('rename ficha error', e);
        }
    });
    $('#fichaDeleteBtn').off('click').on('click', async function () {
        await deleteCurrentFicha();
    });

    // start loading fichas (carregarFichas will not show modal)
    try {
        carregarFichas(STATIC_USER_ID);
    } catch (e) {
        console.warn('carregarFichas init failed', e);
    }

    // hookup new ficha button
    $('#newFichaBtn').off('click').on('click', function () {
        criarNovaFicha(STATIC_USER_ID);
    });

    $('#calendarPrev').off('click').on('click', function () {
        calendarState = addDays(calendarState, -CALENDAR_VISIBLE_WEEKS * 7);
        saveCalendarState();
        renderCalendarWeeks();
    });
    $('#calendarNext').off('click').on('click', function () {
        calendarState = addDays(calendarState, CALENDAR_VISIBLE_WEEKS * 7);
        saveCalendarState();
        renderCalendarWeeks();
    });

    $(document).off('click.calendarWeekEdit').on('click.calendarWeekEdit', '.week-edit', function () {
        const weekKey = $(this).data('weekKey');
        if (!weekKey) return;
        openWeekModal(weekKey);
    });

    $(document).off('click.calendarWeekDay').on('click.calendarWeekDay', '.week-day', function () {
        const weekKey = $(this).data('weekKey');
        const dateKey = $(this).data('dateKey');
        if (!weekKey || !dateKey) return;
        openDayModal(weekKey, dateKey);
    });

    $(document).off('click.calendarWeekCard').on('click.calendarWeekCard', '.calendar-week-card', function (e) {
        if ($(e.target).closest('.week-day, .week-edit').length) return;
        const weekKey = $(this).data('weekKey');
        if (!weekKey) return;
        openWeekModal(weekKey);
    });
    $(document).off('keydown.calendarWeekCard').on('keydown.calendarWeekCard', '.calendar-week-card', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ($(e.target).closest('.week-day, .week-edit').length) return;
        e.preventDefault();
        const weekKey = $(this).data('weekKey');
        if (!weekKey) return;
        openWeekModal(weekKey);
    });

    $('#weekModalSave').off('click').on('click', async function () {
        if (!weekModalKey) return;
        const targetWeek = weekModalKey;
        const entry = ensureWeekEntry(targetWeek);
        entry.type = $('#weekTypeSelect').val() || 'Base';
        const loadVal = parseInt($('#weekLoadInput').val(), 10);
        entry.load = Number.isFinite(loadVal) ? Math.min(150, Math.max(0, loadVal)) : 100;
        entry.note = $('#weekNoteInput').val().trim();
        saveCalendarData();
        closeWeekModal();
        renderCalendarWeeks();
        try {
            await persistWeekToFirestore(targetWeek);
            showToast('success', 'Semana salva');
        } catch (e) {
            console.warn('persistWeekToFirestore failed', e);
            showToast('warning', 'Falha ao sincronizar semana');
        }
    });
    $('#weekModalClose').off('click').on('click', function () {
        closeWeekModal();
    });

    $('#dayModalSave').off('click').on('click', async function () {
        const ctx = { ...dayModalContext };
        if (!ctx.weekKey || !ctx.dateKey) return;
        const entry = ensureWeekEntry(ctx.weekKey);
        if (!entry.days) entry.days = {};
        const note = $('#dayNoteInput').val().trim();
        if (note) entry.days[ctx.dateKey] = note;
        else delete entry.days[ctx.dateKey];
        saveCalendarData();
        closeDayModal();
        renderCalendarWeeks();
        try {
            await persistWeekToFirestore(ctx.weekKey);
            showToast('success', 'Anotação salva');
        } catch (e) {
            console.warn('persist day note failed', e);
            showToast('warning', 'Falha ao sincronizar anotação');
        }
    });
    $('#dayModalDelete').off('click').on('click', async function () {
        const ctx = { ...dayModalContext };
        if (!ctx.weekKey || !ctx.dateKey) return;
        const entry = ensureWeekEntry(ctx.weekKey);
        if (entry.days && entry.days[ctx.dateKey]) {
            delete entry.days[ctx.dateKey];
            saveCalendarData();
        }
        closeDayModal();
        renderCalendarWeeks();
        try {
            await persistWeekToFirestore(ctx.weekKey);
            showToast('success', 'Anotação removida');
        } catch (e) {
            console.warn('delete day note sync failed', e);
            showToast('warning', 'Falha ao sincronizar anotação');
        }
    });
    $('#dayModalClose').off('click').on('click', function () {
        closeDayModal();
    });

    renderCalendarWeeks();
    initCalendarRealtime();
});