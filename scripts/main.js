/* global chrome */
import { taskStatus } from './task_statuses.js';
import { getUserID, hasAnswers, isThereTask, getTaskUniqueID, updateSelectedAnswers, getTask, getTaskDDfieldID } from '../task_logic/read_from_task.js';
import { writeAnswers} from '../task_logic/write_to_task.js';
import { autoNext, _DEBUG, taskFieldSelectors } from './constants.js';
import { blockUserInteraction, unblockUserInteraction, debugLog, fetchMinSettings, toggleTaskStatusesVisibility, isUIHidden, getInstallationKey} from './utils.js';
import { defaultOptions } from './constants.js';

function fetchTask(url, options) {
    return fetch(url, options).catch(error => {
        return {
            ok: false,
            status: 0,
            statusText: error.toString(),
            json: async () => null,
            text: async () => null
        };
    });
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

async function fetchTaskSolution(task) {
    let taskData = {
        ID: task.uniqueID,
        fieldCount: task.answerFields.length
    };
    
    // Get the unique installation key instead of URL parameter
    const installationKey = await getInstallationKey();
    
    let user = {
        name: settings.name,
        azonosito: (await getUserID()) || installationKey
    };
    
    try {
        //debugLog('Fetching solution for task:', task, 'and user:', user);
        const reply = await sendRequestToWebSocket({
            type: 'getSolution',
            task: taskData,
            user: user
        });
        if(reply.status != "ok"){
            debugLog('Error getting solution:', reply);
            debugLog('task sent:', reply);
            return;
        }
        //debugLog('Solution fetched successfully', reply);
        return reply.solution;
    }
    catch (error) {
        debugLog('Error fetching task from DB:', error);
        return;
    }
}

async function sendTaskSolution(task) {
    const taskData = {
        ID: task.uniqueID,
        solution: task.answerFields.map(field => field.value)
    };
    
    // Get the unique installation key instead of URL parameter
    const installationKey = await getInstallationKey();
    
    const user = {
        name: settings.name,
        azonosito: (await getUserID()) || installationKey,
    };
    try {
        const reply = await sendRequestToWebSocket({
            type: 'postSolution',
            task: taskData,
            user: user
        });
        //debugLog('Posting solution to DB:', task, 'for user:', user);
        if (reply && reply.status === "ok") {
            debugLog('Solution posted successfully', reply);
            return reply;
        } else {
            debugLog('Error posting solution:', reply);
            return;
        }
    }
    catch (error) {
        debugLog('Error posting solution:', error);
        return;
    }
}

async function syncTaskWithDB(task) {
    if(!hasAnswers(task.answerFields)) {
        await fetchTaskSolution(task);
    }
    else {
        await sendTaskSolution(task);
    }
    return;
}

let settings = {};
const AI_FALLBACK_TIMEOUT_MS = 45000;
const AI_MAX_ATTEMPTS_PER_TASK = 2;
const aiFallbackAttempts = new Map();
const aiFallbackInProgress = new Set();

function resolveConfiguredModel(items) {
    const modelChoice = items.aiModelChoice || '';
    const customModel = (items.aiModelCustom || '').trim();
    const directModel = (items.aiModel || '').trim();

    if (modelChoice === 'custom') {
        return customModel || directModel || defaultOptions.aiModel;
    }

    return modelChoice || directModel || defaultOptions.aiModel;
}

function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(defaultOptions, function(items) {
            settings.name = items.name;
            settings.minvotes = items.minvotes;
            settings.votepercentage = items.votepercentage * 100.0;
            settings.isContributor = items.contributer;
            settings.url = items.url;
            settings.isSetupComplete = items.isSetupComplete;
            settings.apiMinvotes = items.apiMinvotes || 0;
            settings.apiVotepercentage = items.apiVotepercentage || 0.0;
            settings.autoComplete = items.autoComplete;
            settings.aiFallbackEnabled = !!items.aiFallbackEnabled;
            settings.aiAskBeforeFallback = !!items.aiAskBeforeFallback;
            settings.openRouterApiKey = items.openRouterApiKey || items.geminiApiKey || '';
            settings.aiModelChoice = items.aiModelChoice || defaultOptions.aiModelChoice;
            settings.aiModelCustom = items.aiModelCustom || '';
            settings.aiModel = resolveConfiguredModel(items);
            resolve(items);
        });
    });
}

function extractJsonObject(text) {
    if (!text || typeof text !== 'string') return null;

    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // Continue to best-effort extraction.
    }

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
        try {
            return JSON.parse(fenceMatch[1].trim());
        } catch {
            // Continue to object range parsing.
        }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(maybeJson);
        } catch {
            return null;
        }
    }

    return null;
}

function normalizeLooseText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

async function getDropdownOptionsForAI(dropdownElement) {
    try {
        dropdownElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 60));

        const options = Array.from(document.querySelectorAll('div.ng-option'))
            .map(optionEl => (optionEl.textContent || '').trim())
            .filter(Boolean);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 20));

        return Array.from(new Set(options));
    } catch (error) {
        debugLog('Dropdown options read failed:', error);
        return [];
    }
}

