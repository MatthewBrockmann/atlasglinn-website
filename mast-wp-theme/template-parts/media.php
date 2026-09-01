<?php
/**
 * Featured media — Modern Shooter TV embeds and the Washington Post feature.
 *
 * Video IDs and the press link are filterable so they can be swapped without
 * editing the template.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_videos = apply_filters(
	'mast_videos',
	array(
		array(
			'id'    => 'pSGWdaDglZE',
			'title' => __( 'Modern Shooter TV', 'mast' ),
			'cap'   => __( 'Lance M / Castro / Ray Cash — MAST Solutions', 'mast' ),
		),
		array(
			'id'    => 'OfXe_bdH6t4',
			'title' => __( 'Modern Shooter TV', 'mast' ),
			'cap'   => __( 'Tactical Training Feature', 'mast' ),
		),
	)
);

$mast_press_url = apply_filters( 'mast_press_url', 'https://www.washingtonpost.com/graphics/2018/national/amp-stories/arming-american-teachers/' );

$mast_press_outlets = array(
	__( 'Modern Shooter TV', 'mast' ),
	__( 'The Washington Post', 'mast' ),
	__( 'Gun Digest', 'mast' ),
	__( 'The Houstonian', 'mast' ),
);
?>

<section class="mast-section" id="media">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Featured Media', 'mast' ); ?></span>
		<h2 class="section-title"><?php esc_html_e( 'As seen on.', 'mast' ); ?></h2>

		<div class="media-grid">
			<?php foreach ( $mast_videos as $v ) : ?>
				<div class="media-card">
					<iframe
						src="<?php echo esc_url( 'https://www.youtube.com/embed/' . $v['id'] . '?rel=0&modestbranding=1' ); ?>"
						title="<?php echo esc_attr( $v['title'] . ' — ' . $v['cap'] ); ?>"
						loading="lazy"
						allow="accelerometer;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
						allowfullscreen></iframe>
					<div class="cap">
						<strong><?php echo esc_html( $v['title'] ); ?></strong>
						<?php echo esc_html( $v['cap'] ); ?>
					</div>
				</div>
			<?php endforeach; ?>
		</div>

		<div class="press-row">
			<?php foreach ( $mast_press_outlets as $outlet ) : ?>
				<span><?php echo esc_html( $outlet ); ?></span>
			<?php endforeach; ?>
		</div>

		<a class="wapo-link" href="<?php echo esc_url( $mast_press_url ); ?>" target="_blank" rel="noopener">
			<?php esc_html_e( 'Read the Washington Post feature on our active-shooter preparedness training →', 'mast' ); ?>
		</a>
	</div>
</section>
