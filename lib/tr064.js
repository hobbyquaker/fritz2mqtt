/**
 * TR-064 client for AVM FRITZ!Box routers. Plain node:http/https, no library: TR-064 is SOAP 1.1
 * over HTTP with Digest authentication, and the box publishes its services in a device
 * description — that is all a client needs:
 *
 *   GET  http://<box>:49000/tr64desc.xml                 services with serviceType + controlURL
 *   POST http://<box>:49000<controlURL>                  one action per request
 *        SoapAction: "<serviceType>#<action>"
 *        <u:<action> xmlns:u="<serviceType>"><NewArg>…</NewArg></u:<action>>
 *        → <u:<action>Response><NewOut>…</NewOut></u:<action>Response>
 *        401 + WWW-Authenticate: Digest → retry with the Authorization header (MD5, qop=auth)
 *        500 + <s:Fault> with <errorCode>/<errorDescription> → Tr064Error
 *
 * Port 49000 is plain http on the LAN, 49443 the same over TLS with the box's own certificate
 * (`tls: true`, `insecure: true` to accept it). Some actions return a relative path with a
 * session id (call list, host list) that is fetched with `get()`.
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {parseXml, escapeXml, unescapeXml, find, asArray} from './xml.js';

const DESCRIPTION_PATH = '/tr64desc.xml';
const IGD_DESCRIPTION_PATH = '/igddesc.xml';
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const TR064_PREFIX = 'urn:dslforum-org:service:';
export const IGD_PREFIX = 'urn:schemas-upnp-org:service:';

const agents = {
    http: new http.Agent({keepAlive: true, maxSockets: 2}),
    https: new https.Agent({keepAlive: true, maxSockets: 2}),
};

export class Tr064Error extends Error {
    constructor(message, {status, code, service, action} = {}) {
        super(message);
        this.name = 'Tr064Error';
        this.status = status;
        this.code = code;
        this.service = service;
        this.action = action;
    }
}

/** `fritz.box`, `192.168.178.1:49000` or a full url → `http[s]://host:port` without trailing slash. */
export function baseUrl({address, port, tls = false}) {
    let s = String(address || '').trim();
    if (!s) {
        throw new Error('address is empty');
    }
    if (!/^https?:\/\//i.test(s)) {
        s = (tls ? 'https://' : 'http://') + s;
    }
    const url = new URL(s);
    if (!url.port) {
        url.port = String(port || (url.protocol === 'https:' ? 49443 : 49000));
    }
    return url.origin;
}

/** Default transport: one request, no redirects, text bodies. Replaced in tests. */
export function httpRequest({method, url, headers = {}, body, insecure = false, timeout = 15000}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'http:' ? http : https;
        const req = lib.request(
            u,
            {
                method,
                agent: u.protocol === 'http:' ? agents.http : agents.https,
                headers: {
                    ...headers,
                    ...(body !== undefined && {'content-length': Buffer.byteLength(body)}),
                },
                rejectUnauthorized: !insecure,
                timeout,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}),
                );
                res.on('error', reject);
            },
        );
        req.on('timeout', () => req.destroy(new Error(`timeout after ${timeout} ms`)));
        req.on('error', reject);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

/*
 * Digest authentication (RFC 2617, MD5, qop=auth) — the only scheme the box offers.
 */

export function parseDigestChallenge(header) {
    const value = String(header || '');
    if (!/^digest\s/i.test(value)) {
        return null;
    }
    const params = {};
    const re = /(\w+)=(?:"([^"]*)"|([^\s,]*))/g;
    let m;
    while ((m = re.exec(value.slice(7))) !== null) {
        params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    }
    return params;
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

export function digestHeader({username, password, method, uri, challenge, nc = 1, cnonce}) {
    const {realm = '', nonce = '', opaque, algorithm = 'MD5', qop} = challenge;
    const ncValue = String(nc).padStart(8, '0');
    const cn = cnonce || crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const useQop =
        qop &&
        qop
            .split(',')
            .map((q) => q.trim())
            .includes('auth');
    const response = useQop ? md5(`${ha1}:${nonce}:${ncValue}:${cn}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    const parts = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `algorithm=${algorithm}`,
        `response="${response}"`,
    ];
    if (useQop) {
        parts.push('qop=auth', `nc=${ncValue}`, `cnonce="${cn}"`);
    }
    if (opaque) {
        parts.push(`opaque="${opaque}"`);
    }
    return 'Digest ' + parts.join(', ');
}

/*
 * SOAP
 */

export function soapEnvelope(serviceType, action, args = {}) {
    const body = Object.entries(args)
        .map(([k, v]) => `<${k}>${escapeXml(v === undefined || v === null ? '' : v)}</${k}>`)
        .join('');
    return (
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<s:Envelope xmlns:s="${SOAP_NS}" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
        `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
    );
}