async function collectTaskForAI(task) {
    const fullTaskField = document.querySelector(taskFieldSelectors.fullTask);
    const taskText = (fullTaskField?.innerText || fullTaskField?.textContent || '').trim();

    const fields = [];
    for (let index = 0; index < task.answerFields.length; index++) {
        const field = task.answerFields[index];
        const fieldData = {
            index,
            type: field.type,
            id: field.id || '',
            text: (field.element?.innerText || field.element?.textContent || '').trim()
        };

        if (field.type === 'dropdown') {
            fieldData.options = await getDropdownOptionsForAI(field.element);
        }

        fields.push(fieldData);
    }

    const dragOptions = [];
    const dragElements = Array.from(document.querySelectorAll(taskFieldSelectors.dragDrop.drag));
    for (const dragElement of dragElements) {
        const text = (dragElement.innerText || dragElement.textContent || '').trim();
        const id = await getTaskDDfieldID(dragElement, 'drag');
        dragOptions.push({ id, text });
    }

    return {
        taskId: task.uniqueID,
        taskText,
        fieldCount: task.answerFields.length,
        fields,
        dragOptions
    };
}

async function fetchGeminiSuggestion(task) {
    const model = settings.aiModel || defaultOptions.aiModel;
    const taskPayload = await collectTaskForAI(task);

    const prompt = [
        'A következő magyar kompetenciafeladatot kell megoldanod.',
        'Csak JSON-t adj vissza, kódtömb nélkül.',
        'Pontos forma:',
        '{"answers":[{"index":0,"value":false,"method":"...","reason":"...","confidence":0.0}],"overallConfidence":0.0,"summary":"..."}',
        'A answers tömb hossza pontosan egyezzen meg a fieldCount értékével, és minden index szerepeljen.',
        'A select mező value mezője kizárólag true vagy false lehet.',
        'A dropdown/customNumber mező value mezője string vagy false legyen.',
        'A dragDrop mező value mezője a kiválasztott elem ID-ja legyen (a dragOptions.id értékek közül), vagy false.',
        'Dropdown esetén ha van options lista, lehetőleg abból pontos szöveget válassz.',
        'Számolási feladatnál számolj pontosan, és ellenőrizd vissza az eredményt.',
        'Ha nem vagy biztos a válaszban, akkor inkább adj false értéket.',
        '',
        JSON.stringify(taskPayload)
    ].join('\n');

    const response = await sendRuntimeMessage({
        action: 'openrouter_generate',
        apiKey: settings.openRouterApiKey,
        model,
        prompt
    });

    if (!response?.ok) {
        throw new Error(`OpenRouter API hiba (${response?.status ?? 0}): ${response?.error || 'ismeretlen hiba'}`);
    }

    const data = response.data;
    const rawContent = data?.choices?.[0]?.message?.content;
    const text = typeof rawContent === 'string'
        ? rawContent.trim()
        : Array.isArray(rawContent)
            ? rawContent.map(part => part?.text || '').join('\n').trim()
            : '';

    if (!text) {
        throw new Error('A modell nem adott kiértékelhető választ');
    }

    const parsed = extractJsonObject(text);
    if (!parsed || !Array.isArray(parsed.answers)) {
        throw new Error('A modell válasza nem tartalmaz értelmezhető answers tömböt');
    }

    return parsed;
}

function extractAiAnswerValue(answerItem) {
    if (answerItem === false || answerItem === null || typeof answerItem === 'undefined') {
        return false;
    }

    if (typeof answerItem === 'object' && !Array.isArray(answerItem)) {
        if (Object.prototype.hasOwnProperty.call(answerItem, 'value')) {
            return answerItem.value;
        }
        if (Object.prototype.hasOwnProperty.call(answerItem, 'answer')) {
            return answerItem.answer;
        }
    }

    return answerItem;
}

async function resolveDragDropAnswerToId(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
        return false;
    }

    const dragElements = Array.from(document.querySelectorAll(taskFieldSelectors.dragDrop.drag));
    if (dragElements.length === 0) {
        return raw;
    }

    const choices = [];
    for (const dragElement of dragElements) {
        const id = await getTaskDDfieldID(dragElement, 'drag');
        const text = (dragElement.innerText || dragElement.textContent || '').trim();
        choices.push({ id, text, normalizedText: normalizeLooseText(text) });
    }

    const byId = choices.find(choice => choice.id === raw);
    if (byId) {
        return byId.id;
    }

    if (/^\d+$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        if (idx >= 0 && idx < choices.length) {
            return choices[idx].id;
        }
    }

    const normalizedRaw = normalizeLooseText(raw);
    const byExactText = choices.find(choice => choice.normalizedText === normalizedRaw);
    if (byExactText) {
        return byExactText.id;
    }

    const byPartialText = choices.find(choice => choice.normalizedText.includes(normalizedRaw) || normalizedRaw.includes(choice.normalizedText));
    if (byPartialText) {
        return byPartialText.id;
    }

    return raw;
}

