import { answerField, updateSelectedAnswers } from './read_from_task.js';
import { getTaskDDfieldID } from './read_from_task.js';
import { taskFieldSelectors } from '../scripts/constants.js';
import { waitForLoadingScreen, zoomOut, zoomIn, blockUserInteraction, unblockUserInteraction, debugLog} from '../scripts/utils.js';
import { taskStatus } from '../scripts/task_statuses.js';

export { writeAnswers };

function normalizeDropdownText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function selectDropdownOption(div, option) {

    if (option == false) {
        return;
    }

    const requested = String(option).trim();

    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const options = Array.from(document.querySelectorAll('div.ng-option'));

    if (options.length === 0) {
        debugLog('Dropdown has no options in DOM.');
        return;
    }

    if (/^\d+$/.test(requested)) {
        const idx = parseInt(requested, 10) - 1;
        if (idx >= 0 && idx < options.length) {
            options[idx].click();
            return;
        }
    }

    const normalizedRequested = normalizeDropdownText(requested);

    for (let i = 0; i < options.length; i++) {
        if ((options[i].textContent || '').trim() === requested) {
            options[i].click();
            return;
        }
    }

    for (let i = 0; i < options.length; i++) {
        const candidate = normalizeDropdownText(options[i].textContent);
        if (candidate === normalizedRequested) {
            options[i].click();
            return;
        }
    }

    for (let i = 0; i < options.length; i++) {
        const candidate = normalizeDropdownText(options[i].textContent);
        if (candidate.includes(normalizedRequested) || normalizedRequested.includes(candidate)) {
            options[i].click();
            return;
        }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    debugLog(`didnt find option: '${option}'`);
    new taskStatus(`didnt find dropdown option: '${option}'`, 'error');
}

async function selectDragDropAnswer(dragDiv, dropDiv, expectedDragId = '') {
    const dragRect = dragDiv.getBoundingClientRect();
    const dropRect = dropDiv.getBoundingClientRect();

    const startX = dragRect.left + dragRect.width / 2;
    const startY = dragRect.top + dragRect.height / 2;
    
    const endX = dropRect.left + dropRect.width / 2;
    const endY = dropRect.top + dropRect.height / 2;

    const supportsPointer = typeof window.PointerEvent === 'function';
    const pointerId = 1;

    if (supportsPointer) {
        try {
            dragDiv.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
                button: 0,
                buttons: 1,
                clientX: startX,
                clientY: startY
            }));
            await new Promise(resolve => setTimeout(resolve, 40));

            document.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 1,
                clientX: startX + 12,
                clientY: startY + 12
            }));
            await new Promise(resolve => setTimeout(resolve, 40));

            document.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 1,
                clientX: endX,
                clientY: endY
            }));
            await new Promise(resolve => setTimeout(resolve, 40));

            dropDiv.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
                button: 0,
                buttons: 0,
                clientX: endX,
                clientY: endY
            }));
            await new Promise(resolve => setTimeout(resolve, 50));

            if (expectedDragId && await checkDragSuccess(dropDiv, expectedDragId)) {
                return;
            }
        } catch (error) {
            debugLog('Pointer drag simulation failed, trying mouse fallback:', error);
        }
    }

    dragDiv.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: startX,
        clientY: startY
    }));
    await new Promise(resolve => setTimeout(resolve, 50));

    document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: startX + 10,
        clientY: startY + 10,
        buttons: 1
    }));
    await new Promise(resolve => setTimeout(resolve, 50));

    document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: endX,
        clientY: endY,
        buttons: 1
    }));
    await new Promise(resolve => setTimeout(resolve, 50));

    dropDiv.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: endX,
        clientY: endY,
        button: 0
    }));
}

function selectMultiChoiceAnswer(multiChoiceDiv) {
    multiChoiceDiv.click();
    return;
}

