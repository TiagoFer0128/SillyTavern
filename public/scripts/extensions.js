import { callPopup, eventSource, event_types, saveSettings, saveSettingsDebounced, getRequestHeaders, substituteParams, renderTemplate } from "../script.js";
import { isSubsetOf } from "./utils.js";
export {
    getContext,
    getApiUrl,
    loadExtensionSettings,
    runGenerationInterceptors,
    doExtrasFetch,
    modules,
    extension_settings,
    ModuleWorkerWrapper,
};

export let extensionNames = [];
let manifests = {};
const defaultUrl = "http://localhost:5100";

let saveMetadataTimeout = null;

export function saveMetadataDebounced() {
    const context = getContext();
    const groupId = context.groupId;
    const characterId = context.characterId;

    if (saveMetadataTimeout) {
        console.debug('Clearing save metadata timeout');
        clearTimeout(saveMetadataTimeout);
    }

    saveMetadataTimeout = setTimeout(async () => {
        const newContext = getContext();

        if (groupId !== newContext.groupId) {
            console.warn('Group changed, not saving metadata');
            return;
        }

        if (characterId !== newContext.characterId) {
            console.warn('Character changed, not saving metadata');
            return;
        }

        console.debug('Saving metadata...');
        newContext.saveMetadata();
        console.debug('Saved metadata...');
    }, 1000);
}

export const extensionsHandlebars = Handlebars.create();

/**
 * Provides an ability for extensions to render HTML templates.
 * Templates sanitation and localization is forced.
 * @param {string} extensionName Extension name
 * @param {string} templateId Template ID
 * @param {object} templateData Additional data to pass to the template
 * @returns {string} Rendered HTML
 */
export function renderExtensionTemplate(extensionName, templateId, templateData = {}, sanitize = true, localize = true) {
    return renderTemplate(`scripts/extensions/${extensionName}/${templateId}.html`, templateData, sanitize, localize, true);
}

/**
 * Registers a Handlebars helper for use in extensions.
 * @param {string} name Handlebars helper name
 * @param {function} helper Handlebars helper function
 */
export function registerExtensionHelper(name, helper) {
    extensionsHandlebars.registerHelper(name, helper);
}

/**
 * Applies handlebars extension helpers to a message.
 * @param {number} messageId Message index in the chat.
 */
export function processExtensionHelpers(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (!message?.mes || typeof message.mes !== 'string') {
        return;
    }

    // Don't waste time if there are no mustaches
    if (!substituteParams(message.mes).includes('{{')) {
        return;
    }

    try {
        const template = extensionsHandlebars.compile(substituteParams(message.mes), { noEscape: true });
        message.mes = template({});
    } catch {
        // Ignore
    }
}

// Disables parallel updates
class ModuleWorkerWrapper {
    constructor(callback) {
        this.isBusy = false;
        this.callback = callback;
    }

    // Called by the extension
    async update() {
        // Don't touch me I'm busy...
        if (this.isBusy) {
            return;
        }

        // I'm free. Let's update!
        try {
            this.isBusy = true;
            await this.callback();
        }
        finally {
            this.isBusy = false;
        }
    }
}

const extension_settings = {
    apiUrl: defaultUrl,
    apiKey: '',
    autoConnect: false,
    notifyUpdates: false,
    disabledExtensions: [],
    expressionOverrides: [],
    memory: {},
    note: {
        default: '',
        chara: [],
        wiAddition: [],
    },
    caption: {
        refine_mode: false,
    },
    expressions: {
        /** @type {string[]} */
        custom: [],
    },
    dice: {},
    regex: [],
    tts: {},
    sd: {
        prompts: {},
        character_prompts: {},
    },
    chromadb: {},
    translate: {},
    objective: {},
    quickReply: {},
    randomizer: {
        controls: [],
        fluctuation: 0.1,
        enabled: false,
    },
    speech_recognition: {},
    rvc: {},
    hypebot: {},
    vectors: {},
};

let modules = [];
let activeExtensions = new Set();

const getContext = () => window['SillyTavern'].getContext();
const getApiUrl = () => extension_settings.apiUrl;
let connectedToApi = false;

function showHideExtensionsMenu() {
    // Get the number of menu items that are not hidden
    const hasMenuItems = $('#extensionsMenu').children().filter((_, child) => $(child).css('display') !== 'none').length > 0;

    // We have menu items, so we can stop checking
    if (hasMenuItems) {
        clearInterval(menuInterval);
    }

    // Show or hide the menu button
    $('#extensionsMenuButton').toggle(hasMenuItems);
}

