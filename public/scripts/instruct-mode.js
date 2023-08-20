"use strict";

import { name1, name2, saveSettingsDebounced, substituteParams } from "../script.js";
import { selected_group } from "./group-chats.js";
import { power_user } from "./power-user.js";

export let instruct_presets = [];

/**
 * Loads instruct mode settings from the given data object.
 * @param {object} data Settings data object.
 */
export function loadInstructMode(data) {
    if (data.instruct !== undefined) {
        instruct_presets = data.instruct;
    }

    if (power_user.instruct.names_force_groups === undefined) {
        power_user.instruct.names_force_groups = true;
    }

    const controls = [
        { id: "instruct_enabled", property: "enabled", isCheckbox: true },
        { id: "instruct_wrap", property: "wrap", isCheckbox: true },
        { id: "instruct_system_prompt", property: "system_prompt", isCheckbox: false },
        { id: "instruct_system_sequence", property: "system_sequence", isCheckbox: false },
        { id: "instruct_separator_sequence", property: "separator_sequence", isCheckbox: false },
        { id: "instruct_input_sequence", property: "input_sequence", isCheckbox: false },
        { id: "instruct_output_sequence", property: "output_sequence", isCheckbox: false },
        { id: "instruct_stop_sequence", property: "stop_sequence", isCheckbox: false },
        { id: "instruct_names", property: "names", isCheckbox: true },
        { id: "instruct_macro", property: "macro", isCheckbox: true },
        { id: "instruct_names_force_groups", property: "names_force_groups", isCheckbox: true },
        { id: "instruct_last_output_sequence", property: "last_output_sequence", isCheckbox: false },
        { id: "instruct_activation_regex", property: "activation_regex", isCheckbox: false },
    ];

    controls.forEach(control => {
        const $element = $(`#${control.id}`);

        if (control.isCheckbox) {
            $element.prop('checked', power_user.instruct[control.property]);
        } else {
            $element.val(power_user.instruct[control.property]);
        }

        $element.on('input', function () {
            power_user.instruct[control.property] = control.isCheckbox ? !!$(this).prop('checked') : $(this).val();
            saveSettingsDebounced();
        });
    });

    instruct_presets.forEach((preset) => {
        const name = preset.name;
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        option.selected = name === power_user.instruct.preset;
        $('#instruct_presets').append(option);
    });

    function highlightDefaultPreset() {
        $('#instruct_set_default').toggleClass('default', power_user.default_instruct === power_user.instruct.preset);
    }

    $('#instruct_set_default').on('click', function () {
        power_user.default_instruct = power_user.instruct.preset;
        $(this).addClass('default');
        toastr.success(`Default instruct preset set to ${power_user.default_instruct}`);
        saveSettingsDebounced();
    });

    highlightDefaultPreset();

    $('#instruct_presets').on('change', function () {
        const name = $(this).find(':selected').val();
        const preset = instruct_presets.find(x => x.name === name);

        if (!preset) {
            return;
        }

        power_user.instruct.preset = name;
        controls.forEach(control => {
            if (preset[control.property] !== undefined) {
                power_user.instruct[control.property] = preset[control.property];
                const $element = $(`#${control.id}`);

                if (control.isCheckbox) {
                    $element.prop('checked', power_user.instruct[control.property]).trigger('input');
                } else {
                    $element.val(power_user.instruct[control.property]).trigger('input');
                }
            }
        });

        highlightDefaultPreset();
    });
}

/**
 * Automatically select instruct preset based on model id.
 * 1. Enables instruct mode if preset is found.
 * 2. Otherwise, if default instruct preset is set, selects it.
 * @param {string} modelId Model name reported by the API.
 * @returns {boolean} True if instruct preset was activated by model id, false otherwise.
 */
export function autoSelectInstructPreset(modelId) {
    for (const preset of instruct_presets) {
        // If activation regex is set, check if it matches the model id
        if (preset.activation_regex) {
            try {
                const modeState = power_user.instruct.enabled;
                const regex = new RegExp(preset.activation_regex, 'i');

                // If regex matches, select the preset and enable instruct mode
                // Should not enable instruct mode if it's already enabled and the preset is the same
                if (regex.test(modelId) && (power_user.instruct.preset !== preset.name || !modeState)) {
                    $('#instruct_presets').val(preset.name).trigger('change');
                    $('#instruct_enabled').prop('checked', true).trigger('input');
                    console.log(`Instruct mode: preset "${preset.name}" auto-selected`);

                    // If instruct mode was disabled, show a notification
                    if (!modeState) {
                        toastr.info(`Instruct mode enabled by preset "${preset.name}" for model "${modelId}"`);
                    }

                    return true;
                }
            } catch {
                // If regex is invalid, ignore it
                console.warn(`Invalid instruct activation regex in preset "${preset.name}"`);
            }
        }
    }

    if (power_user.instruct.enabled && power_user.default_instruct && power_user.instruct.preset !== power_user.default_instruct) {
        if (instruct_presets.some(p => p.name === power_user.default_instruct)) {
            console.log(`Instruct mode: default preset "${power_user.default_instruct}" selected`);
            $('#instruct_presets').val(power_user.default_instruct).trigger('change');
        }
    }

    return false;
}