function selectCustomNumberAnswer(customNumberDiv, answer) {
    let normalized = String(answer ?? '').trim();

    if (customNumberDiv instanceof HTMLInputElement && customNumberDiv.type === 'number') {
        normalized = normalized.replace(',', '.').replace(/\s+/g, '');
        let num = Number(normalized);

        if (!Number.isFinite(num)) {
            debugLog(`Invalid numeric AI value ignored: '${answer}'`);
            return;
        }

        const minAttr = customNumberDiv.getAttribute('min');
        const maxAttr = customNumberDiv.getAttribute('max');
        const stepAttr = customNumberDiv.getAttribute('step');

        if (minAttr !== null && minAttr !== '') {
            const min = Number(minAttr);
            if (Number.isFinite(min)) {
                num = Math.max(num, min);
            }
        }
        if (maxAttr !== null && maxAttr !== '') {
            const max = Number(maxAttr);
            if (Number.isFinite(max)) {
                num = Math.min(num, max);
            }
        }

        if (stepAttr && stepAttr !== 'any') {
            const step = Number(stepAttr);
            if (Number.isFinite(step) && step > 0) {
                const base = (minAttr !== null && minAttr !== '' && Number.isFinite(Number(minAttr))) ? Number(minAttr) : 0;
                const steps = Math.round((num - base) / step);
                num = base + steps * step;
            }
        }

        normalized = Number.isInteger(num) ? String(num) : String(Number(num.toFixed(10)));
    }

    customNumberDiv.value = normalized;
    customNumberDiv.dispatchEvent(new Event('input', { bubbles: true }));
    customNumberDiv.dispatchEvent(new Event('change', { bubbles: true }));
}

async function findDragDivFromID(dragID) {
    const dragDivs = document.querySelectorAll(taskFieldSelectors.dragDrop.drag);
    const wanted = String(dragID || '').trim();
    for (let i = 0; i < dragDivs.length; i++) {
        const current = String(await getTaskDDfieldID(dragDivs[i], 'drag') || '').trim();
        if (current === wanted) {
            return dragDivs[i];
        }
    }
    return null;
}

async function waitForDropAnimation(dropDiv) {
    const startTime = Date.now();
    const maxWaitTime = 5000;
    
    while (
        dropDiv.classList.contains('cdk-drop-list-receiving') ||
        dropDiv.classList.contains('cdk-drop-list-dragging') ||
        dropDiv.classList.contains('cdk-drag-animating')
    ) {
        if (Date.now() - startTime > maxWaitTime) {
            debugLog('waitForDropAnimation timeout exceeded');
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
}

async function checkDragSuccess(dropDiv, expectedDragId) {
    const draggedElement =
        dropDiv.querySelector('div.cdk-drag.cella-dd') ||
        dropDiv.querySelector('div.cdk-drag.szoveg-dd-tartalom') ||
        dropDiv.querySelector('div.cdk-drag.ddcimke') ||
        dropDiv.querySelector('div.cdk-drag');

    if (!draggedElement) {
        return false;
    }

    const currentId = String(await getTaskDDfieldID(draggedElement, 'drag') || '').trim();
    const expectedId = String(expectedDragId || '').trim();
    return currentId === expectedId;
}

async function writeAnswers(task, answerFields, answersToWrite) {
    
    await waitForLoadingScreen();

    let oldZoom = -1;
    try {
        for (let i=0;i<answerFields.length;i++)
        {
            let currentInput = answerFields[i];
            let currentToWrite = answersToWrite[i];

            const isEmptyAnswer =
                currentToWrite === false ||
                currentToWrite === null ||
                typeof currentToWrite === 'undefined' ||
                (typeof currentToWrite === 'string' && currentToWrite.trim() === '');

            if (isEmptyAnswer || currentInput.value === currentToWrite) continue;
            
            let taskType = currentInput.type;
            switch (taskType) {
            case 'select':
                selectMultiChoiceAnswer(currentInput.element);
                break;
            case 'dropdown':
                selectDropdownOption(currentInput.element, currentToWrite);
                break;
            case 'customNumber':
                selectCustomNumberAnswer(currentInput.element, currentToWrite);
                break;
            case 'dragDrop':
                blockUserInteraction();
                let fails = 0;
                let succeeded = false;
                while(!succeeded && fails < 5) {
                    let dragDiv = await findDragDivFromID(currentToWrite);
                    if (dragDiv === null) {
                        debugLog('Drag element not found with this ID:', currentToWrite);
                        break;
                    }
                    if (oldZoom === -1) oldZoom = zoomOut();
                    
                    let dropDiv = currentInput.element;
                    unblockUserInteraction();
                    await selectDragDropAnswer(dragDiv, dropDiv, currentToWrite);
                    blockUserInteraction();

                    await waitForDropAnimation(dropDiv);
                    
                    if (await checkDragSuccess(dropDiv, currentToWrite)) {
                        succeeded = true;
                    } else {
                        fails++;
                    }
                }
                break;
            default:
                debugLog('unknown taskType in writeAnswers: ', taskType);
                new taskStatus('unknown taskType in writeAnswers: ' + taskType, 'error');
                break;
        }
        }
    } finally {
        try {
            if (oldZoom !== -1) {
                zoomIn(oldZoom);
            }

            await updateSelectedAnswers(task);
        } catch (error) {
            debugLog('Error in writeAnswers finally block:', error);
        } finally {
            unblockUserInteraction();
        }
    }
}