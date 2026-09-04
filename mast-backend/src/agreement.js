/**
 * Class Participation and Use of Property Agreement — PDF fill.
 *
 * The source PDF (assets/class-participation-agreement.pdf) is a scanned form with
 * 15 DocHub text fields and no signature field. This module fills the fields from
 * a registration, stamps the typed attestation on the signature line of page 3
 * (E-SIGN/UETA: typed name + UTC time + IP + agreement version), flattens the form
 * so the result cannot be edited, and returns the bytes.
 *
 * AGREEMENT_VERSION is the first 16 hex chars of the SHA-256 of the source PDF.
 * If the PDF changes, this constant changes, and every stored signature that
 * carries the old version stops counting as consent to the new terms.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const AGREEMENT_VERSION = '81961f2a07675eff';

/** DocHub field ids, mapped by page coordinates (ARCHITECTURE.md §4). */
export const FIELDS = {
  p1_name: 'dhFormfield-6088230960',
  p1_initials: 'dhFormfield-6088233145',
  p2_initials: 'dhFormfield-6088233457',
  date_day: 'dhFormfield-6088234140',
  date_month: 'dhFormfield-6107630987',
  date_year2: 'dhFormfield-6107639317',
  name: 'dhFormfield-6107632850',
  address1: 'dhFormfield-6107633604',
  address2: 'dhFormfield-6107633880',
  phone: 'dhFormfield-6107637887',
  email: 'dhFormfield-6107637899',
  emergency_name: 'dhFormfield-6107637940',
  emergency_phone: 'dhFormfield-6107648038',
  emergency_relationship: 'dhFormfield-6107650114',
  p3_initials: 'dhFormfield-6107651202',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Fill and flatten the agreement.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes  the blank agreement
 * @param {object} r  registration: customer_name, customer_email, customer_phone, address1, address2,
 *                    emergency_name, emergency_phone, emergency_relationship, agreement_signed_name,
 *                    agreement_initials, agreement_signed_at (ISO), agreement_ip, registration id
 * @returns {Promise<Uint8Array>}
 */
export async function fillAgreement(pdfBytes, r) {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const form = pdf.getForm();
  const signedAt = new Date(r.agreement_signed_at || Date.now());
  const initials = clip(r.agreement_initials, 6);
  const set = (key, value) => {
    try { form.getTextField(FIELDS[key]).setText(clip(value, 90)); }
    catch (e) { throw new Error('agreement field ' + key + ' (' + FIELDS[key] + '): ' + e.message); }
  };

  set('p1_name', r.agreement_signed_name || r.customer_name);
  set('p1_initials', initials);
  set('p2_initials', initials);
  set('p3_initials', initials);
  set('date_day', String(signedAt.getUTCDate()));
  set('date_month', MONTHS[signedAt.getUTCMonth()]);
  set('date_year2', String(signedAt.getUTCFullYear()).slice(-2));
  set('name', r.customer_name);
  set('address1', r.address1);
  set('address2', r.address2);
  set('phone', r.customer_phone);
  set('email', r.customer_email);
  set('emergency_name', r.emergency_name);
  set('emergency_phone', r.emergency_phone);
  set('emergency_relationship', r.emergency_relationship);

  // Typed attestation on the signature line of page 3 (the line runs x 72–334 pt at y ≈ 216 pt;
  // the evidence record sits to its right, where the page is blank).
  const page = pdf.getPage(2);
  const font = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const small = await pdf.embedFont(StandardFonts.Helvetica);
  const grey = rgb(0.3, 0.3, 0.3);
  page.drawText('/s/ ' + clip(r.agreement_signed_name || r.customer_name, 60), { x: 76, y: 221, size: 12, font, color: rgb(0.05, 0.1, 0.35) });
  page.drawText(
    'Signed electronically ' + signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' + (r.agreement_ip ? ' · IP ' + clip(r.agreement_ip, 45) : ''),
    { x: 344, y: 224, size: 6, font: small, color: grey }
  );
  page.drawText(
    'Agreement ' + AGREEMENT_VERSION + (r.id ? ' · ' + clip(String(r.id), 44) : ''),
    { x: 344, y: 215, size: 6, font: small, color: grey }
  );

  form.updateFieldAppearances(small);
  form.flatten();
  return pdf.save({ useObjectStreams: false });
}

function clip(v, n) {
  return (v === undefined || v === null ? '' : String(v)).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
}
