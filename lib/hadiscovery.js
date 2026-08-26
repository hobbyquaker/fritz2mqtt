/**
 * Home Assistant MQTT discovery (device-based, HA >= 2024.11) — the device blocks for the core's
 * `discovery()` hook. Pure: the box model in, device blocks out.
 *
 *   - the box: dsl line sensors, wan connection, traffic counters and rates, wlan switches,
 *     call monitor sensors, answering machine switches, call deflection switches, host count,
 *     reconnect / reboot buttons
 *   - one device per lan host (--ha-hosts): a router device_tracker with the details as attributes
 */

import {entity, discoveryId} from 'mqtt-interfaces-core';

export const ADAPTER = 'fritz2mqtt';

const BOOL = {pl_on: 'true', pl_off: 'false'};
const BANDS = {2400: '2.4 GHz', 5000: '5 GHz', 6000: '6 GHz'};

/** `Deflection <number or type> → <to>` (`Deflection 0` without any of them). */
export function deflectionLabel(d) {
    const from =
        d.number ||
        (d.type && d.type !== 'fromAll' ? d.type.replace(/^from/, '') : '') ||
        (d.type === 'fromAll' ? 'all calls' : '');
    const parts = [from, d.to ? `→ ${d.to}` : ''].filter(Boolean).join(' ');
    return parts ? `Deflection ${parts}` : `Deflection ${d.id}`;
}

/** `WLAN <ssid> [<band>]` — the band tells the radios of one SSID apart. */
export function wlanLabel(wlan, wlans) {
    const base = wlan.ssid ? `WLAN ${wlan.ssid}` : `WLAN ${wlan.index}`;
    const band = BANDS[wlan.band];
    const shared = wlans.filter((w) => w.ssid && w.ssid === wlan.ssid).length > 1;
    return band && (shared || !wlan.guest) ? `${base} ${band}` : base;
}

function macId(mac) {
    return String(mac)
        .replace(/[^0-9a-f]/gi, '')
        .toLowerCase();
}

/**
 * @param {object} input
 * @param {string} input.name instance name / topic prefix
 * @param {object} [input.device] `{model, version, serial}` from DeviceInfo
 * @param {object} [input.features] `{dsl, wan, traffic, wlan, hosts, callmonitor, calllist, wanIp}`
 * @param {Array<{index, ssid, guest, band}>} [input.wlans]
 * @param {Array<{index, name}>} [input.tams] configured answering machines
 * @param {Array<{id, type, number, to}>} [input.deflections]
 * @param {Array<{mac, key, name}>} [input.hosts]
 * @param {boolean} [input.jsonPayloads]
 * @param {boolean} [input.haHosts]
 * @returns {Array<{id: string, device: object, components: object}>}
 */
