<?php
/**
 * Reviews. Filterable so testimonials can be managed elsewhere if needed.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_reviews = apply_filters(
	'mast_reviews',
	array(
		array(
			'quote' => __( 'I trained with Matt & the team at MAST Solutions for over a year. The techniques, skills & mentality I learned in the first class were well more advanced.', 'mast' ),
			'who'   => 'Brian S.',
			'role'  => __( 'IRC & MBA', 'mast' ),
		),
		array(
			'quote' => __( 'Simply THE BEST hands on tactical training you can find local to Houston, TX.', 'mast' ),
			'who'   => 'Guadalupe A.',
			'role'  => __( 'Power Testing Specialist', 'mast' ),
		),
		array(
			'quote' => __( 'His leadership, dedication, drive, and passion is second to none. A master at teamwork, problem-solving, leadership, and communication.', 'mast' ),
			'who'   => 'Ray Cash Care',
			'role'  => __( 'Navy SEAL / Former CIA', 'mast' ),
		),
		array(
			'quote' => __( "As a former Reconnaissance Marine, Matthew's teaching has not only made me a better shooter, he has made me a better team player.", 'mast' ),
			'who'   => 'Arthur Metcalfe',
			'role'  => __( 'Recon Marine, 18yr O&G', 'mast' ),
		),
		array(
			'quote' => __( 'Matthew is an expert in his field. He is highly motivated, knowledgeable and I highly recommend him for top-tier performance.', 'mast' ),
			'who'   => 'Kenny Upton',
			'role'  => __( 'Deputy, Harris County Sheriff', 'mast' ),
		),
		array(
			'quote' => __( "Brockmann had hosted and taught some of the best classes I have been a part of. I can't recommend him enough.", 'mast' ),
			'who'   => 'William H. Miller',
			'role'  => __( 'BS, TP-C, FP-C, CPM — Flight Paramedic', 'mast' ),
		),
	)
);
?>

<section class="mast-section reviews" id="reviews">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Reviews', 'mast' ); ?></span>
		<div class="reviews-head">
			<h2 class="section-title" style="margin-bottom:0;"><?php esc_html_e( 'Trained. Tested. Recommended.', 'mast' ); ?></h2>
			<span class="score-badge"><span class="stars">★★★★★</span> <?php esc_html_e( '5.0 on Google', 'mast' ); ?></span>
		</div>
		<div class="reviews-grid">
			<?php foreach ( $mast_reviews as $r ) : ?>
				<div class="review">
					<p>&ldquo;<?php echo esc_html( $r['quote'] ); ?>&rdquo;</p>
					<div class="who"><strong><?php echo esc_html( $r['who'] ); ?></strong><?php echo esc_html( $r['role'] ); ?></div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
