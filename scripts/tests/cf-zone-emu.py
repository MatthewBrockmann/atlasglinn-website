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
CANARY_WWW_TXT = 'www-txt-canary-verification-string'
CANARY_APEX_TXT = 'apex-txt-canary-verification-string'
# Cloudflare's own error strings quote the record they are about — "an identical record already exists: A tak.<dom>
# → <address>" is a real shape. The canary sweep used to be blind to that whole channel, because every error body
# served here carried only fixed text, so it could not tell an enforced privacy rule from an unenforced one. This
# canary rides INSIDE errors[].message in the three scenarios below, on paths that FAIL.
CANARY_IN_ERROR = 'origin-canary-in-error.example.net'
# The nine below belong to import mode, which reads the records out of the parent's own authoritative nameservers.
# The parent's NAMESERVER NAMES are canaries too, deliberately: the sweep is required to print a count and never the
# names, and that claim was unenforceable while every canary was a record's content.
CANARY_NS1 = 'ns-canary-1.example.net'
CANARY_NS2 = 'ns-canary-2.example.net'
CANARY_MAIL = '203.0.113.88'
CANARY_DKIM = 'dkim-canary.example.net'
CANARY_SRV_HOST = 'sipdir-canary.example.net'
CANARY_CAA_HOST = 'caa-canary.example.net'
CANARY_DELEG = 'deleg-canary.example.net'
CANARY_DMARC = 'dmarc-canary@example.net'
CANARY_DS = 'ds0canary0000000000000000000000000000000000000000000000000000cafe'
# A TXT over 255 bytes — every real DKIM key — is served as SEVERAL quoted character-strings and its wire value is
# their CONCATENATION. The canary rides in the SECOND string, so a workflow that keeps only the first (or that
# corrupts the join with rd.strip('"')) is caught by the round-trip assertion rather than by inspection.
CANARY_TXT_S1 = 'v=DKIM1; k=rsa; p=' + 'A' * 250
CANARY_TXT_S2 = 'dkim-second-string-canary.example.net' + 'B' * 100
CANARY_TXT_JOINED = CANARY_TXT_S1 + CANARY_TXT_S2
CANARY_TXT_TAIL = 'dkim-second-string-canary.example.net'
# an answer whose OWNER is outside the zone, returned under an in-zone label. The out-of-zone filter is the only
# guard against importing a record for the wrong domain, and no dig table exercised it until this row existed.
CANARY_OUT_OF_ZONE = '203.0.113.99'
CANARY_OUT_OF_ZONE_OWNER = 'elsewhere.example.net'
# the zone already holds an apex A pointing somewhere ELSE than the parent serves: the reconcile must refuse, not
# post a second apex A beside it
CANARY_APEX_CONFLICT = '203.0.113.55'
# over the 2048-byte rdata ceiling the sweep refuses to put in a zone file
CANARY_BIGRDATA = 'bigrdata-canary.example.net'
# a zone whose contents cannot be enumerated by asking a candidate list: the parent SYNTHESISES this address for
# every name nobody has a record for, so every probe answers, nothing ever answers NXDOMAIN, and the wildcard record
# itself is revealed by no query except one for the literal owner `*`.
CANARY_WILDCARD = '203.0.113.66'
# the filler that pushes a zone past one page of 100. The row the first page does NOT reach is the conflicting apex
# A, which is the whole point: the reconcile read it as absent and posted a second one beside it.
CANARY_PAGEFILL = 'pagefill-canary.example.net'
# an IPv6 address in its EXPANDED spelling in the zone and its COMPRESSED spelling at the parent — one address, two
# strings, and a text compare calls them a conflict and refuses a run where nothing is wrong
CANARY_V6 = '2001:db8:beef::1'
CANARY_V6_EXPANDED = '2001:0db8:beef:0000:0000:0000:0000:0001'
# a name answering with a CNAME AND another type — illegal at any owner, and Cloudflare rejects the file part-way
CANARY_CNAME_CLASH = 'clash-canary.example.net'
CANARY_CNAME_CLASH_TXT = 'clash-txt-canary-verification-string'
# a wildcard RECORD carrying a type the probe cannot see. RFC 4592: a wildcard makes the matched name exist for
# every type, so a conforming parent answers NOERROR/NODATA for a name that does not exist and the probe refuses the
# run (scenario `wildcard`). This table models the other half — a parent that answers NXDOMAIN for names it has no
# record for while still serving a literal `*` owner, which is the only shape where the `*` candidate label is the
# thing that puts the wildcard record into the zone file rather than belt and braces on top of the probe.
CANARY_WILDCARD_TXT = 'wildcard-txt-canary-verification-string'
# served with a 1-week TTL — what GoDaddy's DNS UI offers and what Cloudflare's documented non-Enterprise 86400
# ceiling refuses. A row copied verbatim is the likeliest way the importer answers 200 and silently skips a record.
CANARY_TTL_A = '203.0.113.44'
# a record the zone already holds at a name NO candidate label and no repository grep ever asks about. It is the
# only way the swept row count and the LANDED row count can differ on a run that still goes green, which is what
# makes the operator's row-count note falsifiable at all.
CANARY_LEGACY = '203.0.113.22'
CANARIES = [CANARY_APEX, CANARY_WWW, CANARY_MX_M365, CANARY_MX_OTHER, CANARY_SPF, CANARY_AUTO, CANARY_TAK_WRONG,
            CANARY_WWW_TXT, CANARY_APEX_TXT, CANARY_IN_ERROR, CANARY_NS1, CANARY_NS2, CANARY_MAIL, CANARY_DKIM,
            CANARY_SRV_HOST, CANARY_CAA_HOST, CANARY_DELEG, CANARY_DMARC, CANARY_DS, CANARY_TXT_TAIL,
            CANARY_OUT_OF_ZONE, CANARY_OUT_OF_ZONE_OWNER, CANARY_APEX_CONFLICT, CANARY_BIGRDATA,
            CANARY_WILDCARD, CANARY_PAGEFILL, CANARY_V6, CANARY_V6_EXPANDED, CANARY_CNAME_CLASH,
            CANARY_CNAME_CLASH_TXT, CANARY_WILDCARD_TXT, CANARY_TTL_A, CANARY_LEGACY]
