import { defaultOptions } from '../scripts/constants.js';

let apiMinValues = {
    minvotes: 0,
    votepercentage: 0.0
};

function getSelectedAiModel() {
    const modelChoice = document.getElementById('ai-model-choice').value;
    const customModel = document.getElementById('ai-model-custom').value.trim();
    if (modelChoice === 'custom') {
        return customModel || defaultOptions.aiModel;
    }
    return modelChoice;
}

function toggleCustomModelInput() {
    const modelChoice = document.getElementById('ai-model-choice').value;
    const customInput = document.getElementById('ai-model-custom');
    customInput.disabled = modelChoice !== 'custom';
}


async function loadApiMinValues() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            url: 'https://tekaku.hu/'
        }, async function(items) {
            try {
                const baseUrl = String(items.url || '').trim().replace(/\/+$/, '');
                if (!baseUrl) {
                    console.log('Skipping min settings fetch: empty URL');
                    updateMinimumDisplay();
                    resolve();
                    return;
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                let response;
                try {
                    response = await fetch(`${baseUrl}/minsettings`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        signal: controller.signal
                    });
                } finally {
                    clearTimeout(timeoutId);
                }
                
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    const minvotes = Number.parseInt(data?.minvotes, 10);
                    const votepercentage = Number.parseFloat(data?.votepercentage);
                    apiMinValues.minvotes = Number.isFinite(minvotes) ? minvotes : 0;
                    apiMinValues.votepercentage = Number.isFinite(votepercentage) ? votepercentage : 0.0;
                    console.log('Min settings fetched successfully:', apiMinValues);
                } else {
                    console.log('Failed to fetch min settings:', response.status, response.statusText);
                }
            } catch (error) {
                console.log('Error fetching min settings:', error);
            }
            updateMinimumDisplay();
            resolve();
        });
    });
}

function updateMinimumDisplay() {
    const minvotesDisplay = document.getElementById('minvotes-minimum');
    const votepercentageDisplay = document.getElementById('votepercentage-minimum');
    const riskOverrideEnabled = !!document.getElementById('risk-override-votepercentage')?.checked;
    
    if (minvotesDisplay && apiMinValues.minvotes > 0) {
        minvotesDisplay.textContent = `Minimum érték: ${apiMinValues.minvotes}`;
    } else if (minvotesDisplay) {
        minvotesDisplay.textContent = '';
    }
    
    if (votepercentageDisplay && apiMinValues.votepercentage > 0) {
        if (riskOverrideEnabled) {
            votepercentageDisplay.textContent = `API minimum: ${(apiMinValues.votepercentage * 100).toFixed(1)}% (felülbírálva)`;
            return;
        }
        votepercentageDisplay.textContent = `Minimum érték: ${(apiMinValues.votepercentage * 100).toFixed(1)}%`;
    } else if (votepercentageDisplay) {
        votepercentageDisplay.textContent = '';
    }
}

function saveOptions() {

    const modelChoice = document.getElementById('ai-model-choice').value;
    const customModel = document.getElementById('ai-model-custom').value.trim();
    if (modelChoice === 'custom' && !customModel) {
        alert('Egyedi modell választásakor add meg a modell azonosítóját is.');
        return;
    }

    const options = {
        minvotes: parseInt(document.getElementById('minvotes').value),
        votepercentage: parseInt(document.getElementById('votepercentage').value) / 100.0,
        contributer: document.getElementById('contributer').checked,
        riskOverrideVotepercentage: document.getElementById('risk-override-votepercentage').checked,
        url: document.getElementById('url').value,
        autoComplete: document.getElementById('auto-complete').checked,
        aiFallbackEnabled: document.getElementById('ai-fallback-enabled').checked,
        aiAskBeforeFallback: document.getElementById('ai-ask-before-fallback').checked,
        openRouterApiKey: document.getElementById('openrouter-api-key').value.trim(),
        aiModelChoice: modelChoice,
        aiModelCustom: customModel,
        aiModel: getSelectedAiModel(),
        isSetupComplete: true
    };
    if(apiMinValues.minvotes > 0 && options.minvotes < apiMinValues.minvotes) {
        alert(`A minimum leadott válaszok száma nem lehet kevesebb, mint ${apiMinValues.minvotes}`);
        return;
    }
    if(!options.riskOverrideVotepercentage && apiMinValues.votepercentage > 0 && options.votepercentage < apiMinValues.votepercentage) {
        alert(`Az azonos válasz aránya nem lehet kevesebb, mint ${(apiMinValues.votepercentage * 100).toFixed(1)}%`);
        return;
    }
    if(options.url.endsWith("/") == false) 
        options.url = options.url + "/";
    

    chrome.storage.sync.set(options, function() {
        const status = document.getElementById('status');
        status.textContent = 'Mentve';
        setTimeout(function() {
            status.textContent = '';
        }, 750);
        deleteSetupReminder();
    });
    restoreOptions();
}
function deleteSetupReminder() {
    const warning = document.getElementById('setup-warning');
    if (warning) {
        warning.remove();
    }
    const contributorCheckbox = document.getElementById('contributer');
    const contributorDiv = contributorCheckbox.closest('div[title]'); 
    if (contributorDiv) {
        contributorDiv.style.border = ""; 
        contributorDiv.style.backgroundColor = ""; 
        contributorDiv.style.padding = "";
        contributorDiv.style.borderRadius = "";
        contributorDiv.style.marginBottom = "";
        
        contributorCheckbox.style.outline = "";
        contributorCheckbox.style.outlineOffset = "";
    }
}

