#!/usr/bin/env python3
"""Generate MAST training weekends.

The owner's rule: 2nd and 4th weekends of each month, plus the 5th when one
exists. September 2026 uses the last weekend. Emits SQL for training_weekends.

    python3 weekends.py                 # the current schedule
    python3 weekends.py 2027 5 2028 4   # a new range, 2nd/4th/5th throughout
"""
import calendar, sys
from datetime import timedelta


def saturdays(y, m):
    c = calendar.Calendar()
    return [d for d in c.itermonthdates(y, m) if d.month == m and d.weekday() == 5]


def weekends_for(y, m, which=(2, 4), include_fifth=True):
    sats = saturdays(y, m)
    out = []
    for n in which:
        pick = sats[-1] if n == -1 else (sats[n - 1] if n - 1 < len(sats) else None)
        if pick:
            out.append((n, pick))
    if include_fifth and len(sats) >= 5 and sats[4] not in [d for _, d in out]:
        out.append((5, sats[4]))
    return sorted(out, key=lambda t: t[1])


def ordinal(n):
    return {1: "1st", 2: "2nd", 3: "3rd", -1: "last"}.get(n, f"{n}th")


def emit(plan):
    print("INSERT OR IGNORE INTO training_weekends (saturday, sunday, label, note) VALUES")
    rows = []
    for y, m, which in plan:
        for n, sat in weekends_for(y, m, which):
            sun = sat + timedelta(days=1)
            label = f"{calendar.month_name[m]} — {ordinal(n)} weekend"
            note = "NULL"
            if sun.month != sat.month:
                note = "'Weekend straddles the month boundary — confirm before scheduling a 2-day class.'"
            rows.append(f"  ('{sat}','{sun}','{label}', {note})")
    print(",\n".join(rows) + ";")


if __name__ == "__main__":
    if len(sys.argv) == 5:
        y1, m1, y2, m2 = map(int, sys.argv[1:])
        plan, y, m = [], y1, m1
        while (y, m) <= (y2, m2):
            plan.append((y, m, (2, 4)))
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    else:
        plan = [(2026, 9, (-1,)), (2026, 10, (2, 4)), (2026, 11, (2,)), (2026, 12, (2,)),
                (2027, 1, (2, 4)), (2027, 2, (2, 4)), (2027, 3, (2, 4)), (2027, 4, (2, 4))]
    emit(plan)
