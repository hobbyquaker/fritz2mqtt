/**
 * Parsers for the two XML lists the box serves under a session path: the call list
 * (X_AVM-DE_OnTel GetCallList → NewCallListURL) and the host list
 * (Hosts X_AVM-DE_GetHostListPath → NewX_AVM-DE_HostListPath). Pure.
 */

import {parseXml, asArray} from './xml.js';
import {CALL_TYPES, normalizeMac} from './model.js';

/** `26.08.26 17:42` (call list, local time) → ms since epoch, or `undefined`. */
export function parseCallDate(text) {
    const m = String(text || '').match(/^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) {
        return undefined;
    }
    const [, dd, mm, yy, hh, mi] = m.map(Number);
    return new Date(2000 + yy, mm - 1, dd, hh, mi, 0).getTime();
}

/** `0:03` (h:mm) → seconds. */
export function parseDuration(text) {
    const m = String(text || '').match(/^(\d+):(\d{2})$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : undefined;
}

/**
 * `NewCallListURL` is an absolute url of the box (`https://fritz.box:49443/calllist.lua?sid=…`);
 * only its path and session id are needed — the client fetches it from its own base url.
 */
export function listPath(urlOrPath, params = {}) {
    let path;
    if (/^https?:\/\//i.test(urlOrPath)) {
        const u = new URL(urlOrPath);
        path = u.pathname + u.search;
    } else {
        path = String(urlOrPath || '');
    }
    const [base, query = ''] = path.split('?');
    const search = new URLSearchParams(query);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') {
            search.set(k, String(v));
        }
    }
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
}

/**
 * Call list xml → array of calls, newest first as the box lists them:
 * `{id, type, number, name, own, device, port, ts, duration, path}`. `type` is incoming, missed,
 * outgoing, rejected, active_incoming or active_outgoing; `number` the remote party, `own` the
 * own number used; `path` the recording of an answering machine / fax entry.
 */
export function parseCallList(xml) {
    const doc = parseXml(xml);
    const root = doc.root || doc;
    return asArray(root.Call).map((c) => {
        const type = Number(c.Type);
        const outgoing = type === 3 || type === 11;
        return {
            id: Number(c.Id),
            type: CALL_TYPES[type] || String(c.Type),
            number: (outgoing ? c.Called : c.Caller) || '',
            name: c.Name || '',
            own: (outgoing ? c.CallerNumber || c.Caller : c.CalledNumber || c.Called) || '',
            device: c.Device || '',
            port: c.Port === undefined || c.Port === '' ? null : Number(c.Port),
            ts: parseCallDate(c.Date) ?? null,
            duration: parseDuration(c.Duration) ?? null,
            path: c.Path || null,
        };
    });
}

/**
 * Host list xml → array of hosts `{mac, ip, name, active, interface, speed, guest}`.
 * (`InterfaceType` is `802.11`, `Ethernet` or `HomePlug`.)
 */
export function parseHostList(xml) {
    const doc = parseXml(xml);
    const root = doc.List || doc;
    return asArray(root.Item)
        .map((h) => ({
            mac: normalizeMac(h.MACAddress),
            ip: h.IPAddress || '',
            name: h.HostName || '',
            active: h.Active === '1',
            interface: h.InterfaceType || '',
            speed:
                h['X_AVM-DE_Speed'] === undefined || h['X_AVM-DE_Speed'] === ''
                    ? undefined
                    : Number(h['X_AVM-DE_Speed']),
            guest: h['X_AVM-DE_Guest'] === '1',
        }))
        .filter((h) => h.mac);
}

/** One `GetGenericHostEntry` result (fallback for boxes without the host list path). */
export function hostFromEntry(entry) {
    return {
        mac: normalizeMac(entry.MACAddress),
        ip: entry.IPAddress || '',
        name: entry.HostName || '',
        active: entry.Active === '1',
        interface: entry.InterfaceType || '',
        speed: undefined,
        guest: false,
    };
}