export function discoveryModel({
    name,
    device = {},
    features = {},
    wlans = [],
    tams = [],
    deflections = [],
    hosts = [],
    jsonPayloads = true,
    haHosts = false,
}) {
    const id = discoveryId(ADAPTER, name);
    const e = (item, platform, label, more = {}) => entity({id, name, item, platform, label, jsonPayloads, ...more});
    const sensor = (item, label, more = {}) => e(item, 'sensor', label, more);
    const diag = (item, label, more = {}) => sensor(item, label, {category: 'diagnostic', ...more});
    const meas = (unit, more = {}) => ({extra: {unit_of_meas: unit, stat_cla: 'measurement', ...more}});

    const cmps = {};

    if (features.dsl !== false) {
        cmps.dsl_status = diag('dsl/status', 'DSL status', {icon: 'mdi:swap-vertical'});
        cmps.dsl_downstream_curr_rate = sensor('dsl/downstream_curr_rate', 'DSL downstream rate', {
            icon: 'mdi:download-network',
            ...meas('kbit/s', {dev_cla: 'data_rate'}),
        });
        cmps.dsl_upstream_curr_rate = sensor('dsl/upstream_curr_rate', 'DSL upstream rate', {
            icon: 'mdi:upload-network',
            ...meas('kbit/s', {dev_cla: 'data_rate'}),
        });
        cmps.dsl_downstream_max_rate = diag('dsl/downstream_max_rate', 'DSL downstream max rate', {
            icon: 'mdi:download-network-outline',
            ...meas('kbit/s', {dev_cla: 'data_rate'}),
        });
        cmps.dsl_upstream_max_rate = diag('dsl/upstream_max_rate', 'DSL upstream max rate', {
            icon: 'mdi:upload-network-outline',
            ...meas('kbit/s', {dev_cla: 'data_rate'}),
        });
        cmps.dsl_downstream_noise_margin = diag('dsl/downstream_noise_margin', 'DSL downstream noise margin', {
            icon: 'mdi:sine-wave',
            ...meas('dB'),
        });
        cmps.dsl_upstream_noise_margin = diag('dsl/upstream_noise_margin', 'DSL upstream noise margin', {
            icon: 'mdi:sine-wave',
            ...meas('dB'),
        });
        cmps.dsl_downstream_attenuation = diag('dsl/downstream_attenuation', 'DSL downstream attenuation', {
            icon: 'mdi:signal',
            ...meas('dB'),
        });
        cmps.dsl_upstream_attenuation = diag('dsl/upstream_attenuation', 'DSL upstream attenuation', {
            icon: 'mdi:signal',
            ...meas('dB'),
        });
        cmps.dsl_downstream_power = diag('dsl/downstream_power', 'DSL downstream power', {
            icon: 'mdi:flash',
            ...meas('dBm'),
        });
        cmps.dsl_upstream_power = diag('dsl/upstream_power', 'DSL upstream power', {
            icon: 'mdi:flash',
            ...meas('dBm'),
        });
        cmps.dsl_crc_errors = diag('dsl/crc_errors', 'DSL CRC errors', {
            icon: 'mdi:alert-circle-outline',
            extra: {stat_cla: 'total_increasing'},
        });
        cmps.dsl_fec_errors = diag('dsl/fec_errors', 'DSL FEC errors', {
            icon: 'mdi:alert-circle-outline',
            extra: {stat_cla: 'total_increasing'},
        });
    }

    if (features.wan !== false) {
        cmps.wan_connected = e('wan/connected', 'binary_sensor', 'Internet', {
            extra: {...BOOL, dev_cla: 'connectivity'},
        });
        cmps.wan_status = diag('wan/status', 'WAN status', {icon: 'mdi:web'});
        cmps.wan_external_ip = diag('wan/external_ip', 'External IP', {icon: 'mdi:ip-network'});
        cmps.wan_external_ipv6 = diag('wan/external_ipv6', 'External IPv6', {icon: 'mdi:ip-network-outline'});
        cmps.wan_uptime = diag('wan/uptime', 'WAN uptime', {
            icon: 'mdi:timer-outline',
            extra: {unit_of_meas: 's', dev_cla: 'duration', stat_cla: 'total_increasing'},
        });
        cmps.wan_link_downstream_max_bitrate = diag('wan/link/downstream_max_bitrate', 'WAN downstream max bitrate', {
            icon: 'mdi:download-network-outline',
            ...meas('bit/s', {dev_cla: 'data_rate'}),
        });
        cmps.wan_link_upstream_max_bitrate = diag('wan/link/upstream_max_bitrate', 'WAN upstream max bitrate', {
            icon: 'mdi:upload-network-outline',
            ...meas('bit/s', {dev_cla: 'data_rate'}),
        });
        cmps.wan_reconnect = e('wan/reconnect', 'button', 'Reconnect', {
            icon: 'mdi:restart',
            category: 'config',
            command: true,
            extra: {pl_prs: 'true'},
        });
    }

    if (features.traffic !== false) {
        cmps.wan_bytes_received = sensor('wan/bytes_received', 'Bytes received', {
            icon: 'mdi:download',
            extra: {unit_of_meas: 'B', dev_cla: 'data_size', stat_cla: 'total_increasing'},
        });
        cmps.wan_bytes_sent = sensor('wan/bytes_sent', 'Bytes sent', {
            icon: 'mdi:upload',
            extra: {unit_of_meas: 'B', dev_cla: 'data_size', stat_cla: 'total_increasing'},
        });
        cmps.wan_rate_down = sensor('wan/rate_down', 'Download rate', {
            icon: 'mdi:download-network',
            ...meas('B/s', {dev_cla: 'data_rate'}),
        });
        cmps.wan_rate_up = sensor('wan/rate_up', 'Upload rate', {
            icon: 'mdi:upload-network',
            ...meas('B/s', {dev_cla: 'data_rate'}),
        });
    }

    for (const wlan of wlans) {
        const label = wlanLabel(wlan, wlans);
        cmps[`wlan_${wlan.index}_enabled`] = e(`wlan/${wlan.index}/enabled`, 'switch', label, {
            icon: wlan.guest ? 'mdi:wifi-lock-open' : 'mdi:wifi',
            category: 'config',
            command: true,
            extra: {...BOOL, stat_on: 'true', stat_off: 'false'},
        });
        cmps[`wlan_${wlan.index}_associations`] = diag(`wlan/${wlan.index}/associations`, `${label} clients`, {
            icon: 'mdi:account-multiple',
            extra: {stat_cla: 'measurement'},
        });
    }

    for (const tam of tams) {
        const label = tam.name ? `Answering machine ${tam.name}` : `Answering machine ${tam.index}`;
        cmps[`tam_${tam.index}_enabled`] = e(`tam/${tam.index}/enabled`, 'switch', label, {
            icon: 'mdi:voicemail',
            category: 'config',
            command: true,
            extra: {...BOOL, stat_on: 'true', stat_off: 'false'},
        });
        cmps[`tam_${tam.index}_new_messages`] = sensor(`tam/${tam.index}/new_messages`, `${label} new messages`, {
            icon: 'mdi:message-badge',
            extra: {stat_cla: 'measurement'},
        });
    }

    for (const d of deflections) {
        cmps[`deflection_${d.id}_enabled`] = e(`deflection/${d.id}/enabled`, 'switch', deflectionLabel(d), {
            icon: 'mdi:phone-forward',
            category: 'config',
            command: true,
            extra: {...BOOL, stat_on: 'true', stat_off: 'false'},
        });
    }

    if (features.hosts !== false) {
        cmps.host_count = sensor('host_count', 'Hosts', {icon: 'mdi:lan', extra: {stat_cla: 'measurement'}});
        cmps.host_count_active = sensor('host_count/active', 'Hosts active', {
            icon: 'mdi:lan-connect',
            extra: {stat_cla: 'measurement'},
        });
    }

    if (features.callmonitor !== false) {
        cmps.call_active = e('call/active', 'binary_sensor', 'Call', {
            icon: 'mdi:phone-in-talk',
            extra: {...BOOL},
        });
        cmps.call_ringing = e('call/ringing', 'binary_sensor', 'Ringing', {
            icon: 'mdi:phone-ring',
            extra: {...BOOL},
        });
        cmps.call_last_caller = sensor('call/last_incoming', 'Last caller', {
            icon: 'mdi:phone-incoming',
            extra: {val_tpl: jsonPayloads ? '{{ value_json.val.number }}' : '{{ value_json.number }}'},
        });
        cmps.call_last_callee = sensor('call/last_outgoing', 'Last called', {
            icon: 'mdi:phone-outgoing',
            extra: {val_tpl: jsonPayloads ? '{{ value_json.val.number }}' : '{{ value_json.number }}'},
        });
    }

    cmps.uptime = diag('device/uptime', 'Uptime', {
        icon: 'mdi:timer-outline',
        extra: {unit_of_meas: 's', dev_cla: 'duration', stat_cla: 'total_increasing'},
    });
    cmps.reboot = e('device/reboot', 'button', 'Reboot', {
        icon: 'mdi:power-cycle',
        category: 'config',
        command: true,
        extra: {pl_prs: 'true', dev_cla: 'restart'},
    });

    const box = {
        id,
        device: {
            name,
            mf: 'AVM',
            ...(device.model && {mdl: device.model}),
            ...(device.version && {sw: device.version}),
            ...(device.serial && {sn: device.serial}),
            ...(device.hardware && {hw: device.hardware}),
        },
        components: cmps,
    };

    const result = [box];

    if (haHosts && features.hosts !== false) {
        for (const host of hosts) {
            const hostId = `${id}_host_${macId(host.mac)}`;
            result.push({
                id: hostId,
                device: {name: host.name, cns: [['mac', host.mac]], via_device: id},
                components: {
                    present: entity({
                        id: hostId,
                        name,
                        item: `host/${host.key}/present`,
                        platform: 'device_tracker',
                        label: 'Presence',
                        jsonPayloads,
                        icon: host.wired ? 'mdi:ethernet' : 'mdi:wifi',
                        extra: {
                            val_tpl: jsonPayloads
                                ? "{{ 'home' if value_json.val else 'not_home' }}"
                                : "{{ 'home' if value == 'true' else 'not_home' }}",
                            pl_home: 'home',
                            pl_not_home: 'not_home',
                            src_type: 'router',
                            json_attr_t: `${name}/status/host/${host.key}/details`,
                            ...(jsonPayloads && {json_attr_tpl: '{{ value_json.val | tojson }}'}),
                        },
                    }),
                },
            });
        }
    }

    return result;
}
