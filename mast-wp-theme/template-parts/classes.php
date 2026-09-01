<?php
/**
 * Class catalog with one-time Stripe checkout.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_classes = mast_get_classes();
?>

<section class="mast-section" id="classes">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Class Catalog', 'mast' ); ?></span>
		<h2 class="section-title"><?php esc_html_e( 'Book your seat in three clicks.', 'mast' ); ?></h2>
		<p class="section-sub"><?php esc_html_e( 'Pick a class, enter your email, pay securely with Stripe. Private and team instruction available on request.', 'mast' ); ?></p>

		<?php if ( empty( $mast_classes ) ) : ?>
			<p class="empty-note"><?php esc_html_e( 'No classes are published yet. Add them under Classes in the WordPress admin.', 'mast' ); ?></p>
		<?php else : ?>
			<div class="classes-grid">
				<?php foreach ( $mast_classes as $c ) : ?>
					<?php $mast_price_cents = (int) $c['price']; ?>
					<article class="class-card">
						<?php if ( ! empty( $c['cat'] ) ) : ?>
							<span class="chip"><?php echo esc_html( $c['cat'] ); ?></span>
						<?php endif; ?>
						<h3><?php echo esc_html( $c['title'] ); ?></h3>
						<?php if ( ! empty( $c['meta'] ) ) : ?>
							<div class="meta"><?php echo esc_html( $c['meta'] ); ?></div>
						<?php endif; ?>
						<p class="desc"><?php echo esc_html( $c['desc'] ); ?></p>
						<div class="row">
							<div class="price">
								<?php echo esc_html( mast_price( $mast_price_cents ) ); ?>
								<small><?php esc_html_e( 'per seat', 'mast' ); ?></small>
							</div>
							<?php if ( $mast_price_cents > 0 ) : ?>
								<button class="btn btn-primary"
									data-mast-buy
									data-mode="payment"
									data-name="<?php echo esc_attr( $c['title'] ); ?>"
									data-meta="<?php echo esc_attr( $c['meta'] ); ?>"
									data-price="<?php echo esc_attr( $mast_price_cents ); ?>"
									data-sku="<?php echo esc_attr( $c['sku'] ); ?>">
									<?php esc_html_e( 'Enroll', 'mast' ); ?>
								</button>
							<?php else : ?>
								<a href="mailto:<?php echo esc_attr( mast_contact( 'email' ) ); ?>?subject=<?php echo rawurlencode( $c['title'] ); ?>" class="btn btn-outline"><?php esc_html_e( 'Enquire', 'mast' ); ?></a>
							<?php endif; ?>
						</div>
					</article>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>

		<p class="class-note">
			<?php esc_html_e( 'Range fees, gear lists, and prerequisites are confirmed by email after booking. Questions first?', 'mast' ); ?>
			<a href="mailto:<?php echo esc_attr( mast_contact( 'email' ) ); ?>"><?php esc_html_e( 'Email us', 'mast' ); ?></a>
			<?php esc_html_e( 'or call', 'mast' ); ?>
			<a href="<?php echo esc_url( mast_contact( 'phone_href' ) ); ?>"><?php echo esc_html( mast_contact( 'phone' ) ); ?></a>.
		</p>
	</div>
</section>
