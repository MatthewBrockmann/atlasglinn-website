<?php
/**
 * Hero + trust strip.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;
?>

<section class="hero" id="top">
	<div class="container">
		<div class="hero-kicker"><?php esc_html_e( 'Tactical Training · Houston, TX', 'mast' ); ?></div>
		<h1><?php esc_html_e( 'MAST Solutions', 'mast' ); ?></h1>
		<div class="meaning"><?php esc_html_e( 'Modern Application of Shooting and Tactics', 'mast' ); ?></div>
		<p class="lede">
			<?php esc_html_e( 'Real curriculum taught by operators — firearms, CQB, medical, and leadership. From federal tactical teams to first-time shooters.', 'mast' ); ?>
			<strong><?php esc_html_e( "Train until you can't get it wrong.", 'mast' ); ?></strong>
		</p>
		<div class="hero-actions">
			<a href="#classes" class="btn btn-primary"><?php esc_html_e( 'Browse Classes', 'mast' ); ?></a>
			<a href="<?php echo esc_url( mast_contact( 'phone_href' ) ); ?>" class="btn btn-dark-outline">
				<?php echo esc_html( sprintf( /* translators: %s: phone number */ __( 'Call %s', 'mast' ), mast_contact( 'phone' ) ) ); ?>
			</a>
		</div>
		<div class="hero-stats">
			<div><div class="num">2005</div><div class="lbl"><?php esc_html_e( 'Training since', 'mast' ); ?></div></div>
			<div><div class="num">7</div><div class="lbl"><?php esc_html_e( 'Core skills', 'mast' ); ?></div></div>
			<div><div class="num">700+</div><div class="lbl"><?php esc_html_e( 'Professionals trained', 'mast' ); ?></div></div>
			<div><div class="num">5.0★</div><div class="lbl"><?php esc_html_e( 'Google rating', 'mast' ); ?></div></div>
		</div>
	</div>
</section>

<div class="trust">
	<div class="container trust-inner">
		<span><?php esc_html_e( 'U.S. Military', 'mast' ); ?></span>
		<span><?php esc_html_e( 'DEA', 'mast' ); ?></span>
		<span><?php esc_html_e( 'Houston SWAT', 'mast' ); ?></span>
		<span><?php esc_html_e( 'High-Risk Warrant Teams', 'mast' ); ?></span>
		<span><?php esc_html_e( 'Federal Agencies', 'mast' ); ?></span>
		<span><?php esc_html_e( 'Private Citizens', 'mast' ); ?></span>
	</div>
</div>
