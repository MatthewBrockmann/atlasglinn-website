#!/usr/bin/env python3
"""A canned Cloudflare for scripts/tests/cf-zone-test.sh.

The idea is the round-3 verifier's: the zone workflow's failing paths are the ones that matter, and the only honest way
to show a failing path fails is to drive the workflow's own shell over real HTTP and watch it exit non-zero. So this is
a tiny http.server that answers the six Cloudflare endpoints cf-zone-atlasglinn.yml calls, with a different canned
answer per scenario, and the workflow reaches it because every call in that file goes through $CF_API_BASE.

    python3 scripts/tests/cf-zone-emu.py [port]      # prints "listening <port>" then serves until killed

URL shape:  http://127.0.0.1:<port>/<scenario>/client/v4/<endpoint>
so one process serves every scenario and the scenario is carried in CF_API_BASE, not in a mutable global.

This is NOT Cloudflare. The envelope shape (success/errors/messages/result/result_info), the 1061 "zone already
exists" code and the nameserver pair are modelled from the documented shapes, and nothing here was read from a live
response — the container that wrote it has no route to api.cloudflare.com. It is enough to prove which way the
workflow BRANCHES, which is what the test asserts; it proves nothing about Cloudflare's real answers.

Every record value served here is a canary chosen to appear nowhere else, so the test can grep the whole captured run
for it and fail if the workflow ever prints a record's content into what is, on this repo, a public log.
"""
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

TAK_IP = '142.93.177.0'          # public DNS today; the address the workflow expects
CANARY_APEX = '203.0.113.77'     # TEST-NET-3, must never reach the log
CANARY_WWW = 'origin-canary.example.net'
CANARY_MX_M365 = 'atlas-canary.mail.protection.outlook.com'
CANARY_MX_OTHER = 'mx-canary.secureserver-example.net'
CANARY_SPF = 'v=spf1 include:spf.protection.outlook.com -all'
CANARY_AUTO = 'autodiscover-canary.outlook.com'
CANARY_TAK_WRONG = '198.51.100.9'
CANARIES = [CANARY_APEX, CANARY_WWW, CANARY_MX_M365, CANARY_MX_OTHER, CANARY_SPF, CANARY_AUTO, CANARY_TAK_WRONG]

ZONE_ID = 'z0000000000000000000000000000001'
ACCOUNT_ID = 'a0000000000000000000000000000001'
NAMESERVERS = ['amber.ns.cloudflare.com', 'kirk.ns.cloudflare.com']


def rec(rtype, name, content, proxied=False, ttl=1, rid=None):
    return {'id': rid or ('r%02d' % (abs(hash(name + rtype + content)) % 100)),
            'type': rtype, 'name': name, 'content': content, 'proxied': proxied, 'ttl': ttl}


def base_records(dom, mx=CANARY_MX_M365, tak=TAK_IP, www=True):
    out = [rec('A', dom, CANARY_APEX, proxied=True, ttl=1),
           rec('MX', dom, mx, ttl=1),
           rec('TXT', dom, CANARY_SPF, ttl=1),
           rec('CNAME', 'autodiscover.' + dom, CANARY_AUTO, ttl=1)]
    if www:
        out.append(rec('CNAME', 'www.' + dom, CANARY_WWW, proxied=True, ttl=1))
    if tak:
        out.append(rec('A', 'tak.' + dom, tak, ttl=1))
    return out


# Each scenario answers four questions: is the token alive, can it see zones, does the zone already exist, and what
# does the import look like. Anything not named here takes the default.
SCENARIOS = {
    # the token this repo already holds: alive, and 403 the moment it is asked about zones
    'workers_scoped':   {'verify': 200, 'zones_probe': 403},
    # revoked / mistyped
    'dead_token':       {'verify': 401, 'zones_probe': 401},
    # an account-owned token cannot call /user/tokens/verify, but it can list zones — must NOT be rejected
    'account_owned':    {'verify': 400, 'zones_probe': 200, 'exists': True},
    'zone_exists':      {'exists': True},
    'create_ok':        {},
    'create_refused':   {'create_code': 1061, 'exists_after_create': True},
    'growing':          {'growing': True},
    'no_www':           {'www': False},
    'mx_other':         {'mx': CANARY_MX_OTHER},
    'tak_mismatch':     {'tak': CANARY_TAK_WRONG},
    'tak_missing':      {'tak': None},
    # a second, untouched copy: the POST in the tak_missing case above is remembered by that scenario's state, so a
    # case that needs "still absent" needs its own scenario rather than a reset that would hide ordering bugs
    'tak_absent':       {'tak': None},
    'byname_500':       {'byname_code': 500},
    'truncated':        {'total_count': 99},
    'no_nameservers':   {'nameservers': []},
    # used by the domain-injection case, which must fail before a single request is made — so its counters must stay 0
    'injection':        {},
}

_LOCK = threading.Lock()
_STATE = {}


