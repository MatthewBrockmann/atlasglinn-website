<?php
/**
 * Class + Membership catalog.
 *
 * Registers two custom post types so staff can edit offerings from wp-admin
 * without touching code. If no posts exist yet, the seed arrays below are used
 * so the site is never empty on a fresh install — publish a Class or Membership
 * and the seeds stop being used for that type.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

/**
 * ⚠️ PRICES PENDING CONFIRMATION.
 *
 * These seed amounts are anchored to a historical listing and have NOT been
 * confirmed by the owner. Stripe charges exactly what is sent, so verify every
 * amount before taking live payments. Editing a class in wp-admin overrides
 * the seed entirely.
 */
function mast_seed_classes() {
	return array(
		array(
			'title' => 'Handgun Operator',
			'cat'   => 'Firearms',
			'meta'  => '2 days · All levels',
			'price' => 39500,
			'sku'   => 'MAST-HG-OP',
			'desc'  => 'Two days reinforcing the fundamentals, then adding non-static components — movement and fighting platforms.',
		),
		array(
			'title' => 'Advanced Weapons Operation',
			'cat'   => 'Firearms · Tactics',
			'meta'  => '2 days · LE / vetted',
			'price' => 59500,
			'sku'   => 'MAST-AWO',
			'desc'  => 'Advanced weapons operations in high-threat urban environments, for law enforcement, security teams, and select qualified citizens.',
		),
		array(
			'title' => 'Force on Force',
			'cat'   => 'Scenario',
			'meta'  => '1 day · Intermediate+',
			'price' => 49500,
			'sku'   => 'MAST-FOF',
			'desc'  => 'Carbine and handgun inside structures against live, controlled aggressors. Decision-making under real pressure.',
		),
		array(
			'title' => 'Direct Action',
			'cat'   => 'Law Enforcement',
			'meta'  => '2 days · LE only',
			'price' => 69500,
			'sku'   => 'MAST-DA',
			'desc'  => 'Small-unit operations in high-threat rural environments through the SUTRA curriculum.',
		),
		array(
			'title' => 'Low-Light / Night Ops',
			'cat'   => 'Conditions',
			'meta'  => '1 evening · Intermediate',
			'price' => 35000,
			'sku'   => 'MAST-LLNO',
			'desc'  => 'Marksmanship fundamentals and manipulation techniques, demonstrated and drilled in low-light conditions.',
		),
		array(
			'title' => 'Long Range Rifle',
			'cat'   => 'Precision',
			'meta'  => '1 day · All levels',
			'price' => 49500,
			'sku'   => 'MAST-LRR',
			'desc'  => 'Base fundamentals of marksmanship with a working understanding of ammunition and weapon systems.',
		),
		array(
			'title' => 'Tactical Medical Training',
			'cat'   => 'Medical',
			'meta'  => '1 day · All levels',
			'price' => 29500,
			'sku'   => 'MAST-TMED',
			'desc'  => 'Basic medical skills under stress — equipment, self-aid, and buddy-aid fundamentals.',
		),
		array(
			'title' => 'NRA Certified RSO',
			'cat'   => 'Certification',
			'meta'  => '1 day · Certification',
			'price' => 15000,
			'sku'   => 'MAST-RSO',
			'desc'  => 'Become an NRA Certified Range Safety Officer — organize and supervise safe shooting activities.',
		),
	);
}

/**
 * Membership tiers.
 *
 * Intentionally EMPTY until the owner supplies real tiers. The Memberships
 * section stays hidden on the front end while this returns no rows, so the
 * site never advertises a plan that does not exist.
 *
 * To add tiers: publish them under Memberships in wp-admin (preferred), or add
 * rows here. Each needs a Stripe `plan` key whose price ID is configured on the
 * Cloudflare Worker as STRIPE_PRICE_<PLAN> — see the theme README.
 */
function mast_seed_memberships() {
	return array();
}

