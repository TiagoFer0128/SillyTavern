import { eventSource, event_types, extension_prompt_types, getCurrentChatId, getRequestHeaders, saveSettingsDebounced, setExtensionPrompt } from "../../../script.js";
import { ModuleWorkerWrapper, extension_settings, getContext, renderExtensionTemplate } from "../../extensions.js";
import { collapseNewlines } from "../../power-user.js";
import { debounce, getStringHash as calculateHash } from "../../utils.js";

const MODULE_NAME = 'vectors';
const AMOUNT_TO_LEAVE = 5;
const INSERT_AMOUNT = 3;
const QUERY_TEXT_AMOUNT = 3;

export const EXTENSION_PROMPT_TAG = '3_vectors';

const settings = {
    enabled: false,
};

const moduleWorker = new ModuleWorkerWrapper(synchronizeChat);

async function synchronizeChat() {
    try {
        if (!settings.enabled) {
            return;
        }

        const context = getContext();
        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(context.chat)) {
            console.debug('Vectors: No chat selected');
            return;
        }

        const hashedMessages = context.chat.filter(x => !x.is_system).map(x => ({ text: String(x.mes), hash: getStringHash(x.mes) }));
        const hashesInCollection = await getSavedHashes(chatId);

        const newVectorItems = hashedMessages.filter(x => !hashesInCollection.includes(x.hash));
        const deletedHashes = hashesInCollection.filter(x => !hashedMessages.some(y => y.hash === x));

        if (newVectorItems.length > 0) {
            await insertVectorItems(chatId, newVectorItems);
            console.log(`Vectors: Inserted ${newVectorItems.length} new items`);
        }

        if (deletedHashes.length > 0) {
            await deleteVectorItems(chatId, deletedHashes);
            console.log(`Vectors: Deleted ${deletedHashes.length} old hashes`);
        }
    } catch (error) {
        console.error('Vectors: Failed to synchronize chat', error);
    }
}

// Cache object for storing hash values
const hashCache = {};

/**
 * Gets the hash value for a given string
 * @param {string} str Input string
 * @returns {number} Hash value
 */
function getStringHash(str) {
  // Check if the hash is already in the cache
  if (hashCache.hasOwnProperty(str)) {
    return hashCache[str];
  }

  // Calculate the hash value
  const hash = calculateHash(str);

  // Store the hash in the cache
  hashCache[str] = hash;

  return hash;
}

/**
 * Removes the most relevant messages from the chat and displays them in the extension prompt
 * @param {object[]} chat Array of chat messages
 */
async function rearrangeChat(chat) {
    try {
        if (!settings.enabled) {
            return;
        }

        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(chat)) {
            console.debug('Vectors: No chat selected');
            return;
        }

        if (chat.length < AMOUNT_TO_LEAVE) {
            console.debug(`Vectors: Not enough messages to rearrange (less than ${AMOUNT_TO_LEAVE})`);
            return;
        }

        const queryText = getQueryText(chat);

        if (queryText.length === 0) {
            console.debug('Vectors: No text to query');
            return;
        }

        // Get the most relevant messages, excluding the last few
        const queryHashes = await queryCollection(chatId, queryText, INSERT_AMOUNT);
        const queriedMessages = [];
        const retainMessages = chat.slice(-AMOUNT_TO_LEAVE);

        for (const message of chat) {
            if (retainMessages.includes(message)) {
                continue;
            }
            if (message.mes && queryHashes.includes(getStringHash(message.mes))) {
                queriedMessages.push(message);
            }
        }

        // Rearrange queried messages to match query order
        // Order is reversed because more relevant are at the lower indices
        queriedMessages.sort((a, b) => queryHashes.indexOf(getStringHash(b.mes)) - queryHashes.indexOf(getStringHash(a.mes)));

        // Remove queried messages from the original chat array
        for (const message of chat) {
            if (queriedMessages.includes(message)) {
                chat.splice(chat.indexOf(message), 1);
            }
        }

        // Format queried messages into a single string
        const queriedText = 'Past events: ' + queriedMessages.map(x => collapseNewlines(`${x.name}: ${x.mes}`).trim()).join('\n\n');
        setExtensionPrompt(EXTENSION_PROMPT_TAG, queriedText, extension_prompt_types.IN_PROMPT, 0);
    } catch (error) {
        console.error('Vectors: Failed to rearrange chat', error);
    }
}

window['vectors_rearrangeChat'] = rearrangeChat;

const onChatEvent = debounce(async () => await moduleWorker.update(), 500);

/**
 * Gets the text to query from the chat
 * @param {object[]} chat Chat messages
 * @returns {string} Text to query
 */
function getQueryText(chat) {
    let queryText = '';
    let i = 0;

    for (const message of chat.slice().reverse()) {
        if (message.mes) {
            queryText += message.mes + '\n';
            i++;
        }

        if (i === QUERY_TEXT_AMOUNT) {
            break;
        }
    }

    return collapseNewlines(queryText).trim();
}

/**
 * Gets the saved hashes for a collection
* @param {string} collectionId
* @returns {Promise<number[]>} Saved hashes
*/
async function getSavedHashes(collectionId) {
    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ collectionId }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get saved hashes for collection ${collectionId}`);
    }

    const hashes = await response.json();
    return hashes;
}

/**
 * Inserts vector items into a collection
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @returns {Promise<void>}
 */
async function insertVectorItems(collectionId, items) {
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ collectionId, items }),
    });

    if (!response.ok) {
        throw new Error(`Failed to insert vector items for collection ${collectionId}`);
    }
}

/**
 * Deletes vector items from a collection
 * @param {string} collectionId - The collection to delete from
 * @param {number[]} hashes - The hashes of the items to delete
 * @returns {Promise<void>}
 */
async function deleteVectorItems(collectionId, hashes) {
    const response = await fetch('/api/vector/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ collectionId, hashes }),
    });

    if (!response.ok) {
        throw new Error(`Failed to delete vector items for collection ${collectionId}`);
    }
}

/**
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @returns {Promise<number[]>} - Hashes of the results
 */
async function queryCollection(collectionId, searchText, topK) {
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ collectionId, searchText, topK }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query collection ${collectionId}`);
    }

    const results = await response.json();
    return results;
}

jQuery(async () => {
    if (!extension_settings.vectors) {
        extension_settings.vectors = settings;
    }

    Object.assign(settings, extension_settings.vectors);
    $('#extensions_settings2').append(renderExtensionTemplate(MODULE_NAME, 'settings'));
    $('#vectors_enabled').prop('checked', settings.enabled).on('input', () => {
        settings.enabled = $('#vectors_enabled').prop('checked');
        Object.assign(extension_settings.vectors, settings);
        saveSettingsDebounced();
    });

    eventSource.on(event_types.CHAT_CHANGED, onChatEvent);
    eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
    eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SENT, onChatEvent);
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
});