/** The `<u:<action>Response>` element of a SOAP response as a flat object (values are strings). */
export function parseSoapResponse(xml, action) {
    const doc = parseXml(xml);
    const body = find(doc, 'Body');
    if (body === undefined || typeof body !== 'object') {
        throw new Tr064Error('no SOAP body in response', {action});
    }
    const fault = body.Fault;
    if (fault !== undefined) {
        const code = find(fault, 'errorCode');
        const description = find(fault, 'errorDescription') || find(fault, 'faultstring') || 'SOAP fault';
        throw new Tr064Error(`${description}${code ? ` (${code})` : ''}`, {
            code: code ? Number(code) : undefined,
            action,
        });
    }
    const response = body[`${action}Response`] !== undefined ? body[`${action}Response`] : Object.values(body)[0];
    if (response === undefined || response === '') {
        return {};
    }
    if (typeof response !== 'object') {
        return {};
    }
    const out = {};
    for (const [k, v] of Object.entries(response)) {
        out[k] = Array.isArray(v) ? v[v.length - 1] : v;
    }
    return out;
}

/** JSON.stringify replacer for log lines: long strings (DeviceLog, host lists) are cut. */
const elide = (key, value) => (typeof value === 'string' && value.length > 200 ? value.slice(0, 200) + '…' : value);

/** `{NewFoo: '1', NewBar: 'x'}` → `{foo: '1', bar: 'x'}` (the `New` prefix is TR-064 noise). */
export function stripNew(args) {
    const out = {};
    for (const [k, v] of Object.entries(args || {})) {
        out[k.replace(/^New/, '')] = v;
    }
    return out;
}

/*
 * Device description
 */

/**
 * All services of a device description (root device and embedded devices), keyed by serviceType.
 * `igd: true` marks the services of the IGD tree (igddesc.xml), which need no authentication.
 */
export function parseDescription(xml, {igd = false} = {}) {
    const doc = parseXml(xml);
    const root = doc.root || doc;
    const services = new Map();
    const info = {};
    const walk = (device) => {
        if (!device || typeof device !== 'object') {
            return;
        }
        for (const s of asArray(device.serviceList && device.serviceList.service)) {
            if (s && s.serviceType && s.controlURL) {
                services.set(s.serviceType, {
                    type: s.serviceType,
                    id: s.serviceId,
                    controlUrl: s.controlURL,
                    scpdUrl: s.SCPDURL,
                    igd,
                });
            }
        }
        for (const d of asArray(device.deviceList && device.deviceList.device)) {
            walk(d);
        }
    };
    const device = root.device;
    if (device && typeof device === 'object') {
        info.friendlyName = device.friendlyName;
        info.modelName = device.modelName;
        info.modelNumber = device.modelNumber;
        info.manufacturer = device.manufacturer;
    }
    walk(device);
    return {services, info};
}

/**
 * @param {object} o
 * @param {string} o.address host, host:port or url
 * @param {number} [o.port]
 * @param {boolean} [o.tls] https on 49443
 * @param {boolean} [o.insecure] accept the box's self-signed certificate
 * @param {string} [o.username]
 * @param {string} [o.password]
 * @param {object} [o.log]
 * @param {Function} [o.request] transport (httpRequest)
 * @param {number} [o.timeout] ms per request
 */
export class Tr064Client {
    constructor({address, port, tls = false, insecure = false, username = '', password = '', log, request, timeout}) {
        this.url = baseUrl({address, port, tls});
        this.insecure = insecure;
        this.username = username;
        this.password = password;
        this.log = log || {debug() {}, info() {}, warn() {}, error() {}};
        this.transport = request || httpRequest;
        this.timeout = timeout;
        this.services = null;
        this.info = {};
        this.challenge = null;
        this.nc = 0;
        this.describing = null;
    }

    /**
     * Loads the device descriptions once (`force` re-reads them): tr64desc.xml, which must exist,
     * plus igddesc.xml, whose services (the unauthenticated UPnP IGD tree with the 64 bit traffic
     * counters) are optional — the box only serves them with "transmit status information over
     * UPnP" enabled.
     */
    async describe({force = false} = {}) {
        if (this.services && !force) {
            return this.services;
        }
        if (!this.describing) {
            this.describing = this._describe().finally(() => {
                this.describing = null;
            });
        }
        return this.describing;
    }

    async _describe() {
        const res = await this.request({method: 'GET', path: DESCRIPTION_PATH, auth: false});
        if (res.status !== 200) {
            throw new Tr064Error(`device description: http ${res.status}`, {status: res.status});
        }
        const {services, info} = parseDescription(res.body);
        if (services.size === 0) {
            throw new Tr064Error('device description lists no services (is TR-064 enabled?)');
        }
        try {
            const igd = await this.request({method: 'GET', path: IGD_DESCRIPTION_PATH, auth: false});
            if (igd.status === 200) {
                for (const [type, service] of parseDescription(igd.body, {igd: true}).services) {
                    services.set(type, service);
                }
            } else {
                this.log.debug('fritz igd description: http', igd.status);
            }
        } catch (err) {
            this.log.debug('fritz igd description failed:', err.message);
        }
        this.services = services;
        this.info = info;
        this.log.debug('fritz description:', services.size, 'services,', info.modelName || '?');
        return services;
    }