// Periodically check for new extensions
const menuInterval = setInterval(showHideExtensionsMenu, 1000);

async function doExtrasFetch(endpoint, args) {
    if (!args) {
        args = {}
    }

    if (!args.method) {
        Object.assign(args, { method: 'GET' });
    }

    if (!args.headers) {
        args.headers = {}
    }
    Object.assign(args.headers, {
        'Authorization': `Bearer ${extension_settings.apiKey}`,
    });

    const response = await fetch(endpoint, args);
    return response;
}

async function discoverExtensions() {
    try {
        const response = await fetch('/api/extensions/discover');

        if (response.ok) {
            const extensions = await response.json();
            return extensions;
        }
        else {
            return [];
        }
    }
    catch (err) {
        console.error(err);
        return [];
    }
}

function onDisableExtensionClick() {
    const name = $(this).data('name');
    disableExtension(name);
}

function onEnableExtensionClick() {
    const name = $(this).data('name');
    enableExtension(name);
}

async function enableExtension(name) {
    extension_settings.disabledExtensions = extension_settings.disabledExtensions.filter(x => x !== name);
    await saveSettings();
    location.reload();
}

async function disableExtension(name) {
    extension_settings.disabledExtensions.push(name);
    await saveSettings();
    location.reload();
}

async function getManifests(names) {
    const obj = {};
    const promises = [];

    for (const name of names) {
        const promise = new Promise((resolve, reject) => {
            fetch(`/scripts/extensions/${name}/manifest.json`).then(async response => {
                if (response.ok) {
                    const json = await response.json();
                    obj[name] = json;
                    resolve();
                } else {
                    reject();
                }
            }).catch(err => {
                reject();
                console.log('Could not load manifest.json for ' + name, err);
            });
        });

        promises.push(promise);
    }

    await Promise.allSettled(promises);
    return obj;
}

async function activateExtensions() {
    const extensions = Object.entries(manifests).sort((a, b) => a[1].loading_order - b[1].loading_order);
    const promises = [];

    for (let entry of extensions) {
        const name = entry[0];
        const manifest = entry[1];
        const elementExists = document.getElementById(name) !== null;

        if (elementExists || activeExtensions.has(name)) {
            continue;
        }

        // all required modules are active (offline extensions require none)
        if (isSubsetOf(modules, manifest.requires)) {
            try {
                const isDisabled = extension_settings.disabledExtensions.includes(name);
                const li = document.createElement('li');

                if (!isDisabled) {
                    const promise = Promise.all([addExtensionScript(name, manifest), addExtensionStyle(name, manifest)]);
                    promise
                        .then(() => activeExtensions.add(name))
                        .catch(err => console.log('Could not activate extension: ' + name, err));
                    promises.push(promise);
                }
                else {
                    li.classList.add('disabled');
                }

                li.id = name;
                li.innerText = manifest.display_name;

                $('#extensions_list').append(li);
            }
            catch (error) {
                console.error(`Could not activate extension: ${name}`);
                console.error(error);
            }
        }
    }

    await Promise.allSettled(promises);
}

async function connectClickHandler() {
    const baseUrl = $("#extensions_url").val();
    extension_settings.apiUrl = String(baseUrl);
    const testApiKey = $("#extensions_api_key").val();
    extension_settings.apiKey = String(testApiKey);
    saveSettingsDebounced();
    await connectToApi(baseUrl);
}

function autoConnectInputHandler() {
    const value = $(this).prop('checked');
    extension_settings.autoConnect = !!value;

    if (value && !connectedToApi) {
        $("#extensions_connect").trigger('click');
    }

    saveSettingsDebounced();
}