/** Register the Classes and Memberships post types. */
function mast_register_post_types() {
	register_post_type(
		'mast_class',
		array(
			'labels'       => array(
				'name'          => __( 'Classes', 'mast' ),
				'singular_name' => __( 'Class', 'mast' ),
				'add_new_item'  => __( 'Add New Class', 'mast' ),
				'edit_item'     => __( 'Edit Class', 'mast' ),
			),
			'public'       => true,
			'has_archive'  => false,
			'menu_icon'    => 'dashicons-awards',
			'menu_position' => 21,
			'supports'     => array( 'title', 'editor', 'thumbnail', 'page-attributes' ),
			'rewrite'      => array( 'slug' => 'classes' ),
			'show_in_rest' => true,
		)
	);

	register_post_type(
		'mast_membership',
		array(
			'labels'       => array(
				'name'          => __( 'Memberships', 'mast' ),
				'singular_name' => __( 'Membership', 'mast' ),
				'add_new_item'  => __( 'Add New Membership', 'mast' ),
				'edit_item'     => __( 'Edit Membership', 'mast' ),
			),
			'public'       => false,
			'show_ui'      => true,
			'menu_icon'    => 'dashicons-id-alt',
			'menu_position' => 22,
			'supports'     => array( 'title', 'editor', 'page-attributes' ),
			'show_in_rest' => true,
		)
	);
}
add_action( 'init', 'mast_register_post_types' );

/** Meta fields, registered so they are typed and REST-visible. */
function mast_register_meta() {
	$fields = array(
		'mast_class' => array(
			'_mast_price_cents' => 'integer',
			'_mast_category'    => 'string',
			'_mast_meta'        => 'string',
			'_mast_sku'         => 'string',
		),
		'mast_membership' => array(
			'_mast_price_cents' => 'integer',
			'_mast_interval'    => 'string',
			'_mast_plan_key'    => 'string',
			'_mast_features'    => 'string',
			'_mast_featured'    => 'boolean',
		),
	);

	foreach ( $fields as $post_type => $keys ) {
		foreach ( $keys as $key => $type ) {
			register_post_meta(
				$post_type,
				$key,
				array(
					'type'          => $type,
					'single'        => true,
					'show_in_rest'  => true,
					'auth_callback' => function () {
						return current_user_can( 'edit_posts' );
					},
				)
			);
		}
	}
}
add_action( 'init', 'mast_register_meta' );

/** Add the pricing/detail meta boxes. */
function mast_add_meta_boxes() {
	add_meta_box( 'mast_class_details', __( 'Class Details & Price', 'mast' ), 'mast_class_meta_box', 'mast_class', 'normal', 'high' );
	add_meta_box( 'mast_membership_details', __( 'Membership Details & Price', 'mast' ), 'mast_membership_meta_box', 'mast_membership', 'normal', 'high' );
}
add_action( 'add_meta_boxes', 'mast_add_meta_boxes' );

