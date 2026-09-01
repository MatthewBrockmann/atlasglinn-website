<?php
/**
 * MAST Solutions theme setup.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

define( 'MAST_VERSION', '1.0.0' );

/**
 * Default checkout Worker base URL.
 *
 * Override per-environment in wp-config.php:
 *   define( 'MAST_CHECKOUT_BASE', 'https://your-worker.workers.dev' );
 */
if ( ! defined( 'MAST_CHECKOUT_BASE' ) ) {
	define( 'MAST_CHECKOUT_BASE', 'https://mast-booking-backend.matthew-221.workers.dev' );
}

require_once get_template_directory() . '/inc/catalog.php';

/** Theme supports. */
function mast_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'custom-logo', array( 'height' => 76, 'width' => 300, 'flex-width' => true, 'flex-height' => true ) );
	register_nav_menus( array( 'primary' => __( 'Primary Menu', 'mast' ) ) );
}
add_action( 'after_setup_theme', 'mast_setup' );

/** Styles and scripts. */
function mast_assets() {
	wp_enqueue_style( 'mast-style', get_stylesheet_uri(), array(), MAST_VERSION );

	wp_enqueue_script( 'mast-checkout', get_template_directory_uri() . '/assets/js/checkout.js', array(), MAST_VERSION, true );
	wp_localize_script(
		'mast-checkout',
		'MAST',
		array(
			'storeEndpoint' => trailingslashit( MAST_CHECKOUT_BASE ) . 'create-booking',
			'subEndpoint'   => trailingslashit( MAST_CHECKOUT_BASE ) . 'create-membership',
			'returnUrl'     => home_url( '/' ),
			'phone'         => mast_contact( 'phone' ),
			'i18n'          => array(
				'badEmail'  => __( 'Enter a valid email address to receive your booking confirmation.', 'mast' ),
				'preparing' => __( 'Preparing secure checkout…', 'mast' ),
				'continue'  => __( 'Continue to Secure Checkout', 'mast' ),
				'failed'    => __( 'Could not start checkout', 'mast' ),
				'booked'    => __( "You're booked", 'mast' ),
				'receipt'   => __( 'Check your email for your receipt — gear list and range details follow shortly.', 'mast' ),
				'cancelled' => __( 'Checkout cancelled — your card was not charged.', 'mast' ),
			),
		)
	);
}
add_action( 'wp_enqueue_scripts', 'mast_assets' );

/**
 * Single source of truth for contact details.
 *
 * Filterable so a child theme or plugin can override without editing templates:
 *   add_filter( 'mast_contact', fn( $v, $key ) => 'phone' === $key ? '(281) 555-0000' : $v, 10, 2 );
 *
 * @param string $key One of phone, phone_href, email, address, city_state_zip.
 * @return string
 */
function mast_contact( $key ) {
	$values = array(
		'phone'          => '(281) 654-8100',
		'phone_href'     => 'tel:+12816548100',
		'email'          => 'atlasglinn.hq@atlasglinn.com',
		'address'        => '2450 Fondren Rd, Suite 255',
		'city_state_zip' => 'Houston, TX 77063',
	);
	$value = isset( $values[ $key ] ) ? $values[ $key ] : '';
	return apply_filters( 'mast_contact', $value, $key );
}

/** Social profile links used in the footer and schema. */
function mast_socials() {
	return apply_filters(
		'mast_socials',
		array(
			'Instagram' => 'https://www.instagram.com/atlasglinn_mastsolutions/',
			'Facebook'  => 'https://www.facebook.com/mastsolutions',
			'LinkedIn'  => 'https://www.linkedin.com/in/mastsolutions1/',
			'Yelp'      => 'https://www.yelp.com/biz/mast-solutions-houston',
		)
	);
}

