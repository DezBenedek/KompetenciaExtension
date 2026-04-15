import { maxImageHashSize, taskFieldSelectors, _DEBUG } from './constants.js';   
export { debugLog, dedupeByKey, hashSHA256, waitForImageLoad, waitForLoadingScreen, fetchMinSettings, isUIHidden, getInstallationKey}

const debugLog = _DEBUG ? console.log.bind(console) : function(){};

let __uiHidden = false;

function isUIHidden() {
    return __uiHidden;
}

function getInstallationKey() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({ installationKey: null }, (items) => {
            if (items.installationKey) {
                resolve(items.installationKey);
            } else {
                const fallbackKey = `install-fb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 15)}`;
                chrome.storage.sync.set({ installationKey: fallbackKey });
                resolve(fallbackKey);
            }
        });
    });
}

function dedupeByKey(items, key) {
    const seen = new Set();
    return items.filter(item => {
        const value = item[key];
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

async function hashSHA256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function waitForImageLoad(img) {
    return new Promise(resolve => {
        if (img.complete) {
            resolve();
        } else {
            img.onload = img.onerror = () => resolve();
        }
    });
}


export { hashImageToID, getCurrentScale, blockUserInteraction, unblockUserInteraction, zoomOut, zoomIn }
async function hashImageToID(img) {
  if (!img.naturalWidth || !img.naturalHeight) return null;

  const canvas = document.createElement('canvas');
  canvas.width = maxImageHashSize;
  canvas.height = maxImageHashSize;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, maxImageHashSize, maxImageHashSize);

  try {
    const dataURL = canvas.toDataURL();
    return await hashSHA256(dataURL);
  } catch (e) {
    console.error('Canvas hashing failed:', e);
    return null;
  }
}

function getCurrentScale() {
    try {
        const currentZoom = document.body.style.zoom;
        if (currentZoom && currentZoom.endsWith('%')) {
            const percent = parseFloat(currentZoom.slice(0, -1));
            if (!isNaN(percent) && percent > 0) {
                return (percent / 100);
            }
        }
        return 1;
    } catch (e) {
        return 1;
    }
}

function blockUserInteraction() {
    if (document.getElementById('__input-blocker')) return;

    try { window.scrollTo(0, 0); } catch (e) {debugLog('scrollTo failed in blockUserInteraction, not necessarily fatal', e); }
    const blocker = document.createElement('div');
    blocker.id = '__input-blocker';
    Object.assign(blocker.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0, 0, 0, 0.18)',
        zIndex: '2147483646',
        cursor: 'wait'
    });
    blocker.style.pointerEvents = 'auto';
    document.body.appendChild(blocker);
}

function unblockUserInteraction() {
    const blocker = document.getElementById('__input-blocker');
    if (blocker) blocker.remove();
}

function zoomOut(zoomPercent = 25) {
    let oldZoom = document.body.style.zoom;
    document.body.style.zoom = `${zoomPercent}%`;
    let tkelo = document.querySelector("tk-elonezet");
    if (tkelo) tkelo.style.height = "3000px";
    try {
        scaleTaskStatuses(1 / (zoomPercent / 100));
    } catch (e) {
        debugLog(`error scaling out task statuses`, e);
    }
    return oldZoom;
}

function zoomIn(oldZoom) {
    document.body.style.zoom = oldZoom;
    let tkelo = document.querySelector("tk-elonezet");
    if (tkelo) tkelo.style.height = "100%";
    try { scaleTaskStatuses(1); } catch (e) { debugLog('scaleTaskStatuses failed on zoomIn', e); }
}

async function waitForLoadingScreen() {
    while (document.querySelector(taskFieldSelectors.loadingLogo)) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
}


export { repositionTaskStatuses, scaleTaskStatuses, toggleTaskStatusesVisibility }

function repositionTaskStatuses(scale = -1) {
    try {
        if (scale === -1) {
            scale = 1 / getCurrentScale();
        }
        const tasks = document.querySelectorAll('[id^="__tk_task_"]');
        tasks.forEach((task, index) => {
            if (index == 0) {
                task.style.bottom = 50 * scale + 'px';
            }
            else {
                const prevTop = tasks[index - 1].getBoundingClientRect().top;
                task.style.bottom = (window.innerHeight - prevTop + 8) * scale + 'px';
            }
        });
    } catch (e) {
        debugLog('repositionTaskStatuses failed', e);
    }
}
function scaleTaskStatuses(scale) {
    try {
        const statuses = document.querySelectorAll('[id^="__tk_task_"]');
        statuses.forEach((status) => {
            status.style.transformOrigin = 'bottom right';
            status.style.transform = `scale(${scale})`;
        });
        repositionTaskStatuses(scale);
    } catch (e) {
        debugLog('scaleTaskStatuses error', e);
    }
}

function toggleTaskStatusesVisibility() {
    try {
        __uiHidden = !__uiHidden;
        
        const taskStatuses = document.querySelectorAll('[id^="__tk_task_"]');
        taskStatuses.forEach((status) => {
            status.style.display = __uiHidden ? 'none' : '';
        });
        
        const customBtns = document.querySelectorAll('[data-tekaku-btn="true"]');
        customBtns.forEach((btn) => {
            btn.style.display = __uiHidden ? 'none' : '';
        });
        
        debugLog('Task statuses and custom buttons visibility toggled. Hidden:', __uiHidden);
    } catch (e) {
        debugLog('toggleTaskStatusesVisibility failed', e);
    }
}

async function fetchMinSettings(url) {
    try {
        const baseUrl = String(url || '').trim().replace(/\/+$/, '');
        if (!baseUrl) {
            debugLog('Cannot fetch min settings: empty base URL');
            return null;
        }

        const minSettingsUrl = `${baseUrl}/minsettings`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        let response;
        try {
            response = await fetch(minSettingsUrl, {
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
            if (!data || (typeof data !== 'object')) {
                debugLog('Min settings response is not valid JSON object');
                return null;
            }

            const minvotes = Number.parseInt(data.minvotes, 10);
            const votepercentage = Number.parseFloat(data.votepercentage);

            debugLog('Min settings fetched successfully:', data);
            return {
                minvotes: Number.isFinite(minvotes) ? minvotes : 0,
                votepercentage: Number.isFinite(votepercentage) ? votepercentage : 0
            };
        } else {
            debugLog('Failed to fetch min settings:', response.status, response.statusText);
            return null;
        }
    } catch (error) {
        debugLog('Error fetching min settings:', error);
        return null;
    }
}