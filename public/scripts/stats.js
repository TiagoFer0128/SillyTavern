// statsHelper.js
import { getRequestHeaders, callPopup, token } from "../script.js";
import { humanizeGenTime } from "./RossAscends-mods.js";

let charStats = {};

/**
 * Creates an HTML stat block.
 *
 * @param {string} statName - The name of the stat to be displayed.
 * @param {number|string} statValue - The value of the stat to be displayed.
 * @returns {string} - An HTML string representing the stat block.
 */
function createStatBlock(statName, statValue) {
    return `<div class="rm_stat_block">
                <div class="rm_stat_name">${statName}:</div>
                <div class="rm_stat_value">${statValue}</div>
            </div>`;
}

/**
 * Verifies and returns a numerical stat value. If the provided stat is not a number, returns 0.
 *
 * @param {number|string} stat - The stat value to be checked and returned.
 * @returns {number} - The stat value if it is a number, otherwise 0.
 */
function calculateTotal(stat) {
    return isNaN(stat) ? 0 : stat;
}

/**
 * Calculates total stats from character statistics.
 *
 * @param {Object} charStats - Object containing character statistics.
 * @returns {Object} - Object containing total statistics.
 */
function calculateTotalStats() {
    let totalStats = {
        total_gen_time: 0,
        user_msg_count: 0,
        non_user_msg_count: 0,
        user_word_count: 0,
        non_user_word_count: 0,
        total_swipe_count: 0,
    };

    for (let stats of Object.values(charStats)) {
        totalStats.total_gen_time += calculateTotal(stats.total_gen_time);
        totalStats.user_msg_count += calculateTotal(stats.user_msg_count);
        totalStats.non_user_msg_count += calculateTotal(
            stats.non_user_msg_count
        );
        totalStats.user_word_count += calculateTotal(stats.user_word_count);
        totalStats.non_user_word_count += calculateTotal(
            stats.non_user_word_count
        );
        totalStats.total_swipe_count += calculateTotal(stats.total_swipe_count);
    }

    return totalStats;
}

/**
 * Generates an HTML report of stats.
 *
 * @param {string} statsType - The type of stats (e.g., "User", "Character").
 * @param {Object} stats - The stats data.
 */
function createHtml(statsType, stats) {
    // Get time string
    let timeStirng = humanizeGenTime(stats.total_gen_time);

    // Create popup HTML with stats
    let html = `<h3>${statsType} Stats</h3>`;
    html += createStatBlock("Chat Time", timeStirng);
    html += createStatBlock("Total User Messages", stats.user_msg_count);
    html += createStatBlock(
        "Total Character Messages",
        stats.non_user_msg_count
    );
    html += createStatBlock("Total User Words", stats.user_word_count);
    html += createStatBlock("Total Character Words", stats.non_user_word_count);
    html += createStatBlock("Swipes", stats.total_swipe_count);

    callPopup(html, "text");
}

/**
 * Handles the user stats by getting them from the server, calculating the total and generating the HTML report.
 *
 * @param {Object} charStats - Object containing character statistics.
 */
async function userStatsHandler() {
    // Get stats from server
    await getStats();

    // Calculate total stats
    let totalStats = calculateTotalStats(charStats);

    // Create HTML with stats
    createHtml("User", totalStats);
}

/**
 * Handles the character stats by getting them from the server and generating the HTML report.
 *
 * @param {Object} charStats - Object containing character statistics.
 * @param {Object} characters - Object containing character data.
 * @param {string} this_chid - The character id.
 */
async function characterStatsHandler(characters, this_chid) {
    // Get stats from server
   await getStats();

    // Get character stats
    let myStats = charStats[characters[this_chid].avatar];

    // Create HTML with stats
    createHtml("Character", myStats);
}

/**
 * Fetches the character stats from the server.
 *
 * @param {Object} charStats - Object containing character statistics.
 * @returns {Object} - Object containing fetched character statistics.
 */
async function getStats() {
    const response = await fetch("/getstats", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
        cache: "no-cache",
    });

    if (!response.ok) {
        toastr.error("Stats could not be loaded. Try reloading the page.");
        throw new Error("Error getting stats");
    }
    charStats = await response.json();
}

/**
 * Calculates the generation time based on start and finish times.
 *
 * @param {string} gen_started - The start time in ISO 8601 format.
 * @param {string} gen_finished - The finish time in ISO 8601 format.
 * @returns {number} - The difference in time in milliseconds.
 */
function calculateGenTime(gen_started, gen_finished) {
    let startDate = new Date(gen_started);
    let endDate = new Date(gen_finished);
    return endDate - startDate;
}

/**
 * Sends a POST request to the server to update the statistics.
 *
 * @param {Object} stats - The stats data to update.
 */
async function updateStats() {
    const response = await fetch("/updatestats", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify(charStats),
    });

    if (response.status !== 200) {
        console.error("Failed to update stats");
        console.log(response).status;
    }
}

/**
 * Handles stat processing for messages.
 *
 * @param {Object} line - Object containing message data.
 * @param {string} type - The type of the message processing (e.g., 'append', 'continue', 'appendFinal', 'swipe').
 * @param {Object} characters - Object containing character data.
 * @param {string} this_chid - The character id.
 * @param {Object} charStats - Object containing character statistics.
 * @param {string} oldMesssage - The old message that's being processed.
 */
async function statMesProcess(
    line,
    type,
    characters,
    this_chid,
    oldMesssage
) {
    if (this_chid === undefined) {
        return;
    }
    await getStats();
    let stat = charStats[characters[this_chid].avatar];

    stat.total_gen_time += calculateGenTime(
        line.gen_started,
        line.gen_finished
    );
    if (line.is_user) {
        if (type != "append" && type != "continue" && type != "appendFinal") {
            stat.user_msg_count++;
            stat.user_word_count += line.mes.split(" ").length;
        } else {
            let oldLen = oldMesssage.split(" ").length;
            stat.user_word_count += line.mes.split(" ").length - oldLen;
        }
    } else {
        // if continue, don't add a message, get the last message and subtract it from the word count of
        // the new message
        if (type != "append" && type != "continue" && type != "appendFinal") {
            stat.non_user_msg_count++;
            stat.non_user_word_count += line.mes.split(" ").length;
        } else {
            let oldLen = oldMesssage.split(" ").length;
            stat.non_user_word_count += line.mes.split(" ").length - oldLen;
        }
    }

    if (type === "swipe") {
        stat.total_swipe_count++;
    }
    stat.date_last_chat = Date.now();
    updateStats();
}

export { userStatsHandler, characterStatsHandler, getStats, statMesProcess };