function addExtensionsButtonAndMenu() {
    const buttonHTML =
        `<div id="extensionsMenuButton" style="display: none;" class="fa-solid fa-magic-wand-sparkles" title="Extras Extensions" /></div>`;
    const extensionsMenuHTML = `<div id="extensionsMenu" class="options-content" style="display: none;"></div>`;

    $(document.body).append(extensionsMenuHTML);

    $('#send_but_sheld').prepend(buttonHTML);

    const button = $('#extensionsMenuButton');
    const dropdown = $('#extensionsMenu');
    //dropdown.hide();

    let popper = Popper.createPopper(button.get(0), dropdown.get(0), {
        placement: 'top-end',
    });

    $(button).on('click', function () {
        popper.update()
        dropdown.fadeIn(250);
    });

    $("html").on('touchstart mousedown', function (e) {
        let clickTarget = $(e.target);
        if (dropdown.is(':visible')
            && clickTarget.closest(button).length == 0
            && clickTarget.closest(dropdown).length == 0) {
            $(dropdown).fadeOut(250);
        }
    });
}

function notifyUpdatesInputHandler() {
    extension_settings.notifyUpdates = !!$('#extensions_notify_updates').prop('checked');
    saveSettingsDebounced();

    if (extension_settings.notifyUpdates) {
        checkForExtensionUpdates(true);
    }
}

/*     $(document).on('click', function (e) {
        const target = $(e.target);
        if (target.is(dropdown)) return;
        if (target.is(button) && dropdown.is(':hidden')) {
            dropdown.toggle(200);
            popper.update();
        }
        if (target !== dropdown &&
            target !== button &&
            dropdown.is(":visible")) {
            dropdown.hide(200);
        }
    });
} */

async function connectToApi(baseUrl) {
    if (!baseUrl) {
        return;
    }

    const url = new URL(baseUrl);
    url.pathname = '/api/modules';

    try {
        const getExtensionsResult = await doExtrasFetch(url);

        if (getExtensionsResult.ok) {
            const data = await getExtensionsResult.json();
            modules = data.modules;
            await activateExtensions();
            eventSource.emit(event_types.EXTRAS_CONNECTED, modules);
        }

        updateStatus(getExtensionsResult.ok);
    }
    catch {
        updateStatus(false);
    }
}

function updateStatus(success) {
    connectedToApi = success;
    const _text = success ? 'Connected to API' : 'Could not connect to API';
    const _class = success ? 'success' : 'failure';
    $('#extensions_status').text(_text);
    $('#extensions_status').attr('class', _class);
}

function addExtensionStyle(name, manifest) {
    if (manifest.css) {
        return new Promise((resolve, reject) => {
            const url = `/scripts/extensions/${name}/${manifest.css}`;

            if ($(`link[id="${name}"]`).length === 0) {
                const link = document.createElement('link');
                link.id = name;
                link.rel = "stylesheet";
                link.type = "text/css";
                link.href = url;
                link.onload = function () {
                    resolve();
                }
                link.onerror = function (e) {
                    reject(e);
                }
                document.head.appendChild(link);
            }
        });
    }

    return Promise.resolve();
}

function addExtensionScript(name, manifest) {
    if (manifest.js) {
        return new Promise((resolve, reject) => {
            const url = `/scripts/extensions/${name}/${manifest.js}`;
            let ready = false;

            if ($(`script[id="${name}"]`).length === 0) {
                const script = document.createElement('script');
                script.id = name;
                script.type = 'module';
                script.src = url;
                script.async = true;
                script.onerror = function (err) {
                    reject(err, script);
                };
                script.onload = script.onreadystatechange = function () {
                    // console.log(this.readyState); // uncomment this line to see which ready states are called.
                    if (!ready && (!this.readyState || this.readyState == 'complete')) {
                        ready = true;
                        resolve();
                    }
                };
                document.body.appendChild(script);
            }
        });
    }

    return Promise.resolve();
}



/**
 * Generates HTML string for displaying an extension in the UI.
 *
 * @param {string} name - The name of the extension.
 * @param {object} manifest - The manifest of the extension.
 * @param {boolean} isActive - Whether the extension is active or not.
 * @param {boolean} isDisabled - Whether the extension is disabled or not.
 * @param {boolean} isExternal - Whether the extension is external or not.
 * @param {string} checkboxClass - The class for the checkbox HTML element.
 * @return {string} - The HTML string that represents the extension.
 */
