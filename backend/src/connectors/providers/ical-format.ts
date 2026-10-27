/**
 * Minimal RFC 5545 (iCalendar) subset: just enough to read/write the VEVENT
 * fields a booking-block calendar needs (UID, DTSTART, DTEND, SUMMARY). No
 * external dependency — the format used here is deliberately small (date-only
 * all-day blocks, no recurrence, no timezone components) because that's what
 * every OTA/PMS "export your calendar as iCal" feature actually produces.
 */

export interface IcsEvent {
  uid: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  start: string;
  /** ISO date (YYYY-MM-DD), exclusive (RFC 5545 DTEND semantics for all-day events). */
  end: string;
  summary: string;
}

function unescapeIcsText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function toIsoDate(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Parse every VEVENT in a raw .ics document. Unknown/malformed events are skipped. */
export function parseIcs(text: string): IcsEvent[] {
  // RFC 5545 line folding: a continuation line starts with a single space or tab.
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);

  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start && cur.end) {
        events.push({ uid: cur.uid, start: cur.start, end: cur.end, summary: cur.summary ?? 'Booked' });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);

    if (key === 'UID') cur.uid = value;
    else if (key === 'DTSTART') cur.start = toIsoDate(value);
    else if (key === 'DTEND') cur.end = toIsoDate(value);
    else if (key === 'SUMMARY') cur.summary = unescapeIcsText(value);
  }

  return events;
}

/** Build a complete .ics document from a list of all-day blocking events. */
export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const asIcsDate = (iso: string) => iso.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChannelManager//EN',
    `X-WR-CALNAME:${esc(calendarName)}`,
    'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${esc(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${asIcsDate(e.start)}`,
      `DTEND;VALUE=DATE:${asIcsDate(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