    /**
     * The user name the box's web UI used last (`LANConfigSecurity X_AVM-DE_GetUserList`, no
     * authentication needed) — for boxes where none is configured. `null` if the box has no users.
     */
    async lastUsername() {
        const res = await this.call('LANConfigSecurity:1', 'X_AVM-DE_GetUserList', {}, {auth: false});
        return parseUserList(res['X_AVM-DE_UserList'] || '');
    }

    /** The service entry for a serviceType (`urn:dslforum-org:service:DeviceInfo:1`) or a short name. */
    async service(type) {
        const services = await this.describe();
        return services.get(normalizeServiceType(type)) || null;
    }

    async hasService(type) {
        return (await this.service(type)) !== null;
    }

    /**
     * Calls one action; the result is the response arguments without their `New` prefix
     * (`{ModelName: 'FRITZ!Box 7590', UpTime: '1234'}`), values as strings.
     */
    async call(type, action, args = {}, {auth} = {}) {
        const service = await this.service(type);
        if (!service) {
            throw new Tr064Error(`service ${normalizeServiceType(type)} not offered by this box`, {
                service: normalizeServiceType(type),
                action,
            });
        }
        const body = soapEnvelope(service.type, action, args);
        this.log.debug(
            'fritz >',
            shortType(service.type),
            action,
            Object.keys(args).length ? JSON.stringify(args) : '',
        );
        const res = await this.request({
            method: 'POST',
            path: service.controlUrl,
            headers: {
                'content-type': 'text/xml; charset="utf-8"',
                soapaction: `"${service.type}#${action}"`,
            },
            body,
            auth: auth === undefined ? !service.igd : auth,
        });
        if (res.status === 401) {
            throw new Tr064Error(`${action}: authentication required`, {status: 401, service: service.type, action});
        }
        let result;
        try {
            result = parseSoapResponse(res.body, action);
        } catch (err) {
            if (err instanceof Tr064Error) {
                err.service = service.type;
                err.status = res.status;
            }
            throw err;
        }
        if (res.status !== 200) {
            throw new Tr064Error(`${action}: http ${res.status}`, {status: res.status, service: service.type, action});
        }
        const out = stripNew(result);
        this.log.debug('fritz <', shortType(service.type), action, JSON.stringify(out, elide));
        return out;
    }

    /** GET of a path the box returned (call list, host list); the session id is part of the path. */
    async get(path) {
        const res = await this.request({method: 'GET', path, auth: false});
        if (res.status !== 200) {
            throw new Tr064Error(`GET ${path.replace(/sid=[^&]+/, 'sid=…')}: http ${res.status}`, {status: res.status});
        }
        return res.body;
    }

    /** One request with Digest auth: the first call collects the challenge, later ones reuse the nonce. */
    async request({method, path, headers = {}, body, auth = true}) {
        const url = this.url + path;
        const send = (extra) =>
            this.transport({
                method,
                url,
                headers: {...headers, ...extra},
                body,
                insecure: this.insecure,
                timeout: this.timeout,
            });
        const authHeader = () => ({
            authorization: digestHeader({
                username: this.username,
                password: this.password,
                method,
                uri: path,
                challenge: this.challenge,
                nc: ++this.nc,
            }),
        });

        let res = await send(auth && this.challenge ? authHeader() : {});
        if (res.status === 401 && auth) {
            const challenge = parseDigestChallenge(res.headers['www-authenticate']);
            if (!challenge) {
                throw new Tr064Error('401 without a Digest challenge', {status: 401});
            }
            this.challenge = challenge;
            this.nc = 0;
            res = await send(authHeader());
            if (res.status === 401) {
                this.challenge = null;
                throw new Tr064Error('authentication failed (wrong username or password)', {status: 401});
            }
        }
        return res;
    }
}

/**
 * `DeviceInfo` → `urn:dslforum-org:service:DeviceInfo:1`, `igd:WANCommonInterfaceConfig:1` →
 * `urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1`; full urns pass through.
 */
export function normalizeServiceType(type) {
    let s = String(type || '');
    if (s.startsWith('urn:')) {
        return s;
    }
    let prefix = TR064_PREFIX;
    if (s.startsWith('igd:')) {
        prefix = IGD_PREFIX;
        s = s.slice(4);
    }
    const m = s.match(/^([A-Za-z0-9_-]+?)(?::(\d+))?$/);
    if (!m) {
        return s;
    }
    return `${prefix}${m[1]}:${m[2] || 1}`;
}

/** `<List><Username last_user="1">john</Username>…</List>` → `john` (the last used, else the first). */
export function parseUserList(xml) {
    const s = String(xml || '');
    const last = s.match(/<Username[^>]*\blast_user="1"[^>]*>([^<]*)<\/Username>/);
    if (last) {
        return unescapeXml(last[1]);
    }
    const first = s.match(/<Username[^>]*>([^<]*)<\/Username>/);
    return first ? unescapeXml(first[1]) : null;
}

/** `urn:dslforum-org:service:DeviceInfo:1` → `DeviceInfo:1`, IGD services `igd:…` for log lines. */
export function shortType(type) {
    const s = String(type);
    return s.startsWith(IGD_PREFIX) ? 'igd:' + s.slice(IGD_PREFIX.length) : s.replace(/^urn:[^:]+:service:/, '');
}
