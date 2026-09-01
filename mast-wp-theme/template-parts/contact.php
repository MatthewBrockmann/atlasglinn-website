<?php
/**
 * Closing CTA band with contact details.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;
?>

<section class="mast-section cta-band" id="contact">
	<div class="container">
		<h2><?php esc_html_e( 'Ready to train?', 'mast' ); ?></h2>
		<p><?php esc_html_e( 'Individual seats, team blocks, and agency instruction. Houston, TX.', 'mast' ); ?></p>
		<div class="cta-actions">
			<a href="#classes" class="btn btn-primary"><?php esc_html_e( 'Book a Class', 'mast' ); ?></a>
			<a href="mailto:<?php echo esc_attr( mast_contact( 'email' ) ); ?>" class="btn btn-dark-outline"><?php esc_html_e( 'Email Us', 'mast' ); ?></a>
		</div>
		<div class="cta-contact">
			<span><?php echo esc_html( mast_contact( 'address' ) . ', ' . mast_contact( 'city_state_zip' ) ); ?></span>
			<a href="<?php echo esc_url( mast_contact( 'phone_href' ) ); ?>"><?php echo esc_html( mast_contact( 'phone' ) ); ?></a>
			<a href="mailto:<?php echo esc_attr( mast_contact( 'email' ) ); ?>"><?php echo esc_html( mast_contact( 'email' ) ); ?></a>
		</div>
	</div>
</section>
