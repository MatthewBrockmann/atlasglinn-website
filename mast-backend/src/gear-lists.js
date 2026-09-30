/**
 * The gear list for each course, in the owner's words (2026-09-30, supplied for the courses on the schedule). One table,
 * read by the paid booking confirmation (worker.js) and by the T−7 and T−1 emails (crm.js), so the list a student is
 * promised and the list a student is sent cannot differ. The text is his, verbatim; only whitespace was normalised.
 * The numbers are not stored: gearListLines() writes "1. " … in front of each item, which reproduces his list exactly.
 *
 * A course with no entry gets GEAR_LIST_FALLBACK, never a promise that a list is on its way. Every email these feed is
 * plain text, so there is no markup here to escape; an HTML part would have to escape it.
 */
export const GEAR_LISTS = Object.freeze({
  'MAST-HG-FUND': Object.freeze({
    course: 'Handgun Fundamentals',
    items: Object.freeze([
      'Handgun.',
      'Eye and ear protection (electronic ears recommended)',
      'Ammunition: 300 rounds of factory ammunition',
      'Proper holster for secondary (holster should be snug to your waistline), molded to fit the pistol.',
      '3-4 magazines and a magazine carrier if you have one.',
    ]),
    note: 'We also recommend packing a cleaning kit for weapons maintenance and wearing comfortable clothes. Bring lunch and enough water for the day; or, if you prefer, we will break for lunch, and there are BBQ joints, Subway, and other options. Sunscreen, wet wipes, and other comfort items are your friends. Pen and paper for notes',
  }),
  'MAST-CAR-FUND': Object.freeze({
    course: 'Carbine Fundamentals',
    items: Object.freeze([
      'Primary (rifle)',
      'Secondary (handgun)',
      'Eye protection and hearing protection (electronic preferred)',
      'Proper holster for secondary (holster should be snug to your waistline), molded to fit the pistol.',
      "Ammunition: 450 rds primary and 250 rounds secondary, if you're bringing a pistol.",
      '4 magazines for primary and 3 mags for secondary',
      'Magazine carrier, can be a chest rig, belt setup, cargo pockets, or other pockets.',
    ]),
    note: 'We also recommend packing a cleaning kit for weapons maintenance and wearing comfortable clothes. Bring lunch and enough water for the day; or, if you prefer, we will break for lunch, and there are BBQ joints, Subway, and other options. Sunscreen, wet wipes, and other comfort items are your friends. Pen and paper for notes.',
  }),
});

export const GEAR_LIST_FALLBACK = 'Your instructor will confirm the gear list before class.';

/** The plain-text block for a course: a heading, the numbered list and his closing note — or null when there is none. */
export function gearListLines(sku) {
  const g = Object.prototype.hasOwnProperty.call(GEAR_LISTS, String(sku)) ? GEAR_LISTS[sku] : null;
  if (!g) return null;
  return ['GEAR LIST — ' + g.course, ...g.items.map((item, i) => (i + 1) + '. ' + item), '', g.note];
}
