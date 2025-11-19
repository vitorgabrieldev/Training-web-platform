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

        data.days[key].forEach(ex => {
            const card = $("<div class='card'></div>");
            let html = `
                <div class='title'>
                        <div>
                            <b>${ex.name}</b>
                            ${ex.obs ? `<div class='small obs'>${ex.obs}</div>` : ''}
                        </div>
                    </div>
            `;

            ex.series.forEach((s, idx) => {
                html += `
                    <div class='small series'>
                        Série ${idx + 1}: ${s.peso}kg RPE ${s.rpe} Desc ${s.descanso}
                    </div>
                `;
            });

            card.html(html);
            col.append(card);
        });

        g.append(col);
    }
}

$(document).on("click", ".editbtn", function () {
    const d = $(this).data("day");
    openEditor(d);
});

let currentDay = null;
let editingIndex = null;

function addSeriesRow(peso = '', rpe = '', descanso = '') {
    const row = $(
        `<div class='seriesitem'>
            <input placeholder='Peso' value='${peso}'>
            <input placeholder='RPE' value='${rpe}'>
            <input placeholder='Descanso' value='${descanso}'>
            <button class='remove' aria-label='Remover série'><i class="bi bi-x-lg"></i></button>
        </div>`
    );

    $("#seriesList").append(row);
    return row;
}

function openEditor(d, exIndex = null) {
    currentDay = d;
    editingIndex = exIndex;

    $("#modalWrap").removeClass("hidden").addClass("flex");
    $("#seriesList").empty();
    $("#modalTitle").text(DAYS[d]);

    if (exIndex !== null && data.days[d] && data.days[d][exIndex]) {
        const ex = data.days[d][exIndex];
        $("#exerciseName").val(ex.name);
        $("#exerciseObs").val(ex.obs || '');
        (ex.series || []).forEach(s => addSeriesRow(s.peso || '', s.rpe || '', s.descanso || ''));
        $("#deleteExercise").removeClass('hidden');
    } else {
        $("#exerciseName").val('');
        $("#exerciseObs").val('');
        $("#deleteExercise").addClass('hidden');
    }
}

$("#closeModal").click(() => {
    $("#modalWrap").addClass("hidden").removeClass("flex");
});

$("#addSeries").click(() => {
    const row = $(`
        <div class='seriesitem'>
            <input placeholder='Peso'>
            <input placeholder='RPE'>
            <input placeholder='Descanso'>
            <button class='remove' aria-label='Remover série'><i class="bi bi-x-lg"></i></button>
        </div>
    `);

    $("#seriesList").append(row);
});

$(document).on("click", ".remove", function () {
    $(this).parent().remove();
});

$("#saveExercise").click(() => {
    const nm = $("#exerciseName").val().trim();
    if (!nm) return Swal.fire({ icon: 'warning', title: 'Nome obrigatório', text: 'Preencha o nome do exercício.' });

    const obs = $("#exerciseObs").val().trim();
    const series = [];

    $(".seriesitem").each(function () {
        const i = $(this).find("input");
        series.push({
            peso: i.eq(0).val(),
            rpe: i.eq(1).val(),
            descanso: i.eq(2).val()
        });
    });
    if (!data.days[currentDay]) data.days[currentDay] = [];

    if (editingIndex !== null && data.days[currentDay] && data.days[currentDay][editingIndex]) {
        data.days[currentDay][editingIndex] = { name: nm, obs, series };
    } else {
        data.days[currentDay].push({ name: nm, obs, series });
    }
    save();
    saveRemoteData(data).catch(err => {
        console.warn('saveRemoteData failed', err);
        const m = err && err.message ? err.message : String(err);
        Swal.fire({ icon: 'warning', title: 'Não sincronizado', html: `O treino foi salvo localmente, mas não sincronizado com o servidor.<br><small style="opacity:.8">${m}</small>` });
    });

    $("#modalWrap").addClass("hidden").removeClass("flex");
    editingIndex = null;
    render();
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
        saveRemoteData(data).catch(err => {
            console.warn('saveRemoteData failed', err);
            const m = err && err.message ? err.message : String(err);
            Swal.fire({ icon: 'warning', title: 'Não sincronizado', html: `O treino foi removido localmente, mas a alteração não foi sincronizada.<br><small style="opacity:.8">${m}</small>` });
        });
    }

    editingIndex = null;
    $("#modalWrap").addClass("hidden").removeClass("flex");
    render();
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
    trySyncOnLoad();
})();

$(document).on('click', '.card', function (e) {
    const day = $(this).closest('.col').find('.editbtn').data('day');
    const idx = $(this).index() - 1;
    const cards = $(this).closest('.col').children('.card');
    const cardIndex = cards.index(this);
    openEditor(day, cardIndex);
});
