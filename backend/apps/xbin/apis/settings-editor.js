/**
 * Settings editor API for XBin. Reads and writes flat JSON/YAML config files.
 * Registered at /apps/{{app}}/settingseditor in apiregistry.json.
 * 
 * Request params:
 *   op        : "read" or "write"
 *   conf_file : The xbin path to the (.yaml) file
 *   extraInfo : Optional extra info for cms.getFullPath (passed through transparently)
 * 
 * On read  → returns all top-level keys as a flat object + result:true
 * On write → merges incoming values over existing config and saves back to disk
 * 
 * (C) 2026 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 */

const yaml = require("yaml");
const fspromises = require("fs").promises;
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);

// Keys stripped from incoming write requests — these are request envelope fields,
// not config values that should ever be persisted.
const WRITE_STRIP_KEYS = new Set(["op", "path", "conf_file", "encrypted_keys", 
    "encryption_key", "extraInfo", "result"]);

exports.doService = async (jsonReq, _ignored, headers) => {
    if (!_validateRequest(jsonReq)) {
        LOG.error(`settings-editor: Invalid request: ${JSON.stringify(jsonReq)}`);
        return CONSTANTS.FALSE_RESULT;
    }

    const filePath = jsonReq.conf_file || jsonReq.path;

    try {
        const isYaml = filePath.toLowerCase().endsWith(".yaml") || 
                       filePath.toLowerCase().endsWith(".yml");

        const fullpath = await cms.getFullPath(headers, filePath, jsonReq.extraInfo);
        if (!fullpath) {
            LOG.error(`settings-editor: Could not resolve path for: ${filePath}`);
            return CONSTANTS.FALSE_RESULT;
        }

        const rawContent = await fspromises.readFile(fullpath, "utf8");
        const conf = isYaml ? yaml.parse(rawContent) : JSON.parse(rawContent);

        if (!conf || typeof conf !== "object") {
            LOG.error(`settings-editor: Parsed config is not an object for: ${filePath}`);
            return CONSTANTS.FALSE_RESULT;
        }

        if (jsonReq.op === "read") {
            return { ...conf, ...CONSTANTS.TRUE_RESULT };
        }

        if (jsonReq.op === "write") {
            const incomingValues = {};
            for (const [key, value] of Object.entries(jsonReq))
                if (!WRITE_STRIP_KEYS.has(key)) incomingValues[key] = value;

            const newConf = { ...conf, ...incomingValues };

            const newConfRaw = isYaml
                ? yaml.stringify(newConf, { lineWidth: 0 })
                : JSON.stringify(newConf, null, 4);

            await fspromises.writeFile(fullpath, newConfRaw, "utf8");
            LOG.info(`settings-editor: Successfully wrote config to: ${filePath}`);
            return CONSTANTS.TRUE_RESULT;
        }

        return CONSTANTS.FALSE_RESULT;

    } catch (err) {
        LOG.error(`settings-editor: Error on op=${jsonReq.op} path=${filePath}: ${err.message}\n${err.stack}`);
        return CONSTANTS.FALSE_RESULT;
    }
};

const _validateRequest = jsonReq =>
    jsonReq &&
    (jsonReq.op === "read" || jsonReq.op === "write") &&
    (jsonReq.conf_file || jsonReq.path);