/**
 * Minimal XML reader for the handful of documents a FRITZ!Box sends: SOAP envelopes, the TR-064
 * device description, the call list and the host list. No namespaces, no attributes, no DTDs —
 * elements, text, CDATA and comments are all the box uses, and that keeps the adapter free of an
 * XML dependency. Not a general purpose parser: do not feed it untrusted documents of any size.
 */

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

/** Decodes the five predefined entities and numeric character references. */
export function unescapeXml(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ref.toLowerCase() in ENTITIES ? ENTITIES[ref.toLowerCase()] : m;
    });
}

export function escapeXml(text) {
    return String(text).replace(
        /[&<>"']/g,
        (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c],
    );
}

/**
 * Parses an XML document into nested plain objects: an element with child elements becomes an
 * object keyed by the local names of its children (repeated names → array); an element with only
 * text becomes a string. Namespace prefixes are dropped (`s:Body` → `Body`), attributes ignored.
 *
 * `<a><b>1</b><b>2</b><c><d>x</d></c></a>` → `{a: {b: ['1', '2'], c: {d: 'x'}}}`
 */
export function parseXml(xml) {
    const src = String(xml);
    const root = {children: [], text: ''};
    const stack = [root];
    const re =
        /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) {
            top.text += m[1];
        } else if (m[2] !== undefined) {
            if (stack.length > 1) {
                stack.pop();
            }
        } else if (m[3] !== undefined) {
            const node = {name: localName(m[3]), children: [], text: ''};
            top.children.push(node);
            if (m[5] !== '/') {
                stack.push(node);
            }
        } else if (m[6] !== undefined) {
            top.text += unescapeXml(m[6]);
        }
    }
    return toObject(root);
}

function localName(qname) {
    const i = qname.indexOf(':');
    return i === -1 ? qname : qname.slice(i + 1);
}

function toObject(node) {
    if (node.children.length === 0) {
        return node.text;
    }
    const obj = {};
    for (const child of node.children) {
        const value = toObject(child);
        if (child.name in obj) {
            if (!Array.isArray(obj[child.name])) {
                obj[child.name] = [obj[child.name]];
            }
            obj[child.name].push(value);
        } else {
            obj[child.name] = value;
        }
    }
    return obj;
}

/** Always an array: `undefined` → `[]`, a single value → `[value]`. */
export function asArray(value) {
    if (value === undefined || value === null || value === '') {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/**
 * Finds the first element with the given local name anywhere in a parsed document
 * (`find(doc, 'Body')`), or `undefined`.
 */
export function find(obj, name) {
    if (obj === null || typeof obj !== 'object') {
        return undefined;
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const hit = find(item, name);
            if (hit !== undefined) {
                return hit;
            }
        }
        return undefined;
    }
    if (name in obj) {
        return obj[name];
    }
    for (const value of Object.values(obj)) {
        const hit = find(value, name);
        if (hit !== undefined) {
            return hit;
        }
    }
    return undefined;
}
