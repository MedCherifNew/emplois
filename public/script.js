// Configuration de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;

// Éléments du DOM
const fileInput = document.getElementById('pdf-file-input');
const loader = document.getElementById('loader');
const tableContainer = document.getElementById('table-container');
const filtersContainer = document.getElementById('filters');
const applyFiltersBtn = document.getElementById('apply-filters-btn');

let fullScheduleData = []; // Stocke toutes les données extraites

// Événement pour le téléversement de fichier
fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    loader.classList.remove('hidden');
    tableContainer.innerHTML = '';
    filtersContainer.classList.add('hidden');
    fullScheduleData = [];

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const pageData = await parseTimetablePage(page);
                fullScheduleData = fullScheduleData.concat(pageData);
            }

            populateFilters(fullScheduleData);
            displayDataTable(fullScheduleData);
            loader.classList.add('hidden');
            filtersContainer.classList.remove('hidden');
        };
        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error("Erreur lors du traitement du PDF:", error);
        tableContainer.innerHTML = "<p>Une erreur est survenue. Assurez-vous que le PDF a une structure attendue.</p>";
        loader.classList.add('hidden');
    }
});

// Événement pour le bouton "Filtrer"
applyFiltersBtn.addEventListener('click', () => {
    const selectedClasses = getSelectedOptions('class-filter');
    const selectedDays = getSelectedOptions('day-filter');
    const selectedSubjects = getSelectedOptions('subject-filter');

    const filteredData = fullScheduleData.filter(item => {
        const classMatch = selectedClasses.length === 0 || selectedClasses.includes(item.classe);
        const dayMatch = selectedDays.length === 0 || selectedDays.includes(item.jour);
        const subjectMatch = selectedSubjects.length === 0 || selectedSubjects.includes(item.matiere);
        return classMatch && dayMatch && subjectMatch;
    });

    displayDataTable(filteredData);
});

/**
 * Analyse une page du PDF pour en extraire les données.
 */
async function parseTimetablePage(page) {
    const textContent = await page.getTextContent();
    const items = textContent.items;

    const classNameItem = items.find(item => item.height > 15 && item.transform[5] > 750 && item.str.trim() !== '');
    const className = classNameItem ? classNameItem.str.trim() : `Page Inconnue ${page.pageNumber}`;

    const days = items.filter(item => item.transform[5] > 700 && item.transform[5] < 750 && item.height > 10 && item.str.trim() !== '')
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(item => ({ name: item.str, x: item.transform[4] }));

    const periods = items.filter(item => /^\d$/.test(item.str.trim()) && item.transform[4] < 100)
        .sort((a, b) => b.transform[5] - a.transform[5])
        .map(item => ({
            period: item.str,
            y: item.transform[5],
            time: items.find(timeItem =>
                Math.abs(timeItem.transform[5] - item.transform[5]) < 5 && timeItem.str.includes(':')
            )?.str || ''
        }));
    
    const extractedData = [];

    for (const period of periods) {
        for (const day of days) {
            const nextDay = days[days.indexOf(day) + 1];
            const nextPeriod = periods[periods.indexOf(period) - 1]; 

            const x_start = day.x - 10;
            const x_end = nextDay ? nextDay.x - 10 : 1000;
            const y_start = nextPeriod ? nextPeriod.y : 0;
            const y_end = period.y + 20;

            const cellItems = items.filter(item =>
                item.transform[4] > x_start && item.transform[4] < x_end &&
                item.transform[5] > y_start && item.transform[5] < y_end &&
                !/^\d$/.test(item.str.trim()) && item.str.trim().length > 1 && !item.str.includes(':')
            ).sort((a, b) => b.transform[5] - a.transform[5]); 

            if (cellItems.length > 0) {
                const subject = cellItems[0]?.str || 'N/A';
                const teacher = cellItems.slice(1).map(i => i.str).join(' - ') || 'N/A';

                extractedData.push({
                    classe: className,
                    jour: day.name,
                    horaire: period.time,
                    periode: period.period,
                    matiere: subject,
                    enseignant: teacher
                });
            }
        }
    }
    return extractedData;
}

/**
 * Remplit les listes de sélection des filtres.
 */
function populateFilters(data) {
    const classes = [...new Set(data.map(item => item.classe))].sort();
    const days = [...new Set(data.map(item => item.jour))];
    const subjects = [...new Set(data.map(item => item.matiere))].sort();

    populateSelect('class-filter', classes);
    populateSelect('day-filter', days);
    populateSelect('subject-filter', subjects);
}

function populateSelect(selectId, options) {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
    });
}

/**
 * Affiche les données dans un tableau HTML.
 */
function displayDataTable(data) {
    if (data.length === 0) {
        tableContainer.innerHTML = "<p class='initial-message'>Aucun résultat ne correspond à votre recherche.</p>";
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const headers = ["Classe", "Jour", "Horaire", "Période", "Matière", "Enseignant"];
    const headerRow = document.createElement('tr');
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    data.forEach(rowData => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${rowData.classe}</td>
            <td>${rowData.jour}</td>
            <td>${rowData.horaire}</td>
            <td>${rowData.periode}</td>
            <td>${rowData.matiere}</td>
            <td>${rowData.enseignant}</td>
        `;
        tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
}

/**
 * Récupère les valeurs sélectionnées d'un <select multiple>.
 */
function getSelectedOptions(selectId) {
    const select = document.getElementById(selectId);
    return Array.from(select.selectedOptions).map(option => option.value);
}