/** Render the Class meta box. */
function mast_class_meta_box( $post ) {
	wp_nonce_field( 'mast_save_meta', 'mast_meta_nonce' );
	$price = get_post_meta( $post->ID, '_mast_price_cents', true );
	$cat   = get_post_meta( $post->ID, '_mast_category', true );
	$meta  = get_post_meta( $post->ID, '_mast_meta', true );
	$sku   = get_post_meta( $post->ID, '_mast_sku', true );
	?>
	<style>.mast-field{margin:14px 0}.mast-field label{display:block;font-weight:600;margin-bottom:4px}.mast-field input{width:100%;max-width:460px}.mast-hint{color:#666;font-size:12px;margin-top:3px}</style>
	<div class="mast-field">
		<label for="mast_price"><?php esc_html_e( 'Price per seat (USD)', 'mast' ); ?></label>
		<input type="number" step="0.01" min="1" id="mast_price" name="mast_price" value="<?php echo esc_attr( $price ? number_format( (int) $price / 100, 2, '.', '' ) : '' ); ?>">
		<p class="mast-hint"><?php esc_html_e( 'What Stripe charges. Enter dollars, e.g. 395.00 — stored as cents.', 'mast' ); ?></p>
	</div>
	<div class="mast-field">
		<label for="mast_category"><?php esc_html_e( 'Category chip', 'mast' ); ?></label>
		<input type="text" id="mast_category" name="mast_category" value="<?php echo esc_attr( $cat ); ?>" placeholder="Firearms · Tactics">
	</div>
	<div class="mast-field">
		<label for="mast_meta"><?php esc_html_e( 'Duration / level line', 'mast' ); ?></label>
		<input type="text" id="mast_meta" name="mast_meta" value="<?php echo esc_attr( $meta ); ?>" placeholder="2 days · All levels">
	</div>
	<div class="mast-field">
		<label for="mast_sku"><?php esc_html_e( 'SKU', 'mast' ); ?></label>
		<input type="text" id="mast_sku" name="mast_sku" value="<?php echo esc_attr( $sku ); ?>" placeholder="MAST-HG-OP">
		<p class="mast-hint"><?php esc_html_e( 'Passed to Stripe as order metadata.', 'mast' ); ?></p>
	</div>
	<?php
}

/** Render the Membership meta box. */
function mast_membership_meta_box( $post ) {
	wp_nonce_field( 'mast_save_meta', 'mast_meta_nonce' );
	$price    = get_post_meta( $post->ID, '_mast_price_cents', true );
	$interval = get_post_meta( $post->ID, '_mast_interval', true );
	$plan     = get_post_meta( $post->ID, '_mast_plan_key', true );
	$features = get_post_meta( $post->ID, '_mast_features', true );
	$featured = get_post_meta( $post->ID, '_mast_featured', true );
	?>
	<style>.mast-field{margin:14px 0}.mast-field label{display:block;font-weight:600;margin-bottom:4px}.mast-field input[type=text],.mast-field input[type=number],.mast-field select,.mast-field textarea{width:100%;max-width:460px}.mast-hint{color:#666;font-size:12px;margin-top:3px}</style>
	<div class="mast-field">
		<label for="mast_price"><?php esc_html_e( 'Price (USD)', 'mast' ); ?></label>
		<input type="number" step="0.01" min="1" id="mast_price" name="mast_price" value="<?php echo esc_attr( $price ? number_format( (int) $price / 100, 2, '.', '' ) : '' ); ?>">
		<p class="mast-hint"><?php esc_html_e( 'Display price only. Stripe bills the amount on the Price ID below.', 'mast' ); ?></p>
	</div>
	<div class="mast-field">
		<label for="mast_interval"><?php esc_html_e( 'Billing interval', 'mast' ); ?></label>
		<select id="mast_interval" name="mast_interval">
			<?php foreach ( array( 'month' => 'per month', 'year' => 'per year', 'quarter' => 'per quarter' ) as $key => $label ) : ?>
				<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $interval, $key ); ?>><?php echo esc_html( $label ); ?></option>
			<?php endforeach; ?>
		</select>
	</div>
	<div class="mast-field">
		<label for="mast_plan_key"><?php esc_html_e( 'Stripe plan key', 'mast' ); ?></label>
		<input type="text" id="mast_plan_key" name="mast_plan_key" value="<?php echo esc_attr( $plan ); ?>" placeholder="range_member">
		<p class="mast-hint"><?php esc_html_e( 'Lowercase key sent to the checkout Worker. The Worker must have STRIPE_PRICE_<KEY> set to the matching Stripe Price ID (uppercased). See the theme README.', 'mast' ); ?></p>
	</div>
	<div class="mast-field">
		<label for="mast_features"><?php esc_html_e( 'Included features (one per line)', 'mast' ); ?></label>
		<textarea id="mast_features" name="mast_features" rows="6" placeholder="Unlimited range access&#10;10% off all classes"><?php echo esc_textarea( $features ); ?></textarea>
	</div>
	<div class="mast-field">
		<label><input type="checkbox" name="mast_featured" value="1" <?php checked( $featured, '1' ); ?>> <?php esc_html_e( 'Highlight this tier as "Most Popular"', 'mast' ); ?></label>
	</div>
	<?php
}

/** Persist meta box values. */
function mast_save_meta( $post_id ) {
	if ( ! isset( $_POST['mast_meta_nonce'] ) || ! wp_verify_nonce( sanitize_key( wp_unslash( $_POST['mast_meta_nonce'] ) ), 'mast_save_meta' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}

	if ( isset( $_POST['mast_price'] ) ) {
		$dollars = (float) wp_unslash( $_POST['mast_price'] );
		update_post_meta( $post_id, '_mast_price_cents', (int) round( $dollars * 100 ) );
	}

	$text_fields = array(
		'mast_category'  => '_mast_category',
		'mast_meta'      => '_mast_meta',
		'mast_sku'       => '_mast_sku',
		'mast_interval'  => '_mast_interval',
		'mast_plan_key'  => '_mast_plan_key',
	);
	foreach ( $text_fields as $input => $key ) {
		if ( isset( $_POST[ $input ] ) ) {
			update_post_meta( $post_id, $key, sanitize_text_field( wp_unslash( $_POST[ $input ] ) ) );
		}
	}

	if ( isset( $_POST['mast_features'] ) ) {
		update_post_meta( $post_id, '_mast_features', sanitize_textarea_field( wp_unslash( $_POST['mast_features'] ) ) );
	}

	update_post_meta( $post_id, '_mast_featured', isset( $_POST['mast_featured'] ) ? '1' : '' );
}
add_action( 'save_post_mast_class', 'mast_save_meta' );
add_action( 'save_post_mast_membership', 'mast_save_meta' );

/**
 * Get classes for the front end — published posts if any exist, else the seeds.
 *
 * @return array List of normalized class rows.
 */
function mast_get_classes() {
	$posts = get_posts(
		array(
			'post_type'      => 'mast_class',
			'post_status'    => 'publish',
			'numberposts'    => 50,
			'orderby'        => array( 'menu_order' => 'ASC', 'date' => 'ASC' ),
		)
	);

	if ( empty( $posts ) ) {
		return mast_seed_classes();
	}

	$out = array();
	foreach ( $posts as $p ) {
		$out[] = array(
			'title' => $p->post_title,
			'cat'   => get_post_meta( $p->ID, '_mast_category', true ),
			'meta'  => get_post_meta( $p->ID, '_mast_meta', true ),
			'price' => (int) get_post_meta( $p->ID, '_mast_price_cents', true ),
			'sku'   => get_post_meta( $p->ID, '_mast_sku', true ),
			'desc'  => wp_strip_all_tags( $p->post_content ),
		);
	}
	return $out;
}

/**
 * Get membership tiers. Returns an empty array until tiers are published,
 * which keeps the Memberships section off the page entirely.
 *
 * @return array List of normalized membership rows.
 */
function mast_get_memberships() {
	$posts = get_posts(
		array(
			'post_type'      => 'mast_membership',
			'post_status'    => 'publish',
			'numberposts'    => 20,
			'orderby'        => array( 'menu_order' => 'ASC', 'date' => 'ASC' ),
		)
	);

	if ( empty( $posts ) ) {
		return mast_seed_memberships();
	}

	$out = array();
	foreach ( $posts as $p ) {
		$features = get_post_meta( $p->ID, '_mast_features', true );
		$out[]    = array(
			'title'    => $p->post_title,
			'price'    => (int) get_post_meta( $p->ID, '_mast_price_cents', true ),
			'interval' => get_post_meta( $p->ID, '_mast_interval', true ) ?: 'month',
			'plan'     => get_post_meta( $p->ID, '_mast_plan_key', true ),
			'featured' => '1' === get_post_meta( $p->ID, '_mast_featured', true ),
			'desc'     => wp_strip_all_tags( $p->post_content ),
			'features' => array_values( array_filter( array_map( 'trim', explode( "\n", (string) $features ) ) ) ),
		);
	}
	return $out;
}

/** Format cents as a display price. */
function mast_price( $cents ) {
	$cents = (int) $cents;
	return '$' . number_format( $cents / 100, ( $cents % 100 ) ? 2 : 0 );
}