async function normalizeGeminiAnswers(task, rawAnswers) {
    if (!Array.isArray(rawAnswers) || rawAnswers.length !== task.answerFields.length) {
        throw new Error('Az AI válasz tömb hossza eltér a mezők számától');
    }

    const normalizedAnswers = [];
    for (let index = 0; index < rawAnswers.length; index++) {
        const answerItem = rawAnswers[index];
        const answer = extractAiAnswerValue(answerItem);
        const fieldType = task.answerFields[index].type;

        if (fieldType === 'select') {
            if (answer === true) {
                normalizedAnswers.push(true);
                continue;
            }
            if (typeof answer === 'string') {
                const normalized = normalizeLooseText(answer);
                normalizedAnswers.push(normalized === 'true' || normalized === '1' || normalized === 'igen');
                continue;
            }
            normalizedAnswers.push(false);
            continue;
        }

        if (answer === false || answer === null || typeof answer === 'undefined') {
            normalizedAnswers.push(false);
            continue;
        }

        if (fieldType === 'dragDrop') {
            const dragId = await resolveDragDropAnswerToId(answer);
            normalizedAnswers.push(dragId);
            continue;
        }

        if (fieldType === 'dropdown') {
            const raw = String(answer).trim();
            if (!raw) {
                normalizedAnswers.push(false);
                continue;
            }

            const target = task.answerFields[index].element;
            const available = Array.from(target.querySelectorAll('span.ng-value-label, div.ng-placeholder'))
                .map(el => (el.textContent || '').trim())
                .filter(Boolean);

            if (available.length === 0) {
                normalizedAnswers.push(raw);
                continue;
            }

            const normalizedRaw = normalizeLooseText(raw);
            const exact = available.find(option => normalizeLooseText(option) === normalizedRaw);
            if (exact) {
                normalizedAnswers.push(exact);
                continue;
            }

            const partial = available.find(option => {
                const normalizedOption = normalizeLooseText(option);
                return normalizedOption.includes(normalizedRaw) || normalizedRaw.includes(normalizedOption);
            });
            normalizedAnswers.push(partial || raw);
            continue;
        }

        const normalized = String(answer).trim();
        normalizedAnswers.push(normalized === '' ? false : normalized);
    }

    return normalizedAnswers;
}

async function tryAiFallbackFill(task, taskFillStatus, reasonText, autoNextEnabled) {
    if (!settings.aiFallbackEnabled) {
        return null;
    }

    const taskKey = task?.uniqueID || `task-${Date.now()}`;

    if (aiFallbackInProgress.has(taskKey)) {
        taskFillStatus.fail({ text: 'AI kitöltés már fut ehhez a feladathoz', status: 'skipped' });
        return false;
    }

    const attemptCount = aiFallbackAttempts.get(taskKey) || 0;
    if (attemptCount >= AI_MAX_ATTEMPTS_PER_TASK) {
        taskFillStatus.fail({ text: 'AI kitöltés max próbálkozás elérve ennél a feladatnál', status: 'skipped' });
        return false;
    }

    if (!settings.openRouterApiKey) {
        taskFillStatus.fail({ text: 'nincs szerveres megoldás, és nincs beállított OpenRouter token', status: 'skipped' });
        return false;
    }

    if (settings.aiAskBeforeFallback) {
        const userAccepted = window.confirm(`Nincs biztos szerveres megoldás (${reasonText}).\nPróbáljam AI-val kitölteni?`);
        if (!userAccepted) {
            taskFillStatus.fail({ text: 'AI kitöltés kihagyva (felhasználói döntés)', status: 'skipped' });
            return false;
        }
    }

    aiFallbackAttempts.set(taskKey, attemptCount + 1);
    aiFallbackInProgress.add(taskKey);

    try {
        const runAiFlow = async () => {
            taskFillStatus.set_text(`AI kitöltés (${settings.aiModel || defaultOptions.aiModel}) ...`);

            let geminiAnswer;
            try {
                geminiAnswer = await fetchGeminiSuggestion(task);
            } catch (error) {
                taskFillStatus.error({ text: `AI hívás sikertelen: ${getErrorMessage(error)}` });
                return false;
            }

            let normalizedAnswers;
            try {
                normalizedAnswers = await normalizeGeminiAnswers(task, geminiAnswer.answers);
            } catch (error) {
                taskFillStatus.error({ text: `AI válasz formátumhiba: ${getErrorMessage(error)}` });
                return false;
            }

            if (geminiAnswer.summary || geminiAnswer.reason) {
                debugLog('AI summary:', geminiAnswer.summary || geminiAnswer.reason);
            }
            if (Array.isArray(geminiAnswer.answers)) {
                debugLog('AI detailed answers:', geminiAnswer.answers);
            }

            taskFillStatus.set_text('AI válasz beírása...');
            try {
                await writeAnswersWithRetry(task, normalizedAnswers, 4);
                taskFillStatus.succeed({ text: 'AI válasz beírása kész' });
            } catch (error) {
                taskFillStatus.error({ text: `AI kitöltés sikertelen: ${getErrorMessage(error)}` });
                return false;
            }

            if (autoNextEnabled) {
                try {
                    await goToNextTask();
                } catch (error) {
                    debugLog('Auto-next failed after AI fill:', error);
                }
            }

            aiFallbackAttempts.delete(taskKey);
            return true;
        };

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`AI timeout (${Math.floor(AI_FALLBACK_TIMEOUT_MS / 1000)}s)`)), AI_FALLBACK_TIMEOUT_MS);
        });

        return await Promise.race([runAiFlow(), timeoutPromise]);
    } catch (error) {
        taskFillStatus.error({ text: `AI kitöltés leállítva: ${getErrorMessage(error)}` });
        return false;
    } finally {
        aiFallbackInProgress.delete(taskKey);
    }
}

