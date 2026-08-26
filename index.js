#!/usr/bin/env node

import {createAdapter, toBoolean} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {handle as handleInstall} from './lib/install.js';
import {Tr064Client, Tr064Error, normalizeServiceType} from './lib/tr064.js';
import {CallMonitor} from './lib/callmonitor.js';
import {FritzState, normalizeMac} from './lib/model.js';
import {parseCallList, parseHostList, hostFromEntry, listPath} from './lib/lists.js';
import {discoveryModel} from './lib/hadiscovery.js';

handleInstall(config);

const RETRY_INTERVAL = 10000;
const CALLLIST_DELAY = 3000;
const WLAN_MAX = 4;

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'fritz',
    info: () => ({
        fritz: box.url,
        model: state.device.model,
        firmware: state.device.version,
        wan: state.wanKind,
        callmonitor: config.callmonitor ? Boolean(monitor && monitor.connected) : false,
        pollInterval: config.pollInterval,
        trafficInterval: config.trafficInterval,
    }),
    discovery: () =>
        discoveryModel({
            name: config.name,
            device: state.device,
            features: {
                dsl: config.dsl && features.dsl,
                wan: features.wan,
                traffic: config.trafficInterval > 0 && features.traffic,
                wlan: config.wlan,
                hosts: config.hosts && features.hosts,
                callmonitor: config.callmonitor,
            },
            wlans: config.wlan ? state.wlanList() : [],
            hosts: state.hostList(),
            jsonPayloads: config.jsonPayloads,
            haHosts: config.haHosts,
        }),
    onSet: handleSet,
    onShutdown: shutdownDevice,
});
const {log, pubStatus, clearStatus, setDeviceConnected} = adapter;

const box = new Tr064Client({
    address: config.address,
    tls: config.tls,
    insecure: config.insecure,
    username: config.username,
    password: config.password,
    log,
});

const state = new FritzState({hostKey: config.hostKey, hostFilter: config.hostFilter});

/** Which optional services the box offers; decided once after the first description. */
const features = {dsl: true, wan: true, traffic: true, hosts: true, hostList: true, calllist: true};
let wanService = null; // WANPPPConnection:1 or WANIPConnection:1
let trafficService = null; // igd:WANCommonInterfaceConfig:1 (64 bit counters + rates) or the tr-064 one
let dslAction = 'GetInfo'; // or X_AVM-DE_GetDSLInfo for users without configuration rights
let ipv6Source = undefined; // [service, action] that answers, null when none does
let wlanServices = []; // [{index, type}]

let monitor = null;
let pollTimer = null;
let trafficTimer = null;
let calllistTimer = null;
let discoveryTimer = null;
let polling = false;
let discoveryPending = false;
let lastError = null;

/*
 * publishing
 */

function apply({changes, clear, discovery}) {
    for (const item of clear) {
        clearStatus(item);
    }
    for (const {item, value, retain} of changes) {
        pubStatus(item, value, {retain: retain !== false});
    }
    if (discovery) {
        scheduleDiscovery();
    }
}

/** Discovery is re-published once per poll at most: a poll touches model, wlans and hosts in turn. */
function scheduleDiscovery() {
    adapter.markDiscoveryDirty();
    if (polling) {
        discoveryPending = true;
        return;
    }
    if (discoveryTimer) {
        return;
    }
    discoveryTimer = setTimeout(() => {
        discoveryTimer = null;
        adapter.publishDiscovery();
    }, 1000);
}

function warnOnce(what, err) {
    const message = (err && err.message) || String(err);
    const key = `${what}: ${message}`;
    if (key !== lastError) {
        log.warn('fritz', box.url, what + ':', message);
        lastError = key;
    } else {
        log.debug('fritz', what, 'failed again:', message);
    }
}

/*
 * services
 */

