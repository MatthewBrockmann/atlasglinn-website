#!/usr/bin/env python3
"""A stub `dig` for scripts/tests/cf-zone-test.sh, driven by scripts/tests/cf-zone-emu.py.

The import mode of .github/workflows/cf-zone-atlasglinn.yml reads the domain's records out of its own authoritative
nameservers with dig, so the harness cannot prove a single one of that mode's branches without a dig it controls. This
is that dig: it parses the same argument shape the workflow uses, asks the emulator's /_dig route what the scenario
says the answer is, and prints the real dig ANSWER-SECTION shape so the workflow's own parser reads it unchanged.

    dig +time=5 +tries=1 +nocmd +noall +comments +answer +norecurse @<server> <name> <TYPE>

The harness puts a 2-line wrapper named `dig` on PATH ahead of everything else, so the workflow's `command -v dig`
limb finds this and never reaches apt-get. It NEVER touches the network: with no $CF_API_BASE it exits 9 rather than
resolving anything, and $CF_API_BASE always points at 127.0.0.1 under the harness.

TIMEOUT is a first-class answer, not an error case to skip: real dig exits 9 when no server answers, and the
workflow's nameserver failover and its refusal-on-a-partial-sweep limb are both driven by exactly that.
"""
import json
import os
import sys
from urllib.parse import urlencode
from urllib.request import urlopen

TYPES = ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'DS', 'SOA', 'PTR')


def main():
    args = sys.argv[1:]
    if '-v' in args:
        sys.stdout.write('DiG 9.99.9-STUB\n')
        return 0
    server, pos = None, []
    for a in args:
        if a.startswith('@'):
            server = a[1:]
        elif a.startswith('+') or a.startswith('-'):
            continue
        else:
            pos.append(a)
    if not server or len(pos) < 2:
        sys.stderr.write(';; cf-zone-dig-stub: expected @server <name> <TYPE>\n')
        return 9
    name, qtype = pos[0], pos[1].upper()
    if qtype not in TYPES:
        sys.stderr.write(';; cf-zone-dig-stub: unknown query type %s\n' % qtype)
        return 9
    base = os.environ.get('CF_API_BASE')
    if not base:
        sys.stderr.write(';; cf-zone-dig-stub: no $CF_API_BASE — this stub answers only from the emulator and '
                         'never reaches the network\n')
        return 9
    url = base.rstrip('/') + '/_dig?' + urlencode({'server': server, 'name': name, 'type': qtype,
                                                   'norec': '1' if '+norecurse' in args else '0'})
    try:
        d = json.loads(urlopen(url, timeout=10).read().decode('utf-8'))
    except Exception as exc:
        sys.stderr.write(';; cf-zone-dig-stub: %s asking the emulator\n' % exc.__class__.__name__)
        return 9
    status = d.get('status') or 'SERVFAIL'
    if status == 'TIMEOUT':
        # real dig's exit code when no server answered; the workflow reads the empty stdout, not this code
        sys.stderr.write(';; connection timed out; no servers could be reached\n')
        return 9
    answers = d.get('answers') or []
    out = [';; ->>HEADER<<- opcode: QUERY, status: %s, id: 1' % status,
           ';; flags: %s; QUERY: 1, ANSWER: %d, AUTHORITY: 0, ADDITIONAL: 0'
           % ('qr aa' if d.get('aa') else 'qr', len(answers))]
    if answers:
        out.append(';; ANSWER SECTION:')
        for a in answers:
            out.append('%s\t%s\tIN\t%s\t%s' % (a.get('name'), a.get('ttl'), a.get('type'), a.get('rdata')))
    sys.stdout.write('\n'.join(out) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
