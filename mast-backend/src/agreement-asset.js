/**
 * The blank agreement PDF, bundled into the Worker as a Data module: wrangler.toml
 * declares a [[rules]] entry of type "Data" for every .pdf under the project.
 * (Never write the glob itself in a block comment: its star-slash ends the comment.)
 *
 * Kept in its own module and imported dynamically from worker.js so the Node
 * test runner, which cannot import a .pdf, never has to load it.
 */
import agreementPdf from '../assets/class-participation-agreement.pdf';

export default agreementPdf;
