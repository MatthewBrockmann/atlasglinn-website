<?php
/**
 * Lead instructor bio.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

$mast_photo = apply_filters( 'mast_instructor_photo', 'https://atlasglinn.com/wp-content/uploads/2025/03/Matthew-Brockmann-Atlas-glenn-security-ceo-protection1-scaled-e1741887403903.jpeg' );

$mast_creds = array(
	sprintf( '%s <strong>%s</strong>%s', esc_html__( 'Has trained the', 'mast' ), esc_html__( 'U.S. Military, DEA, Houston SWAT', 'mast' ), esc_html__( ', high-risk warrant teams, and federal agencies', 'mast' ) ),
	sprintf( '%s <strong>%s</strong>', esc_html__( 'Trained alongside', 'mast' ), esc_html__( 'Navy SEALs, DELTA Force, Recon Marines, Special Forces, PJ Para Rescue', 'mast' ) ),
	sprintf( '<strong>%s</strong> %s', esc_html__( 'Former Head of Security & Dignitary Protection', 'mast' ), esc_html__( '— U.S. Senators Ted Cruz and Eric Schmitt', 'mast' ) ),
	sprintf( '<strong>%s</strong> %s', esc_html__( 'Law Enforcement Instructor', 'mast' ), esc_html__( '— Harris County Diplomatic Protection Unit', 'mast' ) ),
	esc_html__( 'Certified Firearms Instructor — civilians, law enforcement, and agencies', 'mast' ),
	esc_html__( 'Licensed PPO (TX) · PI License (TX) · Gracie Jiu-Jitsu practitioner', 'mast' ),
);
?>

<section class="mast-section instructor" id="instructor">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Lead Instructor', 'mast' ); ?></span>
		<div class="instructor-grid">
			<div class="instructor-photo">
				<img src="<?php echo esc_url( $mast_photo ); ?>" alt="<?php esc_attr_e( 'Matthew Brockmann, founder of MAST Solutions', 'mast' ); ?>" loading="lazy">
			</div>
			<div>
				<h2><?php esc_html_e( 'Matthew Brockmann', 'mast' ); ?></h2>
				<div class="role"><?php esc_html_e( 'Founder & Chief Training Officer', 'mast' ); ?></div>
				<p><?php esc_html_e( 'Over 34 years in security, training, and dignitary protection. Career began in 1991 at Gunsight under Cornel J. Cooper — and has since spanned federal tactical teams, protective details for United States Senators, and more than 700 professionals trained.', 'mast' ); ?></p>
				<div class="cred-grid">
					<?php foreach ( $mast_creds as $cred ) : ?>
						<div class="cred"><span><?php echo wp_kses( $cred, array( 'strong' => array() ) ); ?></span></div>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
	</div>
</section>