ERR_CANARY_MSG = ('An identical record already exists: A tak.atlasglinn.com pointing at %s — delete it first'
                  % CANARY_IN_ERROR)

ZONE_ID = 'z0000000000000000000000000000001'
ACCOUNT_ID = 'a0000000000000000000000000000001'
NAMESERVERS = ['amber.ns.cloudflare.com', 'kirk.ns.cloudflare.com']


def rec(rtype, name, content, proxied=False, ttl=1, rid=None, priority=None):
    d = {'id': rid or ('r%02d' % (abs(hash(name + rtype + content)) % 100)),
         'type': rtype, 'name': name, 'content': content, 'proxied': proxied, 'ttl': ttl}
    if priority is not None:
        d['priority'] = priority
    return d


def base_records(dom, mx=CANARY_MX_M365, tak=TAK_IP, www=True, apex=True, extra_mx=None):
    # www and apex take three values, not two: True = the CNAME/A that serves the website, False = the name is
    # absent entirely, 'txt' = a record EXISTS at that name and it cannot serve a website. The third one is the
    # case the gate used to pass: "is there a record called www" is not the same question as "can www serve".
    out = [rec('MX', dom, mx, ttl=1, priority=10)] if mx else []
    out += [rec('TXT', dom, CANARY_SPF, ttl=1),
            rec('CNAME', 'autodiscover.' + dom, CANARY_AUTO, ttl=1)]
    for extra in (extra_mx or []):
        out.append(rec('MX', dom, extra, ttl=1))
    if apex is True:
        out.append(rec('A', dom, CANARY_APEX, proxied=True, ttl=1))
    elif apex == 'txt':
        out.append(rec('TXT', dom, CANARY_APEX_TXT, ttl=1))
    if www is True:
        out.append(rec('CNAME', 'www.' + dom, CANARY_WWW, proxied=True, ttl=1))
    elif www == 'txt':
        out.append(rec('TXT', 'www.' + dom, CANARY_WWW_TXT, ttl=1))
    if tak:
        out.append(rec('A', 'tak.' + dom, tak, ttl=1))
    return out

# ── what the parent's authoritative nameservers answer, per scenario ────────────────────────────────────────────────
# import mode never asks a recursive resolver for a record — a recursor answers from a cache and the point is to copy
# what the parent serves right now. It asks a public resolver exactly two questions (who is authoritative, and is
# there a DS) and everything else goes to the authoritative servers with +norecurse. RESOLVERS is the set this
# emulator will answer those two questions for; a record query aimed at one of them is counted and REFUSED, which is
# what makes "the sweep never read a record from a cache" a counter rather than a claim.
DOM = 'atlasglinn.com'
RESOLVERS = {'1.1.1.1', '8.8.8.8', '9.9.9.9'}

