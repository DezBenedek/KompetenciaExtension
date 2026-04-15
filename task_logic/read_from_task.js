import { dedupeByKey, waitForImageLoad, hashImageToID, hashSHA256, debugLog} from '../scripts/utils.js';
import { taskFieldSelectors } from '../scripts/constants.js';

export { answerField, task, isThereTask, getTaskUniqueID, getTaskDDfieldID,getUserID, updateSelectedAnswers, getTask, hasAnswers }

class answerField {
    constructor(type, element, value, id='') {
        this.type = type;
        this.element = element;
        this.value = value;
        this.id = id;
    }
}

class task {
    constructor(uniqueID, answerFields) {
        this.uniqueID = uniqueID;
        this.answerFields = answerFields;
    }
}

function isThereTask() {
    if (
        document.querySelector(taskFieldSelectors.selectText.detect) ||
        document.querySelector(taskFieldSelectors.selectImage.detect) ||
        document.querySelector(taskFieldSelectors.dropdown.detect) ||
        document.querySelector(taskFieldSelectors.customNumber.detect) ||
        document.querySelector(taskFieldSelectors.categorySelect.detect) ||
        document.querySelector(taskFieldSelectors.dragDrop.detect)
    ) {
        return true;
    } else {
        return false;
    }
}

async function hashTaskImages(fullTaskField) {
    const images = fullTaskField.querySelectorAll('img');
    let allIds = "";
    if (images.length > 0) {
        for (let img of images) {
            let imageId = await hashImageToID(img);
            allIds += imageId;
        }
        return allIds;
    }
    return "";
}

async function getTaskUniqueID() {
    const fullTaskFields = Array.from(document.querySelectorAll(taskFieldSelectors.fullTask));
    if (fullTaskFields.length === 0) {
        return null;
    }

    let allText = '';
    let imageIds = '';

    for (const fullTaskField of fullTaskFields) {
        allText += (fullTaskField.textContent || '').trim();
        imageIds += await hashTaskImages(fullTaskField);
    }

    return hashSHA256(allText + imageIds);

}

function getAnswerFields(selector, type, idGenerator = null) {
    const fields = Array.from(document.querySelectorAll(selector));
    return Promise.all(fields.map(async field => new answerField(type, field, false, idGenerator ? await idGenerator(field) : '')));
}

async function getUserID() {
    const url = window.location.href;
    const match = url.match(/[?&]azon=([^&%]+)/);
    if (match && match[1]) {
        return await hashSHA256(decodeURIComponent(match[1]));
    }
    return "";
}


async function getTaskDDfieldID(div, dragordrop) {
  try {
    if (dragordrop === 'drag') {
      return await getDragFieldID(div);
    } else if (dragordrop === 'drop') {
      return div.id || '';
    } else {
      console.error(`Invalid dragordrop parameter: ${dragordrop}, expected 'drag' or 'drop'.`);
      return '';
    }
  } catch (error) {
    console.error(`Error getting task DD field ID:`, error);
    return '';
  }
}

async function getDragFieldID(div) {
  const img = div.querySelector('img');
  if (img) {
    await waitForImageLoad(img);
    const idFromImage = await hashImageToID(img);
    if (idFromImage) return idFromImage;
  }
  return div.textContent.trim();
}

function isMultiChoiceAnswerSelected(MultiChoiceDiv) {
    if (MultiChoiceDiv.classList.contains('selected') ||
        MultiChoiceDiv.querySelector('div.selected') ||
        MultiChoiceDiv.querySelector('div.kep-valasz-check-selected')
    ) {
        return true;
    }
    return false;
}

function dropdownAnswerSelected(dropdownDiv) {
    let dropdownText = dropdownDiv.firstChild.textContent;
    if (dropdownText == "") {
        return false;
    }
    dropdownText = dropdownText.trim();
    if (dropdownDiv.querySelector('div.ng-placeholder')) {
        const placeholder = dropdownDiv.querySelector('div.ng-placeholder').textContent.trim();
        if (dropdownText == placeholder) {
            return false;
        }
        else {
            dropdownText = dropdownText.replace(placeholder, '').trim();
        }
    }
    return dropdownText;
}

function CustomNumberAnswerSelected(customNumberDiv) {
    if (customNumberDiv.value != "") {
        return customNumberDiv.value;
    }
    return false;
}

async function updateSelectedAnswers(task) {
    let fields = task.answerFields;
    for (let field of fields) {
        switch (field.type) {
        case 'select':
            field.value = isMultiChoiceAnswerSelected(field.element);
            break;
        case 'dropdown':
            field.value = dropdownAnswerSelected(field.element);
            break;
        case 'customNumber':
            field.value = CustomNumberAnswerSelected(field.element);
            break;
        case 'dragDrop':
            let draggedElement = field.element.querySelector('div.cdk-drag');
            if (draggedElement) {
                field.value = await getTaskDDfieldID(draggedElement, 'drag');
            } else {
                field.value = false;
            }
            break;
        default:
            debugLog('unknown taskType in updateSelectedAnswers: ', field.type);
        }
    }
}

async function getTask() {
    let uniqueID = await getTaskUniqueID();
    let answers = [];
    answers.push(
        ...await getAnswerFields(taskFieldSelectors.selectText.answers, 'select'),
        ...await getAnswerFields(taskFieldSelectors.selectImage.answers, 'select'),
        ...await getAnswerFields(taskFieldSelectors.categorySelect.answers, 'select'),
        ...await getAnswerFields(taskFieldSelectors.dropdown.answers, 'dropdown'),
        ...await getAnswerFields(taskFieldSelectors.customNumber.answers, 'customNumber'),
        ...await getAnswerFields(taskFieldSelectors.dragDrop.drop, 'dragDrop', async (div) => await getTaskDDfieldID(div, 'drop'))
    );

    answers = dedupeByKey(answers, 'element');

    let t = new task(uniqueID,answers);
    debugLog('Detected task:', t);
    return t;
}

function hasAnswers(answerFields) {
    for (let i=0;i<answerFields.length;i++) {
        if(answerFields[i].value) return true;
    }
    return false;
}