async function detectServices() {
    await box.describe({force: true});
    if (!config.username) {
        // FRITZ!OS >= 7.24 always has named users; take the one the box used last
        const user = await optional('user list', () => box.lastUsername());
        if (user) {
            box.username = user;
            log.info('fritz using user', user, '(--username not set)');
        }
    }
    features.dsl = await box.hasService('WANDSLInterfaceConfig:1');
    features.hosts = await box.hasService('Hosts:1');
    features.calllist = await box.hasService('X_AVM-DE_OnTel:1');
    trafficService = null;
    for (const type of ['igd:WANCommonInterfaceConfig:1', 'WANCommonInterfaceConfig:1']) {
        if (await box.hasService(type)) {
            trafficService = type;
            break;
        }
    }
    features.traffic = trafficService !== null;

    // the wan connection service: what the box routes by default, else the first one that answers
    const candidates = [];
    for (const type of ['WANPPPConnection:1', 'WANIPConnection:1']) {
        if (await box.hasService(type)) {
            candidates.push(type);
        }
    }
    wanService = null;
    if (candidates.length > 1 && (await box.hasService('Layer3Forwarding:1'))) {
        const res = await optional('default connection', () =>
            box.call('Layer3Forwarding:1', 'GetDefaultConnectionService'),
        );
        const m = res && /WAN(PPP|IP)Connection/.exec(res.DefaultConnectionService || '');
        if (m) {
            wanService = `WAN${m[1]}Connection:1`;
        }
    }
    if (!wanService) {
        for (const type of candidates) {
            const info = await optional(type, () => box.call(type, 'GetInfo'));
            if (info && info.ConnectionStatus && info.ConnectionStatus !== 'Unconfigured') {
                wanService = type;
                break;
            }
            wanService = wanService || (info ? type : null);
        }
    }
    features.wan = wanService !== null;
    wlanServices = [];
    for (let i = 1; i <= WLAN_MAX; i++) {
        if (await box.hasService(`WLANConfiguration:${i}`)) {
            wlanServices.push({index: i, type: `WLANConfiguration:${i}`});
        }
    }
    log.info(
        'fritz',
        box.info.modelName || box.url,
        '- services:',
        [
            features.dsl && 'dsl',
            wanService &&
                `wan(${wanService
                    .replace(/Connection:1$/, '')
                    .replace('WAN', '')
                    .toLowerCase()})`,
            trafficService && `traffic(${trafficService.startsWith('igd:') ? 'igd' : 'tr064'})`,
            wlanServices.length && `wlan(${wlanServices.length})`,
            features.hosts && 'hosts',
            features.calllist && 'calllist',
        ]
            .filter(Boolean)
            .join(', '),
    );
}

const RIGHTS_ERROR = 606;
const warned = new Set();

/**
 * An optional part of the poll: a failure is logged, it does not fail the whole poll. Wrong
 * credentials (401) do fail it; missing rights (606) are reported once at warn.
 */
async function optional(what, fn) {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof Tr064Error && err.status === 401) {
            throw err;
        }
        if (err instanceof Tr064Error && err.code === RIGHTS_ERROR) {
            if (!warned.has(what)) {
                warned.add(what);
                log.warn('fritz', what, 'not allowed for user', box.username, '- grant "FRITZ!Box settings" rights');
            } else {
                log.debug('fritz', what, 'not allowed');
            }
            return null;
        }
        log.debug('fritz', what, 'failed:', err.message);
        return null;
    }
}

const isRightsError = (err) => err instanceof Tr064Error && err.code === RIGHTS_ERROR;

/*
 * polling
 */

async function pollDevice() {
    // DeviceInfo GetInfo needs configuration rights; the description knows the model at least
    const info = await optional('device info', () => box.call('DeviceInfo:1', 'GetInfo'));
    apply(state.applyDevice(info || {ModelName: box.info.modelName}));
}