FULL_ANSWERS = {
    '@':    [('A', 3600, CANARY_APEX), ('MX', 3600, '10 %s.' % CANARY_MX_M365), ('TXT', 3600, '"%s"' % CANARY_SPF),
             ('CAA', 3600, '0 issue "%s"' % CANARY_CAA_HOST),
             # the apex NS set IS the delegation. Cloudflare assigns its own, so the writer must drop these two.
             ('NS', 3600, CANARY_NS1 + '.'), ('NS', 3600, CANARY_NS2 + '.')],
    # the fourth element of a row is an OWNER OVERRIDE: what an authoritative server returned, whatever was asked.
    # This one is outside the zone entirely and must never reach the zone file.
    'www':  [('CNAME', 3600, CANARY_WWW + '.'),
             ('A', 3600, CANARY_OUT_OF_ZONE, CANARY_OUT_OF_ZONE_OWNER + '.')],
    'mail': [('A', 3600, CANARY_MAIL)],
    'tak':  [('A', 60, TAK_IP)],                       # ttl 60 — the only proof the 300 floor is applied
    'autodiscover': [('CNAME', 3600, CANARY_AUTO + '.')],
    '_dmarc': [('TXT', 3600, '"v=DMARC1; p=none; rua=mailto:%s"' % CANARY_DMARC)],
    'selector1._domainkey': [('CNAME', 3600, CANARY_DKIM + '.')],
    # a DKIM key: over 255 bytes, so it is two character-strings and its value is their concatenation
    'selector2._domainkey': [('TXT', 3600, '"%s" "%s"' % (CANARY_TXT_S1, CANARY_TXT_S2))],
    '_sip._tls': [('SRV', 3600, '100 1 443 %s.' % CANARY_SRV_HOST)],
    'ops':  [('NS', 3600, CANARY_DELEG + '.')],        # a real delegation below the apex: KEPT
    'ftp':  [],                                        # NOERROR and no data — dropped, like an NXDOMAIN name
}
# 6 apex answers - 2 apex NS = 4, + www (the out-of-zone A is dropped) + mail + tak + autodiscover + _dmarc
# + selector1 + selector2 + _sip._tls + ops = 13
NO_MX_ANSWERS = dict(FULL_ANSWERS, **{'@': [r for r in FULL_ANSWERS['@'] if r[0] != 'MX']})
# an rdata past the 2048-byte ceiling the sweep refuses to write into a zone file, and a control character in the
# same table: both must stop the run before anything is imported.
BAD_RDATA_ANSWERS = dict(FULL_ANSWERS, **{'blog': [('TXT', 3600, '"%s%s"' % (CANARY_BIGRDATA, 'z' * 2100))]})
# a name answering with a CNAME and a TXT. No server should serve it and plenty do — a name mid-migration keeping a
# leftover verification TXT beside its new CNAME is the ordinary way. Cloudflare rejects the zone file for it and
# rejects it part-way, so the sweep has to catch it before the file is written.
CNAME_CLASH_ANSWERS = dict(FULL_ANSWERS, **{'blog': [('CNAME', 3600, CANARY_CNAME_CLASH + '.'),
                                                     ('TXT', 3600, '"%s"' % CANARY_CNAME_CLASH_TXT)]})
# one AAAA, on a label no other table uses so the record counts every other import case pins stay put
V6_ANSWERS = dict(FULL_ANSWERS, **{'app': [('AAAA', 3600, CANARY_V6)]})
# a wildcard RECORD at the literal `*` owner, carrying a type the A probe cannot see, at a parent that still
# answers NXDOMAIN for names it holds nothing for. The probe passes, the sweep proceeds — and the ONLY query that
# can copy this record is the one for the literal owner, which is why `*` is in the candidate list. The reason it is
# belt and braces rather than the detector is in the workflow header: under RFC 4592 a conforming parent would have
# answered the probe NOERROR/NODATA and the run would have refused before reaching here (scenario `wildcard`).
WILDCARD_TYPED_ANSWERS = dict(FULL_ANSWERS, **{'*': [('TXT', 3600, '"%s"' % CANARY_WILDCARD_TXT)]})
# a TTL of one week, which GoDaddy's UI offers and Cloudflare's non-Enterprise maximum of 86400 does not take. The
# sweep clamps at both ends, so this row must reach the zone file at 86400 and not at 604800.
TTL_ANSWERS = dict(FULL_ANSWERS, **{'app': [('A', 604800, CANARY_TTL_A)]})


TXT_STRINGS = re.compile(r'"((?:[^"\\]|\\.)*)"')


def txt_join(rd, strict=True):
    """A TXT rdata's wire value: the concatenation of its quoted character-strings, unescaped.

    BIND splits any TXT over 255 bytes into several quoted strings and dig prints them that way, so `"a" "b"` is the
    single value `ab` and NOT the four-character `a" "b` that rd.strip('"') produces. strict=True is the parser's
    contract — a TXT rdata that is not entirely quoted strings is a file Cloudflare would reject.
    """
    rd = (rd or '').strip()
    if strict and not re.fullmatch(r'("(?:[^"\\]|\\.)*"\s*)+', rd):
        raise ValueError('TXT rdata is not one or more quoted character-strings')
    parts = TXT_STRINGS.findall(rd)
    if not parts:
        return rd.strip('"')
    return ''.join(x.replace('\\"', '"').replace('\\\\', '\\') for x in parts)


def answers_to_records(table, dom=DOM, skip=()):
    """The record set the workflow SHOULD end up with, shaped as Cloudflare rows — the prefill for a zone that has
    already been imported once. Same four rules the workflow's own writer follows: apex NS dropped, out-of-zone
    owners dropped, TTLs floored at 300, MX split into priority + content — and a multi-string TXT joined."""
    out = []
    for lab in sorted(table):
        owner = dom if lab == '@' else lab + '.' + dom
        for row in table[lab]:
            ty, ttl, rd = row[0], row[1], row[2]
            if len(row) > 3:                       # an owner override is out-of-zone; the workflow must drop it
                continue
            if (ty == 'NS' and lab == '@') or (lab, ty) in skip:
                continue
            ttl = max(300, ttl)
            if ty == 'MX':
                pri, tgt = rd.split(None, 1)
                out.append(rec('MX', owner, tgt.rstrip('.'), ttl=ttl, priority=int(pri)))
            elif ty == 'TXT':
                out.append(rec('TXT', owner, txt_join(rd), ttl=ttl))
            else:
                out.append(rec(ty, owner, rd.rstrip('.'), ttl=ttl))
    return out


