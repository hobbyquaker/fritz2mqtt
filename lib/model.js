/**
 * The box model — pure. Feed the raw TR-064 results (`apply*()`), get back the status items that
 * changed (`{changes, clear, discovery}`); only changed values are reported (JSON compare per
 * item) so a poll that finds nothing new publishes nothing. Naming and unit conversions of the
 * MQTT items live here and nowhere else.
 */

const num = (v) => {
    if (v === undefined || v === null || v === '') {
        return undefined;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const tenth = (v) => {
    const n = num(v);
    return n === undefined ? undefined : n / 10;
};
const bool = (v) =>
    v === undefined || v === null || v === '' ? undefined : v === '1' || v === 1 || v === true || v === 'true';
const str = (v) => (v === undefined || v === null ? undefined : String(v));

/** A name as topic level: whitespace, `/`, `+`, `#` → `_`; empty → `_`. */
export function topicKey(name) {
    const key = String(name === undefined || name === null ? '' : name)
        .trim()
        .replace(/[\s/+#]+/g, '_');
    return key || '_';
}

export function normalizeMac(mac) {
    return String(mac || '')
        .trim()
        .toUpperCase()
        .replace(/-/g, ':');
}

/** TR-064 call list `Type` → readable kind. */
export const CALL_TYPES = {
    1: 'incoming',
    2: 'missed',
    3: 'outgoing',
    9: 'active_incoming',
    10: 'rejected',
    11: 'active_outgoing',
};

export class FritzState {
    /**
     * @param {object} [o]
     * @param {'name' | 'mac'} [o.hostKey]
     * @param {string[]} [o.hostFilter] mac addresses or hostnames; empty = all
     */
    constructor({hostKey = 'name', hostFilter = []} = {}) {
        this.hostKey = hostKey;
        this.hostFilter = new Set(hostFilter.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
        this.values = new Map();
        this.device = {};
        this.wlans = [];
        this.hosts = new Map(); // mac → {mac, key, name, ...}
        this.calls = new Map(); // call monitor id → {type, ...}
        this.wanKind = null;
        this.traffic = null; // last counter sample for derived rates
    }

    get(item) {
        return this.values.has(item) ? this.values.get(item).value : undefined;
    }

    /*
     * change tracking
     */

    _begin() {
        return {changes: [], clear: [], discovery: false};
    }

    _set(result, item, value, {retain = true} = {}) {
        if (value === undefined) {
            return false;
        }
        const json = JSON.stringify(value);
        const prev = this.values.get(item);
        if (retain && prev && prev.json === json) {
            return false;
        }
        this.values.set(item, {value, json});
        result.changes.push({item, value, retain});
        return true;
    }

    _clear(result, item) {
        if (this.values.delete(item)) {
            result.clear.push(item);
        }
    }

    _clearPrefix(result, prefix) {
        for (const item of [...this.values.keys()]) {
            if (item.startsWith(prefix)) {
                this._clear(result, item);
            }
        }
    }

    /*
     * DeviceInfo GetInfo
     */

    applyDevice(info) {
        const r = this._begin();
        const device = {
            model: str(info.ModelName),
            version: str(info.SoftwareVersion),
            hardware: str(info.HardwareVersion),
            serial: str(info.SerialNumber),
        };
        if (JSON.stringify(device) !== JSON.stringify(this.device)) {
            this.device = device;
            r.discovery = true;
        }
        this._set(r, 'device/model', device.model);
        this._set(r, 'device/software_version', device.version);
        this._set(r, 'device/hardware_version', device.hardware);
        this._set(r, 'device/serial', device.serial);
        this._set(r, 'device/uptime', num(info.UpTime));
        return r;
    }

    /*
     * WANDSLInterfaceConfig GetInfo (+ GetStatisticsTotal), or X_AVM-DE_GetDSLInfo for users
     * without configuration rights (same fields, `LinkStatus` instead of `Status`, errors inline)
     */

    applyDsl(info, stats = null) {
        const r = this._begin();
        this._set(r, 'dsl/enabled', bool(info.Enable));
        this._set(r, 'dsl/status', str(info.Status ?? info.LinkStatus));
        this._set(r, 'dsl/modulation', str(info.ModulationType));
        this._set(r, 'dsl/profile', str(info.CurrentProfile));
        this._set(r, 'dsl/data_path', str(info.DataPath));
        this._set(r, 'dsl/upstream_curr_rate', num(info.UpstreamCurrRate));
        this._set(r, 'dsl/downstream_curr_rate', num(info.DownstreamCurrRate));
        this._set(r, 'dsl/upstream_max_rate', num(info.UpstreamMaxRate));
        this._set(r, 'dsl/downstream_max_rate', num(info.DownstreamMaxRate));
        this._set(r, 'dsl/upstream_noise_margin', tenth(info.UpstreamNoiseMargin));
        this._set(r, 'dsl/downstream_noise_margin', tenth(info.DownstreamNoiseMargin));
        this._set(r, 'dsl/upstream_attenuation', tenth(info.UpstreamAttenuation));
        this._set(r, 'dsl/downstream_attenuation', tenth(info.DownstreamAttenuation));
        this._set(r, 'dsl/upstream_power', tenth(info.UpstreamPower));
        this._set(r, 'dsl/downstream_power', tenth(info.DownstreamPower));
        this._set(r, 'dsl/atur_vendor', str(info.ATURVendor));
        this._set(r, 'dsl/atur_country', str(info.ATURCountry));
        if (stats) {
            this._set(r, 'dsl/crc_errors', num(stats.CRCErrors));
            this._set(r, 'dsl/fec_errors', num(stats.FECErrors));
            this._set(r, 'dsl/hec_errors', num(stats.HECErrors));
            this._set(r, 'dsl/errored_secs', num(stats.ErroredSecs));
            this._set(r, 'dsl/severely_errored_secs', num(stats.SeverelyErroredSecs));
            this._set(r, 'dsl/link_retrain', num(stats.LinkRetrain));
        } else {
            this._set(r, 'dsl/crc_errors', num(info.CRCErrors));
            this._set(r, 'dsl/fec_errors', num(info.FECErrors));
        }
        return r;
    }

    /*
     * WANCommonInterfaceConfig GetCommonLinkProperties
     */

    applyLink(props) {
        const r = this._begin();
        this._set(r, 'wan/access_type', str(props.WANAccessType));
        this._set(r, 'wan/link/status', str(props.PhysicalLinkStatus));
        this._set(r, 'wan/link/upstream_max_bitrate', num(props.Layer1UpstreamMaxBitRate));
        this._set(r, 'wan/link/downstream_max_bitrate', num(props.Layer1DownstreamMaxBitRate));
        return r;
    }

    /*
     * WANPPPConnection / WANIPConnection GetInfo (+ X_AVM_DE_GetExternalIPv6Address)
     */

    applyWan(info, {kind = 'ppp', ipv6 = null} = {}) {
        const r = this._begin();
        this.wanKind = kind;
        const status = str(info.ConnectionStatus);
        this._set(r, 'wan/type', kind);
        this._set(r, 'wan/status', status);
        this._set(r, 'wan/connected', status === undefined ? undefined : status === 'Connected');
        this._set(r, 'wan/enabled', bool(info.Enable));
        this._set(r, 'wan/uptime', num(info.Uptime));
        this._set(r, 'wan/external_ip', str(info.ExternalIPAddress));
        this._set(r, 'wan/last_error', str(info.LastConnectionError));
        this._set(r, 'wan/dns_servers', str(info.DNSServers));
        this._set(r, 'wan/upstream_max_bitrate', num(info.UpstreamMaxBitRate));
        this._set(r, 'wan/downstream_max_bitrate', num(info.DownstreamMaxBitRate));
        if (ipv6) {
            this._set(r, 'wan/external_ipv6', str(ipv6.ExternalIPv6Address));
            this._set(r, 'wan/external_ipv6_prefix_length', num(ipv6.PrefixLength));
        }
        return r;
    }

    /*
     * WANCommonInterfaceConfig GetAddonInfos (rates + counters)
     */

    /**
     * `addon` is the IGD GetAddonInfos result (64 bit counters and rates) or the TR-064
     * GetTotalBytesSent/Received pair; without rates from the box they are derived from the
     * counter deltas between two calls (`now` in ms).
     */
    applyTraffic(addon, {now = Date.now()} = {}) {
        const r = this._begin();
        const sent64 = num(addon['X_AVM_DE_TotalBytesSent64'] ?? addon['X_AVM-DE_TotalBytesSent64']);
        const recv64 = num(addon['X_AVM_DE_TotalBytesReceived64'] ?? addon['X_AVM-DE_TotalBytesReceived64']);
        const sent = sent64 !== undefined ? sent64 : num(addon.TotalBytesSent);
        const received = recv64 !== undefined ? recv64 : num(addon.TotalBytesReceived);
        this._set(r, 'wan/bytes_sent', sent);
        this._set(r, 'wan/bytes_received', received);
        let rateUp = num(addon.ByteSendRate);
        let rateDown = num(addon.ByteReceiveRate);
        if (rateUp === undefined && rateDown === undefined && sent !== undefined && received !== undefined) {
            const prev = this.traffic;
            if (prev && now > prev.now) {
                const seconds = (now - prev.now) / 1000;
                // a counter reset (reconnect, reboot) yields a negative delta: report 0 for that interval
                rateUp = Math.max(0, Math.round((sent - prev.sent) / seconds));
                rateDown = Math.max(0, Math.round((received - prev.received) / seconds));
            }
            this.traffic = {now, sent, received};
        }
        this._set(r, 'wan/rate_up', rateUp);
        this._set(r, 'wan/rate_down', rateDown);
        this._set(r, 'wan/packet_rate_up', num(addon.PacketSendRate));
        this._set(r, 'wan/packet_rate_down', num(addon.PacketReceiveRate));
        return r;
    }

    /*
     * WLANConfiguration:n GetInfo + X_AVM-DE_GetWLANExtInfo + GetTotalAssociations
     */

    applyWlans(list) {
        const r = this._begin();
        const wlans = [];
        for (const {index, info = {}, ext = {}, associations} of list) {
            const type = str(ext['X_AVM-DE_APType']);
            const wlan = {
                index,
                ssid: str(info.SSID),
                guest: type === 'guest',
                band: str(info['X_AVM-DE_FrequencyBand'] ?? ext['X_AVM-DE_FrequencyBand']),
            };
            wlans.push(wlan);
            const p = `wlan/${index}/`;
            this._set(r, p + 'enabled', bool(info.Enable));
            this._set(r, p + 'status', str(info.Status));
            this._set(r, p + 'ssid', wlan.ssid);
            this._set(r, p + 'channel', num(info.Channel));
            this._set(r, p + 'standard', str(info.Standard));
            this._set(r, p + 'bssid', str(info.BSSID));
            this._set(r, p + 'guest', type === undefined ? undefined : wlan.guest);
            this._set(r, p + 'band', wlan.band);
            this._set(r, p + 'associations', num(associations));
        }
        const signature = JSON.stringify(wlans);
        if (signature !== JSON.stringify(this.wlans)) {
            const gone = this.wlans.filter((w) => !wlans.some((n) => n.index === w.index));
            for (const w of gone) {
                this._clearPrefix(r, `wlan/${w.index}/`);
            }
            this.wlans = wlans;
            r.discovery = true;
        }
        return r;
    }

    wlanList() {
        return this.wlans.slice();
    }

    /*
     * Hosts (X_AVM-DE_GetHostListPath list or GetGenericHostEntry rows), normalised by the caller
     * to {mac, ip, name, active, interface, speed, guest, ...}
     */

    _hostAllowed(host) {
        if (this.hostFilter.size === 0) {
            return true;
        }
        return (
            this.hostFilter.has(String(host.mac || '').toLowerCase()) ||
            this.hostFilter.has(String(host.name || '').toLowerCase())
        );
    }

    _assignKeys(hosts) {
        const byKey = new Map();
        for (const host of hosts) {
            const wanted = this.hostKey === 'mac' || !host.name ? topicKey(host.mac) : topicKey(host.name);
            const list = byKey.get(wanted) || [];
            list.push(host);
            byKey.set(wanted, list);
        }
        for (const [key, list] of byKey) {
            if (list.length === 1) {
                list[0].key = key;
            } else {
                for (const host of list) {
                    host.key = `${key}_${normalizeMac(host.mac).replace(/:/g, '').slice(-4)}`;
                }
            }
        }
    }

    applyHosts(list) {
        const r = this._begin();
        const hosts = list.map((h) => ({...h, mac: normalizeMac(h.mac)})).filter((h) => h.mac);
        const total = hosts.length;
        const active = hosts.filter((h) => h.active).length;
        this._set(r, 'host_count', total);
        this._set(r, 'host_count/active', active);

        const published = hosts.filter((h) => this._hostAllowed(h));
        this._assignKeys(published);
        const next = new Map();
        let changed = false;
        for (const host of published) {
            const prev = this.hosts.get(host.mac);
            if (prev && prev.key !== host.key) {
                this._clearPrefix(r, `host/${prev.key}/`);
            }
            if (!prev || prev.key !== host.key || prev.name !== host.name) {
                changed = true;
            }
            next.set(host.mac, host);
            const details = {
                mac: host.mac,
                name: host.name || null,
                ip: host.ip || null,
                interface: host.interface || null,
                speed: host.speed === undefined ? null : host.speed,
                guest: Boolean(host.guest),
                wired: host.interface === 'Ethernet' || host.interface === 'HomePlug',
            };
            this._set(r, `host/${host.key}/present`, Boolean(host.active));
            this._set(r, `host/${host.key}/details`, details);
        }
        for (const [mac, prev] of this.hosts) {
            if (!next.has(mac)) {
                this._clearPrefix(r, `host/${prev.key}/`);
                changed = true;
            }
        }
        this.hosts = next;
        if (changed) {
            r.discovery = true;
        }
        return r;
    }

    hostList() {
        return [...this.hosts.values()].map((h) => ({
            mac: h.mac,
            key: h.key,
            name: h.name || h.mac,
            wired: h.interface === 'Ethernet' || h.interface === 'HomePlug',
        }));
    }

    hostByKey(key) {
        for (const host of this.hosts.values()) {
            if (host.key === key) {
                return host;
            }
        }
        const mac = normalizeMac(key);
        return this.hosts.get(mac) || null;
    }

    /*
     * Call monitor events
     */

    applyCall(event) {
        const r = this._begin();
        const ts = event.ts || Date.now();
        switch (event.type) {
            case 'ring':
                this.calls.set(event.id, {
                    id: event.id,
                    direction: 'incoming',
                    state: 'ringing',
                    number: event.caller,
                    own: event.callee,
                    line: event.line,
                    ts,
                });
                this._set(r, 'call/last_incoming', {number: event.caller, own: event.callee, line: event.line, ts});
                break;
            case 'call':
                this.calls.set(event.id, {
                    id: event.id,
                    direction: 'outgoing',
                    state: 'dialing',
                    number: event.callee,
                    own: event.caller,
                    extension: event.extension,
                    line: event.line,
                    ts,
                });
                this._set(r, 'call/last_outgoing', {
                    number: event.callee,
                    own: event.caller,
                    extension: event.extension,
                    line: event.line,
                    ts,
                });
                break;
            case 'connect': {
                const call = this.calls.get(event.id) || {id: event.id, direction: 'unknown', number: event.number, ts};
                call.state = 'connected';
                call.extension = event.extension;
                call.connected = ts;
                this.calls.set(event.id, call);
                break;
            }
            case 'disconnect': {
                const call = this.calls.get(event.id);
                this.calls.delete(event.id);
                if (call) {
                    const last = {...call, state: 'ended', duration: event.duration, ended: ts};
                    delete last.connected;
                    this._set(r, 'call/last', {...last, missed: call.direction === 'incoming' && !call.connected});
                }
                break;
            }
            default:
                return r;
        }
        const active = [...this.calls.values()];
        this._set(r, 'event/call', {...event, ts}, {retain: false});
        this._set(
            r,
            'call/ringing',
            active.some((c) => c.state === 'ringing'),
        );
        this._set(
            r,
            'call/active',
            active.some((c) => c.state === 'connected'),
        );
        this._set(r, 'call/count', active.length);
        this._set(r, 'call/calls', active);
        return r;
    }

    /*
     * Call list (X_AVM-DE_OnTel GetCallList), parsed by calllist.js
     */

    applyCallList(calls) {
        const r = this._begin();
        this._set(r, 'calllist', calls);
        return r;
    }
}