async function pollDsl() {
    if (!config.dsl || !features.dsl) {
        return;
    }
    let info = null;
    if (dslAction === 'GetInfo') {
        try {
            info = await box.call('WANDSLInterfaceConfig:1', 'GetInfo');
        } catch (err) {
            if (!isRightsError(err)) {
                throw err;
            }
            log.info(
                'fritz user',
                box.username,
                'may not read WANDSLInterfaceConfig GetInfo, using X_AVM-DE_GetDSLInfo',
            );
            dslAction = 'X_AVM-DE_GetDSLInfo';
        }
    }
    if (dslAction !== 'GetInfo') {
        info = await optional('dsl', () => box.call('WANDSLInterfaceConfig:1', dslAction));
        if (info) {
            apply(state.applyDsl(info));
        }
        return;
    }
    const stats = await optional('dsl statistics', () => box.call('WANDSLInterfaceConfig:1', 'GetStatisticsTotal'));
    apply(state.applyDsl(info, stats));
}

async function pollWan() {
    if (await box.hasService('WANCommonInterfaceConfig:1')) {
        const link = await optional('link', () => box.call('WANCommonInterfaceConfig:1', 'GetCommonLinkProperties'));
        if (link) {
            apply(state.applyLink(link));
        }
    }
    if (!wanService) {
        return;
    }
    const info = await optional('wan', () => box.call(wanService, 'GetInfo'));
    if (!info) {
        return;
    }
    const ipv6 = await pollIpv6();
    apply(state.applyWan(info, {kind: wanService.startsWith('WANPPP') ? 'ppp' : 'ip', ipv6}));
}

/**
 * The external IPv6 address is an IGD action (WANIPConn1, no auth) on most boxes; some firmware
 * versions also offer it on the TR-064 connection service. Probe the candidates once.
 */
async function pollIpv6() {
    if (ipv6Source === null) {
        return null;
    }
    if (ipv6Source) {
        return optional('ipv6', () => box.call(ipv6Source[0], ipv6Source[1]));
    }
    const candidates = [
        ['igd:WANIPConnection:1', 'X_AVM_DE_GetExternalIPv6Address'],
        [wanService, 'X_AVM_DE_GetExternalIPv6Address'],
        [wanService, 'X_AVM-DE_GetExternalIPv6Address'],
    ];
    for (const [service, action] of candidates) {
        if (!(await box.hasService(service))) {
            continue;
        }
        const res = await optional('ipv6', () => box.call(service, action));
        if (res) {
            ipv6Source = [service, action];
            return res;
        }
    }
    log.info('fritz external ipv6 address not available (needs "transmit status information over upnp")');
    ipv6Source = null;
    return null;
}

async function pollTraffic() {
    if (!trafficService) {
        return;
    }
    if (trafficService.startsWith('igd:')) {
        apply(state.applyTraffic(await box.call(trafficService, 'GetAddonInfos')));
        return;
    }
    // tr-064 only: counters without rates (the igd tree needs "transmit status information over upnp"); rates are derived
    const sent = await box.call(trafficService, 'GetTotalBytesSent');
    const received = await box.call(trafficService, 'GetTotalBytesReceived');
    apply(state.applyTraffic({...sent, ...received}, {now: Date.now()}));
}

async function pollWlans() {
    if (!config.wlan || wlanServices.length === 0) {
        return;
    }
    const list = [];
    for (const {index, type} of wlanServices) {
        const info = await optional(`wlan ${index}`, () => box.call(type, 'GetInfo'));
        if (!info) {
            continue;
        }
        const ext = await optional(`wlan ${index} ext`, () => box.call(type, 'X_AVM-DE_GetWLANExtInfo'));
        const assoc = await optional(`wlan ${index} associations`, () => box.call(type, 'GetTotalAssociations'));
        list.push({index, info, ext: ext || {}, associations: assoc ? assoc.TotalAssociations : undefined});
    }
    apply(state.applyWlans(list));
}