async function generateExtensionHtml(name, manifest, isActive, isDisabled, isExternal, checkboxClass) {
    const displayName = manifest.display_name;
    let displayVersion = manifest.version ? ` v${manifest.version}` : "";
    let isUpToDate = true;
    let updateButton = '';
    let originHtml = '';
    if (isExternal) {
        let data = await getExtensionVersion(name.replace('third-party', ''));
        let branch = data.currentBranchName;
        let commitHash = data.currentCommitHash;
        let origin = data.remoteUrl
        isUpToDate = data.isUpToDate;
        displayVersion = ` (${branch}-${commitHash.substring(0, 7)})`;
        updateButton = isUpToDate ?
            `<span class="update-button"><button class="btn_update menu_button" data-name="${name.replace('third-party', '')}" title="Up to date"><i class="fa-solid fa-code-commit"></i></button></span>` :
            `<span class="update-button"><button class="btn_update menu_button" data-name="${name.replace('third-party', '')}" title="Update available"><i class="fa-solid fa-download"></i></button></span>`;
        originHtml = `<a href="${origin}" target="_blank" rel="noopener noreferrer">`;
    }

    let toggleElement = isActive || isDisabled ?
        `<input type="checkbox" title="Click to toggle" data-name="${name}" class="${isActive ? 'toggle_disable' : 'toggle_enable'} ${checkboxClass}" ${isActive ? 'checked' : ''}>` :
        `<input type="checkbox" title="Cannot enable extension" data-name="${name}" class="extension_missing ${checkboxClass}" disabled>`;

    let deleteButton = isExternal ? `<span class="delete-button"><button class="btn_delete menu_button" data-name="${name.replace('third-party', '')}" title="Delete"><i class="fa-solid fa-trash-can"></i></button></span>` : '';

    // if external, wrap the name in a link to the repo

    let extensionHtml = `<hr>
        <h4>
            ${updateButton}
            ${deleteButton}
            ${originHtml}
            <span class="${isActive ? "extension_enabled" : isDisabled ? "extension_disabled" : "extension_missing"}">
                ${DOMPurify.sanitize(displayName)}${displayVersion}
            </span>
            ${isExternal ? '</a>' : ''}

            <span style="float:right;">${toggleElement}</span>
        </h4>`;

    if (isActive && Array.isArray(manifest.optional)) {
        const optional = new Set(manifest.optional);
        modules.forEach(x => optional.delete(x));
        if (optional.size > 0) {
            const optionalString = DOMPurify.sanitize([...optional].join(', '));
            extensionHtml += `<p>Optional modules: <span class="optional">${optionalString}</span></p>`;
        }
    } else if (!isDisabled) { // Neither active nor disabled
        const requirements = new Set(manifest.requires);
        modules.forEach(x => requirements.delete(x));
        const requirementsString = DOMPurify.sanitize([...requirements].join(', '));
        extensionHtml += `<p>Missing modules: <span class="failure">${requirementsString}</span></p>`;
    }

    return extensionHtml;
}

/**
 * Gets extension data and generates the corresponding HTML for displaying the extension.
 *
 * @param {Array} extension - An array where the first element is the extension name and the second element is the extension manifest.
 * @return {Promise<object>} - An object with 'isExternal' indicating whether the extension is external, and 'extensionHtml' for the extension's HTML string.
 */
async function getExtensionData(extension) {
    const name = extension[0];
    const manifest = extension[1];
    const isActive = activeExtensions.has(name);
    const isDisabled = extension_settings.disabledExtensions.includes(name);
    const isExternal = name.startsWith('third-party');

    const checkboxClass = isDisabled ? "checkbox_disabled" : "";

    const extensionHtml = await generateExtensionHtml(name, manifest, isActive, isDisabled, isExternal, checkboxClass);

    return { isExternal, extensionHtml };
}


/**
 * Gets the module information to be displayed.
 *
 * @return {string} - The HTML string for the module information.
 */
function getModuleInformation() {
    let moduleInfo = modules.length ? `<p>${DOMPurify.sanitize(modules.join(', '))}</p>` : '<p class="failure">Not connected to the API!</p>';
    return `
        <h3>Modules provided by your Extensions API:</h3>
        ${moduleInfo}
    `;
}

/**
 * Generates the HTML strings for all extensions and displays them in a popup.
 */
async function showExtensionsDetails() {
    let htmlDefault = '<h3>Default Extensions:</h3>';
    let htmlExternal = '<h3>External Extensions:</h3>';

    const extensions = Object.entries(manifests).sort((a, b) => a[1].loading_order - b[1].loading_order);
    const promises = [];

    for (const extension of extensions) {
        promises.push(getExtensionData(extension));
    }

    const settledPromises = await Promise.allSettled(promises);

    settledPromises.forEach(promise => {
        if (promise.status === 'fulfilled') {
            const { isExternal, extensionHtml } = promise.value;
            if (isExternal) {
                htmlExternal += extensionHtml;
            } else {
                htmlDefault += extensionHtml;
            }
        }
    });

    const html = `
        ${getModuleInformation()}
        ${htmlDefault}
        ${htmlExternal}
    `;
    callPopup(`<div class="extensions_info">${html}</div>`, 'text');
}