def state(scn):
    with _LOCK:
        return _STATE.setdefault(scn, {'reqs': 0, 'polls': 0, 'post_records': 0, 'post_zones': 0,
                                       'created': False, 'added': [], 'last_create_body': ''})


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):        # the harness captures the workflow's own log, not this one
        pass

    # ── plumbing ────────────────────────────────────────────────────────────────────────────────────────────────
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, result, code=200, **extra):
        d = {'success': True, 'errors': [], 'messages': [], 'result': result}
        d.update(extra)
        self._send(code, d)

    def _err(self, http, code, message):
        self._send(http, {'success': False, 'errors': [{'code': code, 'message': message}],
                          'messages': [], 'result': None})

    def _route(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split('/') if p]
        if len(parts) < 3 or parts[1] != 'client' or parts[2] != 'v4':
            return None, None, None
        return parts[0], '/' + '/'.join(parts[3:]), parse_qs(u.query)

    # ── endpoints ───────────────────────────────────────────────────────────────────────────────────────────────
    def do_GET(self):
        scn, path, q = self._route()
        if scn is None:
            return self._send(404, {'success': False, 'errors': [{'message': 'bad path'}]})
        cfg = SCENARIOS.get(scn)
        if cfg is None:
            return self._send(404, {'success': False, 'errors': [{'message': 'unknown scenario ' + scn}]})
        st = state(scn)
        if path != '/_stats':
            with _LOCK:
                st['reqs'] += 1

        if path == '/_stats':
            return self._send(200, st)

        if path == '/user/tokens/verify':
            code = cfg.get('verify', 200)
            if code == 200:
                return self._ok({'id': 'tok', 'status': cfg.get('verify_status', 'active')})
            return self._err(code, 6003, 'Invalid request headers')

        if path == '/accounts':
            return self._ok([{'id': ACCOUNT_ID, 'name': 'atlas'}], result_info={'total_count': 1})

        if path == '/zones':
            name = (q.get('name') or [None])[0]
            if name is None:                                   # the scope probe
                code = cfg.get('zones_probe', 200)
                if code != 200:
                    return self._err(code, 9109, 'Unauthorized to access requested resource')
                return self._ok([], result_info={'total_count': 0})
            code = cfg.get('byname_code', 200)                 # the lookup by name
            if code != 200:
                return self._err(code, 0, 'Internal server error')
            exists = cfg.get('exists', False) or (st['created'] and not cfg.get('exists_after_create')) \
                or (cfg.get('exists_after_create') and st['post_zones'] > 0)
            if exists:
                return self._ok([self._zone(cfg, name)], result_info={'total_count': 1})
            return self._ok([], result_info={'total_count': 0})

        m = re.match(r'^/zones/([^/]+)/dns_records$', path)
        if m:
            dom = cfg.get('domain', 'atlasglinn.com')
            recs = self._records(scn, cfg, dom)
            total = cfg.get('total_count', len(recs))
            return self._ok(recs, result_info={'total_count': total, 'page': 1, 'per_page': 100})

        return self._send(404, {'success': False, 'errors': [{'message': 'no route ' + path}]})

    def do_POST(self):
        scn, path, q = self._route()
        if scn is None:
            return self._send(404, {'success': False, 'errors': [{'message': 'bad path'}]})
        cfg = SCENARIOS.get(scn)
        if cfg is None:
            return self._send(404, {'success': False, 'errors': [{'message': 'unknown scenario ' + scn}]})
        st = state(scn)
        with _LOCK:
            st['reqs'] += 1
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8', 'replace') if n else ''

        if path == '/zones':
            with _LOCK:
                st['post_zones'] += 1
                st['last_create_body'] = raw
            code = cfg.get('create_code')
            if code == 1061:
                return self._err(400, 1061, 'The zone name is already taken by another account')
            if code:
                return self._err(400, code, 'refused by scenario')
            with _LOCK:
                st['created'] = True
            body = json.loads(raw) if raw else {}
            return self._ok(self._zone(cfg, body.get('name', 'atlasglinn.com')))

        if re.match(r'^/zones/([^/]+)/dns_records$', path):
            with _LOCK:
                st['post_records'] += 1
                st['added'].append(raw)
            try:
                body = json.loads(raw)
            except Exception:
                return self._err(400, 1004, 'unparseable body')
            return self._ok({'id': 'rnew', 'type': body.get('type'), 'name': body.get('name'),
                             'content': body.get('content'), 'proxied': body.get('proxied'), 'ttl': body.get('ttl')})

        return self._send(404, {'success': False, 'errors': [{'message': 'no route ' + path}]})

    # ── canned data ─────────────────────────────────────────────────────────────────────────────────────────────
    def _zone(self, cfg, name):
        return {'id': ZONE_ID, 'name': name, 'status': 'pending',
                'account': {'id': ACCOUNT_ID},
                'name_servers': cfg.get('nameservers', NAMESERVERS)}

    def _records(self, scn, cfg, dom):
        st = state(scn)
        with _LOCK:
            st['polls'] += 1
            polls = st['polls']
        recs = base_records(dom, mx=cfg.get('mx', CANARY_MX_M365),
                            tak=cfg['tak'] if 'tak' in cfg else TAK_IP,
                            www=cfg.get('www', True))
        if cfg.get('growing'):
            # the import that never settles: three more filler records on every poll, with the gated three always
            # present so the ONLY reason this scenario can fail is instability at the deadline
            for i in range(polls * 3):
                recs.append(rec('TXT', 'filler%d.%s' % (i, dom), 'canary-filler-%d' % i))
        for raw in list(st['added']):
            try:
                b = json.loads(raw)
            except Exception:
                continue
            nm = b.get('name') or ''
            recs.append(rec(b.get('type', 'A'), nm if nm.endswith(dom) else (nm + '.' + dom),
                            b.get('content', ''), bool(b.get('proxied')), b.get('ttl', 1)))
        return recs


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('listening %d' % srv.server_address[1], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