def conflicting_prefill():
    """A zone already imported once, whose apex A points somewhere ELSE than the parent serves today. Every
    prefilled scenario before this one was built from the same dig answers the sweep reads, so no case anywhere put
    a record in the zone whose CONTENT differed — and the reconcile's conflicting-content branch had zero coverage."""
    out = []
    for r in answers_to_records(FULL_ANSWERS):
        r = dict(r)
        if r['type'] == 'A' and r['name'] == DOM:
            r['content'] = CANARY_APEX_CONFLICT
        out.append(r)
    return out


def paged_prefill(total=122, cap=100):
    """A zone too big for one page, with the CONFLICTING apex A on the page the reconcile never reads.

    Cloudflare serves per_page=100 as a PAGE and reports the zone's real size in result_info.total_count. Every
    prefilled scenario before this one held fewer than 100 records, so the reconcile's single un-paged read was
    always the whole zone and nothing could tell the difference between "not in the zone" and "not on page one".
    122 records with the conflict at row 101 can: a reconcile reading one page sees no apex A at all, calls the
    parent's apex A missing, and POSTs a second one beside the one it could not see.
    """
    base = conflicting_prefill()
    clash = [r for r in base if r['type'] == 'A' and r['name'] == DOM]
    rest = [r for r in base if r not in clash]
    filler = [rec('TXT', 'pagefill%d.%s' % (i, DOM), '%s-%03d' % (CANARY_PAGEFILL, i), ttl=300)
              for i in range(total - len(base))]
    out = rest + filler
    out.insert(cap, clash[0])
    return out


def v6_prefill():
    """A zone holding the same AAAA the parent serves, written the other legal way round."""
    out = []
    for r in answers_to_records(V6_ANSWERS):
        r = dict(r)
        if r['type'] == 'AAAA':
            r['content'] = CANARY_V6_EXPANDED
        out.append(r)
    return out


BIND_TYPES = ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS')


