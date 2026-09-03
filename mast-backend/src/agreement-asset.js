/**
 * The blank agreement PDF, bundled into the Worker as a Data module
 * (wrangler.toml: [[rules]] type = "Data" globs = ["**/*.pdf"]).
 *
 * Kept in its own module and imported dynamically from worker.js so the Node
 * test runner, which cannot import a .pdf, never has to load it.
 */
import agreementPdf from '../assets/class-participation-agreement.pdf';

export default agreementPdf;