/** LocalBusiness structured data. */
function mast_schema() {
	if ( ! is_front_page() ) {
		return;
	}
	$schema = array(
		'@context'         => 'https://schema.org',
		'@type'            => 'LocalBusiness',
		'name'             => 'MAST Solutions',
		'alternateName'    => 'Modern Application of Shooting and Tactics',
		'description'      => 'Tactical training company in Houston, TX since 2005 — firearms, hand combat, CQB, medical, and leadership training for military, law enforcement, and private citizens.',
		'parentOrganization' => array( '@type' => 'Organization', 'name' => 'Atlas Glinn, LLC' ),
		'foundingDate'     => '2005',
		'address'          => array(
			'@type'           => 'PostalAddress',
			'streetAddress'   => mast_contact( 'address' ),
			'addressLocality' => 'Houston',
			'addressRegion'   => 'TX',
			'postalCode'      => '77063',
			'addressCountry'  => 'US',
		),
		'telephone'        => '+1-281-654-8100',
		'url'              => home_url( '/' ),
		'sameAs'           => array_values( mast_socials() ),
	);
	echo '<script type="application/ld+json">' . wp_json_encode( $schema ) . '</script>' . "\n";
}
add_action( 'wp_head', 'mast_schema' );

/** Admin list columns so prices are visible at a glance. */
function mast_class_columns( $columns ) {
	$columns['mast_price'] = __( 'Price', 'mast' );
	$columns['mast_sku']   = __( 'SKU', 'mast' );
	return $columns;
}
add_filter( 'manage_mast_class_posts_columns', 'mast_class_columns' );

function mast_membership_columns( $columns ) {
	$columns['mast_price'] = __( 'Price', 'mast' );
	$columns['mast_plan']  = __( 'Stripe plan key', 'mast' );
	return $columns;
}
add_filter( 'manage_mast_membership_posts_columns', 'mast_membership_columns' );

function mast_render_columns( $column, $post_id ) {
	switch ( $column ) {
		case 'mast_price':
			$cents = (int) get_post_meta( $post_id, '_mast_price_cents', true );
			echo $cents ? esc_html( mast_price( $cents ) ) : '<span style="color:#c00">' . esc_html__( 'not set', 'mast' ) . '</span>';
			break;
		case 'mast_sku':
			echo esc_html( get_post_meta( $post_id, '_mast_sku', true ) );
			break;
		case 'mast_plan':
			$plan = get_post_meta( $post_id, '_mast_plan_key', true );
			echo $plan ? '<code>' . esc_html( $plan ) . '</code>' : '<span style="color:#c00">' . esc_html__( 'not set', 'mast' ) . '</span>';
			break;
	}
}
add_action( 'manage_mast_class_posts_custom_column', 'mast_render_columns', 10, 2 );
add_action( 'manage_mast_membership_posts_custom_column', 'mast_render_columns', 10, 2 );

/**
 * Warn in wp-admin when a published offering has no price — that offering
 * cannot be purchased, and a silent zero-price card is worse than a notice.
 */
function mast_price_notice() {
	$screen = get_current_screen();
	if ( ! $screen || 'dashboard' !== $screen->id ) {
		return;
	}

	$missing = get_posts(
		array(
			'post_type'   => array( 'mast_class', 'mast_membership' ),
			'post_status' => 'publish',
			'numberposts' => 5,
			'fields'      => 'ids',
			'meta_query'  => array(
				'relation' => 'OR',
				array( 'key' => '_mast_price_cents', 'compare' => 'NOT EXISTS' ),
				array( 'key' => '_mast_price_cents', 'value' => 0, 'compare' => '=' ),
			),
		)
	);

	if ( empty( $missing ) ) {
		return;
	}

	echo '<div class="notice notice-warning"><p><strong>' . esc_html__( 'MAST:', 'mast' ) . '</strong> ';
	echo esc_html( sprintf( /* translators: %d: number of offerings */ __( '%d published offering(s) have no price set and cannot be purchased:', 'mast' ), count( $missing ) ) ) . ' ';
	$links = array();
	foreach ( $missing as $id ) {
		$links[] = '<a href="' . esc_url( get_edit_post_link( $id ) ) . '">' . esc_html( get_the_title( $id ) ) . '</a>';
	}
	echo wp_kses_post( implode( ', ', $links ) ) . '</p></div>';
}
add_action( 'admin_notices', 'mast_price_notice' );