/**
 * Handles the click event for the update button of an extension.
 * This function makes a POST request to '/update_extension' with the extension's name.
 * If the extension is already up to date, it displays a success message.
 * If the extension is not up to date, it updates the extension and displays a success message with the new commit hash.
 */
async function onUpdateClick() {
    const extensionName = $(this).data('name');
    await updateExtension(extensionName, false);
}

/**
 * Updates a third-party extension via the API.
 * @param {string} extensionName Extension folder name
 * @param {boolean} quiet If true, don't show a success message
 */
async function updateExtension(extensionName, quiet) {
    try {
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName })
        });

        const data = await response.json();
        if (data.isUpToDate) {
            if (!quiet) {
                toastr.success('Extension is already up to date');
            }
        } else {
            toastr.success(`Extension ${extensionName} updated to ${data.shortCommitHash}`);
        }

        if (!quiet) {
            showExtensionsDetails();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

/**
 * Handles the click event for the delete button of an extension.
 * This function makes a POST request to '/api/extensions/delete' with the extension's name.
 * If the extension is deleted, it displays a success message.
 * Creates a popup for the user to confirm before delete.
 */
async function onDeleteClick() {
    const extensionName = $(this).data('name');
    // use callPopup to create a popup for the user to confirm before delete
    const confirmation = await callPopup(`Are you sure you want to delete ${extensionName}?`, 'delete_extension');
    if (confirmation) {
        await deleteExtension(extensionName);
    }
};

export async function deleteExtension(extensionName) {
    try {
        const response = await fetch('/api/extensions/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName })
        });
    } catch (error) {
        console.error('Error:', error);
    }

    toastr.success(`Extension ${extensionName} deleted`);
    showExtensionsDetails();
    // reload the page to remove the extension from the list
    location.reload();
}

/**
 * Fetches the version details of a specific extension.
 *
 * @param {string} extensionName - The name of the extension.
 * @return {Promise<object>} - An object containing the extension's version details.
 * This object includes the currentBranchName, currentCommitHash, isUpToDate, and remoteUrl.
 * @throws {error} - If there is an error during the fetch operation, it logs the error to the console.
 */
async function getExtensionVersion(extensionName) {
    try {
        const response = await fetch('/api/extensions/version', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName })
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}

/**
 * Installs a third-party extension via the API.
 * @param {string} url Extension repository URL
 * @returns {Promise<void>}
 */
export async function installExtension(url) {
    console.debug('Extension installation started', url);

    toastr.info('Please wait...', 'Installing extension');

    const request = await fetch('/api/extensions/install', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ url }),
    });

    if (!request.ok) {
        toastr.info(request.statusText, 'Extension installation failed');
        console.error('Extension installation failed', request.status, request.statusText);
        return;
    }

    const response = await request.json();
    toastr.success(`Extension "${response.display_name}" by ${response.author} (version ${response.version}) has been installed successfully!`, 'Extension installation successful');
    console.debug(`Extension "${response.display_name}" has been installed successfully at ${response.extensionPath}`);
    await loadExtensionSettings({}, false);
    eventSource.emit(event_types.EXTENSION_SETTINGS_LOADED);
}

/**
 * Loads extension settings from the app settings.
 * @param {object} settings App Settings
 * @param {boolean} versionChanged Is this a version change?
 */
async function loadExtensionSettings(settings, versionChanged) {
    if (settings.extension_settings) {
        Object.assign(extension_settings, settings.extension_settings);
    }

    $("#extensions_url").val(extension_settings.apiUrl);
    $("#extensions_api_key").val(extension_settings.apiKey);
    $("#extensions_autoconnect").prop('checked', extension_settings.autoConnect);
    $("#extensions_notify_updates").prop('checked', extension_settings.notifyUpdates);

    // Activate offline extensions
    eventSource.emit(event_types.EXTENSIONS_FIRST_LOAD);
    extensionNames = await discoverExtensions();
    manifests = await getManifests(extensionNames)

    if (versionChanged) {
        await autoUpdateExtensions();
    }

    await activateExtensions();
    if (extension_settings.autoConnect && extension_settings.apiUrl) {
        connectToApi(extension_settings.apiUrl);
    }

    if (extension_settings.notifyUpdates) {
        checkForExtensionUpdates(false);
    }
}

