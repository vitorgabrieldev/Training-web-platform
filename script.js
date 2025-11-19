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
        } else {
            // escape HTML to avoid accidental injection (we allow simple text and markdown)
            const safe = String(m.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            container.append(`<div class="${cls}">${safe}</div>`);
        }
    });
    container.scrollTop(container.prop('scrollHeight'));
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
    // find last loading message
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'loading') {
            msgs[i] = { role: 'ai', text, ts: Date.now() };
            localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
            return;
        }
    }
    // fallback: append
    msgs.push({ role: 'ai', text, ts: Date.now() });
    localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
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
        saveChatMessage('user', txt);
        $('#chatInput').val('');
        loadChat();

        // show temporary loading indicator
        saveChatMessage('ai', '...');
        loadChat();

        try {
            // Send via serverless proxy (Vercel): '/api/mistral' (uses server env key)
            const resp = await mistralProxySend(txt);
            saveChatMessage('ai', resp && resp.text ? resp.text : JSON.stringify(resp && resp.raw ? resp.raw : resp));
        } catch (err) {
            saveChatMessage('ai', 'Erro ao contatar o treinador: ' + (err && err.message ? err.message : String(err)));
        }
        loadChat();
    })();
});

// allow Enter to send in chat input
$('#chatInput').on('keydown', function (e) {
    if (e.key === 'Enter') { $('#chatSend').trigger('click'); }
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

        const head = $(`
            <div class='dayhead'>
                <span class='dayname'>${DAYS[i]}</span>
                <button class='editbtn' data-day='${i}'>Editar</button>
            </div>
        `);

        col.append(head);

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
            animation: 150,
            draggable: '.card',
            handle: '.card',
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