/**
 * Check if API minimum values have changed and update settings if needed
 * Warns user if current settings conflict with new API minimums
 */
async function checkAndUpdateApiMinimums() {
    const apiMinValues = await fetchMinSettings(settings.url);
    
    if (!apiMinValues) {
        debugLog('Could not fetch API minimum values');
        return;
    }
    
    debugLog('API min values:', apiMinValues);
    debugLog('Stored min values - minvotes:', settings.apiMinvotes, 'votepercentage:', settings.apiVotepercentage);
    
    // Check if API values have changed
    const minvotesChanged = apiMinValues.minvotes !== settings.apiMinvotes;
    const votepercentageChanged = apiMinValues.votepercentage !== settings.apiVotepercentage;
    
    if (minvotesChanged || votepercentageChanged) {
        debugLog('API minimum values changed!');
        
        let updatedSettings = {
            apiMinvotes: apiMinValues.minvotes,
            apiVotepercentage: apiMinValues.votepercentage
        };
        
        let warningMessage = '';
        let hasConflict = false;
        
        // Check for conflicts with current minvotes setting
        if (minvotesChanged && apiMinValues.minvotes > settings.minvotes) {
            debugLog('minvotes conflict detected');
            updatedSettings.minvotes = apiMinValues.minvotes;
            warningMessage += `Minimum leadott válaszok száma frissítve: ${apiMinValues.minvotes}. `;
            hasConflict = true;
        }
        
        // Check for conflicts with current votepercentage setting
        if (votepercentageChanged && apiMinValues.votepercentage > (settings.votepercentage / 100.0)) {
            debugLog('votepercentage conflict detected');
            updatedSettings.votepercentage = apiMinValues.votepercentage;
            warningMessage += `Azonos válasz aránya frissítve: ${(apiMinValues.votepercentage * 100).toFixed(1)}%. `;
            hasConflict = true;
        }
        
        // Save updated settings if there were changes
        if (Object.keys(updatedSettings).length > 0) {
            chrome.storage.sync.set(updatedSettings, function() {
                debugLog('Updated settings saved:', updatedSettings);
            });
            
            // Reload the settings in memory
            settings.apiMinvotes = apiMinValues.minvotes;
            settings.apiVotepercentage = apiMinValues.votepercentage;
            if (updatedSettings.minvotes) {
                settings.minvotes = updatedSettings.minvotes;
            }
            if (updatedSettings.votepercentage) {
                settings.votepercentage = updatedSettings.votepercentage * 100.0;
            }
        }
        
        // Show warning to user if there was a conflict
        if (hasConflict) {
            warningMessage += 'A beállítások az API minimumok szerint frissültek.';
            debugLog('Showing warning:', warningMessage);
            let settingUpdateWarning = new taskStatus(warningMessage);
            settingUpdateWarning.fail({stayTime: 6000, color: 'rgba(170, 0, 255, 0.9)'});
        }
    }
}

async function fetchAnnouncements() {
    chrome.storage.sync.get({lastAnnouncement: "2025-05-25T04:26:14.000Z"},async (items) => {
        const announcementUrl = settings.url+'announcements/';
        
        const response = await fetchTask(announcementUrl+items.lastAnnouncement, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            const announcements = await response.json();
            debugLog('Announcements fetched:', announcements);
            if (announcements === null) {
                debugLog('No new announcements found.');
                return false; // Return false if no new announcements
            }
            const huDateTimeFormatter = new Intl.DateTimeFormat('hu-HU', {
                dateStyle: 'long',
                timeStyle: 'short'
            });
            for (let i = 0; i < announcements.length; i++) {
                const announcement = announcements[i];
                items.lastAnnouncement = announcement.created_at;
                const createdAtDate = new Date(announcement.created_at.replace(' ', 'T'));
                const formattedCreatedAt = Number.isNaN(createdAtDate.getTime())
                    ? announcement.created_at
                    : huDateTimeFormatter.format(createdAtDate);
                debugLog('New announcement:', announcement);
                alert(`Új közlemény:\n${announcement.title}\n\n${announcement.content}\n\n${formattedCreatedAt}`);
            }
            if (items.lastAnnouncement) {
                const lastDate = new Date(items.lastAnnouncement.replace(' ', 'T'));
                lastDate.setSeconds(lastDate.getSeconds() + 1);
                items.lastAnnouncement = lastDate.toISOString();
            }
            chrome.storage.sync.set({lastAnnouncement: items.lastAnnouncement});
            return true; // Return true if an announcement was found
        } else {
            console.error('Failed to fetch announcement:', response.status, response.error);
            //throw new Error('Failed to fetch announcement:', response.error);
        }
        
    });
}

