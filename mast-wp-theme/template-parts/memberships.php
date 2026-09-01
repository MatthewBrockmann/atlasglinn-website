<?php
/**
 * Membership tiers with recurring Stripe checkout.
 *
 * Renders nothing until at least one Membership is published, so the site
 * never advertises a plan that does not exist.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_tiers = mast_get_memberships();

if ( empty( $mast_tiers ) ) {
	return;
}

$mast_intervals = array(
	'month'   => __( 'per month', 'mast' ),
	'year'    => __( 'per year', 'mast' ),
	'quarter' => __( 'per quarter', 'mast' ),
);
?>

<section class="mast-section memberships" id="memberships">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Memberships', 'mast' ); ?></span>
		<h2 class="section-title"><?php esc_html_e( 'Train on a schedule, not a whim.', 'mast' ); ?></h2>
		<p class="section-sub"><?php esc_html_e( 'Recurring membership plans. Cancel anytime — billing is handled securely by Stripe.', 'mast' ); ?></p>

		<div class="tiers-grid">
			<?php foreach ( $mast_tiers as $t ) : ?>
				<?php
				$mast_interval_label = isset( $mast_intervals[ $t['interval'] ] ) ? $mast_intervals[ $t['interval'] ] : $t['interval'];
				$mast_purchasable    = ! empty( $t['plan'] ) && (int) $t['price'] > 0;
				?>
				<article class="tier<?php echo $t['featured'] ? ' featured' : ''; ?>">
					<?php if ( $t['featured'] ) : ?>
						<span class="badge"><?php esc_html_e( 'Most Popular', 'mast' ); ?></span>
					<?php endif; ?>
					<h3><?php echo esc_html( $t['title'] ); ?></h3>
					<div class="tier-price">
						<?php echo esc_html( mast_price( $t['price'] ) ); ?>
						<span><?php echo esc_html( $mast_interval_label ); ?></span>
					</div>
					<?php if ( ! empty( $t['desc'] ) ) : ?>
						<p class="tier-desc"><?php echo esc_html( $t['desc'] ); ?></p>
					<?php endif; ?>
					<?php if ( ! empty( $t['features'] ) ) : ?>
						<ul>
							<?php foreach ( $t['features'] as $f ) : ?>
								<li><?php echo esc_html( $f ); ?></li>
							<?php endforeach; ?>
						</ul>
					<?php endif; ?>

					<?php if ( $mast_purchasable ) : ?>
						<button class="btn btn-primary"
							data-mast-buy
							data-mode="subscription"
							data-name="<?php echo esc_attr( $t['title'] ); ?>"
							data-meta="<?php echo esc_attr( $mast_interval_label ); ?>"
							data-price="<?php echo esc_attr( (int) $t['price'] ); ?>"
							data-plan="<?php echo esc_attr( $t['plan'] ); ?>">
							<?php esc_html_e( 'Join', 'mast' ); ?>
						</button>
					<?php else : ?>
						<a href="mailto:<?php echo esc_attr( mast_contact( 'email' ) ); ?>?subject=<?php echo rawurlencode( $t['title'] ); ?>" class="btn btn-outline"><?php esc_html_e( 'Contact Us', 'mast' ); ?></a>
					<?php endif; ?>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>
