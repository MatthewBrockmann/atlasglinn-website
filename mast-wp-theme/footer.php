<?php
/**
 * Site footer and the checkout sheet markup.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;
?>

<footer class="site-footer">
	<div class="container foot">
		<div class="brand-line">MAST<em>SOLUTIONS</em> — <?php esc_html_e( 'Modern Application of Shooting and Tactics', 'mast' ); ?></div>
		<nav aria-label="<?php esc_attr_e( 'Footer', 'mast' ); ?>">
			<?php foreach ( mast_socials() as $label => $url ) : ?>
				<a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $label ); ?></a>
			<?php endforeach; ?>
		</nav>
		<div class="division">
			<?php
			printf(
				/* translators: %1$s: year, %2$s: Atlas Glinn link */
				esc_html__( '© %1$s MAST Solutions · A division of %2$s', 'mast' ),
				esc_html( gmdate( 'Y' ) ),
				'<a href="https://www.atlasglinn.com" target="_blank" rel="noopener">Atlas Glinn, LLC</a>'
			);
			?>
		</div>
	</div>
</footer>

<!-- Checkout sheet: modal on desktop, bottom sheet on mobile -->
<div id="mast-sheet-backdrop" class="sheet-backdrop" data-mast-close></div>
<div id="mast-sheet" class="sheet" role="dialog" aria-modal="true" aria-labelledby="mast-sheet-title">
	<button class="sheet-close" aria-label="<?php esc_attr_e( 'Close checkout', 'mast' ); ?>" data-mast-close>&times;</button>
	<h3 id="mast-sheet-title"></h3>
	<div class="sheet-meta"><span data-mast-meta></span> · <span class="sheet-price" data-mast-unit></span></div>

	<label for="mast-email"><?php esc_html_e( 'Email', 'mast' ); ?></label>
	<input type="email" id="mast-email" placeholder="you@example.com" autocomplete="email" inputmode="email" required>

	<label for="mast-name"><?php esc_html_e( 'Name', 'mast' ); ?> <span style="color:var(--ink-2);font-weight:400;"><?php esc_html_e( '(optional)', 'mast' ); ?></span></label>
	<input type="text" id="mast-name" placeholder="First Last" autocomplete="name">

	<div data-mast-qty-wrap>
		<label><?php esc_html_e( 'Seats', 'mast' ); ?></label>
		<div class="qty-row">
			<button type="button" aria-label="<?php esc_attr_e( 'Fewer seats', 'mast' ); ?>" data-mast-step="-1">&minus;</button>
			<span class="qty" data-mast-qty>1</span>
			<button type="button" aria-label="<?php esc_attr_e( 'More seats', 'mast' ); ?>" data-mast-step="1">+</button>
		</div>
	</div>

	<div class="total-row"><span data-mast-total-label><?php esc_html_e( 'Total', 'mast' ); ?></span><span class="amt" data-mast-total></span></div>

	<button class="btn btn-primary" data-mast-pay><?php esc_html_e( 'Continue to Secure Checkout', 'mast' ); ?></button>
	<div class="secure">🔒 <?php esc_html_e( "Payments processed by Stripe. You'll receive a receipt by email.", 'mast' ); ?></div>
	<div class="err" data-mast-err></div>
</div>

<?php wp_footer(); ?>
</body>
</html>