let wsGlobal = null;
let reqList = new Map();
let reqListIndex = 1;
let eventListenersInitialized = false;

function getWebSocketUrl() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get({url: "https://tekaku.hu/"}, function(items) {
            let url = items.url.replace(/^http/, 'ws');
            if (!url.endsWith('/')) {
                url += '/';
            }
            resolve(url);
        });
    });
}
let connectionPending = false;
function connectWebSocket() {
    // If a connection is already pending, wait for it to complete
    if (connectionPending) {
        return new Promise((resolve, reject) => {
            const checkConnection = setInterval(() => {
                if (wsGlobal && wsGlobal.readyState === WebSocket.OPEN) {
                    clearInterval(checkConnection);
                    resolve();
                }
            }, 150);
            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkConnection);
                reject(new Error('WebSocket connection pending timeout'));
            }, 30000);
        });
    }

    connectionPending = true;
    return new Promise((resolve, reject) => {
        if (wsGlobal && wsGlobal.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }
        
        getWebSocketUrl().then(url => {
            wsGlobal = new WebSocket(url);
            
            wsGlobal.onopen = () => {
                debugLog('WebSocket connection established');
                setTimeout(() => resolve(), 100);
            };
            
            wsGlobal.onerror = error => {
                console.error('WebSocket error:', error);
                reject(error);
            }
            
            wsGlobal.onmessage = event => {
                //console.log('WebSocket message received:', event.data);
                try {
                    const response = JSON.parse(event.data);
                     if (response.id && reqList.has(response.id)) {
                        reqList.get(response.id)(response);
                        reqList.delete(response.id);
                    } else {
                         debugLog('Received message without ID or handler:', response);
                    }
                } catch(e) {
                    console.error('Error parsing WS message', e);
                }
            };
            
            wsGlobal.onclose = () => {
                debugLog('WebSocket connection closed');
                new taskStatus('WebSocket kapcsolat bontva (inaktivitás)').fail({stayTime: 2000, color: 'rgba(128, 128, 128, 0.85)'});
                wsGlobal = null;
            };
        });
    }).finally(() => {
        connectionPending = false;
    });
}

async function sendRequestToWebSocket(request) {
    if (!wsGlobal || wsGlobal.readyState !== WebSocket.OPEN) {
        debugLog('WebSocket not connected, connecting...');
        await connectWebSocket();
    }
    
    return new Promise((resolve, reject) => {
        if (typeof request !== 'object' || !request.type) {
            console.error('Invalid request format:', request);
            reject(new Error('Invalid request format'));
            return;
        }
        request.id = reqListIndex++;
        
        const timeoutId = setTimeout(() => {
            if (reqList.has(request.id)) {
                reqList.delete(request.id);
                reject(new Error("WebSocket response timeout"));
            }
        }, 12000); // 12 second timeout

        reqList.set(request.id, (response) => {
            clearTimeout(timeoutId);
            resolve(response);
        });
        
        wsGlobal.send(JSON.stringify(request));
    });
}

async function initialize() {
    //load stored settings on startup
    let settings_task = new taskStatus('beállítások betöltése');
    try {
        await loadSettings();
        // Check and update API minimum values
        await checkAndUpdateApiMinimums();
        settings_task.succeed();
    } catch (error) {
        settings_task.error({"text": "hiba a beállítások betöltésekor: " + error});
        throw error;
    }

    if(!settings.isSetupComplete) {
        let setupStatus = new taskStatus('setupTaskStatus');
        setupStatus.error({text: `Kérlek fejezd be a beállításokat a <a href="#" id="open-options-btn" target="_blank">beállítások menüben</a> és utána frissítsd az oldalt!`, stayTime: -1});

        document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'open-options-btn') {
        e.preventDefault();
        chrome.runtime.sendMessage({ action: "open_options_page" });
    }
});
    }

    // Connect to background and retry on failure with increasing timeouts
    let retryTimeout = 500; // ms
    const maxRetryTimeout = 8000; // ms
    let retryCnt = 0;
    const maxRetryCnt = 5;
    let connectStatus = new taskStatus('kapcsolódás a szerverhez...', 'processing');
    while (true) {
        try {
            await connectWebSocket();
            connectStatus.succeed();
            break; // connected
        } catch (err) {
            debugLog('connectWebSocket failed:', err);
            retryCnt++;
            if (retryCnt >= maxRetryCnt) {
                connectStatus.error({"text": 'Max újrakapcsolódási kísérlet elérve, frissítse az oldalt az újrapróbálkozáshoz'});
                debugLog('Max retries reached, giving up.');
                return 504;
            }
            connectStatus.set_text('kapcsolódás a szerverhez... (újrapróbálkozás ' + retryCnt + '/' + maxRetryCnt + ')');
            await new Promise(resolve => setTimeout(resolve, retryTimeout));
            retryTimeout = Math.min(maxRetryTimeout, Math.floor(retryTimeout * 1.8));
            
        }
    }

    try {
        await fetchAnnouncements();
    } catch (error) {
        debugLog('Error fetching announcements:', error);
    }
}

