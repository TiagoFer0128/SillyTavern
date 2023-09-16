const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');
const jimp = require('jimp');
const writeFileAtomicSync = require('write-file-atomic').sync;
const { directories } = require('./constants');
const { getConfigValue } = require('./util');

/**
 * Gets a path to thumbnail folder based on the type.
 * @param {'bg' | 'avatar'} type Thumbnail type
 * @returns {string} Path to the thumbnails folder
 */
function getThumbnailFolder(type) {
    let thumbnailFolder;

    switch (type) {
        case 'bg':
            thumbnailFolder = directories.thumbnailsBg;
            break;
        case 'avatar':
            thumbnailFolder = directories.thumbnailsAvatar;
            break;
    }

    return thumbnailFolder;
}

/**
 * Gets a path to the original images folder based on the type.
 * @param {'bg' | 'avatar'} type Thumbnail type
 * @returns {string} Path to the original images folder
 */
function getOriginalFolder(type) {
    let originalFolder;

    switch (type) {
        case 'bg':
            originalFolder = directories.backgrounds;
            break;
        case 'avatar':
            originalFolder = directories.characters;
            break;
    }

    return originalFolder;
}

/**
 * Removes the generated thumbnail from the disk.
 * @param {'bg' | 'avatar'} type Type of the thumbnail
 * @param {string} file Name of the file
 */
function invalidateThumbnail(type, file) {
    const folder = getThumbnailFolder(type);
    if (folder === undefined) throw new Error("Invalid thumbnail type")

    const pathToThumbnail = path.join(folder, file);

    if (fs.existsSync(pathToThumbnail)) {
        fs.rmSync(pathToThumbnail);
    }
}

/**
 * Generates a thumbnail for the given file.
 * @param {'bg' | 'avatar'} type Type of the thumbnail
 * @param {string} file Name of the file
 * @returns
 */
async function generateThumbnail(type, file) {
    let thumbnailFolder = getThumbnailFolder(type)
    let originalFolder = getOriginalFolder(type)
    if (thumbnailFolder === undefined || originalFolder === undefined) throw new Error("Invalid thumbnail type")

    const pathToCachedFile = path.join(thumbnailFolder, file);
    const pathToOriginalFile = path.join(originalFolder, file);

    const cachedFileExists = fs.existsSync(pathToCachedFile);
    const originalFileExists = fs.existsSync(pathToOriginalFile);

    // to handle cases when original image was updated after thumb creation
    let shouldRegenerate = false;

    if (cachedFileExists && originalFileExists) {
        const originalStat = fs.statSync(pathToOriginalFile);
        const cachedStat = fs.statSync(pathToCachedFile);

        if (originalStat.mtimeMs > cachedStat.ctimeMs) {
            //console.log('Original file changed. Regenerating thumbnail...');
            shouldRegenerate = true;
        }
    }

    if (cachedFileExists && !shouldRegenerate) {
        return pathToCachedFile;
    }

    if (!originalFileExists) {
        return null;
    }

    const imageSizes = { 'bg': [160, 90], 'avatar': [96, 144] };
    const mySize = imageSizes[type];

    try {
        let buffer;

        try {
            const image = await jimp.read(pathToOriginalFile);
            buffer = await image.cover(mySize[0], mySize[1]).quality(95).getBufferAsync('image/jpeg');
        }
        catch (inner) {
            console.warn(`Thumbnailer can not process the image: ${pathToOriginalFile}. Using original size`);
            buffer = fs.readFileSync(pathToOriginalFile);
        }

        writeFileAtomicSync(pathToCachedFile, buffer);
    }
    catch (outer) {
        return null;
    }

    return pathToCachedFile;
}

/**
 * Ensures that the thumbnail cache for backgrounds is valid.
 * @returns {Promise<void>} Promise that resolves when the cache is validated
 */
async function ensureThumbnailCache() {
    const cacheFiles = fs.readdirSync(directories.thumbnailsBg);

    // files exist, all ok
    if (cacheFiles.length) {
        return;
    }

    console.log('Generating thumbnails cache. Please wait...');

    const bgFiles = fs.readdirSync(directories.backgrounds);
    const tasks = [];

    for (const file of bgFiles) {
        tasks.push(generateThumbnail('bg', file));
    }

    await Promise.all(tasks);
    console.log(`Done! Generated: ${bgFiles.length} preview images`);
}


/**
 * Registers the endpoints for the thumbnail management.
 * @param {import('express').Express} app Express app
 * @param {any} jsonParser JSON parser middleware
 */
function registerEndpoints(app, jsonParser) {
    // Important: Do not change a path to this endpoint. It is used in the client code and saved to chat files.
    app.get('/thumbnail', jsonParser, async function (request, response) {
        if (typeof request.query.file !== 'string' || typeof request.query.type !== 'string') return response.sendStatus(400);

        const type = request.query.type;
        const file = sanitize(request.query.file);

        if (!type || !file) {
            return response.sendStatus(400);
        }

        if (!(type == 'bg' || type == 'avatar')) {
            return response.sendStatus(400);
        }

        if (sanitize(file) !== file) {
            console.error('Malicious filename prevented');
            return response.sendStatus(403);
        }

        if (getConfigValue('disableThumbnails', false) == true) {
            let folder = getOriginalFolder(type);
            if (folder === undefined) return response.sendStatus(400);
            const pathToOriginalFile = path.join(folder, file);
            return response.sendFile(pathToOriginalFile, { root: process.cwd() });
        }

        const pathToCachedFile = await generateThumbnail(type, file);

        if (!pathToCachedFile) {
            return response.sendStatus(404);
        }

        return response.sendFile(pathToCachedFile, { root: process.cwd() });
    });

}

module.exports = {
    invalidateThumbnail,
    registerEndpoints,
    ensureThumbnailCache,
}