def parse_bind(text, dom=DOM, proxied=False):
    """Cloudflare rows out of a BIND master file, parsed STRICTLY — every deviation raises.

    This is the only thing in the suite that can tell whether the workflow's zone-file WRITER emits something
    Cloudflare could parse. A lenient parser here would pass a writer that emits a broken file and the failure would
    surface on the live dispatch, against the real zone, which is the one place it must not.

    It does NOT reject an apex NS. Cloudflare's own importer's handling of that was never read from a live response,
    and guessing it would put a guess in the middle of the assertion that the workflow drops those records itself —
    the record COUNT is the detector for that, not this parser.
    """
    origin, out = None, []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(';'):
            continue
        if line.startswith('$'):
            p = line.split()
            if len(p) != 2 or p[0] not in ('$ORIGIN', '$TTL'):
                raise ValueError('unparseable directive')
            if p[0] == '$ORIGIN':
                origin = p[1].rstrip('.').lower()
            elif not p[1].isdigit():
                raise ValueError('$TTL is not a number')
            continue
        if origin != dom:
            raise ValueError('records before a $ORIGIN for this zone')
        p = line.split(None, 4)
        if len(p) != 5:
            raise ValueError('a record line needs owner, ttl, class, type and rdata')
        owner, ttl, cls, ty, rd = p
        if not owner.endswith('.'):
            raise ValueError('owner is not fully qualified')
        owner = owner.rstrip('.').lower()
        if not (owner == dom or owner.endswith('.' + dom)):
            raise ValueError('owner is outside the zone')
        if not ttl.isdigit() or cls != 'IN':
            raise ValueError('bad ttl or class')
        ty = ty.upper()
        if ty not in BIND_TYPES:
            raise ValueError('unsupported type ' + ty)
        ttl = int(ttl)
        if ty == 'MX':
            bits = rd.split(None, 1)
            if len(bits) != 2 or not bits[0].isdigit():
                raise ValueError('MX rdata is not "<priority> <target>"')
            out.append(rec('MX', owner, bits[1].rstrip('.'), proxied=proxied, ttl=ttl, priority=int(bits[0])))
        elif ty == 'TXT':
            # STRICT, and multi-string aware: Cloudflare's importer stores `"a" "b"` as the single value `ab`, and a
            # writer that emitted `a" "b` would import a corrupted DKIM key that looks fine in a name/type table.
            out.append(rec('TXT', owner, txt_join(rd), proxied=proxied, ttl=ttl))
        elif ty in ('CNAME', 'NS'):
            out.append(rec(ty, owner, rd.rstrip('.'), proxied=proxied, ttl=ttl))
        else:
            # A/AAAA/SRV/CAA: stored verbatim. Cloudflare's JSON shape for SRV and CAA was never read from a live
            # response, so nothing here pretends to know it.
            out.append(rec(ty, owner, rd, proxied=proxied, ttl=ttl))
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
    # a record at www that is not a website: the gate asked "is there a record called www", and a TXT answered yes
    'www_txt_only':     {'www': 'txt'},
    # the same shape one name up: an apex carrying TXT and MX and no address record
    'apex_txt_only':    {'apex': 'txt'},
    'mx_other':         {'mx': CANARY_MX_OTHER},
    # the realistic GoDaddy-to-M365 leftover: the M365 MX plus one stale registrar MX on the same apex
    'mx_mixed':         {'extra_mx': [CANARY_MX_OTHER]},
    'tak_mismatch':     {'tak': CANARY_TAK_WRONG},
    'tak_missing':      {'tak': None},
    # a second, untouched copy: the POST in the tak_missing case above is remembered by that scenario's state, so a
    # case that needs "still absent" needs its own scenario rather than a reset that would hide ordering bugs
    'tak_absent':       {'tak': None},
    'byname_500':       {'byname_code': 500},
    'truncated':        {'total_count': 99},
    'no_nameservers':   {'nameservers': []},
    # Cloudflare assigned one name, and the GoDaddy form takes a pair
    'ns_single':        {'nameservers': ['solo.ns.cloudflare.com']},
    # the three error-body canary scenarios: each drives one of the workflow's three vendor-text echo points
    'err_leak_token':   {'verify': 403, 'zones_probe': 403, 'err_canary': True},
    'err_leak_create':  {'create_code': 1109, 'err_canary': True},
    'err_leak_tak':     {'tak': None, 'post_record_code': 400, 'err_canary': True},
    # used by the domain-injection case, which must fail before a single request is made — so its counters must stay 0
    'injection':        {},
    # ── import mode. 'empty' is the measured truth for atlasglinn.com: the zone exists and jump_start imported
    # nothing (records=0 MX=0 across 32 polls, runs 34382780038 / 34383841484), so the records have to be swept out
    # of the parent and posted. 'dig' names the answer table those authoritative nameservers serve.
    'full_import':        {'exists': True, 'empty': True, 'dig': FULL_ANSWERS},
    # own state, because the repo-grep and budget cases must not inherit another case's counters
    'full_import_repo':   {'exists': True, 'empty': True, 'dig': FULL_ANSWERS},
    'full_import_budget': {'exists': True, 'empty': True, 'dig': FULL_ANSWERS},
    'import_no_mx':       {'exists': True, 'empty': True, 'dig': NO_MX_ANSWERS},
    'ds_present':         {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'ds': [CANARY_DS]},
    'ds_unknown':         {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'ds_status': 'SERVFAIL'},
    # the parent names no authoritative server: there is nothing to copy from
    'dig_no_ns':          {'exists': True, 'empty': True, 'ns': [], 'dig': FULL_ANSWERS},
    'dig_empty':          {'exists': True, 'empty': True, 'dig': {}},
    'ns_failover':        {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'dead': [CANARY_NS1]},
    # both authoritative servers stop answering: a PARTIAL sweep, which must refuse rather than import half a zone
    'dig_all_dead':       {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'dead': [CANARY_NS1, CANARY_NS2]},
    'import_truncated':   {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'total_count': 99},
    'import_4xx':         {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'import_code': 400, 'err_canary': True},
    # the zone already holds a previous import, minus www and tak: exactly two records are missing
    'zone_prefilled':     {'exists': True, 'dig': FULL_ANSWERS,
                           'prefill': answers_to_records(FULL_ANSWERS, skip=(('www', 'CNAME'), ('tak', 'A')))},
    # the one missing record is an SRV, the type this run refuses to create one at a time
    'zone_prefilled_srv': {'exists': True, 'dig': FULL_ANSWERS,
                           'prefill': answers_to_records(FULL_ANSWERS, skip=(('_sip._tls', 'SRV'),))},
    # the zone holds an apex A pointing somewhere ELSE. Nothing is "missing" by name+type, and everything the four
    # gates ask about is present — so a reconcile that treats a differing content as a missing record posts a SECOND
    # apex A, passes all four gates, prints the nameservers, and round-robins the website on the switch.
    'zone_conflicting':   {'exists': True, 'dig': FULL_ANSWERS, 'prefill': conflicting_prefill()},
    # the same zone, one page bigger than the reconcile's single read. per_page=100 answers with a SLICE and reports
    # the true size in result_info.total_count, and the conflicting apex A sits at row 101 — so a reconcile built on
    # that one page sees no apex A, calls the parent's apex A missing, and posts a second one into a live zone.
    'zone_paged':         {'exists': True, 'dig': FULL_ANSWERS, 'prefill': paged_prefill(), 'page_cap': 100},
    # the zone holds everything except the two-character-string DKIM TXT: exactly one record is posted one at a time,
    # and its content must be the CONCATENATION of both strings
    'zone_prefilled_txt': {'exists': True, 'dig': FULL_ANSWERS,
                           'prefill': answers_to_records(FULL_ANSWERS, skip=(('selector2._domainkey', 'TXT'),))},
    # the zone holds the AAAA the parent serves, spelled out in full. One address, two strings: a text compare calls
    # it a conflict and refuses a run where nothing is wrong.
    'zone_prefilled_v6':  {'exists': True, 'dig': V6_ANSWERS, 'prefill': v6_prefill()},
    # a wildcard at the parent: every name answers, nothing answers NXDOMAIN, and no query but one for the literal
    # `*` owner reveals the record. A candidate list cannot enumerate this zone and must not pretend it did.
    'wildcard':           {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'wildcard': CANARY_WILDCARD},
    # a name answering with a CNAME AND a TXT: illegal at any owner, and Cloudflare rejects the file part-way
    'dig_cname_clash':    {'exists': True, 'empty': True, 'dig': CNAME_CLASH_ANSWERS},
    # an rdata past the 2048-byte ceiling: the sweep must refuse before writing a zone file
    'dig_bad_rdata':      {'exists': True, 'empty': True, 'dig': BAD_RDATA_ANSWERS},
    # import dispatched at a domain that is NOT in the account: import never creates a zone
    'import_no_zone':     {},
    # ── round 4. A 200 IS NOT AN IMPORT. Cloudflare's importer parses a file, creates what it CAN and answers 200
    # with two counts that are allowed to differ; the step printed both and compared them to nothing, while the
    # sweep's own count was written to disk and read by no one. Two shapes, because they fail differently:
    #   partial_import        — the importer reports only what it created (added == parsed == 11) and the SWEPT
    #                           count is the only witness that two rows are gone.
    #   partial_import_parsed — it reports honestly (parsed 13, added 11) and the two numbers already disagree.
    'partial_import':        {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'partial_import': 2},
    'partial_import_parsed': {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'partial_import': 2,
                              'honest_parsed': True},
    # the counts agree and the ZONE still settles short — a row lost between the parse and the zone. Nothing the
    # import step reads can see this: it trusts Cloudflare's own recs_added, and Cloudflare's own recs_added is
    # what is wrong. It is the only case that arms the SECOND count check, after the wait, against what the zone
    # actually serves.
    'partial_import_settled': {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'partial_import': 2,
                               'lie_counts': True},
    # a wildcard record the probe cannot see, at a parent that answers NXDOMAIN normally: the `*` candidate label
    # is the only query that copies it
    'wildcard_typed':     {'exists': True, 'empty': True, 'dig': WILDCARD_TYPED_ANSWERS},
    # a 604800 TTL at the parent: it must reach the zone file clamped to 86400
    'ttl_ceiling':        {'exists': True, 'empty': True, 'dig': TTL_ANSWERS},
    # ONE LOST UDP PACKET IS NOT A DEAD SERVER. ns1 drops its first two queries (two strikes: rested), then ns2
    # drops its fifth — at which point NO server is in the rotation and the sweep must ask the rested one again.
    # The two-strikes limb and the rested-nameserver retry were source-only until this scenario existed: reverting
    # them wholesale left the suite green.
    'ns_flaky':           {'exists': True, 'empty': True, 'dig': FULL_ANSWERS,
                           'flaky': {CANARY_NS1: [1, 2], CANARY_NS2: [5]}},
    # a records response with NO result_info at all. Both truncated-read guards read total_count as None and fell
    # through to "carry on" — "I could not measure the zone" treated as "the zone is small enough", once on the
    # step that writes and once on the step every assertion below reads from.
    'no_result_info_import': {'exists': True, 'empty': True, 'dig': FULL_ANSWERS, 'omit_result_info': True},
    'no_result_info_wait':   {'omit_result_info': True},
    # the zone already holds a record the sweep can never see — `legacy` is in no candidate label and in no file
    # the repository grep reads — plus the same two missing rows as zone_prefilled. The run goes green and the
    # zone SETTLES at 14 name/type rows while the sweep found 13, which is the only shape where the number above
    # the paste block is falsifiable: quoting the swept count tells him to expect 13 over a zone serving 14.
    'zone_extra':         {'exists': True, 'dig': FULL_ANSWERS,
                           'prefill': answers_to_records(FULL_ANSWERS, skip=(('www', 'CNAME'), ('tak', 'A')))
                                      + [rec('A', 'legacy.' + DOM, CANARY_LEGACY, ttl=300)]},
    # the one missing record is the apex MX. Every prefilled scenario before this one was missing an address
    # record or a TXT, so the reconcile's MX body — the branch that carries a priority — had no case at all, and
    # `proxied: false` rode in it unasserted.
    'zone_prefilled_mx':  {'exists': True, 'dig': FULL_ANSWERS,
                           'prefill': answers_to_records(FULL_ANSWERS, skip=(('@', 'MX'),))},
    # DNSSEC already on, dispatched in CREATE mode. The DS gate was import-only while the paste block was reachable
    # from create, so a create run against a signed domain printed two nameservers with the DS never measured.
    'ds_present_create':  {'ds': [CANARY_DS]},
}