async function detectUrlChange() {
    let url = window.location.href;
    while (url === window.location.href) {
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

async function waitForTask() {
    while (!isThereTask() || await getTaskUniqueID() === null) {
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

async function goToNextTask() {
    let nextBtn = Array.from(document.querySelectorAll('button.btn.btn-secondary.d-block')).find(btn => btn.innerText.toLowerCase().includes('következő'));
    if (nextBtn) {
        nextBtn.click();
    }
}

function aggregateQueryResults(queryResultNew) {
    if (!queryResultNew || !Array.isArray(queryResultNew) || queryResultNew.length === 0) {
        if(_DEBUG && queryResultNew === 0) {
            debugLog('IRNS');
            let irnsTask = new taskStatus('nincs megoldás');
            irnsTask.fail({color: 'rgba(128, 128, 128, 0.85)', stayTime: 2000});
        }
        return null;
    }

    const answers = queryResultNew.map(item => item.answer);
    const totalVotes = Math.max(...queryResultNew.map(item => item.totalVotes));
    const votes = Math.min(...queryResultNew.map(item => item.votes));

    return {
        totalVotes: totalVotes,
        votes: votes,
        answer: JSON.stringify(answers)
    };
}

function getErrorMessage(error) {
    if (!error) return 'ismeretlen hiba';
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

async function writeAnswersWithRetry(task, answers, maxAttempts = 2) {
    const normalizeForCompare = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const expectedMatchesField = (field, expected) => {
        if (!expected) {
            return true;
        }

        if (field.type === 'select') {
            return expected === true ? field.value === true : true;
        }

        if (field.type === 'dragDrop') {
            return String(field.value || '').trim() === String(expected).trim();
        }

        if (field.type === 'dropdown') {
            const actual = normalizeForCompare(field.value);
            const wanted = normalizeForCompare(expected);
            return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
        }

        if (field.type === 'customNumber') {
            const actual = normalizeForCompare(field.value);
            const wanted = normalizeForCompare(expected);
            return actual === wanted;
        }

        return normalizeForCompare(field.value) === normalizeForCompare(expected);
    };

    const getPendingIndexes = () => {
        const pending = [];
        for (let idx = 0; idx < task.answerFields.length; idx++) {
            if (!expectedMatchesField(task.answerFields[idx], answers[idx])) {
                pending.push(idx);
            }
        }
        return pending;
    };

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await writeAnswers(task, task.answerFields, answers);
            await updateSelectedAnswers(task);

            const pendingIndexes = getPendingIndexes();

            if (pendingIndexes.length === 0) {
                return;
            }

            lastError = new Error(`függő mezők maradtak: ${pendingIndexes.map(i => i + 1).join(', ')}`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    throw lastError || new Error('a feladat kitöltése sikertelen');
}

async function tryAutoFillTask(task, taskFillStatus, autoNext) {
    taskFillStatus.set_text('válasz kérése szervertől...');

    let queryResult;
    try {
        const queryResultNew = await fetchTaskSolution(task);
        queryResult = aggregateQueryResults(queryResultNew);
    } catch (error) {
        taskFillStatus.error({ text: `hálózati hiba: ${getErrorMessage(error)}` });
        debugLog('Autofill fetch error:', error);
        return;
    }

    if (!queryResult) {
        debugLog('No solution found in the database. Trying AI fallback if enabled.');
        const aiFilled = await tryAiFallbackFill(task, taskFillStatus, 'nincs elegendő megbízható válasz', autoNext);
        if (aiFilled === null) {
            taskFillStatus.fail({ text: 'nincs elegendő megbízható válasz ehhez a feladathoz', status: 'skipped' });
        }
        return;
    }

    debugLog('Query result:', queryResult);

    try {
        await loadSettings();
    } catch (error) {
        taskFillStatus.error({ text: `beállítások betöltése sikertelen: ${getErrorMessage(error)}` });
        debugLog('Settings load failed during autofill:', error);
        return;
    }

    if (!queryResult.totalVotes || queryResult.totalVotes < settings.minvotes || 100 * queryResult.votes / queryResult.totalVotes < settings.votepercentage) {
        debugLog('Not enough votes or not enough percentage of votes.');
        debugLog('Total votes:', queryResult.totalVotes, 'required votes:', settings.minvotes);
        debugLog('Vote%:', 100 * queryResult.votes / queryResult.totalVotes, 'required vote%:', settings.votepercentage);
        const aiFilled = await tryAiFallbackFill(task, taskFillStatus, 'nincs elegendő leadott vagy egyező válasz', autoNext);
        if (aiFilled === null) {
            taskFillStatus.fail({ text: 'nincs elegendő leadott vagy egyező válasz ehhez a feladathoz', status: 'skipped' });
        }
        return;
    }

    let parsedAnswers;
    try {
        parsedAnswers = JSON.parse(queryResult.answer);
        if (!Array.isArray(parsedAnswers)) {
            throw new Error('a szerver válasza nem tömb');
        }
    } catch (error) {
        taskFillStatus.error({ text: `érvénytelen szerver válasz: ${getErrorMessage(error)}` });
        debugLog('Invalid answer payload from server:', queryResult.answer, error);
        return;
    }

    taskFillStatus.set_text('válasz beírása...');
    try {
        await writeAnswersWithRetry(task, parsedAnswers, 2);
        taskFillStatus.succeed({ text: 'válasz beírása kész' });
    } catch (error) {
        taskFillStatus.error({ text: `kitöltés sikertelen: ${getErrorMessage(error)}` });
        debugLog('Autofill write failed:', error);
        return;
    }

    if (autoNext) {
        try {
            await goToNextTask();
        } catch (error) {
            debugLog('Auto-next failed after successful fill:', error);
        }
    }
}

/**
 * Duplicates a button, gives it new text/action, and places it next to the original.
 * @param {string} selector - CSS selector to find the original button.
 * @param {string} newText - The text for the new button.
 * @param {Function} onClickCallback - The function to run when clicked.
 */
let customBtnId = 0;
function addCustomButton(originalBtn, newText, description, onClickCallback) {
    
    if (originalBtn.parentElement.querySelector('.tekaku-btn')) return;
    
    const newBtn = originalBtn.cloneNode(true);

    newBtn.innerText = newText;
    newBtn.id = "tekaku-btn-" + customBtnId++;
    newBtn.classList.add('tekaku-btn');

    if(description) {
        newBtn.title = description;
    }
    
    newBtn.removeAttribute('onclick');

    newBtn.addEventListener('click', (e) => {
        e.preventDefault(); // Stop default form submissions/navigation
        e.stopPropagation(); // Stop page scripts from seeing the click
        onClickCallback(e);
    });

    // Mark this button as a tekaku custom button for reliable selection
    newBtn.setAttribute('data-tekaku-btn', 'true');
    
    originalBtn.insertAdjacentElement('beforebegin', newBtn);
    newBtn.style.marginLeft = "10px"; 
    
    // Apply hidden state if UI is hidden
    if (isUIHidden()) {
        newBtn.style.display = 'none';
    }
    if(newBtn.classList.contains('d-block')) {
        newBtn.classList.remove('d-block');
    }
}

async function goToNextTaskWithoutSaving() {
    cancelTaskSync = true;
    await goToNextTask();
}

let cancelTaskSync = false;
function copyNextButton() {
    let nextBtn = Array.from(document.querySelectorAll('button.btn.btn-secondary.d-block')).find(btn => btn.innerText.toLowerCase().includes('következő'));
    if (!nextBtn) return;
    addCustomButton(nextBtn, 'továbblépés válasz küldése nélkül', 'következő feladatra lép, de nem menti a TeKaKu a választ (akkor használd, ha nem vagy magabiztos ebben a feladatban!)', 
        goToNextTaskWithoutSaving
    );
}

async function main_loop() {
    
    await initialize();
    
    let last_url = '';
    let url = '';
    let currentTask = null;
    /**
     * Stores the answers filled in the current task when task is first loaded to detect changes
     * @type {Array<answerField>}
     */
    let taskFilledAnswers = [];

    // Only add event listeners once to prevent memory leaks
    if (!eventListenersInitialized) {
        eventListenersInitialized = true;

        document.addEventListener('click', async function(event) {
            if (document.getElementById('__input-blocker') || currentTask === null) return;
            try {
                updateSelectedAnswers(currentTask, event);
                // a 'lezárás' gomb ilyen, ekkor elküldjük az utolsó feladatot, mivel nem lesz következő amit érzékelünk
                if (event.target.classList.contains('btn-danger')) { 
                    if (settings.isContributor && !cancelTaskSync && currentTask != null && hasAnswers(currentTask.answerFields) && JSON.stringify(taskFilledAnswers) !== JSON.stringify(currentTask.answerFields.map(input => input.value))) {

                        debugLog('lezárás clicked, syncing last task');
                        let syncPromise = syncTaskWithDB(currentTask);
                        let finalSyncStatus = new taskStatus('utolsó feladat küldése...', 'processing');
                    syncPromise.then(() => {
                        finalSyncStatus.succeed({"text": "utolsó feladat küldése kész"});
                    }).catch((error) => {
                        finalSyncStatus.error({"text": "hiba az utolsó feladat küldése során: " + error});
                    });
            }
        }
        }
        catch (error) {
            console.error({'text': 'Error updating user answers:', error});
        }
    })

    document.addEventListener('keydown', async function(event) {
        
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'q') {
            event.preventDefault();
            goToNextTaskWithoutSaving();
        }
        else if (event.ctrlKey && event.key.toLowerCase() === 'q') {
            event.preventDefault();
            goToNextTask();
        }
        else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'h') {
            event.preventDefault();
            toggleTaskStatusesVisibility();
        }
        else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            if (currentTask != null) {
                debugLog('Trying to autofill task with keybind...');
                maybeFillTask(currentTask);
            }
        }
    });

    if (_DEBUG) document.addEventListener('keydown', async function(event) {
        if (event.key.toLowerCase() === 'i') {
            if (currentTask != null) {
                debugLog('URL:', url);
                debugLog('Current task:', currentTask);
            }
        }
        else if (event.key.toLowerCase() === 's') {
            if (currentTask != null) {
                debugLog(`prev. task sync debug: \ncancelTaskSync: ${cancelTaskSync}, \nhasAnswers: ${hasAnswers(currentTask.answerFields)}, \ntaskFilledAnswers  : ${taskFilledAnswers}, \ncurrentTask answers: ${currentTask.answerFields.map(input => input.value)}`);
            }
        }
        else if(event.key.toLowerCase() === 'u') {
            if (currentTask != null) {
                debugLog('user ID:',await  getUserID());
            }
        }
        else if (event.ctrlKey && event.key.toLowerCase() === 'b') {
            if (document.getElementById('__input-blocker')) {
                debugLog('Unblocking user interaction...');
                unblockUserInteraction();
            } else {
                debugLog('Blocking user interaction...');
                blockUserInteraction();
            }
        }
        else if (event.key.toLowerCase() === 'h') {
            debugLog('current task ID: ', await getTaskUniqueID());
        }
    });
    } // End of eventListenersInitialized block
    
    while (true) {
        if (currentTask) await detectUrlChange(); //if no task yet, we should immediately see if there is one
        
        let getTaskStatus = new taskStatus('feladatra várakozás...', 'processing');

        await waitForTask();
        debugLog('task seen');
        getTaskStatus.set_text("feladat észlelve");

        if (settings.isContributor && !cancelTaskSync && currentTask != null && hasAnswers(currentTask.answerFields) && JSON.stringify(taskFilledAnswers) !== JSON.stringify(currentTask.answerFields.map(input => input.value))) {
            let syncstatus = new taskStatus('előző feladat küldése...', 'processing');
            syncTaskWithDB(currentTask).then(() => {
                syncstatus.succeed({"text": "előző feladat küldése kész"});
            }).catch((error) => {
                syncstatus.error({"text": "hiba az előző feladat küldése során: " + error});
            });
        }
        else {
            debugLog('not syncing prev. task because: ',)
            !settings.isContributor ? debugLog('user not a contributor') : 
            currentTask == null ? debugLog('no current task') : 
            !hasAnswers(currentTask ? currentTask.answerFields : []) ? debugLog('no answers') : 
            JSON.stringify(taskFilledAnswers) === JSON.stringify(currentTask.answerFields.map(input => input.value)) ? debugLog('no changes from prev. filled answers') : debugLog('WTF?');

        }

        currentTask = await getTask();
        await updateSelectedAnswers(currentTask);

        getTaskStatus.succeed({"text": "feladat feldolgozva"});
        url = window.location.href;
        last_url = url;

        if (settings.isContributor){
            cancelTaskSync = false;
            copyNextButton();
        }

        if (settings.autoComplete) {
            await maybeFillTask(currentTask);
        }


        await updateSelectedAnswers(currentTask);
        taskFilledAnswers = JSON.parse(JSON.stringify(currentTask.answerFields.map(input => input.value))); //the answers that were there when task loaded, or after autocomplete
    }
}

async function maybeFillTask(task) {
    let taskFillStatus = new taskStatus('feladat kitöltése...', 'processing');

            if (hasAnswers(task.answerFields)) {
                debugLog('Already has answers, skipping autofill...');
                taskFillStatus.fail({text: "már van valami beírva; automata kitöltés kihagyva", color:'rgba(156, 39, 176, 0.85)'});
            }
            else{
                try {
                    await tryAutoFillTask(task, taskFillStatus, autoNext);
                }
                catch (error) {
                    taskFillStatus.error({"text": "váratlan hiba az automata kitöltés során: " + getErrorMessage(error)});
                    debugLog('Unexpected error in maybeFillTask:', error);
                }
            }
}

async function main_loop_wrapper() {
    let maxGlobalRetryCnt = 5;
    let mainError = false;
    for (let i = 0; i < maxGlobalRetryCnt; i++) {
        try {
            let returncode = await main_loop();
            if (returncode === 504) {
                debugLog('timeout while connecting to server');
                break;
            }
        } catch (error) {
            let mainErrorTask = new taskStatus('hiba: ' + error, '\nújraindítás...');
            mainErrorTask.error({ stayTime: -1 });
            console.error('Error in main loop:', error);
            mainError = error;
        }
    }
    if (mainError) {
        let finalErrorTask = new taskStatus('hiba: ' + mainError, '\nvége. maximum újraindítási kísérletek elérve');
        finalErrorTask.error({ stayTime: -1 });
        console.error('Error in main loop:', mainError);
    }
}
main_loop_wrapper();