async function pollHosts() {
    if (!config.hosts || !features.hosts) {
        return;
    }
    let hosts = null;
    if (features.hostList) {
        hosts = await optional('host list', async () => {
            const res = await box.call('Hosts:1', 'X_AVM-DE_GetHostListPath');
            const path = res['X_AVM-DE_HostListPath'];
            if (!path) {
                throw new Error('no host list path');
            }
            return parseHostList(await box.get(listPath(path)));
        });
        if (hosts === null) {
            log.info('fritz host list not available, falling back to GetGenericHostEntry');
            features.hostList = false;
        }
    }
    if (hosts === null) {
        const count = await optional('host count', () => box.call('Hosts:1', 'GetHostNumberOfEntries'));
        if (!count) {
            return;
        }
        hosts = [];
        const n = Number(count.HostNumberOfEntries) || 0;
        for (let i = 0; i < n; i++) {
            const entry = await optional(`host ${i}`, () => box.call('Hosts:1', 'GetGenericHostEntry', {NewIndex: i}));
            if (entry) {
                hosts.push(hostFromEntry(entry));
            }
        }
    }
    apply(state.applyHosts(hosts));
}

async function pollCallList() {
    if (!config.calllist || !features.calllist) {
        return;
    }
    const res = await box.call('X_AVM-DE_OnTel:1', 'GetCallList');
    const url = res.CallListURL;
    if (!url) {
        throw new Error('no call list url');
    }
    const path = listPath(url, {max: config.calllistMax, days: config.calllistDays || undefined});
    apply(state.applyCallList(parseCallList(await box.get(path))));
}

async function poll() {
    if (polling || adapter.shuttingDown) {
        return;
    }
    polling = true;
    try {
        if (!box.services) {
            await detectServices();
        }
        await pollDevice();
        await pollDsl();
        await pollWan();
        await pollWlans();
        await pollHosts();
        if (!adapter.deviceConnected) {
            log.info('fritz', box.info.modelName || box.url, 'connected');
            setDeviceConnected(true);
            adapter.publishInfo();
            scheduleCallList(0);
            if (config.trafficInterval > 0) {
                scheduleTraffic(0);
            }
        }
        lastError = null;
    } catch (err) {
        warnOnce('poll', err);
        if (adapter.deviceConnected) {
            log.info('fritz', box.url, 'disconnected');
            setDeviceConnected(false);
            adapter.publishInfo();
        }
        if (err instanceof Tr064Error && err.status === 401) {
            // wrong credentials: re-read everything (and the user list) on the next attempt
            box.services = null;
        }
    } finally {
        polling = false;
        if (discoveryPending) {
            discoveryPending = false;
            scheduleDiscovery();
        }
        schedulePoll();
    }
}

function schedulePoll() {
    if (adapter.shuttingDown) {
        return;
    }
    if (pollTimer) {
        clearTimeout(pollTimer);
    }
    const interval = config.pollInterval * 1000;
    const delay = adapter.deviceConnected ? interval : Math.min(interval, RETRY_INTERVAL);
    pollTimer = setTimeout(poll, delay);
}

async function traffic() {
    if (adapter.shuttingDown || !adapter.deviceConnected) {
        return;
    }
    try {
        await pollTraffic();
    } catch (err) {
        log.debug('fritz traffic poll failed:', err.message);
    } finally {
        scheduleTraffic(config.trafficInterval * 1000);
    }
}

function scheduleTraffic(delay) {
    if (adapter.shuttingDown || config.trafficInterval <= 0 || !features.traffic) {
        return;
    }
    if (trafficTimer) {
        clearTimeout(trafficTimer);
    }
    trafficTimer = setTimeout(traffic, delay);
}

function scheduleCallList(delay = CALLLIST_DELAY) {
    if (adapter.shuttingDown || !config.calllist || !features.calllist) {
        return;
    }
    if (calllistTimer) {
        clearTimeout(calllistTimer);
    }
    calllistTimer = setTimeout(() => {
        calllistTimer = null;
        pollCallList().catch((err) => log.warn('fritz call list failed:', err.message));
    }, delay);
}

