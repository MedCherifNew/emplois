/**
 * Analyseur d'Emplois du Temps - v3.0
 * Ce script est spécifiquement conçu pour gérer les cellules complexes,
 * y compris les cellules divisées (multiples cours dans un même créneau)
 * et les étiquettes de groupe (ex: "Group 1").
 */

// Configuration de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;

// Éléments du DOM
const fileInput = document.getElementById('pdf-file-input');
const loader = document.getElementById('loader');
const tableContainer = document.getElementById('table-container');
const filtersContainer = document.getElementById('filters');
const applyFiltersBtn = document.getElementById('apply-filters-btn');

let fullScheduleData = [];

// === GESTIONNAIRES D'ÉVÉNEMENTS ===

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    loader.classList.remove('hidden');
    tableContainer.innerHTML = `<p class="initial-message">Analyse du PDF en cours...</p>`;
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
                fullScheduleData.push(...pageData); // Use spread syntax to merge arrays
            }

            if (fullScheduleData.length > 0) {
                populateFilters(fullScheduleData);
                displayDataTable(fullScheduleData);
                filtersContainer.classList.remove('hidden');
            } else {
                tableContainer.innerHTML = `<p class="initial-message">Aucune donnée n'a pu être extraite. Le format du PDF n'est peut-être pas reconnu.</p>`;
            }
            loader.classList.add('hidden');
        };
        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error("Erreur critique lors du traitement du PDF:", error);
        tableContainer.innerHTML = "<p class='initial-message'>Une erreur est survenue. Vérifiez la console pour plus de détails.</p>";
        loader.classList.add('hidden');
    }
});

applyFiltersBtn.addEventListener('click', () => {
    const selectedClasses = getSelectedOptions('class-filter');
    const selectedDays = getSelectedOptions('day-filter');
    const selectedSubjects = getSelectedOptions('subject-filter');

    const filteredData = fullScheduleData.filter(item => {
        const classMatch = !selectedClasses.length || selectedClasses.includes(item.classe);
        const dayMatch = !selectedDays.length || selectedDays.includes(item.jour);
        const subjectMatch = !selectedSubjects.length || selectedSubjects.includes(item.matiere);
        return classMatch && dayMatch && subjectMatch;
    });

    displayDataTable(filteredData);
});


// === NOUVELLE LOGIQUE D'ANALYSE DU PDF (AMÉLIORÉE) ===

async function parseTimetablePage(page) {
    const textContent = await page.getTextContent();
    const items = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        height: item.height,
        width: item.width
    }));

    // Détection du nom de la classe
    const title = items.find(it => it.y > 750 && it.height > 20 && it.text.trim());
    const className = title ? title.text.trim() : `Page ${page.pageNumber}`;

    // Détection des jours et de leurs positions en X
    const anchorDay = items.find(it => it.text.trim().toLowerCase() === 'sunday');
    if (!anchorDay) return [];
    const days = items.filter(it => Math.abs(it.y - anchorDay.y) < 5 && it.text.trim().length > 3)
        .sort((a, b) => a.x - b.x);

    // Détection des périodes et horaires sur la gauche
    const periods = items
        .filter(it => /^\d$/.test(it.text.trim()) && it.x < 100)
        .sort((a, b) => b.y - a.y)
        .map(pItem => ({
            period: pItem.text.trim(),
            time: items.find(tItem => Math.abs(tItem.y - pItem.y) < 5 && tItem.text.includes(':'))?.text || '',
            y: pItem.y,
            height: pItem.height
        }));

    if (days.length === 0 || periods.length === 0) return [];

    const extractedData = [];

    // Itération sur chaque créneau (période, jour)
    for (const period of periods) {
        for (let i = 0; i < days.length; i++) {
            const day = days[i];
            const nextDay = days[i + 1];
            const prevPeriod = periods.find(p => p.y > period.y);

            // Définir la "boîte" qui délimite le créneau horaire
            const x_start = day.x - 10;
            const x_end = nextDay ? nextDay.x - 10 : 1000;
            const y_start = period.y - period.height - 10;
            const y_end = prevPeriod ? prevPeriod.y - prevPeriod.height - 10 : 1000;

            const cellItems = items.filter(it =>
                it.x > x_start && it.x < x_end &&
                it.y > y_start && it.y < y_end &&
                it.text.trim() !== ''
            );

            if (cellItems.length === 0) continue;

            // *** NOUVELLE LOGIQUE POUR GÉRER LES CELLULES DIVISÉES ***
            cellItems.sort((a, b) => a.x - b.x);
            const subCells = [];
            let currentSubCell = [];
            if (cellItems.length > 0) {
                currentSubCell.push(cellItems[0]);
                for (let k = 1; k < cellItems.length; k++) {
                    const prevItem = cellItems[k - 1];
                    const currentItem = cellItems[k];
                    // Si un grand écart horizontal est détecté, c'est une nouvelle sous-cellule
                    if (currentItem.x - (prevItem.x + prevItem.width) > 15) {
                        subCells.push(currentSubCell);
                        currentSubCell = [];
                    }
                    currentSubCell.push(currentItem);
                }
                subCells.push(currentSubCell);
            }
            
            // Traiter chaque sous-cellule comme un cours indépendant
            for (const subCell of subCells) {
                subCell.sort((a, b) => b.y - a.y); // Trier verticalement

                let groupLabel = '';
                const groupItemIndex = subCell.findIndex(it => it.text.trim().toLowerCase().startsWith('group'));
                if (groupItemIndex !== -1) {
                    groupLabel = ` (${subCell[groupItemIndex].text.trim()})`;
                    subCell.splice(groupItemIndex, 1);
                }

                if (subCell.length === 0) continue;

                const subject = subCell[0].text.trim() + groupLabel;
                const teacher = subCell.slice(1).map(it => it.text.trim()).join(' - ');

                extractedData.push({
                    classe: className,
                    jour: day.text,
                    horaire: period.time,
                    periode: period.period,
                    matiere: subject,
                    enseignant: teacher || 'N/A',
                });
            }
        }
    }
    return extractedData;
}


// === FONCTIONS D'AFFICHAGE ET UTILITAIRES (INCHANGÉES) ===

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

function displayDataTable(data) {
    if (!data || data.length === 0) {
        tableContainer.innerHTML = "<p class='initial-message'>Aucun résultat ne correspond à votre recherche.</p>";
        return;
    }
    const tableHTML = `
        <table>
            <thead>
                <tr>
                    <th>Classe</th>
                    <th>Jour</th>
                    <th>Horaire</th>
                    <th>Période</th>
                    <th>Matière</th>
                    <th>Enseignant</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(row => `
                    <tr>
                        <td>${row.classe || ''}</td>
                        <td>${row.jour || ''}</td>
                        <td>${row.horaire || ''}</td>
                        <td>${row.periode || ''}</td>
                        <td>${row.matiere || ''}</td>
                        <td>${row.enseignant || ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    tableContainer.innerHTML = tableHTML;
}

function getSelectedOptions(selectId) {
    return Array.from(document.getElementById(selectId).selectedOptions).map(option => option.value);
}