/**
 * Converts instruct mode sequences to an array of stopping strings.
 * @returns {string[]} Array of instruct mode stopping strings.
 */
export function getInstructStoppingSequences() {
    function addInstructSequence(sequence) {
        // Cohee: oobabooga's textgen always appends newline before the sequence as a stopping string
        // But it's a problem for Metharme which doesn't use newlines to separate them.
        const wrap = (s) => power_user.instruct.wrap ? '\n' + s : s;
        // Sequence must be a non-empty string
        if (typeof sequence === 'string' && sequence.length > 0) {
            // If sequence is just a whitespace or newline - we don't want to make it a stopping string
            // User can always add it as a custom stop string if really needed
            if (sequence.trim().length > 0) {
                const wrappedSequence = wrap(sequence);
                // Need to respect "insert macro" setting
                const stopString = power_user.instruct.macro ? substituteParams(wrappedSequence) : wrappedSequence;
                result.push(stopString);
            }
        }
    }

    const result = [];

    if (power_user.instruct.enabled) {
        const input_sequence = power_user.instruct.input_sequence;
        const output_sequence = power_user.instruct.output_sequence;
        const last_output_sequence = power_user.instruct.last_output_sequence;

        const combined_sequence = `${input_sequence}\n${output_sequence}\n${last_output_sequence}`;

        combined_sequence.split('\n').filter((line, index, self) => self.indexOf(line) === index).forEach(addInstructSequence);
    }

    return result;
}

/**
 * Formats instruct mode chat message.
 * @param {string} name Character name.
 * @param {string} mes Message text.
 * @param {boolean} isUser Is the message from the user.
 * @param {boolean} isNarrator Is the message from the narrator.
 * @param {string} forceAvatar Force avatar string.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 * @returns {string} Formatted instruct mode chat message.
 */
export function formatInstructModeChat(name, mes, isUser, isNarrator, forceAvatar, name1, name2) {
    let includeNames = isNarrator ? false : power_user.instruct.names;

    if (!isNarrator && power_user.instruct.names_force_groups && (selected_group || forceAvatar)) {
        includeNames = true;
    }

    let sequence = (isUser || isNarrator) ? power_user.instruct.input_sequence : power_user.instruct.output_sequence;

    if (power_user.instruct.macro) {
        sequence = substituteParams(sequence, name1, name2);
    }

    const separator = power_user.instruct.wrap ? '\n' : '';
    const separatorSequence = power_user.instruct.separator_sequence && !isUser
        ? power_user.instruct.separator_sequence
        : separator;
    const textArray = includeNames ? [sequence, `${name}: ${mes}` + separatorSequence] : [sequence, mes + separatorSequence];
    const text = textArray.filter(x => x).join(separator);
    return text;
}

/**
 * Formats example messages according to instruct mode settings.
 * @param {string} mesExamples Example messages string.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 * @returns {string} Formatted example messages string.
 */
export function formatInstructModeExamples(mesExamples, name1, name2) {
    const includeNames = power_user.instruct.names || (!!selected_group && power_user.instruct.names_force_groups);

    let inputSequence = power_user.instruct.input_sequence;
    let outputSequence = power_user.instruct.output_sequence;

    if (power_user.instruct.macro) {
        inputSequence = substituteParams(inputSequence, name1, name2);
        outputSequence = substituteParams(outputSequence, name1, name2);
    }

    const separator = power_user.instruct.wrap ? '\n' : '';
    const separatorSequence = power_user.instruct.separator_sequence ? power_user.instruct.separator_sequence : separator;

    mesExamples = mesExamples.replace(new RegExp(`\n${name1}: `, "gm"), separatorSequence + inputSequence + separator + (includeNames ? `${name1}: ` : ''));
    mesExamples = mesExamples.replace(new RegExp(`\n${name2}: `, "gm"), separator + outputSequence + separator + (includeNames ? `${name2}: ` : ''));

    return mesExamples;
}

/**
 * Formats instruct mode last prompt line.
 * @param {string} name Character name.
 * @param {boolean} isImpersonate Is generation in impersonation mode.
 * @param {string} promptBias Prompt bias string.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 */
export function formatInstructModePrompt(name, isImpersonate, promptBias, name1, name2) {
    const includeNames = power_user.instruct.names || (!!selected_group && power_user.instruct.names_force_groups);
    const getOutputSequence = () => power_user.instruct.last_output_sequence || power_user.instruct.output_sequence;
    let sequence = isImpersonate ? power_user.instruct.input_sequence : getOutputSequence();

    if (power_user.instruct.macro) {
        sequence = substituteParams(sequence, name1, name2);
    }

    const separator = power_user.instruct.wrap ? '\n' : '';
    let text = includeNames ? (separator + sequence + separator + `${name}:`) : (separator + sequence);

    if (!isImpersonate && promptBias) {
        text += (includeNames ? promptBias : (separator + promptBias));
    }

    return text.trimEnd() + (includeNames ? '' : separator);
}