/**
 * Checks if there are updates available for 3rd-party extensions.
 * @param {boolean} force Skip nag check
 * @returns {Promise<any>}
 */
async function checkForExtensionUpdates(force) {
    if (!force) {
        const STORAGE_NAG_KEY = 'extension_update_nag';
        const currentDate = new Date().toDateString();

        // Don't nag more than once a day
        if (localStorage.getItem(STORAGE_NAG_KEY) === currentDate) {
            return;
        }

        localStorage.setItem(STORAGE_NAG_KEY, currentDate);
    }

    const updatesAvailable = [];
    const promises = [];

    for (const [id, manifest] of Object.entries(manifests)) {
        if (manifest.auto_update && id.startsWith('third-party')) {
            const promise = new Promise(async (resolve, reject) => {
                try {
                    const data = await getExtensionVersion(id.replace('third-party', ''));
                    if (data.isUpToDate === false) {
                        updatesAvailable.push(manifest.display_name);
                    }
                    resolve();
                } catch (error) {
                    console.error('Error checking for extension updates', error);
                    reject();
                }
            });
            promises.push(promise);
        }
    }

    await Promise.allSettled(promises);

    if (updatesAvailable.length > 0) {
        toastr.info(`${updatesAvailable.map(x => `• ${x}`).join('\n')}`, 'Extension updates available');
    }
}

async function autoUpdateExtensions() {
    for (const [id, manifest] of Object.entries(manifests)) {
        if (manifest.auto_update && id.startsWith('third-party')) {
            console.debug(`Auto-updating 3rd-party extension: ${manifest.display_name} (${id})`);
            await updateExtension(id.replace('third-party', ''), true);
        }
    }
}

async function runGenerationInterceptors(chat, contextSize) {
    for (const manifest of Object.values(manifests)) {
        const interceptorKey = manifest.generate_interceptor;
        if (typeof window[interceptorKey] === 'function') {
            try {
                await window[interceptorKey](chat, contextSize);
            } catch (e) {
                console.error(`Failed running interceptor for ${manifest.display_name}`, e);
            }
        }
    }
}

jQuery(function () {
    addExtensionsButtonAndMenu();
    $("#extensionsMenuButton").css("display", "flex");

    $("#extensions_connect").on('click', connectClickHandler);
    $("#extensions_autoconnect").on('input', autoConnectInputHandler);
    $("#extensions_details").on('click', showExtensionsDetails);
    $("#extensions_notify_updates").on('input', notifyUpdatesInputHandler);
    $(document).on('click', '.toggle_disable', onDisableExtensionClick);
    $(document).on('click', '.toggle_enable', onEnableExtensionClick);
    $(document).on('click', '.btn_update', onUpdateClick);
    $(document).on('click', '.btn_delete', onDeleteClick);

    /**
     * Handles the click event for the third-party extension import button.
     * Prompts the user to enter the Git URL of the extension to import.
     * After obtaining the Git URL, makes a POST request to '/api/extensions/install' to import the extension.
     * If the extension is imported successfully, a success message is displayed.
     * If the extension import fails, an error message is displayed and the error is logged to the console.
     * After successfully importing the extension, the extension settings are reloaded and a 'EXTENSION_SETTINGS_LOADED' event is emitted.
     *
     * @listens #third_party_extension_button#click - The click event of the '#third_party_extension_button' element.
     */
    $('#third_party_extension_button').on('click', async () => {
        const html = `<h3>Enter the Git URL of the extension to install</h3>
    <br>
    <p><b>Disclaimer:</b> Please be aware that using external extensions can have unintended side effects and may pose security risks. Always make sure you trust the source before importing an extension. We are not responsible for any damage caused by third-party extensions.</p>
    <br>
    <p>Example: <tt> https://github.com/author/extension-name </tt></p>`
        const input = await callPopup(html, 'input');

        if (!input) {
            console.debug('Extension install cancelled');
            return;
        }

        const url = input.trim();
        await installExtension(url);
    });
});
