/**
 * Analyseur d'Emplois du Temps - v2.0
 * Ce script est optimisé pour être plus flexible dans la détection des éléments
 * en se basant sur leurs positions relatives plutôt que sur des coordonnées absolues.
 */

// Configuration de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;

// Éléments du DOM
const fileInput = document.getElementById('pdf-file-input');
const loader = document.getElementById('loader');
const tableContainer = document.getElementById('table-container');
const filtersContainer = document.getElementById('filters');
const applyFiltersBtn = document.getElementById('apply-filters-btn');

// Variable globale pour stocker les données extraites
let fullScheduleData = [];

// === GESTIONNAIRES D'ÉVÉNEMENTS ===

// 1. Gère le téléversement du fichier PDF
fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert("Veuillez sélectionner un fichier PDF valide.");
        return;
    }

    // Réinitialiser l'interface
    loader.classList.remove('hidden');
    tableContainer.innerHTML = `<p class="initial-message">Analyse du PDF en cours...</p>`;
    filtersContainer.classList.add('hidden');
    fullScheduleData = [];

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            
            // Traiter chaque page du PDF
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const pageData = await parseTimetablePage(page);
                fullScheduleData = fullScheduleData.concat(pageData);
            }

            if (fullScheduleData.length > 0) {
                // Si des données ont été trouvées, peupler les filtres et afficher le tableau
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
        tableContainer.innerHTML = "<p class='initial-message'>Une erreur est survenue. Vérifiez la console du navigateur pour plus de détails.</p>";
        loader.classList.add('hidden');
    }
});

// 2. Gère le clic sur le bouton "Filtrer"
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


// === LOGIQUE D'ANALYSE DU PDF ===

/**
 * Analyse une seule page du PDF pour en extraire la structure de l'emploi du temps.
 * @param {PDFPageProxy} page - L'objet page de PDF.js.
 * @returns {Array} - Un tableau d'objets contenant les informations de chaque cours.
 */
async function parseTimetablePage(page) {
    const textContent = await page.getTextContent();
    const items = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        height: item.height,
        width: item.width
    }));

    // 1. Détection du nom de la classe (plus robuste)
    // On cherche le texte le plus grand situé dans le haut de la page.
    const potentialTitles = items.filter(it => it.y > 750 && it.height > 15 && it.text.trim() !== '');
    const className = potentialTitles.length > 0 ? potentialTitles[0].text.trim() : `Page ${page.pageNumber}`;

    // 2. Détection des jours de la semaine (plus robuste)
    // On trouve un jour connu (ex: "Sunday") et on déduit les autres sur la même ligne.
    const anchorDay = items.find(it => it.text.trim().toLowerCase() === 'sunday');
    if (!anchorDay) return []; // Si on ne trouve pas les jours, on ne peut pas continuer
    
    const days = items.filter(it => Math.abs(it.y - anchorDay.y) < 5 && it.text.trim().length > 3)
        .sort((a, b) => a.x - b.x);

    // 3. Détection des périodes et horaires
    const periods = items
        .filter(it => /^\d$/.test(it.text.trim()) && it.x < 100) // Un seul chiffre, à gauche
        .sort((a, b) => b.y - a.y) // Trier du haut vers le bas
        .map(periodItem => {
            const timeItem = items.find(it => Math.abs(it.y - periodItem.y) < 5 && it.text.includes(':'));
            return {
                period: periodItem.text,
                time: timeItem ? timeItem.text : '',
                y: periodItem.y,
                height: periodItem.height
            };
        });

    if (days.length === 0 || periods.length === 0) return []; // Structure non reconnue

    const extractedData = [];

    // 4. Extraction du contenu de chaque cellule
    for (const period of periods) {
        for (let i = 0; i < days.length; i++) {
            const day = days[i];
            
            // Définir les limites de la cellule (bounding box)
            const nextDay = days[i + 1];
            const nextPeriodIndex = periods.findIndex(p => p.y < period.y);
            const nextPeriod = periods[nextPeriodIndex];
            
            const x_start = day.x - (day.width / 2);
            const x_end = nextDay ? (nextDay.x - (nextDay.width / 2)) : 1000;
            const y_end = period.y + period.height;
            const y_start = nextPeriod ? (nextPeriod.y + nextPeriod.height) : 0;
            
            // Trouver tous les textes à l'intérieur de cette cellule
            const cellItems = items.filter(it =>
                it.x > x_start && it.x < x_end &&
                it.y > y_start && it.y < y_end &&
                !it.text.includes(':') && // Exclure les horaires
                !/^\d$/.test(it.text.trim()) // Exclure les numéros de période
            ).sort((a, b) => b.y - a.y); // Trier de haut en bas

            if (cellItems.length > 0) {
                // Le premier item est la matière, le reste les enseignants
                const subject = cellItems[0].text.trim();
                const teacher = cellItems.slice(1).map(i => i.text.trim()).join(' - ');

                extractedData.push({
                    classe: className,
                    jour: day.text,
                    horaire: period.time,
                    periode: period.period,
                    matiere: subject,
                    enseignant: teacher || 'N/A'
                });
            }
        }
    }
    return extractedData;
}


// === FONCTIONS D'AFFICHAGE ===

/**
 * Remplit les listes de sélection des filtres avec des valeurs uniques.
 */
function populateFilters(data) {
    const classes = [...new Set(data.map(item => item.classe))].sort();
    const days = [...new Set(data.map(item => item.jour))]; // L'ordre est déjà bon
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
 * Affiche les données dans un tableau HTML dynamique.
 */
function displayDataTable(data) {
    if (!data || data.length === 0) {
        tableContainer.innerHTML = "<p class='initial-message'>Aucun résultat ne correspond à votre recherche.</p>";
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
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
                    <td>${row.classe}</td>
                    <td>${row.jour}</td>
                    <td>${row.horaire}</td>
                    <td>${row.periode}</td>
                    <td>${row.matiere}</td>
                    <td>${row.enseignant}</td>
                </tr>
            `).join('')}
        </tbody>
    `;

    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
}

/**
 * Récupère les valeurs sélectionnées d'un <select multiple>.
 */
function getSelectedOptions(selectId) {
    return Array.from(document.getElementById(selectId).selectedOptions).map(option => option.value);
}