_LOCK = threading.Lock()
_STATE = {}


def state(scn):
    with _LOCK:
        return _STATE.setdefault(scn, {'reqs': 0, 'polls': 0, 'post_records': 0, 'post_zones': 0,
                                       'created': False, 'added': [], 'last_create_body': '',
                                       'import_calls': 0, 'deletes': 0, 'puts': 0, 'parse_errors': 0,
                                       'dig_queries': 0, 'dig_dead_queries': 0, 'dig_recursor_data_queries': 0,
                                       'dig_recursive_auth_queries': 0,
                                       'dig_per_server': {}, 'dig_dropped': 0,
                                       'dig_names': [], 'imported': []})


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

        if path == '/_dig':
            return self._dig(scn, cfg, st, q)

        if path == '/user/tokens/verify':
            code = cfg.get('verify', 200)
            if code == 200:
                return self._ok({'id': 'tok', 'status': cfg.get('verify_status', 'active')})
            return self._err(code, 6003, ERR_CANARY_MSG if cfg.get('err_canary') else 'Invalid request headers')

        if path == '/accounts':
            return self._ok([{'id': ACCOUNT_ID, 'name': 'atlas'}], result_info={'total_count': 1})

        if path == '/zones':
            name = (q.get('name') or [None])[0]
            if name is None:                                   # the scope probe
                code = cfg.get('zones_probe', 200)
                if code != 200:
                    return self._err(code, 9109,
                                     ERR_CANARY_MSG if cfg.get('err_canary') else 'Unauthorized to access requested resource')
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
            total = len(recs)
            tc = cfg.get('total_count')
            # A zone that REPORTS more records than the page it served. In import mode the pre-import read of an
            # empty zone is a genuine zero — what those scenarios model is a truncated read AFTER the import — so
            # the inflation starts once the import has landed, which is where the original 100-cap check lives.
            if tc is not None and (not cfg.get('empty') or st['import_calls'] > 0):
                total = tc
            cap = cfg.get('page_cap')
            if cap is not None and len(recs) > cap:
                # what Cloudflare does at per_page=100: serve one page, report the zone's real size beside it
                recs = recs[:cap]
            if cfg.get('omit_result_info'):
                # no result_info key at all — the shape both truncated-read guards fell open on
                return self._ok(recs)
            return self._ok(recs, result_info={'total_count': total, 'page': 1, 'per_page': cap or 100})

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
                return self._err(400, code, ERR_CANARY_MSG if cfg.get('err_canary') else 'refused by scenario')
            with _LOCK:
                st['created'] = True
            body = json.loads(raw) if raw else {}
            return self._ok(self._zone(cfg, body.get('name', 'atlasglinn.com')))

        m = re.match(r'^/zones/([^/]+)/dns_records/import$', path)
        if m:
            with _LOCK:
                st['import_calls'] += 1
            code = cfg.get('import_code')
            if code:
                return self._err(code, 1004, ERR_CANARY_MSG if cfg.get('err_canary') else 'refused by scenario')
            fields = self._multipart(raw)
            if 'file' not in fields:
                with _LOCK:
                    st['parse_errors'] += 1
                return self._err(400, 1004, 'no file part in the multipart body')
            try:
                recs = parse_bind(fields['file'], cfg.get('domain', DOM),
                                  proxied=(fields.get('proxied', 'false').strip().lower() == 'true'))
            except ValueError:
                # STRICTNESS IS THE POINT. This parser is the only thing in the suite that proves the workflow's BIND
                # writer emits a file Cloudflare could actually parse; a lenient one would pass a broken writer.
                with _LOCK:
                    st['parse_errors'] += 1
                return self._err(400, 1004, 'the zone file did not parse')
            # A 200 IS NOT AN IMPORT. Cloudflare's importer creates what it can and reports two counts that are
            # allowed to differ — a row past the 86400 TTL ceiling, a type it will not take. Nothing about the HTTP
            # code says a row was skipped, and until this knob existed every scenario answered
            # recs_added == total_records_parsed == len(recs), so no case could tell a checked count from an
            # unchecked one.
            drop = cfg.get('partial_import') or 0
            parsed = added = len(recs)
            if drop:
                recs = recs[:-drop]
                if cfg.get('lie_counts'):
                    pass                                  # both counts still report the whole file
                elif cfg.get('honest_parsed'):
                    added = len(recs)                     # parsed 13, created 11 — the two disagree on their own
                else:
                    parsed = added = len(recs)            # only what it created; the swept count is the witness
            with _LOCK:
                st['imported'].extend(recs)
            return self._ok({'recs_added': added, 'total_records_parsed': parsed})

        if re.match(r'^/zones/([^/]+)/dns_records$', path):
            with _LOCK:
                st['post_records'] += 1
                st['added'].append(raw)
            rcode = cfg.get('post_record_code')
            if rcode:
                return self._err(rcode, 81057, ERR_CANARY_MSG if cfg.get('err_canary') else 'refused by scenario')
            try:
                body = json.loads(raw)
            except Exception:
                return self._err(400, 1004, 'unparseable body')
            return self._ok({'id': 'rnew', 'type': body.get('type'), 'name': body.get('name'),
                             'content': body.get('content'), 'proxied': body.get('proxied'), 'ttl': body.get('ttl')})

        return self._send(404, {'success': False, 'errors': [{'message': 'no route ' + path}]})

    def _multipart(self, raw):
        # ~20 lines instead of the cgi module (gone in 3.13). curl sends one part per -F, each headed by a
        # Content-Disposition carrying name="...", and every part body ends with the CRLF before the next boundary.
        ctype = self.headers.get('Content-Type') or ''
        b = re.search(r'boundary="?([^";]+)"?', ctype)
        if not b:
            return {}
        fields = {}
        for part in raw.split('--' + b.group(1)):
            if '\r\n\r\n' not in part:
                continue
            head, body = part.split('\r\n\r\n', 1)
            nm = re.search(r'name="([^"]+)"', head)
            if not nm:
                continue
            fields[nm.group(1)] = body[:-2] if body.endswith('\r\n') else body
        return fields

    # Never-deletes and never-updates stop being a claim about the workflow's source and become a counter: no path
    # in cf-zone-atlasglinn.yml may reach either of these, in any mode.
    def do_DELETE(self):
        return self._refuse('deletes')

    def do_PUT(self):
        return self._refuse('puts')

    def _refuse(self, counter):
        scn, path, q = self._route()
        if scn is None or SCENARIOS.get(scn) is None:
            return self._send(404, {'success': False, 'errors': [{'message': 'bad path'}]})
        st = state(scn)
        with _LOCK:
            st['reqs'] += 1
            st[counter] += 1
        return self._err(405, 7003, 'this emulator serves no destructive method')

    # ── the parent's DNS, as seen through scripts/tests/cf-zone-dig-stub.py ─────────────────────────────────────
    def _dig(self, scn, cfg, st, q):
        dom = cfg.get('domain', DOM)
        server = (q.get('server') or [''])[0].rstrip('.').lower()
        name = (q.get('name') or [''])[0].rstrip('.').lower()
        qtype = (q.get('type') or [''])[0].upper()
        with _LOCK:
            st['dig_queries'] += 1
            # +norecurse on an authoritative query is the difference between reading what the parent serves RIGHT NOW
            # and reading whatever that server happened to have cached. The workflow header claimed it; nothing could
            # detect its removal until this counter existed.
            if (q.get('norec') or ['0'])[0] != '1' and server not in RESOLVERS:
                st['dig_recursive_auth_queries'] += 1
            key = '%s|%s' % (name, qtype)
            if key not in st['dig_names']:
                st['dig_names'].append(key)
                st['dig_names'].sort()
        ns = [n.rstrip('.').lower() for n in cfg.get('ns', [CANARY_NS1, CANARY_NS2])]
        dead = [n.rstrip('.').lower() for n in cfg.get('dead', [])]

        def answer(status, rows=(), aa=False):
            return self._send(200, {'status': status, 'aa': aa, 'answers': list(rows)})

        if server in RESOLVERS:
            # the two questions a recursor is allowed to answer, and nothing else
            if qtype == 'NS':
                return answer('NOERROR', [{'name': name + '.', 'ttl': 3600, 'type': 'NS', 'rdata': n + '.'}
                                          for n in cfg.get('ns', [CANARY_NS1, CANARY_NS2])])
            if qtype == 'DS':
                return answer(cfg.get('ds_status', 'NOERROR'),
                              [{'name': name + '.', 'ttl': 3600, 'type': 'DS', 'rdata': '2371 13 2 %s' % v}
                               for v in cfg.get('ds', [])])
            with _LOCK:
                st['dig_recursor_data_queries'] += 1
            return answer('REFUSED')
        # ONE LOST UDP PACKET, aimed. `flaky` names, per server, the 1-based indexes of that server's own queries
        # that go unanswered — which is what a dropped datagram looks like and is NOT what `dead` models (a server
        # that never answers again). It is the only way to reach the sweep's two-strikes counter and its
        # rested-nameserver retry, both of which were source-only.
        flaky = {k.rstrip('.').lower(): list(v) for k, v in (cfg.get('flaky') or {}).items()}
        if server in flaky:
            with _LOCK:
                nth = st['dig_per_server'].get(server, 0) + 1
                st['dig_per_server'][server] = nth
                drop_it = nth in flaky[server]
                if drop_it:
                    st['dig_dropped'] += 1
            if drop_it:
                return answer('TIMEOUT')
        if server in dead:
            with _LOCK:
                st['dig_dead_queries'] += 1
            return answer('TIMEOUT')
        if server in ns:
            table = cfg.get('dig')
            if table is None:
                return answer('REFUSED')
            if name == dom:
                lab = '@'
            elif name.endswith('.' + dom):
                lab = name[:-(len(dom) + 1)]
            else:
                return answer('NXDOMAIN', aa=True)
            wc = cfg.get('wildcard')
            if lab not in table:
                if wc:
                    # A WILDCARD IS SYNTHESISED INTO THE ANSWER. The row that comes back is owned by the name that
                    # was ASKED FOR, never by `*`, and the name EXISTS for every type — so a query for a type the
                    # wildcard does not carry answers NOERROR with no data rather than NXDOMAIN. That is the shape
                    # that quietly turns the sweep's name-level NXDOMAIN shortcut off and still looks green.
                    rows = [{'name': name + '.', 'ttl': 3600, 'type': 'A', 'rdata': wc}] if qtype == 'A' else []
                    return answer('NOERROR', rows, aa=True)
                return answer('NXDOMAIN', aa=True)
            if lab == '*' and wc and qtype == 'A':
                # asking for the literal owner is the ONE query that reveals a wildcard, which is why the sweep's
                # candidate list carries '*'
                return answer('NOERROR', [{'name': '*.' + dom + '.', 'ttl': 3600, 'type': 'A', 'rdata': wc}], aa=True)
            return answer('NOERROR', [{'name': (r[3] if len(r) > 3 else name + '.'), 'ttl': r[1],
                                       'type': r[0], 'rdata': r[2]}
                                      for r in table[lab] if r[0] == qtype], aa=True)
        return answer('REFUSED')

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
        if cfg.get('empty'):
            recs = []                                  # the measured atlasglinn.com: the zone exists and holds nothing
        elif cfg.get('prefill') is not None:
            recs = [dict(r) for r in cfg['prefill']]   # a zone that has already been imported once
        else:
            recs = base_records(dom, mx=cfg.get('mx', CANARY_MX_M365),
                                tak=cfg['tak'] if 'tak' in cfg else TAK_IP,
                                www=cfg.get('www', True), apex=cfg.get('apex', True),
                                extra_mx=cfg.get('extra_mx'))
        recs += [dict(r) for r in st['imported']]
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
