<?php
/**
 * Seven core skills band.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_skills = array(
	__( 'Firearms', 'mast' ),
	__( 'Hand Combat', 'mast' ),
	__( 'Knife Combat', 'mast' ),
	__( 'CQB', 'mast' ),
	__( 'Fitness', 'mast' ),
	__( 'Medical', 'mast' ),
	__( 'Leadership', 'mast' ),
);
?>

<section class="mast-section skills-band" id="skills">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'The Curriculum', 'mast' ); ?></span>
		<h2 class="section-title"><?php esc_html_e( 'One standard. Seven skills.', 'mast' ); ?></h2>
		<p class="section-sub"><?php esc_html_e( 'Every MAST program is built from the same seven pillars — measured against a selection baseline, planned to an operations-order standard, with four layers of redundancy in every plan.', 'mast' ); ?></p>
		<div class="skills-row">
			<?php foreach ( $mast_skills as $i => $skill ) : ?>
				<div class="skill">
					<div class="n"><?php echo esc_html( str_pad( (string) ( $i + 1 ), 2, '0', STR_PAD_LEFT ) ); ?></div>
					<div class="t"><?php echo esc_html( $skill ); ?></div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