/*
 * call monitor
 */

if (config.callmonitor) {
    monitor = new CallMonitor({host: new URL(box.url).hostname, log});
    monitor.on('open', () => adapter.publishInfo());
    monitor.on('close', () => adapter.publishInfo());
    monitor.on('error', () => {}); // logged by the monitor itself
    monitor.on('event', (event) => {
        apply(state.applyCall(event));
        if (event.type === 'disconnect') {
            scheduleCallList();
        }
    });
}

/*
 * set handling
 */

async function handleSet(parts, value, topic) {
    if (value === undefined) {
        log.warn('mqtt ignoring empty payload on', topic);
        return;
    }
    const [kind, key, item] = parts;

    if (kind === 'wlan' && parts.length === 3 && item === 'enabled') {
        const wlan = wlanServices.find((w) => String(w.index) === String(key));
        if (!config.wlan || !wlan) {
            throw new Error(`unknown wlan ${key}`);
        }
        const enabled = toBoolean(value);
        if (enabled === undefined) {
            throw new Error(`not a boolean: ${value}`);
        }
        log.info('fritz wlan', key, enabled ? 'enable' : 'disable');
        await box.call(wlan.type, 'SetEnable', {NewEnable: enabled ? 1 : 0});
        setTimeout(() => pollWlans().catch((err) => log.debug('fritz wlan refresh failed:', err.message)), 2000);
        return;
    }

    if (kind === 'wan' && parts.length === 2 && key === 'reconnect') {
        if (toBoolean(value) === false) {
            return;
        }
        if (!wanService) {
            throw new Error('no wan connection service');
        }
        log.warn('fritz wan reconnect requested');
        await box.call(wanService, 'ForceTermination');
        return;
    }

    if (kind === 'device' && parts.length === 2 && key === 'reboot') {
        if (toBoolean(value) === false) {
            return;
        }
        log.warn('fritz reboot requested');
        await box.call('DeviceConfig:1', 'Reboot');
        return;
    }

    if (kind === 'calllist' && parts.length === 2 && key === 'refresh') {
        scheduleCallList(0);
        return;
    }

    if (kind === 'host' && parts.length === 3 && item === 'wol') {
        const host = state.hostByKey(key);
        const mac = host ? host.mac : normalizeMac(key);
        if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
            throw new Error(`unknown host ${key}`);
        }
        log.info('fritz wake on lan', mac);
        await box.call('Hosts:1', 'X_AVM-DE_WakeOnLANByMACAddress', {NewMACAddress: mac});
        return;
    }

    if (kind === 'raw' && parts.length === 1) {
        if (!config.rawSet) {
            throw new Error('set/raw is disabled (--raw-set)');
        }
        const {service, action, arguments: args = {}} = value && typeof value === 'object' ? value : {};
        if (!service || !action) {
            throw new Error('set/raw needs {"service", "action", "arguments"}');
        }
        log.info('fritz raw', service, action);
        let result;
        try {
            result = await box.call(service, action, args);
        } catch (err) {
            adapter.publish(
                adapter.topic('raw'),
                JSON.stringify({service: normalizeServiceType(service), action, error: err.message, code: err.code}),
            );
            throw err;
        }
        adapter.publish(adapter.topic('raw'), JSON.stringify({service: normalizeServiceType(service), action, result}));
        return;
    }

    throw new Error(`unknown item ${parts.join('/')}`);
}

/*
 * lifecycle
 */

async function shutdownDevice() {
    for (const t of [pollTimer, trafficTimer, calllistTimer, discoveryTimer]) {
        if (t) {
            clearTimeout(t);
        }
    }
    if (monitor) {
        monitor.stop();
    }
}

adapter.start();
log.info('fritz', box.url, '- trying to connect');
poll();
if (monitor) {
    monitor.start();
}