function restoreOptions() {
    chrome.storage.sync.get(defaultOptions, function(items) {
        if(items.minvotes == 0) {
            document.getElementById('minvotes').value = defaultOptions.minvotes;
        }
        else document.getElementById('minvotes').value = items.minvotes;

        if(items.votepercentage == 0.0) {
            document.getElementById('votepercentage').value = defaultOptions.votepercentage * 100.0;
        }
        else document.getElementById('votepercentage').value = items.votepercentage * 100.0;

        document.getElementById('contributer').checked = items.contributer;
        document.getElementById('risk-override-votepercentage').checked = !!items.riskOverrideVotepercentage;
        updateMinimumDisplay();
        if(items.url == '') {
            document.getElementById('url').value = defaultOptions.url;
        }
        else document.getElementById('url').value = items.url;
        document.getElementById('auto-complete').checked = items.autoComplete;
        document.getElementById('ai-fallback-enabled').checked = !!items.aiFallbackEnabled;
        document.getElementById('ai-ask-before-fallback').checked = !!items.aiAskBeforeFallback;
        document.getElementById('openrouter-api-key').value = items.openRouterApiKey || items.geminiApiKey || '';

        const modelChoice = items.aiModelChoice || items.aiModel || defaultOptions.aiModel;
        const modelChoiceSelect = document.getElementById('ai-model-choice');
        const hasPreset = Array.from(modelChoiceSelect.options).some(opt => opt.value === modelChoice);
        if (hasPreset) {
            modelChoiceSelect.value = modelChoice;
            document.getElementById('ai-model-custom').value = items.aiModelCustom || '';
        } else {
            modelChoiceSelect.value = 'custom';
            document.getElementById('ai-model-custom').value = items.aiModel || items.aiModelCustom || '';
        }
        toggleCustomModelInput();

        if (!items.isSetupComplete) {
            const contributorCheckbox = document.getElementById('contributer');
            if (!document.getElementById('setup-warning')) {
                
                const contributorDiv = contributorCheckbox.closest('div[title]'); 
                
                if (contributorDiv) {
                    contributorDiv.style.border = "3px solid #e51400";
                    contributorDiv.style.backgroundColor = "#fce8e6";
                    contributorDiv.style.padding = "15px";
                    contributorDiv.style.borderRadius = "5px";
                    contributorDiv.style.marginBottom = "10px";
                    
                    const message = document.createElement('div');
                    message.id = 'setup-warning';
                    message.style.color = "#a50f00";
                    message.style.fontWeight = "bold";
                    message.style.marginBottom = "10px";
                    message.style.fontSize = "1.1em";
                    message.innerText = "Ez itt fontos: Kérlek döntsd el, hogy elküldöd-e a megoldásaid a szerverünknek, hogy azokat felhasználhassuk később automata kitöltésre. Akkor kapcsold be, ha magabiztos vagy a tudásodban. Ha nem szeretnéd megosztani a megoldásaid, csak nyomj a 'Mentés' gombra.";
                    
                    contributorDiv.insertBefore(message, contributorDiv.firstChild);
                    
                    contributorCheckbox.style.outline = "2px solid #e51400";
                    contributorCheckbox.style.outlineOffset = "2px";
                }
            }
        }
    });
}
function showAdvanced() {
    const advanced = document.getElementById('advanced');
    if(advanced.style.display == 'none') {
        advanced.style.display = 'block';
        document.getElementById('advancedbutton').textContent = 'fejlesztői beállítások elrejtése';
    }
    else {
        advanced.style.display = 'none';
        document.getElementById('advancedbutton').textContent = 'fejlesztői beállítások megjelenítése';
    }
}

function resetDefaultOptions() {
    let defaultsForReset = {...defaultOptions};
    defaultsForReset.lastAnnouncement = new Date().toISOString();
    chrome.storage.sync.set(defaultsForReset, function() {
        const status = document.getElementById('status');
        status.textContent = 'Alapértelmezett beállítások visszaállítva.';
        setTimeout(function() {
            status.textContent = '';
            window.location.reload();
        }, 750);
    });
}

function setNotSavedStatus() {
    const status = document.getElementById('status');
    status.textContent = 'Mentés szükséges!';
}

document.getElementById('minvotes').addEventListener('input', function() {
    setNotSavedStatus();
});
document.getElementById('votepercentage').addEventListener('input', function() {
    setNotSavedStatus();
});
document.getElementById('contributer').addEventListener('change', setNotSavedStatus);
document.getElementById('risk-override-votepercentage').addEventListener('change', function() {
    updateMinimumDisplay();
    setNotSavedStatus();
});
document.getElementById('auto-complete').addEventListener('change', setNotSavedStatus);
document.getElementById('ai-fallback-enabled').addEventListener('change', setNotSavedStatus);
document.getElementById('ai-ask-before-fallback').addEventListener('change', setNotSavedStatus);
document.getElementById('openrouter-api-key').addEventListener('input', setNotSavedStatus);
document.getElementById('ai-model-choice').addEventListener('change', function() {
    toggleCustomModelInput();
    setNotSavedStatus();
});
document.getElementById('ai-model-custom').addEventListener('input', setNotSavedStatus);


document.getElementById('minvotes').addEventListener('change', function() {
    saveOptions();
});
document.getElementById('votepercentage').addEventListener('change', function() {
    saveOptions();
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        saveOptions();
    }
});

document.addEventListener('DOMContentLoaded', async function() {
    await loadApiMinValues();
    restoreOptions();
});
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('advancedbutton').addEventListener('click', showAdvanced);
document.getElementById('reset').addEventListener('click', resetDefaultOptions);

window.addEventListener('beforeunload', (event) => {
    const status = document.getElementById('status');
    if (status.textContent === 'Mentés szükséges!') {
        event.preventDefault();
    }
});
(async function() {
    await loadApiMinValues();
    restoreOptions();
})();