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

render();
trySyncOnLoad();

$(document).on('click', '.card', function (e) {
    const day = $(this).closest('.col').find('.editbtn').data('day');
    const idx = $(this).index() - 1;
    const cards = $(this).closest('.col').children('.card');
    const cardIndex = cards.index(this);
    openEditor(day, cardIndex);
});
