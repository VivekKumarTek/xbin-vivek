/** 
 * Settings editor component. Renders a YAML or JSON config file as an editable
 * form. Each top-level key becomes an input (short values) or textarea (long
 * values, objects, arrays). On save the values are written back via the backend
 * API preserving the original file type.
 * 
 * HTML attributes:
 *   apiurl        : URL of the settings-editor backend API
 *   conffile      : xbin path to the config file to edit
 *   encryptedkeys : comma-separated list of keys whose values are encrypted (optional)
 *   encryptionkey : name of the key that holds the encryption key (optional)
 * 
 * (C) 2026 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 */

import {util} from "/framework/js/util.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const COMPONENT_PATH = util.getModulePath(import.meta);

async function elementConnected(host) {
    const apiurl = host.getAttribute("apiurl");
    const conf_file = host.getAttribute("conffile");

    if (!apiurl || !conf_file) return;

    const encrypted_keys = host.getAttribute("encryptedkeys")
        ? host.getAttribute("encryptedkeys").split(",") 
        : undefined;
    const encryption_key = host.getAttribute("encryptionkey");

    const currentConfig = await apiman.rest(apiurl, "POST",
        {conf_file, encrypted_keys, encryption_key, op: "read"}, true);

    if (!currentConfig?.result) {
        LOG.error(`settings-editor: Failed to read config: ${conf_file}`);
        return;
    }

    const schema = [];
    for (const [key, value] of Object.entries(currentConfig)) {
        if (key === "result") continue;

        const keyName = key.split(/[-_]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

        const valueType = _getValueType(value);
        const valueStr  = _getStringValue(value, valueType);
        const fieldType = _getFieldType(valueType, valueStr);

        schema.push({
            name: keyName, key, type: fieldType,
            value: valueStr, valueType,
            textarea: fieldType === "textarea" ? true : undefined
        });
    }

    const memory = settings_editor.getMemoryByHost(host);
    memory.current_schema  = schema;
    memory.apiurl          = apiurl;
    memory.conf_file       = conf_file;
    memory.encrypted_keys  = encrypted_keys;
    memory.encryption_key  = encryption_key;

    settings_editor.setData(host.id, {schema});
}

async function update(hostid) {
    const shadowRoot = settings_editor.getShadowRootByHostId(hostid);
    const memory     = settings_editor.getMemory(hostid);

    if (!shadowRoot || !memory?.apiurl || !memory?.conf_file) {
        LOG.error(`settings-editor: update() called but component is not ready (hostid=${hostid})`);
        return false;
    }

    const config = {};
    for (const schemaEntry of memory.current_schema || []) {
        const el  = shadowRoot.querySelector(`#value${schemaEntry.key}`);
        const raw = el ? el.value.trim().replace(/\r\n/g, "\n") : schemaEntry.value;

        try {
            config[schemaEntry.key] = _getTypedValue(raw, schemaEntry);
        } catch (err) {
            LOG.error(`settings-editor: Validation error on field "${schemaEntry.key}": ${err.message}`);
            return false;
        }
    }

    const result = await apiman.rest(memory.apiurl, "POST", {
        conf_file:      memory.conf_file,
        encrypted_keys: memory.encrypted_keys,
        encryption_key: memory.encryption_key,
        op:             "write",
        ...config
    }, true);

    if (!result?.result) {
        LOG.error(`settings-editor: Backend write failed for: ${memory.conf_file}`);
        return false;
    }

    return true;
}

function _getValueType(value) {
    if (value === undefined) return "undefined";
    if (value === null)      return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function _getStringValue(value, valueType) {
    if (valueType === "undefined" || valueType === "null") return "";
    if (valueType === "array" || valueType === "object")
        return JSON.stringify(value, null, 4);
    return String(value);
}

function _getFieldType(valueType, valueStr) {
    if (valueType === "array" || valueType === "object") return "textarea";
    return valueStr.length > 50 ? "textarea" : "input";
}

function _getTypedValue(raw, schemaEntry) {
    switch (schemaEntry.valueType) {
        case "number": {
            if (raw === "") return null;
            const n = Number(raw);
            if (Number.isNaN(n)) throw new Error(`"${schemaEntry.name}" must be a number.`);
            return n;
        }
        case "boolean":
            return raw.toLowerCase() === "true";
        case "null":
            return raw === "" ? null : raw;
        case "array":
        case "object": {
            if (!raw) return schemaEntry.valueType === "array" ? [] : {};
            try       { return JSON.parse(raw); }
            catch (e) { throw new Error(`"${schemaEntry.name}" contains invalid JSON: ${e.message}`); }
        }
        default:
            return raw;
    }
}

export const settings_editor = {trueWebComponentMode: true, elementConnected, update};
monkshu_component.register("settings-editor", `${COMPONENT_PATH}/settings-editor.html`, settings_editor);