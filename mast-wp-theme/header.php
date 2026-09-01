<?php
/**
 * Site header.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header">
	<div class="container nav">
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="brand">
			<?php if ( has_custom_logo() ) : ?>
				<?php the_custom_logo(); ?>
			<?php else : ?>
				<span class="mark">MAST<em>SOLUTIONS</em></span>
				<span class="since"><?php esc_html_e( 'HTX · EST 2005', 'mast' ); ?></span>
			<?php endif; ?>
		</a>

		<?php if ( has_nav_menu( 'primary' ) ) : ?>
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'primary',
					'container'      => false,
					'menu_class'     => 'nav-links',
					'depth'          => 1,
				)
			);
			?>
		<?php else : ?>
			<ul class="nav-links">
				<li><a href="#classes"><?php esc_html_e( 'Classes', 'mast' ); ?></a></li>
				<?php if ( mast_get_memberships() ) : ?>
					<li><a href="#memberships"><?php esc_html_e( 'Memberships', 'mast' ); ?></a></li>
				<?php endif; ?>
				<li><a href="#skills"><?php esc_html_e( 'Curriculum', 'mast' ); ?></a></li>
				<li><a href="#instructor"><?php esc_html_e( 'Instructor', 'mast' ); ?></a></li>
				<li><a href="#media"><?php esc_html_e( 'Media', 'mast' ); ?></a></li>
				<li><a href="#reviews"><?php esc_html_e( 'Reviews', 'mast' ); ?></a></li>
				<li><a href="#classes" class="btn btn-primary nav-cta"><?php esc_html_e( 'Book a Class', 'mast' ); ?></a></li>
			</ul>
		<?php endif; ?>

		<button class="menu-btn" aria-label="<?php esc_attr_e( 'Open menu', 'mast' ); ?>" aria-controls="mobile-panel" aria-expanded="false" data-mast-menu>&#9776;</button>
	</div>

	<nav id="mobile-panel" class="mobile-panel" aria-label="<?php esc_attr_e( 'Mobile', 'mast' ); ?>">
		<a href="#classes"><?php esc_html_e( 'Classes', 'mast' ); ?></a>
		<?php if ( mast_get_memberships() ) : ?>
			<a href="#memberships"><?php esc_html_e( 'Memberships', 'mast' ); ?></a>
		<?php endif; ?>
		<a href="#skills"><?php esc_html_e( 'Curriculum', 'mast' ); ?></a>
		<a href="#instructor"><?php esc_html_e( 'Instructor', 'mast' ); ?></a>
		<a href="#media"><?php esc_html_e( 'Media', 'mast' ); ?></a>
		<a href="#reviews"><?php esc_html_e( 'Reviews', 'mast' ); ?></a>
		<a href="#classes" style="color:var(--accent);"><?php esc_html_e( 'Book a Class →', 'mast' ); ?></a>
	</nav>
</header>

<div id="mast-banner" class="banner" role="status"></div>
